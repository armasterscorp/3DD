import { describe, expect, it } from 'vitest';
import {
  classifyCaptchaAfterToken,
  mapCaptchaTerminalReason,
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

  it('maps locked captcha timeout into captcha solver timeout', () => {
    expect(mapCaptchaTerminalReason({
      captchaDetected: true,
      captchaClassificationLocked: true,
      captchaStillPresent: true,
      solverTimedOut: true,
    })).toBe('captcha_solver_timeout');
  });

  it('maps locked captcha token rejection into captcha_unsolved_after_token', () => {
    expect(mapCaptchaTerminalReason({
      captchaDetected: true,
      captchaClassificationLocked: true,
      tokenReturned: true,
      captchaStillPresent: true,
    })).toBe('captcha_unsolved_after_token');
  });
});
