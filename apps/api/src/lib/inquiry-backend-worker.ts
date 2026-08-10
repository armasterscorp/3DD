import { NextRequest } from 'next/server';
import { POST as prepareInquiry } from '@/app/api/inquiry/prepare/route';
import { POST as submitInquiry } from '@/app/api/inquiry/submit/route';
import { addInquiryLog, addInquiryResult, getInquiryRunState, inquiryCheckpoint, InquiryRunStoppedError, setInquiryRunState } from '@/lib/inquiry-run-store';
import { closeInquirySession } from '@/lib/inquiry-browser-store';

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
      message: `${args.index + 1}/${args.total} — still ${args.phase === 'prepare' ? 'scanning' : 'submitting'} ${args.target} (${elapsed}s)`,
    });
  }, 20_000);

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(async () => {
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
      for (let i = Math.max(0, args.startIndex); i < args.targets.length; i += 1) {
        await inquiryCheckpoint(args.licenseId);
        const state = getInquiryRunState(args.licenseId);
        if (state.runId && state.runId !== args.runId) return;

        const target = args.targets[i];
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
        addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'info', message: `${i + 1}/${args.targets.length} — checking ${target} for a contact form` });

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
            task: prepareInquiry(requestFor(args.licenseId, '/api/inquiry/prepare', {
              sessionId: args.sessionId,
              runId: args.runId,
              target,
              profile: args.profile,
            })),
          });
        } catch (error) {
          assertWorkerActive(args.licenseId, args.runId);
          if (error instanceof InquiryTargetTimeoutError) {
            const reason = `TARGET_TIMEOUT_${Math.round(error.timeoutMs / 1000)}S`;
            addInquiryResult({
              licenseId: args.licenseId,
              runId: args.runId,
              sessionId: args.sessionId,
              status: 'failed',
              target,
              reason,
            });
            addInquiryLog({
              licenseId: args.licenseId,
              runId: args.runId,
              level: 'warning',
              message: `${i + 1}/${args.targets.length} — ${target} — scan timed out after ${Math.round(error.timeoutMs / 1000)}s; browser session recycled and skipped automatically`,
            });
            continue;
          }
          throw error;
        }
        assertWorkerActive(args.licenseId, args.runId);
        const prepared = await responseJson(prepareResponse);
        assertWorkerActive(args.licenseId, args.runId);

        if (prepareResponse.ok && prepared?.success) {
          const classification = String(prepared.classification || (prepared.captchaDetected ? 'captcha' : 'form_found'));
          if (classification === 'captcha') {
            addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'warning', message: `${i + 1}/${args.targets.length} — CAPTCHA detected (${prepared.captchaProvider || 'CAPTCHA'}) on ${prepared.contactUrl || target}; saved and skipped automatically` });
          } else if (classification === 'review_required') {
            addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'warning', message: `${i + 1}/${args.targets.length} — REVIEW REQUIRED on ${prepared.contactUrl || target} — ${prepared.reviewReason || 'manual interaction needed'}; saved and skipped automatically` });
          } else if (classification === 'site_unavailable') {
            addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'warning', message: `${i + 1}/${args.targets.length} — ${target} — website unavailable (${prepared.unavailableReason || 'SITE_UNAVAILABLE'}); skipped automatically` });
          } else if (classification === 'no_form') {
            addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'warning', message: `${i + 1}/${args.targets.length} — ${target} — no usable contact/quote/inquiry form found; skipped automatically` });
          } else if (classification === 'form_found') {
            addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'success', message: `${i + 1}/${args.targets.length} — form found and prepared on ${prepared.contactUrl || target}` });
            addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'info', message: `${i + 1}/${args.targets.length} — auto-submit — completing review/next steps and submitting ${target}` });
            await inquiryCheckpoint(args.licenseId);
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
                task: submitInquiry(requestFor(args.licenseId, '/api/inquiry/submit', {
                  sessionId: args.sessionId,
                  runId: args.runId,
                })),
              });
            } catch (error) {
              assertWorkerActive(args.licenseId, args.runId);
              if (error instanceof InquiryTargetTimeoutError) {
                const reason = `SUBMIT_TIMEOUT_${Math.round(error.timeoutMs / 1000)}S`;
                addInquiryResult({
                  licenseId: args.licenseId,
                  runId: args.runId,
                  sessionId: args.sessionId,
                  status: 'review',
                  target,
                  contactUrl: prepared.contactUrl || target,
                  reason: `Submission did not reach a reliable terminal state within ${Math.round(error.timeoutMs / 1000)} seconds.`,
                });
                addInquiryLog({
                  licenseId: args.licenseId,
                  runId: args.runId,
                  level: 'warning',
                  message: `${i + 1}/${args.targets.length} — REVIEW REQUIRED on ${target} — submission timed out after ${Math.round(error.timeoutMs / 1000)}s; browser session recycled and skipped automatically`,
                });
                continue;
              }
              throw error;
            }
            assertWorkerActive(args.licenseId, args.runId);
            const submitted = await responseJson(submitResponse);
            assertWorkerActive(args.licenseId, args.runId);
            if (submitResponse.ok && submitted?.success) {
              addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'success', message: `${i + 1}/${args.targets.length} — submission confirmed on ${submitted.currentUrl || prepared.contactUrl || target}${submitted.confirmation ? ` — ${submitted.confirmation}` : ''}` });
            } else if (submitted?.captchaDetected) {
              addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'warning', message: `${i + 1}/${args.targets.length} — CAPTCHA detected (${submitted.captchaProvider || 'CAPTCHA'}) during review/submit on ${target}; saved and skipped automatically` });
            } else if (submitted?.reviewRequired) {
              addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'warning', message: `${i + 1}/${args.targets.length} — REVIEW REQUIRED on ${target} — ${submitted.reason || submitted.error || 'manual interaction needed'}; saved and skipped automatically` });
            } else {
              addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'error', message: `${i + 1}/${args.targets.length} — ${target} — submit failed: ${submitted?.error || `HTTP ${submitResponse.status}`}` });
            }
          }
        } else {
          addInquiryLog({ licenseId: args.licenseId, runId: args.runId, level: 'error', message: `${i + 1}/${args.targets.length} — ${target} — prepare failed: ${prepared?.error || `HTTP ${prepareResponse.status}`}` });
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
