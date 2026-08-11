import { describe, expect, it } from 'vitest';
import {
  classifyCaptchaAfterToken,
  shouldAttemptPreSubmitCaptchaSolve,
} from '../../../../../lib/inquiry-submit-captcha-policy';

describe('inquiry submit captcha gating', () => {
  it('solves only when the active target form currently requires captcha', () => {
    expect(
      shouldAttemptPreSubmitCaptchaSolve({
        captchaDetected: true,
        hasActiveTargetForm: true,
        activeTargetFormHasCaptcha: true,
        isItemTerminal: false,
        isCurrentAttempt: true,
      })
    ).toBe(true);

    expect(
      shouldAttemptPreSubmitCaptchaSolve({
        captchaDetected: true,
        hasActiveTargetForm: false,
        activeTargetFormHasCaptcha: true,
        isItemTerminal: false,
        isCurrentAttempt: true,
      })
    ).toBe(false);

    expect(
      shouldAttemptPreSubmitCaptchaSolve({
        captchaDetected: true,
        hasActiveTargetForm: true,
        activeTargetFormHasCaptcha: false,
        isItemTerminal: false,
        isCurrentAttempt: true,
      })
    ).toBe(false);

    expect(
      shouldAttemptPreSubmitCaptchaSolve({
        captchaDetected: true,
        hasActiveTargetForm: true,
        activeTargetFormHasCaptcha: true,
        isItemTerminal: true,
        isCurrentAttempt: true,
      })
    ).toBe(false);
  });

  it('marks review_required when token returned but captcha still required', () => {
    expect(classifyCaptchaAfterToken(true)).toEqual({
      reviewRequired: true,
      reasonCode: 'captcha_unsolved_after_token',
    });
    expect(classifyCaptchaAfterToken(false)).toEqual({ reviewRequired: false });
  });
});
