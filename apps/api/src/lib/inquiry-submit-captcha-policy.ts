export type PreSubmitCaptchaSolveContext = {
  captchaDetected: boolean;
  hasActiveTargetForm: boolean;
  activeTargetFormHasCaptcha: boolean;
  isItemTerminal: boolean;
  isCurrentAttempt: boolean;
};

export function shouldAttemptPreSubmitCaptchaSolve(
  input: boolean | PreSubmitCaptchaSolveContext
): boolean {
  if (typeof input === 'boolean') return input;
  return (
    input.captchaDetected &&
    input.hasActiveTargetForm &&
    input.activeTargetFormHasCaptcha &&
    !input.isItemTerminal &&
    input.isCurrentAttempt
  );
}

export function classifyCaptchaAfterToken(stillRequired: boolean): { reviewRequired: boolean; reasonCode?: string } {
  if (!stillRequired) return { reviewRequired: false };
  return { reviewRequired: true, reasonCode: 'captcha_unsolved_after_token' };
}
