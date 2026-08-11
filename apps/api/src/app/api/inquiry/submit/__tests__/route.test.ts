import { describe, expect, it } from 'vitest';
import { classifyCaptchaAfterToken, shouldAttemptPreSubmitCaptchaSolve } from '../route';

describe('inquiry submit captcha gating', () => {
  it('does not attempt pre-submit solve when captcha is not detected', () => {
    expect(shouldAttemptPreSubmitCaptchaSolve(false)).toBe(false);
    expect(shouldAttemptPreSubmitCaptchaSolve(true)).toBe(true);
  });

  it('marks review_required when token returned but captcha still required', () => {
    expect(classifyCaptchaAfterToken(true)).toEqual({
      reviewRequired: true,
      reasonCode: 'captcha_unsolved_after_token',
    });
    expect(classifyCaptchaAfterToken(false)).toEqual({ reviewRequired: false });
  });
});
