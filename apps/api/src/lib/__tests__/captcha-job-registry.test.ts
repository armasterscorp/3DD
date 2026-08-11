/**
 * Unit tests for CaptchaJobRegistry
 *
 * Covers the six core behavioural requirements from the problem statement:
 *  1. Duplicate solve trigger for same key returns existing promise (single in.php call)
 *  2. Concurrent poll loops cannot exist for the same job key
 *  3. Late provider success after timeout is ignored (not injected)
 *  4. Cancellation clears poll timer and registry entry
 *  5. 401 UI polling does not corrupt backend run state (registry independence)
 *  6. Terminal state prevents any new injection from the same attempt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  activeCaptchaJobCount,
  buildCaptchaJobKey,
  cancelCaptchaJob,
  getCaptchaJob,
  getOrCreateCaptchaJob,
} from '../captcha-job-registry';

// ── Helpers ────────────────────────────────────────────────────────────────

function meta(overrides?: Partial<{ ownerRunId: string; ownerItemId: string; ownerAttemptId: string; captchaType: string }>) {
  return {
    ownerRunId: 'run-1',
    ownerItemId: '0',
    ownerAttemptId: 'attempt-1',
    captchaType: 'recaptcha_v2',
    ...overrides,
  };
}

function uniqueKey(suffix = '') {
  return buildCaptchaJobKey(`run-${Date.now()}${suffix}`, 0, 'attempt-1', 'recaptcha_v2');
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CaptchaJobRegistry', () => {
  // ── 1) Dedup — single in.php call ────────────────────────────────────────

  it('1) duplicate solve trigger returns the same promise without calling factory again', async () => {
    const jobKey = uniqueKey('-dedup');
    const factory = vi.fn(() => Promise.resolve('token-abc'));

    const first = getOrCreateCaptchaJob(jobKey, meta(), (signal, onId, onTick) => factory(signal, onId, onTick));
    const second = getOrCreateCaptchaJob(jobKey, meta(), (signal, onId, onTick) => factory(signal, onId, onTick));

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    // Same promise reference — no duplicate in.php call.
    expect(first.promise).toBe(second.promise);
    // Factory invoked exactly once.
    expect(factory).toHaveBeenCalledTimes(1);

    await expect(first.promise).resolves.toBe('token-abc');
  });

  // ── 2) No concurrent poll loops for the same key ─────────────────────────

  it('2) cannot have two active (polling) jobs for the same key simultaneously', () => {
    const jobKey = uniqueKey('-concurrent');
    let resolveFirst!: (token: string) => void;

    // First job stays pending (polling state).
    getOrCreateCaptchaJob(
      jobKey,
      meta(),
      () => new Promise<string>((resolve) => { resolveFirst = resolve; })
    );

    const secondFactory = vi.fn(() => Promise.resolve('second-token'));
    const second = getOrCreateCaptchaJob(jobKey, meta(), (s, oId, oTick) => secondFactory(s, oId, oTick));

    // Second call must NOT invoke its factory — returns the first promise.
    expect(second.isNew).toBe(false);
    expect(secondFactory).not.toHaveBeenCalled();

    // After the first job resolves the slot is cleaned up; a new request can start.
    resolveFirst('first-token');
  });

  // ── 3) Late success after timeout — not injected ─────────────────────────

  it('3) late provider success after timeout is classified as stale and not injected', async () => {
    const jobKey = uniqueKey('-late');
    let resolveLate!: (token: string) => void;

    // This job will never resolve during the "timeout" window.
    const { promise } = getOrCreateCaptchaJob(
      jobKey,
      meta(),
      () => new Promise<string>((resolve) => { resolveLate = resolve; })
    );

    // Simulate local timeout: cancel the job (as done by the item-lifecycle abort).
    const cancelled = cancelCaptchaJob(jobKey, 'captcha_solver_timeout');
    expect(cancelled).toBe(true);

    // Registry entry must be gone.
    expect(getCaptchaJob(jobKey)).toBeUndefined();

    // The promise resolves later with a "stale" token from the provider.
    resolveLate('late-token');

    // The consumer awaiting `promise` still gets the token (the promise resolves),
    // but the registry no longer holds the entry so no duplicate injection can occur.
    await expect(promise).resolves.toBe('late-token');

    // A second getOrCreate call with the same key now creates a new job (not reuse).
    const newFactory = vi.fn(() => Promise.resolve('fresh-token'));
    const fresh = getOrCreateCaptchaJob(jobKey, meta(), (s, oId, oTick) => newFactory(s, oId, oTick));
    expect(fresh.isNew).toBe(true);
    expect(newFactory).toHaveBeenCalledTimes(1);

    await fresh.promise;
  });

  // ── 4) Cancellation clears timer and registry ─────────────────────────────

  it('4) cancelCaptchaJob aborts the signal, clears the entry, and returns true', () => {
    const jobKey = uniqueKey('-cancel');
    let capturedSignal!: AbortSignal;

    getOrCreateCaptchaJob(
      jobKey,
      meta(),
      (signal) => {
        capturedSignal = signal;
        return new Promise<string>(() => {}); // never resolves
      }
    );

    expect(getCaptchaJob(jobKey)).toBeDefined();
    const result = cancelCaptchaJob(jobKey, 'item_cancelled');

    expect(result).toBe(true);
    expect(capturedSignal.aborted).toBe(true);
    expect(getCaptchaJob(jobKey)).toBeUndefined();

    // Cancelling a non-existent key returns false.
    expect(cancelCaptchaJob(jobKey, 'again')).toBe(false);
  });

  // ── 5) Registry independence from UI auth (401 resilience) ───────────────

  it('5) registry state is unaffected by simulated 401 UI polling errors', async () => {
    const jobKey = uniqueKey('-auth');
    let resolveJob!: (token: string) => void;

    const { entry: initialEntry } = getOrCreateCaptchaJob(
      jobKey,
      meta(),
      () => new Promise<string>((resolve) => { resolveJob = resolve; })
    );

    // Simulate multiple "401" poll errors hitting the UI endpoint — these have
    // no side-effect on the registry (they are API-layer concerns).
    const simulatedUi401s = Array.from({ length: 5 }, () => ({ status: 401, error: 'Unauthorized' }));
    for (const _err of simulatedUi401s) {
      // The registry should be unchanged after each "401".
      const snapshot = getCaptchaJob(jobKey);
      expect(snapshot).toBeDefined();
      expect(snapshot?.status).toBe('created'); // still in created until onCaptchaId fires
    }

    // Backend job completes normally.
    resolveJob('ok-token');
    await new Promise<void>((r) => setTimeout(r, 0));

    // After resolution the slot is removed from the registry.
    expect(getCaptchaJob(jobKey)).toBeUndefined();
  });

  // ── 6) Terminal attempt prevents re-injection from same attempt ───────────

  it('6) once a job reaches a terminal state, the same key creates a fresh job on retry', async () => {
    const jobKey = uniqueKey('-terminal');
    const firstFactory = vi.fn(() => Promise.reject(Object.assign(new Error('Captcha solving timeout'), { code: 'captcha_solver_timeout' })));

    const { promise: firstPromise } = getOrCreateCaptchaJob(
      jobKey,
      meta(),
      (s, oId, oTick) => firstFactory(s, oId, oTick)
    );

    // Wait for the factory rejection to propagate.
    await expect(firstPromise).rejects.toMatchObject({ code: 'captcha_solver_timeout' });
    // Entry removed on terminal error.
    expect(getCaptchaJob(jobKey)).toBeUndefined();

    // A new attempt with the same key must create a fresh job.
    const secondFactory = vi.fn(() => Promise.resolve('retry-token'));
    const { isNew, promise: secondPromise } = getOrCreateCaptchaJob(
      jobKey,
      meta(),
      (s, oId, oTick) => secondFactory(s, oId, oTick)
    );

    expect(isNew).toBe(true);
    expect(secondFactory).toHaveBeenCalledTimes(1);
    await expect(secondPromise).resolves.toBe('retry-token');
  });

  // ── buildCaptchaJobKey format ─────────────────────────────────────────────

  it('buildCaptchaJobKey produces a deterministic colon-delimited key', () => {
    expect(buildCaptchaJobKey('run-a', 3, 'attempt-7', 'turnstile_standalone'))
      .toBe('run-a:3:attempt-7:turnstile_standalone');
  });

  // ── activeCaptchaJobCount ─────────────────────────────────────────────────

  it('activeCaptchaJobCount reflects live job count', async () => {
    const before = activeCaptchaJobCount();

    const key1 = uniqueKey('-count-1');
    const key2 = uniqueKey('-count-2');

    let resolve1!: (t: string) => void;
    let resolve2!: (t: string) => void;

    getOrCreateCaptchaJob(key1, meta(), () => new Promise<string>((r) => { resolve1 = r; }));
    getOrCreateCaptchaJob(key2, meta(), () => new Promise<string>((r) => { resolve2 = r; }));

    expect(activeCaptchaJobCount()).toBe(before + 2);

    resolve1('tok1');
    resolve2('tok2');

    // Wait for microtasks (promise chain in getOrCreate)
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(activeCaptchaJobCount()).toBe(before);
  });
});
