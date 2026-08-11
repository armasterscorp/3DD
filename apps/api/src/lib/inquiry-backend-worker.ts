import { NextRequest } from 'next/server';
import { POST as prepareInquiry } from '@/app/api/inquiry/prepare/route';
import { POST as submitInquiry } from '@/app/api/inquiry/submit/route';
import { addInquiryLog, addInquiryResult, getInquiryRunState, inquiryCheckpoint, InquiryRunStoppedError, setInquiryRunState } from '@/lib/inquiry-run-store';
import { closeInquirySession } from '@/lib/inquiry-browser-store';
import { cancelInquiryItemAttempt, finishInquiryItemAttempt, formatAttemptStep, isActiveInquiryItemAttempt, startInquiryItemAttempt, transitionInquiryItemState, type InquiryAttemptRef } from '@/lib/inquiry-item-lifecycle';

const globalWorkers = globalThis as typeof globalThis & {
  __threeDSuiteInquiryWorkers?: Map<string, Promise<void>>;
};
const workers = globalWorkers.__threeDSuiteInquiryWorkers ?? new Map<string, Promise<void>>();
if (!globalWorkers.__threeDSuiteInquiryWorkers) globalWorkers.__threeDSuiteInquiryWorkers = workers;

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
  const state = getInquiryRunState(licenseId);
  if (state.mode === 'stopped') throw new InquiryRunStoppedError();
  if (state.runId && state.runId !== runId) throw new InquiryRunStoppedError();
}

class InquiryTargetTimeoutError extends Error {
  constructor(
    public phase: 'prepare' | 'submit',
    public target: string,
    public timeoutMs: number
  ) {
    super(`${phase === 'prepare' ? 'Form discovery/preparation' : 'Submission'} timed out after ${Math.round(timeoutMs / 1000)}s`);
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
  let finished = false;

  const heartbeat = setInterval(() => {
    if (finished) return;
    const state = getInquiryRunState(args.licenseId);
    if (state.mode === 'stopped' || (state.runId && state.runId !== args.runId)) return;
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    addInquiryLog({
      licenseId: args.licenseId,
      runId: args.runId,
      level: 'info',
      message: formatAttemptStep(`${args.index + 1}/${args.total} — still ${args.phase === 'prepare' ? 'scanning' : 'submitting'} ${args.target} (${elapsed}s)`, args.attempt),
      attemptId: args.attempt.attemptId,
      sessionGeneration: args.attempt.sessionGeneration,
      targetIndex: args.attempt.index,
      target: args.target,
    });
  }, 20_000);

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(async () => {
      cancelInquiryItemAttempt(args.attempt, 'TIMEOUT', `${args.phase}_timeout_${Math.round(args.timeoutMs / 1000)}s`);
      try {
        // Closing the licensed Playwright session aborts any navigation/evaluate
        // that is actually wedged. The next target will recreate the same
        // license-scoped session automatically in the prepare route.
        await closeInquirySession(args.sessionId, args.licenseId);
      } catch {}
      reject(new InquiryTargetTimeoutError(args.phase, args.target, args.timeoutMs));
    }, args.timeoutMs);
  });

  try {
    return await Promise.race([args.task, timeout]);
  } finally {
    finished = true;
    clearInterval(heartbeat);
    if (timeoutHandle) clearTimeout(timeoutHandle);
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
  const key = `${args.licenseId}:${args.runId}`;
  if (workers.has(key)) return;

  const task = (async () => {
    try {
      let sessionGeneration = 1;
      for (let i = Math.max(0, args.startIndex); i < args.targets.length; i += 1) {
        await inquiryCheckpoint(args.licenseId);
        const state = getInquiryRunState(args.licenseId);
        if (state.runId && state.runId !== args.runId) return;

        const target = args.targets[i];
        const attempt = startInquiryItemAttempt({
          licenseId: args.licenseId,
          runId: args.runId,
          target,
          index: i,
          sessionGeneration,
        });
        const addAttemptLog = (level: 'info' | 'success' | 'warning' | 'error', message: string) => {
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
        const addAttemptResult = (input: Omit<Parameters<typeof addInquiryResult>[0], 'licenseId' | 'runId' | 'sessionId' | 'target'> & { status: 'submitted' | 'failed' | 'captcha' | 'review'; reason?: string; contactUrl?: string }) => {
          if (!isActiveInquiryItemAttempt(attempt)) return null;
          return addInquiryResult({
            licenseId: args.licenseId,
            runId: args.runId,
            sessionId: args.sessionId,
            target,
            ...input,
            attemptId: attempt.attemptId,
            sessionGeneration: attempt.sessionGeneration,
            targetIndex: i,
          });
        };
        // Publish the active target before emitting its runtime log. The dashboard
        // uses this state to bind the screenshot stream to the same target/index,
        // avoiding logs visually advancing ahead of the browser preview.
        setInquiryRunState(args.licenseId, 'running', {
          runId: args.runId,
          sessionId: args.sessionId,
          targets: args.targets,
          totalTargets: args.targets.length,
          index: i,
          currentTarget: target,
        });
        addAttemptLog('info', `${i + 1}/${args.targets.length} — checking ${target} for a contact form`);

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
            timeoutMs: 75_000,
            attempt,
            task: prepareInquiry(requestFor(args.licenseId, '/api/inquiry/prepare', {
              sessionId: args.sessionId,
              runId: args.runId,
              target,
              profile: args.profile,
              attemptId: attempt.attemptId,
              sessionGeneration: attempt.sessionGeneration,
              targetIndex: i,
            })),
          });
        } catch (error) {
          assertWorkerActive(args.licenseId, args.runId);
          if (error instanceof InquiryTargetTimeoutError) {
            const reason = `TARGET_TIMEOUT_${Math.round(error.timeoutMs / 1000)}S`;
            transitionInquiryItemState(attempt, 'TIMEOUT');
            addAttemptResult({ status: 'failed', reason });
            addAttemptLog('warning', `${i + 1}/${args.targets.length} — ${target} — scan timed out after ${Math.round(error.timeoutMs / 1000)}s; browser session recycled and skipped automatically`);
            finishInquiryItemAttempt(attempt, 'TIMEOUT', reason);
            sessionGeneration += 1;
            continue;
          }
          cancelInquiryItemAttempt(attempt, 'FAILED', 'prepare_exception');
          throw error;
        }
        assertWorkerActive(args.licenseId, args.runId);
        if (!isActiveInquiryItemAttempt(attempt)) continue;
        const prepared = await responseJson(prepareResponse);
        assertWorkerActive(args.licenseId, args.runId);
        if (!isActiveInquiryItemAttempt(attempt)) continue;

        if (prepareResponse.ok && prepared?.success) {
          const classification = String(prepared.classification || (prepared.captchaDetected ? 'captcha' : 'form_found'));
          if (classification === 'captcha') {
            addAttemptLog('warning', `${i + 1}/${args.targets.length} — CAPTCHA detected (${prepared.captchaProvider || 'CAPTCHA'}) on ${prepared.contactUrl || target}; saved and skipped automatically`);
            finishInquiryItemAttempt(attempt, 'SKIPPED', 'captcha_detected');
          } else if (classification === 'review_required') {
            addAttemptLog('warning', `${i + 1}/${args.targets.length} — REVIEW REQUIRED on ${prepared.contactUrl || target} — ${prepared.reviewReason || 'manual interaction needed'}; saved and skipped automatically`);
            finishInquiryItemAttempt(attempt, 'REVIEW_REQUIRED', 'prepare_review_required');
          } else if (classification === 'site_unavailable') {
            addAttemptLog('warning', `${i + 1}/${args.targets.length} — ${target} — website unavailable (${prepared.unavailableReason || 'SITE_UNAVAILABLE'}); skipped automatically`);
            finishInquiryItemAttempt(attempt, 'SKIPPED', 'site_unavailable');
          } else if (classification === 'no_form') {
            addAttemptLog('warning', `${i + 1}/${args.targets.length} — ${target} — no usable contact/quote/inquiry form found; skipped automatically`);
            finishInquiryItemAttempt(attempt, 'SKIPPED', 'no_form');
          } else if (classification === 'form_found') {
            transitionInquiryItemState(attempt, 'FORM_FOUND');
            transitionInquiryItemState(attempt, 'READY_TO_SUBMIT');
            addAttemptLog('success', `${i + 1}/${args.targets.length} — form found and prepared on ${prepared.contactUrl || target}`);
            addAttemptLog('info', `${i + 1}/${args.targets.length} — auto-submit — completing review/next steps and submitting ${target}`);
            await inquiryCheckpoint(args.licenseId);
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
                timeoutMs: 35_000,
                attempt,
                task: submitInquiry(requestFor(args.licenseId, '/api/inquiry/submit', {
                  sessionId: args.sessionId,
                  runId: args.runId,
                  attemptId: attempt.attemptId,
                  sessionGeneration: attempt.sessionGeneration,
                  targetIndex: i,
                })),
              });
            } catch (error) {
              assertWorkerActive(args.licenseId, args.runId);
              if (error instanceof InquiryTargetTimeoutError) {
                const reason = `SUBMIT_TIMEOUT_${Math.round(error.timeoutMs / 1000)}S`;
                addAttemptResult({
                  status: 'review',
                  contactUrl: prepared.contactUrl || target,
                  reason: `Submission did not reach a reliable terminal state within ${Math.round(error.timeoutMs / 1000)} seconds.`,
                });
                addAttemptLog('warning', `${i + 1}/${args.targets.length} — REVIEW REQUIRED on ${target} — submission timed out after ${Math.round(error.timeoutMs / 1000)}s; browser session recycled and skipped automatically`);
                finishInquiryItemAttempt(attempt, 'TIMEOUT', reason);
                sessionGeneration += 1;
                continue;
              }
              cancelInquiryItemAttempt(attempt, 'FAILED', 'submit_exception');
              throw error;
            }
            assertWorkerActive(args.licenseId, args.runId);
            if (!isActiveInquiryItemAttempt(attempt)) continue;
            const submitted = await responseJson(submitResponse);
            assertWorkerActive(args.licenseId, args.runId);
            if (!isActiveInquiryItemAttempt(attempt)) continue;
            if (submitResponse.ok && submitted?.success) {
              addAttemptLog('success', `${i + 1}/${args.targets.length} — submission confirmed on ${submitted.currentUrl || prepared.contactUrl || target}${submitted.confirmation ? ` — ${submitted.confirmation}` : ''}`);
              finishInquiryItemAttempt(attempt, 'DONE', 'submitted');
            } else if (submitted?.captchaDetected) {
              addAttemptLog('warning', `${i + 1}/${args.targets.length} — CAPTCHA detected (${submitted.captchaProvider || 'CAPTCHA'}) during review/submit on ${target}; saved and skipped automatically`);
              finishInquiryItemAttempt(attempt, 'SKIPPED', 'submit_captcha');
            } else if (submitted?.reviewRequired) {
              addAttemptLog('warning', `${i + 1}/${args.targets.length} — REVIEW REQUIRED on ${target} — ${submitted.reason || submitted.error || 'manual interaction needed'}; saved and skipped automatically`);
              finishInquiryItemAttempt(attempt, 'REVIEW_REQUIRED', submitted.reason || submitted.error || 'submit_review_required');
            } else {
              addAttemptLog('error', `${i + 1}/${args.targets.length} — ${target} — submit failed: ${submitted?.error || `HTTP ${submitResponse.status}`}`);
              finishInquiryItemAttempt(attempt, 'FAILED', 'submit_failed');
            }
          }
        } else {
          addAttemptLog('error', `${i + 1}/${args.targets.length} — ${target} — prepare failed: ${prepared?.error || `HTTP ${prepareResponse.status}`}`);
          finishInquiryItemAttempt(attempt, 'FAILED', 'prepare_failed');
        }

        // Live-monitor guarantee: do not replace the terminal page immediately.
        // At 250ms screenshot polling this gives several frames of every target's
        // final visible state (success/review/captcha/no-form) before advancing.
        assertWorkerActive(args.licenseId, args.runId);
        await new Promise((resolve) => setTimeout(resolve, 1800));
        assertWorkerActive(args.licenseId, args.runId);

        // Persist the next position only while this exact run is still active.
        // A stopped run is terminal and must never be resurrected as "running".
        setInquiryRunState(args.licenseId, 'running', {
          runId: args.runId,
          sessionId: args.sessionId,
          targets: args.targets,
          totalTargets: args.targets.length,
          index: Math.min(i + 1, args.targets.length - 1),
          currentTarget: args.targets[i + 1] || '',
        });
      }

      assertWorkerActive(args.licenseId, args.runId);
      addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'success', message: `Inquiry automatic run complete — ${args.targets.length}/${args.targets.length} processed` });
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
      const explicitlyStopped = error instanceof InquiryRunStoppedError || current.mode === 'stopped' || (current.runId && current.runId !== args.runId);
      if (!explicitlyStopped) {
        // Unexpected worker failure: freeze the run at its last known target.
        setInquiryRunState(args.licenseId, 'stopped', {
          runId: args.runId,
          sessionId: args.sessionId,
          targets: args.targets,
          totalTargets: args.targets.length,
          index: current.index,
          currentTarget: current.currentTarget,
        });
        addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'error', message: `Inquiry backend worker stopped with error — ${error instanceof Error ? error.message : String(error)}` });
        console.error('[inquiry-worker]', error);
      }
      // Whether Stop was explicit or caused by an unexpected failure, do not leave
      // an owned browser process running for this worker.
      await closeInquirySession(args.sessionId, args.licenseId).catch(() => undefined);
    } finally {
      workers.delete(key);
    }
  })();

  workers.set(key, task);
}
