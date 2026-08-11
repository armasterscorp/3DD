/**
 * CaptchaJobRegistry — in-memory singleton that ensures exactly one active
 * 2Captcha solve job exists per {runId}:{itemIndex}:{attemptId}:{captchaType}
 * key.
 *
 * Guarantees:
 *  - A second call to getOrCreateCaptchaJob with the same key while the first
 *    job is in created/polling state returns the same promise — no new in.php
 *    request is made.
 *  - On any terminal state (solved|timed_out|failed|cancelled) the entry is
 *    removed from the registry so a later retry with the same key creates a
 *    fresh job.
 *  - cancelCaptchaJob aborts the internal AbortController and clears any
 *    scheduled poll timer, preventing further network requests.
 */

export type CaptchaJobStatus =
  | 'created'
  | 'polling'
  | 'solved'
  | 'timed_out'
  | 'failed'
  | 'cancelled';

/** Public view of a job entry (no internal handles). */
export interface CaptchaJobEntry {
  jobKey: string;
  providerCaptchaId?: string;
  status: CaptchaJobStatus;
  startedAt: Date;
  lastPollAt?: Date;
  ownerRunId: string;
  ownerItemId: string;
  ownerAttemptId: string;
  captchaType: string;
}

/** Internal slot — extends entry with runtime handles. */
interface CaptchaJobSlot extends CaptchaJobEntry {
  promise: Promise<string>;
  abortController: AbortController;
  pollTimerRef?: ReturnType<typeof setTimeout>;
}

// ── Global singleton (survives Next.js route worker recycling) ─────────────

const _g = globalThis as typeof globalThis & {
  __threeDSuiteCaptchaJobRegistry?: Map<string, CaptchaJobSlot>;
};
const registry: Map<string, CaptchaJobSlot> =
  _g.__threeDSuiteCaptchaJobRegistry ?? new Map();
if (!_g.__threeDSuiteCaptchaJobRegistry) _g.__threeDSuiteCaptchaJobRegistry = registry;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the canonical job key from its constituent parts.
 * Format: `{runId}:{itemIndex}:{attemptId}:{captchaType}`
 */
export function buildCaptchaJobKey(
  runId: string,
  itemIndex: string | number,
  attemptId: string,
  captchaType: string
): string {
  return `${runId}:${itemIndex}:${attemptId}:${captchaType}`;
}

/** Return a public snapshot of the job entry, or undefined if not present. */
export function getCaptchaJob(jobKey: string): CaptchaJobEntry | undefined {
  const slot = registry.get(jobKey);
  if (!slot) return undefined;
  // Strip internal handles from the copy returned to callers.
  const { promise: _p, abortController: _ac, pollTimerRef: _pt, ...entry } = slot;
  return entry as CaptchaJobEntry;
}

/** Total number of active (created/polling) jobs — useful for diagnostics. */
export function activeCaptchaJobCount(): number {
  let n = 0;
  for (const slot of registry.values()) {
    if (slot.status === 'created' || slot.status === 'polling') n++;
  }
  return n;
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Get an existing active job for `jobKey` or create a new one by invoking
 * `factory`.
 *
 * The factory receives:
 *  - `abortSignal` — abort when the job is cancelled; pass to poll loop
 *  - `onCaptchaId` — call once with the provider captcha ID after in.php
 *  - `onPollTick` — call on every poll iteration to update `lastPollAt`
 *
 * Returns `{ promise, isNew, entry }`. If `isNew` is false the caller must
 * not make a new in.php call — it should await the shared `promise`.
 */
export function getOrCreateCaptchaJob(
  jobKey: string,
  meta: {
    ownerRunId: string;
    ownerItemId: string;
    ownerAttemptId: string;
    captchaType: string;
  },
  factory: (
    abortSignal: AbortSignal,
    onCaptchaId: (id: string) => void,
    onPollTick: () => void
  ) => Promise<string>
): { promise: Promise<string>; isNew: boolean; entry: CaptchaJobEntry } {
  const existing = registry.get(jobKey);
  if (existing && (existing.status === 'created' || existing.status === 'polling')) {
    const { promise: _p, abortController: _ac, pollTimerRef: _pt, ...entry } = existing;
    return { promise: existing.promise, isNew: false, entry: entry as CaptchaJobEntry };
  }

  const abortController = new AbortController();
  const slot: CaptchaJobSlot = {
    jobKey,
    status: 'created',
    startedAt: new Date(),
    ownerRunId: meta.ownerRunId,
    ownerItemId: meta.ownerItemId,
    ownerAttemptId: meta.ownerAttemptId,
    captchaType: meta.captchaType,
    abortController,
    promise: null as unknown as Promise<string>, // set below
  };

  const onCaptchaId = (id: string) => {
    if (registry.get(jobKey) === slot) {
      slot.providerCaptchaId = id;
      slot.status = 'polling';
    }
  };

  const onPollTick = () => {
    if (registry.get(jobKey) === slot) {
      slot.lastPollAt = new Date();
    }
  };

  slot.promise = factory(abortController.signal, onCaptchaId, onPollTick).then(
    (token) => {
      if (registry.get(jobKey) === slot) {
        slot.status = 'solved';
        registry.delete(jobKey);
      }
      return token;
    },
    (err: unknown) => {
      if (registry.get(jobKey) === slot) {
        if ((err as { code?: string })?.code === 'captcha_solver_timeout') {
          slot.status = 'timed_out';
        } else if ((err as { code?: string })?.code === 'captcha_cancelled') {
          slot.status = 'cancelled';
        } else {
          slot.status = 'failed';
        }
        if (slot.pollTimerRef !== undefined) clearTimeout(slot.pollTimerRef);
        registry.delete(jobKey);
      }
      throw err;
    }
  );

  registry.set(jobKey, slot);

  const { promise: _p, abortController: _ac, pollTimerRef: _pt, ...entry } = slot;
  return { promise: slot.promise, isNew: true, entry: entry as CaptchaJobEntry };
}

/**
 * Cancel a running job: abort its signal, clear its poll timer, and remove it
 * from the registry.  Returns false if no active job was found.
 */
export function cancelCaptchaJob(jobKey: string, reason = 'captcha_cancelled'): boolean {
  const slot = registry.get(jobKey);
  if (!slot) return false;
  slot.status = 'cancelled';
  if (!slot.abortController.signal.aborted) slot.abortController.abort(reason);
  if (slot.pollTimerRef !== undefined) clearTimeout(slot.pollTimerRef);
  registry.delete(jobKey);
  return true;
}

/**
 * Attach an externally created timer reference to a job slot so that
 * `cancelCaptchaJob` can clean it up.
 */
export function registerCaptchaJobPollTimer(
  jobKey: string,
  timer: ReturnType<typeof setTimeout>
): void {
  const slot = registry.get(jobKey);
  if (slot) slot.pollTimerRef = timer;
}
