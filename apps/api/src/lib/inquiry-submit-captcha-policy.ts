export type PreSubmitCaptchaSolveContext = {
  captchaDetected: boolean;
  hasActiveTargetForm: boolean;
  activeTargetFormHasCaptcha: boolean;
  isItemTerminal: boolean;
  isCurrentAttempt: boolean;
};

export type CaptchaPrimaryReason =
  | 'captcha_solved'
  | 'captcha_unsolved_after_token'
  | 'captcha_solver_timeout'
  | 'captcha_solver_failed'
  | 'captcha_detected_autoskip'
  | 'captcha_required_manual_review';

export type InquiryPrimaryReason =
  | CaptchaPrimaryReason
  | 'no_form_found'
  | 'review_required_unchecked_required_checkbox'
  | 'scan_timeout'
  | 'submit_timeout'
  | 'submit_failed'
  | 'run_context_invalid'
  | 'submitted_success';

export type CaptchaClassificationState = {
  captchaDetected: boolean;
  captchaClassificationLocked: boolean;
  captchaType?: string;
  solveCompleted: boolean;
  tokenReturned: boolean;
};

export function createCaptchaClassificationState(): CaptchaClassificationState {
  return {
    captchaDetected: false,
    captchaClassificationLocked: false,
    captchaType: undefined,
    solveCompleted: false,
    tokenReturned: false,
  };
}

export function lockCaptchaClassification(
  state: CaptchaClassificationState,
  captchaType?: string
): CaptchaClassificationState {
  state.captchaDetected = true;
  state.captchaClassificationLocked = true;
  if (captchaType) state.captchaType = captchaType;
  return state;
}

export function markCaptchaTokenReturned(
  state: CaptchaClassificationState,
  captchaType?: string
): CaptchaClassificationState {
  lockCaptchaClassification(state, captchaType);
  state.tokenReturned = true;
  return state;
}

export function markCaptchaSolved(
  state: CaptchaClassificationState,
  captchaType?: string
): CaptchaClassificationState {
  markCaptchaTokenReturned(state, captchaType);
  state.solveCompleted = true;
  return state;
}

export function isCaptchaPrimaryReason(value: unknown): value is CaptchaPrimaryReason {
  return (
    value === 'captcha_solved' ||
    value === 'captcha_unsolved_after_token' ||
    value === 'captcha_solver_timeout' ||
    value === 'captcha_solver_failed' ||
    value === 'captcha_detected_autoskip' ||
    value === 'captcha_required_manual_review'
  );
}

export function mapCaptchaTerminalReason(input: {
  captchaDetected: boolean;
  captchaClassificationLocked: boolean;
  solvedAndSubmitted?: boolean;
  tokenReturned?: boolean;
  captchaStillPresent?: boolean;
  solverTimedOut?: boolean;
  solverFailed?: boolean;
  autoskip?: boolean;
  manualReview?: boolean;
}): CaptchaPrimaryReason | null {
  if (!input.captchaDetected || !input.captchaClassificationLocked) return null;
  if (input.solvedAndSubmitted) return 'captcha_solved';
  if (input.autoskip) return 'captcha_detected_autoskip';
  if (input.tokenReturned && input.captchaStillPresent) return 'captcha_unsolved_after_token';
  if (input.solverTimedOut) return 'captcha_solver_timeout';
  if (input.manualReview && input.captchaStillPresent) return 'captcha_required_manual_review';
  if (input.solverFailed || !input.solvedAndSubmitted) return 'captcha_solver_failed';
  return 'captcha_required_manual_review';
}

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
