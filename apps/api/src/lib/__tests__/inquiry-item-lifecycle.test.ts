import { describe, expect, it } from 'vitest';
import {
  cancelInquiryItemAttempt,
  finishInquiryItemAttempt,
  getInquiryItemAttemptSignal,
  isActiveInquiryItemAttempt,
  isCurrentInquiryItemAttempt,
  startInquiryItemAttempt,
  transitionInquiryItemState,
} from '../inquiry-item-lifecycle';

describe('inquiry item lifecycle', () => {
  it('blocks invalid transitions and accepts valid transitions', () => {
    const attempt = startInquiryItemAttempt({
      licenseId: 'lic-a',
      runId: 'run-a',
      target: 'https://example.com',
      index: 0,
      sessionGeneration: 1,
    });
    expect(transitionInquiryItemState(attempt, 'SUBMITTING')).toBe(false);
    expect(transitionInquiryItemState(attempt, 'FORM_FOUND')).toBe(true);
    expect(transitionInquiryItemState(attempt, 'READY_TO_SUBMIT')).toBe(true);
    expect(transitionInquiryItemState(attempt, 'SUBMITTING')).toBe(true);
    expect(finishInquiryItemAttempt(attempt, 'DONE', 'submitted')).toBe(true);
  });

  it('ignores late async results after timeout terminal state', () => {
    const attempt = startInquiryItemAttempt({
      licenseId: 'lic-b',
      runId: 'run-b',
      target: 'https://timeout.example',
      index: 1,
      sessionGeneration: 1,
    });
    expect(isActiveInquiryItemAttempt(attempt)).toBe(true);
    expect(cancelInquiryItemAttempt(attempt, 'TIMEOUT', 'scan_timeout')).toBe(true);
    expect(isCurrentInquiryItemAttempt(attempt)).toBe(true);
    expect(isActiveInquiryItemAttempt(attempt)).toBe(false);
    expect(transitionInquiryItemState(attempt, 'DONE')).toBe(false);
  });

  it('recycle/new generation cancels prior in-flight attempt', () => {
    const first = startInquiryItemAttempt({
      licenseId: 'lic-c',
      runId: 'run-c',
      target: 'https://recycle.example',
      index: 2,
      sessionGeneration: 1,
    });
    const signal = getInquiryItemAttemptSignal(first);
    expect(signal?.aborted).toBe(false);

    const second = startInquiryItemAttempt({
      licenseId: 'lic-c',
      runId: 'run-c',
      target: 'https://recycle.example',
      index: 2,
      sessionGeneration: 2,
    });

    expect(signal?.aborted).toBe(true);
    expect(isCurrentInquiryItemAttempt(first)).toBe(false);
    expect(isActiveInquiryItemAttempt(first)).toBe(false);
    expect(isActiveInquiryItemAttempt(second)).toBe(true);
  });
});
