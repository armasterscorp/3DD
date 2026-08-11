export function shouldAttemptPreSubmitCaptchaSolve(captchaDetected: boolean): boolean {
  return captchaDetected;
}

export function classifyCaptchaAfterToken(stillRequired: boolean): { reviewRequired: boolean; reasonCode?: string } {
  if (!stillRequired) return { reviewRequired: false };
  return { reviewRequired: true, reasonCode: 'captcha_unsolved_after_token' };
}
