import { describe, expect, it, vi } from 'vitest';
import {
  cancelInquiryItemAttempt,
  canEmitInquiryProgress,
  drainInquiryItemDebugEvents,
  finishInquiryItemAttempt,
  getInquiryItemAttempt,
  getInquiryItemAttemptSignal,
  isActiveInquiryItemAttempt,
  isCurrentInquiryItemAttempt,
  registerInquiryItemTimer,
  startInquiryItemAttempt,
  transitionInquiryItemState,
} from '../inquiry-item-lifecycle';

describe('inquiry item lifecycle', () => {
  it('blocks invalid transitions and accepts valid transitions in the strict state machine', () => {
    const attempt = startInquiryItemAttempt({
      licenseId: 'lic-a',
      runId: 'run-a',
      target: 'https://example.com',
      index: 0,
      sessionGeneration: 1,
    });

    expect(transitionInquiryItemState(attempt, 'SUBMITTING')).toBe(false);
    expect(transitionInquiryItemState(attempt, 'FORM_FOUND')).toBe(true);
    expect(transitionInquiryItemState(attempt, 'CAPTCHA_CHECKING')).toBe(true);
    expect(transitionInquiryItemState(attempt, 'READY_TO_SUBMIT')).toBe(true);
    expect(transitionInquiryItemState(attempt, 'SUBMITTING')).toBe(true);
    expect(finishInquiryItemAttempt(attempt, 'SUBMITTED', 'submitted_success', 'confirmed')).toBe(true);
    expect(finishInquiryItemAttempt(attempt, 'SUBMITTED', 'submitted_success', 'confirmed-again')).toBe(false);
  });

  it('ignores stale captcha completion after timeout', async () => {
    const attempt = startInquiryItemAttempt({
      licenseId: 'lic-b',
      runId: 'run-b',
      target: 'https://timeout.example',
      index: 1,
      sessionGeneration: 1,
    });

    const lateMutation = vi.fn(() => {
      if (!isActiveInquiryItemAttempt(attempt)) return 'ignored_stale';
      transitionInquiryItemState(attempt, 'READY_TO_SUBMIT');
      return 'mutated';
    });

    expect(cancelInquiryItemAttempt(attempt, 'TIMEOUT_SCAN', 'scan_timeout', 'timeout')).toBe(true);
    await Promise.resolve();
    expect(lateMutation()).toBe('ignored_stale');
    expect(canEmitInquiryProgress(attempt)).toBe(false);
  });

  it('suppresses further scan tick logs after terminal state', () => {
    vi.useFakeTimers();
    const attempt = startInquiryItemAttempt({
      licenseId: 'lic-c',
      runId: 'run-c',
      target: 'https://ticks.example',
      index: 2,
      sessionGeneration: 1,
    });

    const tick = vi.fn(() => {
      if (!canEmitInquiryProgress(attempt)) return;
      tick.mock.calls.length;
    });
    const timer = setInterval(() => tick(), 20_000);
    registerInquiryItemTimer(attempt, timer);

    vi.advanceTimersByTime(20_000);
    expect(tick).toHaveBeenCalledTimes(1);

    cancelInquiryItemAttempt(attempt, 'SKIPPED_NO_FORM', 'no_form_found', 'no form');
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('records invalid transition debug once and prevents duplicate terminal emission', () => {
    const attempt = startInquiryItemAttempt({
      licenseId: 'lic-d',
      runId: 'run-d',
      target: 'https://duplicate.example',
      index: 3,
      sessionGeneration: 1,
    });

    expect(transitionInquiryItemState(attempt, 'SUBMITTING')).toBe(false);
    expect(transitionInquiryItemState(attempt, 'SUBMITTING')).toBe(false);
    expect(cancelInquiryItemAttempt(attempt, 'FAILED', 'submit_failed', 'failed')).toBe(true);
    expect(cancelInquiryItemAttempt(attempt, 'FAILED', 'submit_failed', 'failed again')).toBe(false);

    const debugEvents = drainInquiryItemDebugEvents(attempt);
    expect(debugEvents.filter((entry) => entry.includes('invalid transition ignored'))).toHaveLength(1);
    expect(getInquiryItemAttempt(attempt)?.terminalEmitted).toBe(true);
  });

  it('recycle aborts in-flight scan, captcha, and submit operations', () => {
    const first = startInquiryItemAttempt({
      licenseId: 'lic-e',
      runId: 'run-e',
      target: 'https://recycle.example',
      index: 4,
      sessionGeneration: 1,
    });
    const scanSignal = getInquiryItemAttemptSignal(first, 'scan');
    const captchaSignal = getInquiryItemAttemptSignal(first, 'captcha');
    const submitSignal = getInquiryItemAttemptSignal(first, 'submit');

    const second = startInquiryItemAttempt({
      licenseId: 'lic-e',
      runId: 'run-e',
      target: 'https://recycle.example',
      index: 4,
      sessionGeneration: 2,
    });

    expect(scanSignal?.aborted).toBe(true);
    expect(captchaSignal?.aborted).toBe(true);
    expect(submitSignal?.aborted).toBe(true);
    expect(isCurrentInquiryItemAttempt(first)).toBe(false);
    expect(isActiveInquiryItemAttempt(second)).toBe(true);
  });

  it('stores exactly one terminal status per item', () => {
    const attempt = startInquiryItemAttempt({
      licenseId: 'lic-f',
      runId: 'run-f',
      target: 'https://terminal.example',
      index: 5,
      sessionGeneration: 1,
    });

    transitionInquiryItemState(attempt, 'FORM_FOUND');
    transitionInquiryItemState(attempt, 'CAPTCHA_CHECKING');
    transitionInquiryItemState(attempt, 'CAPTCHA_REQUIRED');
    cancelInquiryItemAttempt(attempt, 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED', 'captcha_required_manual_review', 'captcha remained');
    finishInquiryItemAttempt(attempt, 'SUBMITTED', 'submitted_success', 'should not happen');

    const snapshot = getInquiryItemAttempt(attempt);
    expect(snapshot?.terminalState).toBe('REVIEW_REQUIRED_CAPTCHA_UNSOLVED');
    expect(snapshot?.terminalReasonCode).toBe('captcha_required_manual_review');
    expect(snapshot?.terminalEmitted).toBe(true);
  });
});
