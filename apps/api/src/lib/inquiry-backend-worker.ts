import { NextRequest } from 'next/server';
import { POST as prepareInquiry } from '@/app/api/inquiry/prepare/route';
import { POST as submitInquiry } from '@/app/api/inquiry/submit/route';
import {
  addInquiryLog,
  addInquiryResult,
  clearInquiryRunContext,
  getActiveInquiryRunId,
  getInquiryRunDiagnostics,
  getInquiryRunState,
  inquiryCheckpoint,
  InquiryRunStoppedError,
  setInquiryRunState,
} from '@/lib/inquiry-run-store';
import { closeInquirySession } from '@/lib/inquiry-browser-store';
import {
  canEmitInquiryProgress,
  cancelInquiryItemAttempt,
  finishInquiryItemAttempt,
  formatAttemptStep,
  getInquiryItemAttempt,
  isActiveInquiryItemAttempt,
  markInquiryItemCaptchaDetected,
  registerInquiryItemTimer,
  renewInquiryItemOperation,
  startInquiryItemAttempt,
  transitionInquiryItemState,
  type InquiryAttemptRef,
  type InquiryTerminalReasonCode,
  type InquiryTerminalState,
} from '@/lib/inquiry-item-lifecycle';
import { isCaptchaPrimaryReason } from '@/lib/inquiry-submit-captcha-policy';

const globalWorkers = globalThis as typeof globalThis & {
  __threeDSuiteInquiryWorkers?: Map<string, Promise<void>>;
};
const workers = globalWorkers.__threeDSuiteInquiryWorkers ?? new Map<string, Promise<void>>();
if (!globalWorkers.__threeDSuiteInquiryWorkers) globalWorkers.__threeDSuiteInquiryWorkers = workers;

const INQUIRY_SCAN_TIMEOUT_MS = 75_000;
const INQUIRY_SUBMIT_TIMEOUT_MS = 35_000;

function requestFor(licenseId: string, path: string, payload: unknown): NextRequest {
  return new NextRequest(`http://inquiry.internal${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-3d-suite-license-id': licenseId,
    },
    body: JSON.stringify(payload),
  });
}

async function responseJson(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

function assertWorkerActive(licenseId: string, runId: string): void {
  const diagnostics = getInquiryRunDiagnostics(licenseId, runId);
  const state = getInquiryRunState(licenseId);
  if (diagnostics.stopped || state.mode === 'stopped') throw new InquiryRunStoppedError('stopped_by_user');
  if (!diagnostics.isActive) throw new InquiryRunStoppedError('stale_run_context');
}

class InquiryRunContextError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: ReturnType<typeof getInquiryRunDiagnostics>
  ) {
    super(message);
    this.name = 'InquiryRunContextError';
  }
}

class InquiryTargetTimeoutError extends Error {
  constructor(
    public phase: 'prepare' | 'submit',
    public target: string,
    public timeoutMs: number
  ) {
    super(
      `${phase === 'prepare' ? 'Form discovery/preparation' : 'Submission'} timed out after ${Math.round(timeoutMs / 1000)}s`
    );
    this.name = 'InquiryTargetTimeoutError';
  }
}

async function withTargetWatchdog<T>(args: {
  licenseId: string;
  runId: string;
  sessionId: string;
  target: string;
  index: number;
  total: number;
  phase: 'prepare' | 'submit';
  timeoutMs: number;
  task: Promise<T>;
  attempt: InquiryAttemptRef;
}): Promise<T> {
  const startedAt = Date.now();
  renewInquiryItemOperation(args.attempt, args.phase === 'prepare' ? 'scan' : 'submit');

  const heartbeat = setInterval(() => {
    if (!canEmitInquiryProgress(args.attempt)) return;
    const state = getInquiryRunState(args.licenseId);
    if (state.mode === 'stopped' || (state.runId && state.runId !== args.runId)) return;
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    addInquiryLog({
      licenseId: args.licenseId,
      runId: args.runId,
      level: 'info',
      message: formatAttemptStep(
        `${args.index + 1}/${args.total} — still ${args.phase === 'prepare' ? 'scanning' : 'submitting'} ${args.target} (${elapsed}s)`,
        args.attempt
      ),
      attemptId: args.attempt.attemptId,
      sessionGeneration: args.attempt.sessionGeneration,
      targetIndex: args.attempt.index,
      target: args.target,
    });
  }, 20_000);
  registerInquiryItemTimer(args.attempt, heartbeat);

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(async () => {
      cancelInquiryItemAttempt(
        args.attempt,
        args.phase === 'prepare' ? 'TIMEOUT_SCAN' : 'TIMEOUT_SUBMIT',
        args.phase === 'prepare' ? 'scan_timeout' : 'submit_timeout',
        `${args.phase}_timeout_${Math.round(args.timeoutMs / 1000)}s`
      );
      try {
        await closeInquirySession(args.sessionId, args.licenseId);
      } catch {}
      reject(new InquiryTargetTimeoutError(args.phase, args.target, args.timeoutMs));
    }, args.timeoutMs);
  });
  if (timeoutHandle) registerInquiryItemTimer(args.attempt, timeoutHandle);

  try {
    return await Promise.race([args.task, timeout]);
  } finally {
    clearInterval(heartbeat);
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function terminalResultFor(
  input: {
    terminalState: InquiryTerminalState;
    reasonCode: InquiryTerminalReasonCode;
    target: string;
    detail?: string;
    captchaType?: string;
  }
): { status: 'submitted' | 'failed' | 'captcha' | 'review'; reason?: string; primaryReason?: string; failureDetail?: string; captchaDetected?: boolean; captchaType?: string; captchaProvider?: string; contactUrl?: string } | null {
  if (input.terminalState === 'SUBMITTED') {
    return {
      status: 'submitted',
      reason: input.detail || input.reasonCode,
      primaryReason: input.reasonCode,
      failureDetail: input.detail,
      captchaDetected: input.reasonCode === 'captcha_solved' ? true : undefined,
      captchaType: input.reasonCode === 'captcha_solved' ? input.captchaType : undefined,
      captchaProvider: input.reasonCode === 'captcha_solved' ? input.captchaType || 'CAPTCHA' : undefined,
      contactUrl: input.target,
    };
  }
  if (isCaptchaPrimaryReason(input.reasonCode)) {
    return {
      status: 'captcha',
      reason: input.detail || input.reasonCode,
      primaryReason: input.reasonCode,
      failureDetail: input.detail,
      captchaDetected: true,
      captchaType: input.captchaType,
      captchaProvider: input.captchaType || 'CAPTCHA',
      contactUrl: input.target,
    };
  }
  switch (input.terminalState) {
    case 'TIMEOUT_SUBMIT':
      return {
        status: 'review',
        reason: input.detail || 'submit_timeout',
        primaryReason: input.reasonCode,
        failureDetail: input.detail,
        contactUrl: input.target,
      };
    case 'SKIPPED_NO_FORM':
    case 'TIMEOUT_SCAN':
    case 'FAILED':
      return {
        status: 'failed',
        reason: input.detail || input.reasonCode,
        primaryReason: input.reasonCode,
        failureDetail: input.detail,
        contactUrl: input.target,
      };
    default:
      return null;
  }
}

function canonicalTerminalMessage(args: {
  index: number;
  total: number;
  target: string;
  reasonCode: InquiryTerminalReasonCode;
  detail?: string;
}): string {
  const prefix = `${args.index + 1}/${args.total} — ${args.target}`;
  switch (args.reasonCode) {
    case 'submitted_success':
      return `${prefix} — [submitted_success] submission confirmed${args.detail ? ` — ${args.detail}` : ''}`;
    case 'no_form_found':
      return `${prefix} — [no_form_found] no usable contact/quote/inquiry form found; skipped automatically`;
    case 'captcha_detected_autoskip':
      return `${prefix} — [captcha_detected_autoskip] CAPTCHA still required on the active form; saved and skipped automatically`;
    case 'captcha_solved':
      return `${prefix} — [captcha_solved] CAPTCHA cleared and submission confirmed`;
    case 'captcha_unsolved_after_token':
      return `${prefix} — [captcha_unsolved_after_token] CAPTCHA token returned but the challenge is still required`;
    case 'captcha_solver_timeout':
      return `${prefix} — [captcha_solver_timeout] CAPTCHA solver timed out before the challenge cleared`;
    case 'captcha_solver_failed':
      return `${prefix} — [captcha_solver_failed] ${args.detail || 'CAPTCHA solve flow did not complete successfully'}`;
    case 'captcha_required_manual_review':
      return `${prefix} — [captcha_required_manual_review] ${args.detail || 'CAPTCHA path still needs manual review'}`;
    case 'scan_timeout':
      return `${prefix} — [scan_timeout] scan timed out; browser session recycled and skipped automatically`;
    case 'submit_timeout':
      return `${prefix} — [submit_timeout] submission timed out; browser session recycled and saved for review`;
    case 'submit_failed':
    default:
      return `${prefix} — [submit_failed] ${args.detail || 'submission/prepare failed'}`;
  }
}

export function startInquiryBackendWorker(args: {
  licenseId: string;
  runId: string;
  sessionId: string;
  targets: string[];
  startIndex: number;
  profile: Record<string, unknown>;
}): void {
  // Prevent starting the same run twice.
  if (workers.has(`${args.licenseId}:${args.runId}`)) return;
  console.info(`[inquiry-worker] runId=${args.runId} licenseId=${args.licenseId} isStopped=false controllers=created starting ${args.targets.length} targets`);

  const key = `${args.licenseId}:${args.runId}`;

  const task = (async () => {
    const summary = { processed: 0, success: 0, skippedReview: 0, failed: 0 };
    const summaryText = () =>
      `${summary.processed}/${args.targets.length} processed (success ${summary.success}, skipped/review ${summary.skippedReview}, failed ${summary.failed})`;
    const trackTerminal = (terminalState: InquiryTerminalState) => {
      summary.processed += 1;
      if (terminalState === 'SUBMITTED') summary.success += 1;
      else if (
        terminalState === 'SKIPPED_NO_FORM' ||
        terminalState === 'SKIPPED_CAPTCHA_REQUIRED' ||
        terminalState === 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED' ||
        terminalState === 'TIMEOUT_SUBMIT'
      ) {
        summary.skippedReview += 1;
      } else {
        summary.failed += 1;
      }
    };
    const logRunContextDebug = (label: 'run_start' | 'item_1') => {
      const diagnostics = getInquiryRunDiagnostics(args.licenseId, args.runId);
      addInquiryLog({
        licenseId: args.licenseId,
        runId: args.runId,
        level: 'info',
        message: `[debug] ${label} run-context — runId=${args.runId} activeRunId=${getActiveInquiryRunId(args.licenseId) || 'none'} contextExists=${diagnostics.contextExists} stopped=${diagnostics.stopped}`,
      });
      if (!diagnostics.isActive) {
        throw new InquiryRunContextError(
          `Inactive inquiry run context at ${label}.`,
          diagnostics
        );
      }
    };
    try {
      logRunContextDebug('run_start');
      let sessionGeneration = 1;
      for (let i = Math.max(0, args.startIndex); i < args.targets.length; i += 1) {
        await inquiryCheckpoint(args.licenseId, args.runId);
        const state = getInquiryRunState(args.licenseId);
        if (state.runId && state.runId !== args.runId) return;
        if (i === Math.max(0, args.startIndex)) logRunContextDebug('item_1');

        const target = args.targets[i];
        const attempt = startInquiryItemAttempt({
          licenseId: args.licenseId,
          runId: args.runId,
          target,
          index: i,
          sessionGeneration,
        });

        const addPhaseLog = (level: 'info' | 'success' | 'warning' | 'error', message: string) => {
          if (!canEmitInquiryProgress(attempt)) return;
          addInquiryLog({
            licenseId: args.licenseId,
            runId: args.runId,
            level,
            message: formatAttemptStep(message, attempt),
            attemptId: attempt.attemptId,
            sessionGeneration: attempt.sessionGeneration,
            targetIndex: attempt.index,
            target,
          });
        };

        const emitTerminal = (input: {
          terminalState: 'SUBMITTED';
          reasonCode: 'submitted_success' | 'captcha_solved';
          level: 'success';
          detail?: string;
          contactUrl?: string;
          captchaType?: string;
        } | {
          terminalState: Exclude<InquiryTerminalState, 'SUBMITTED'>;
          reasonCode: Exclude<InquiryTerminalReasonCode, 'submitted_success'>;
          level: 'success' | 'warning' | 'error';
          detail?: string;
          contactUrl?: string;
          captchaType?: string;
        }): boolean => {
          const emitted = input.terminalState === 'SUBMITTED'
            ? finishInquiryItemAttempt(attempt, input.terminalState, input.reasonCode, input.detail)
            : cancelInquiryItemAttempt(attempt, input.terminalState, input.reasonCode, input.detail);
          if (!emitted) return false;
          const result = terminalResultFor({
            terminalState: input.terminalState,
            reasonCode: input.reasonCode,
            target: input.contactUrl || target,
            detail: input.detail,
            captchaType: input.captchaType,
          });
          if (result) {
            addInquiryResult({
              licenseId: args.licenseId,
              runId: args.runId,
              sessionId: args.sessionId,
              target,
              ...result,
              contactUrl: input.contactUrl || result.contactUrl,
              attemptId: attempt.attemptId,
              sessionGeneration: attempt.sessionGeneration,
              targetIndex: i,
            });
          }
          trackTerminal(input.terminalState);
          addInquiryLog({
            licenseId: args.licenseId,
            runId: args.runId,
            level: input.level,
            message: formatAttemptStep(
              canonicalTerminalMessage({
                index: i,
                total: args.targets.length,
                target,
                reasonCode: input.reasonCode,
                detail: input.detail,
              }),
              attempt
            ),
            attemptId: attempt.attemptId,
            sessionGeneration: attempt.sessionGeneration,
            targetIndex: attempt.index,
            target,
          });
          return true;
        };

        setInquiryRunState(args.licenseId, 'running', {
          runId: args.runId,
          sessionId: args.sessionId,
          targets: args.targets,
          totalTargets: args.targets.length,
          index: i,
          currentTarget: target,
        });
        addPhaseLog('info', `${i + 1}/${args.targets.length} — checking ${target} for a contact form`);

        let prepareResponse: Response;
        try {
          prepareResponse = await withTargetWatchdog({
            licenseId: args.licenseId,
            runId: args.runId,
            sessionId: args.sessionId,
            target,
            index: i,
            total: args.targets.length,
            phase: 'prepare',
            timeoutMs: INQUIRY_SCAN_TIMEOUT_MS,
            attempt,
            task: prepareInquiry(
              requestFor(args.licenseId, '/api/inquiry/prepare', {
                sessionId: args.sessionId,
                runId: args.runId,
                target,
                profile: args.profile,
                attemptId: attempt.attemptId,
                sessionGeneration: attempt.sessionGeneration,
                targetIndex: i,
              })
            ),
          });
        } catch (error) {
          assertWorkerActive(args.licenseId, args.runId);
          if (error instanceof InquiryTargetTimeoutError) {
            emitTerminal({
              terminalState: 'TIMEOUT_SCAN',
              reasonCode: 'scan_timeout',
              level: 'warning',
              detail: `scan timed out after ${Math.round(error.timeoutMs / 1000)}s`,
            });
            sessionGeneration += 1;
            continue;
          }
          const snapshot = getInquiryItemAttempt(attempt);
          cancelInquiryItemAttempt(
            attempt,
            snapshot?.captchaClassificationLocked ? 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED' : 'FAILED',
            snapshot?.captchaClassificationLocked ? 'captcha_solver_failed' : 'submit_failed',
            'prepare_exception'
          );
          throw error;
        }
        assertWorkerActive(args.licenseId, args.runId);
        if (!isActiveInquiryItemAttempt(attempt)) continue;

        const prepared = await responseJson(prepareResponse);
        assertWorkerActive(args.licenseId, args.runId);
        if (!isActiveInquiryItemAttempt(attempt)) continue;

        if (!(prepareResponse.ok && prepared?.success)) {
          if (prepared?.code === 'RUN_STOPPED') {
            throw new InquiryRunContextError(
              prepared?.error || 'Inquiry run context is no longer active.',
              getInquiryRunDiagnostics(args.licenseId, args.runId)
            );
          }
          emitTerminal({
            terminalState: 'FAILED',
            reasonCode: 'submit_failed',
            level: 'error',
            detail: `prepare failed: ${prepared?.error || `HTTP ${prepareResponse.status}`}`,
          });
          continue;
        }

        const classification = String(prepared.classification || (prepared.captchaDetected ? 'captcha' : 'form_found'));
        if (prepared?.captchaDetected || prepared?.captchaClassificationLocked) {
          markInquiryItemCaptchaDetected(attempt, prepared?.captchaType || prepared?.captchaProvider);
        }
        if (classification === 'captcha') {
          transitionInquiryItemState(attempt, 'CAPTCHA_CHECKING');
          transitionInquiryItemState(attempt, 'CAPTCHA_REQUIRED');
          emitTerminal({
            terminalState: 'SKIPPED_CAPTCHA_REQUIRED',
            reasonCode: isCaptchaPrimaryReason(prepared?.primaryReason) ? prepared.primaryReason : 'captcha_detected_autoskip',
            level: 'warning',
            detail: prepared.failureDetail || prepared.reason || `${prepared.captchaProvider || 'CAPTCHA'} required on ${prepared.contactUrl || target}`,
            contactUrl: prepared.contactUrl || target,
            captchaType: prepared?.captchaType || prepared?.captchaProvider,
          });
        } else if (classification === 'review_required') {
          transitionInquiryItemState(attempt, 'CAPTCHA_CHECKING');
          transitionInquiryItemState(attempt, 'CAPTCHA_REQUIRED');
          emitTerminal({
            terminalState: 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED',
            reasonCode: isCaptchaPrimaryReason(prepared?.primaryReason) ? prepared.primaryReason : 'captcha_required_manual_review',
            level: 'warning',
            detail: prepared.failureDetail || prepared.reviewReason || prepared.reason || 'manual interaction needed',
            contactUrl: prepared.contactUrl || target,
            captchaType: prepared?.captchaType || prepared?.captchaProvider,
          });
        } else if (classification === 'site_unavailable') {
          emitTerminal({
            terminalState: 'FAILED',
            reasonCode: 'submit_failed',
            level: 'warning',
            detail: `website unavailable (${prepared.unavailableReason || 'SITE_UNAVAILABLE'})`,
            contactUrl: prepared.contactUrl || target,
          });
        } else if (classification === 'no_form') {
          emitTerminal({
            terminalState: 'SKIPPED_NO_FORM',
            reasonCode: 'no_form_found',
            level: 'warning',
            detail: prepared.noFormReason,
            contactUrl: prepared.contactUrl || target,
          });
        } else if (classification === 'form_found') {
          transitionInquiryItemState(attempt, 'FORM_FOUND');
          transitionInquiryItemState(attempt, 'CAPTCHA_CHECKING');
          transitionInquiryItemState(attempt, 'READY_TO_SUBMIT');
          addPhaseLog('success', `${i + 1}/${args.targets.length} — form found and prepared on ${prepared.contactUrl || target}`);
          addPhaseLog('info', `${i + 1}/${args.targets.length} — auto-submit — completing review/next steps and submitting ${target}`);
          await inquiryCheckpoint(args.licenseId, args.runId);
          transitionInquiryItemState(attempt, 'SUBMITTING');

          let submitResponse: Response;
          try {
            submitResponse = await withTargetWatchdog({
              licenseId: args.licenseId,
              runId: args.runId,
              sessionId: args.sessionId,
              target,
              index: i,
              total: args.targets.length,
              phase: 'submit',
              timeoutMs: INQUIRY_SUBMIT_TIMEOUT_MS,
              attempt,
              task: submitInquiry(
                requestFor(args.licenseId, '/api/inquiry/submit', {
                  sessionId: args.sessionId,
                  runId: args.runId,
                  attemptId: attempt.attemptId,
                  sessionGeneration: attempt.sessionGeneration,
                  targetIndex: i,
                })
              ),
            });
          } catch (error) {
            assertWorkerActive(args.licenseId, args.runId);
            if (error instanceof InquiryTargetTimeoutError) {
              emitTerminal({
                terminalState: 'TIMEOUT_SUBMIT',
                reasonCode: 'submit_timeout',
                level: 'warning',
                detail: `submission timed out after ${Math.round(error.timeoutMs / 1000)}s`,
                contactUrl: prepared.contactUrl || target,
              });
              sessionGeneration += 1;
              continue;
            }
            const snapshot = getInquiryItemAttempt(attempt);
            cancelInquiryItemAttempt(
              attempt,
              snapshot?.captchaClassificationLocked ? 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED' : 'FAILED',
              snapshot?.captchaClassificationLocked ? 'captcha_solver_failed' : 'submit_failed',
              'submit_exception'
            );
            throw error;
          }
          assertWorkerActive(args.licenseId, args.runId);
          if (!isActiveInquiryItemAttempt(attempt)) continue;

          const submitted = await responseJson(submitResponse);
          assertWorkerActive(args.licenseId, args.runId);
          if (!isActiveInquiryItemAttempt(attempt)) continue;

          if (submitResponse.ok && submitted?.success) {
            const snapshot = getInquiryItemAttempt(attempt);
            emitTerminal({
              terminalState: 'SUBMITTED',
              reasonCode: snapshot?.captchaClassificationLocked ? 'captcha_solved' : 'submitted_success',
              level: 'success',
              detail: submitted.confirmation || submitted.currentUrl || prepared.contactUrl || target,
              contactUrl: submitted.currentUrl || prepared.contactUrl || target,
              captchaType: snapshot?.captchaType,
            });
          } else if (submitted?.captchaDetected) {
            markInquiryItemCaptchaDetected(attempt, submitted?.captchaType || submitted?.captchaProvider);
            transitionInquiryItemState(attempt, 'CAPTCHA_CHECKING');
            transitionInquiryItemState(attempt, 'CAPTCHA_REQUIRED');
            emitTerminal({
              terminalState: 'SKIPPED_CAPTCHA_REQUIRED',
              reasonCode: isCaptchaPrimaryReason(submitted?.primaryReason) ? submitted.primaryReason : 'captcha_detected_autoskip',
              level: 'warning',
              detail: submitted.failureDetail || submitted.error || submitted.reason || `${submitted.captchaProvider || 'CAPTCHA'} required during submit`,
              contactUrl: prepared.contactUrl || target,
              captchaType: submitted?.captchaType || submitted?.captchaProvider,
            });
          } else if (submitted?.reviewRequired) {
            if (submitted?.captchaClassificationLocked || isCaptchaPrimaryReason(submitted?.primaryReason)) {
              markInquiryItemCaptchaDetected(attempt, submitted?.captchaType || submitted?.captchaProvider);
            }
            transitionInquiryItemState(attempt, 'CAPTCHA_CHECKING');
            transitionInquiryItemState(attempt, 'CAPTCHA_REQUIRED');
            emitTerminal({
              terminalState: 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED',
              reasonCode: isCaptchaPrimaryReason(submitted?.primaryReason) ? submitted.primaryReason : 'captcha_required_manual_review',
              level: 'warning',
              detail: submitted.failureDetail || submitted.reason || submitted.error || 'manual interaction needed',
              contactUrl: prepared.contactUrl || target,
              captchaType: submitted?.captchaType || submitted?.captchaProvider,
            });
          } else {
            if (submitted?.code === 'RUN_STOPPED') {
              throw new InquiryRunContextError(
                submitted?.error || 'Inquiry run context is no longer active.',
                getInquiryRunDiagnostics(args.licenseId, args.runId)
              );
            }
            const snapshot = getInquiryItemAttempt(attempt);
            const captchaLocked = !!snapshot?.captchaClassificationLocked;
            emitTerminal({
              terminalState: captchaLocked ? 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED' : 'FAILED',
              reasonCode: captchaLocked ? 'captcha_solver_failed' : 'submit_failed',
              level: captchaLocked ? 'warning' : 'error',
              detail: submitted?.failureDetail || submitted?.error || `HTTP ${submitResponse.status}`,
              contactUrl: prepared.contactUrl || target,
              captchaType: snapshot?.captchaType,
            });
          }
        }

        assertWorkerActive(args.licenseId, args.runId);
        await new Promise((resolve) => setTimeout(resolve, 1800));
        assertWorkerActive(args.licenseId, args.runId);

        const snapshot = getInquiryItemAttempt(attempt);
        if (snapshot?.terminalEmitted) {
          setInquiryRunState(args.licenseId, 'running', {
            runId: args.runId,
            sessionId: args.sessionId,
            targets: args.targets,
            totalTargets: args.targets.length,
            index: Math.min(i + 1, args.targets.length - 1),
            currentTarget: args.targets[i + 1] || '',
          });
        }
      }

      assertWorkerActive(args.licenseId, args.runId);
      addInquiryLog({
        licenseId: args.licenseId,
        runId: args.runId,
        level: 'success',
        message: `Inquiry automatic run complete — ${summaryText()}`,
      });
      setInquiryRunState(args.licenseId, 'complete', {
        runId: args.runId,
        sessionId: args.sessionId,
        targets: args.targets,
        totalTargets: args.targets.length,
        index: Math.max(0, args.targets.length - 1),
        currentTarget: '',
      });
    } catch (error) {
      const current = getInquiryRunState(args.licenseId);
      if (error instanceof InquiryRunContextError) {
        setInquiryRunState(args.licenseId, 'stopped', {
          runId: args.runId,
          sessionId: args.sessionId,
          targets: args.targets,
          totalTargets: args.targets.length,
          index: current.index,
          currentTarget: current.currentTarget,
        });
        addInquiryLog({
          licenseId: args.licenseId,
          runId: args.runId,
          level: 'error',
          message: `Inquiry automatic run aborted — ${summaryText()} — ${error.message} (runId=${error.diagnostics.runId} activeRunId=${error.diagnostics.activeRunId || 'none'} contextExists=${error.diagnostics.contextExists} stopped=${error.diagnostics.stopped})`,
        });
        console.error('[inquiry-worker] fatal run context error', error.message, error.diagnostics);
        return;
      }
      const isStaleRunContext = error instanceof InquiryRunStoppedError && error.code === 'stale_run_context';
      const explicitlyStopped =
        error instanceof InquiryRunStoppedError ||
        current.mode === 'stopped' ||
        (current.runId && current.runId !== args.runId);
      if (isStaleRunContext) {
        console.info(`[inquiry-worker] runId=${args.runId} source=system exited: stale_run_context (superseded by new run)`);
      } else if (explicitlyStopped) {
        addInquiryLog({
          licenseId: args.licenseId,
          runId: args.runId,
          level: 'warning',
          message: `Inquiry automatic run stopped — ${summaryText()}`,
        });
        console.info(`[inquiry-worker] runId=${args.runId} source=user stopped at ${new Date().toISOString()}`);
      } else {
        setInquiryRunState(args.licenseId, 'stopped', {
          runId: args.runId,
          sessionId: args.sessionId,
          targets: args.targets,
          totalTargets: args.targets.length,
          index: current.index,
          currentTarget: current.currentTarget,
        });
        addInquiryLog({
          licenseId: args.licenseId,
          runId: args.runId,
          level: 'error',
          message: `Inquiry backend worker stopped with error — ${summaryText()} — ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        console.error('[inquiry-worker]', error);
      }
    } finally {
      await closeInquirySession(args.sessionId, args.licenseId).catch(() => undefined);
      clearInquiryRunContext(args.licenseId, args.runId);
      workers.delete(key);
    }
  })();

  workers.set(key, task);
}
