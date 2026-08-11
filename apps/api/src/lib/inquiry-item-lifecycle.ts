export type InquiryItemState =
  | 'PENDING'
  | 'SCANNING'
  | 'FORM_FOUND'
  | 'CAPTCHA_CHECKING'
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_SOLVING'
  | 'CAPTCHA_VERIFIED'
  | 'CAPTCHA_FAILED'
  | 'READY_TO_SUBMIT'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'SKIPPED_NO_FORM'
  | 'SKIPPED_CAPTCHA_REQUIRED'
  | 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED'
  | 'TIMEOUT_SCAN'
  | 'TIMEOUT_SUBMIT'
  | 'FAILED';

export type InquiryTerminalState = Extract<
  InquiryItemState,
  | 'SUBMITTED'
  | 'SKIPPED_NO_FORM'
  | 'SKIPPED_CAPTCHA_REQUIRED'
  | 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED'
  | 'TIMEOUT_SCAN'
  | 'TIMEOUT_SUBMIT'
  | 'FAILED'
>;

export type InquiryTerminalReasonCode =
  | 'no_form_found'
  | 'captcha_solved'
  | 'captcha_unsolved_after_token'
  | 'captcha_solver_timeout'
  | 'captcha_solver_failed'
  | 'captcha_detected_autoskip'
  | 'captcha_required_manual_review'
  | 'scan_timeout'
  | 'submit_timeout'
  | 'submit_failed'
  | 'run_context_invalid'
  | 'submitted_success';

export type InquiryOperationKind = 'scan' | 'captcha' | 'submit';

export type InquiryAttemptRef = {
  licenseId: string;
  runId: string;
  target: string;
  index: number;
  attemptId: string;
  sessionGeneration: number;
};

type StoredAttempt = InquiryAttemptRef & {
  state: InquiryItemState;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  terminalState?: InquiryTerminalState;
  terminalReason?: string;
  terminalReasonCode?: InquiryTerminalReasonCode;
  captchaDetected?: boolean;
  captchaClassificationLocked?: boolean;
  captchaType?: string;
  terminalEmitted: boolean;
  controllers: Record<InquiryOperationKind, AbortController>;
  timers: Set<NodeJS.Timeout>;
  invalidTransitionDebugKeys: Set<string>;
  debugEvents: string[];
  attemptSequence: number;
};

export type InquiryItemSnapshot = Omit<StoredAttempt, 'controllers' | 'timers' | 'invalidTransitionDebugKeys' | 'debugEvents'> & {
  aborted: boolean;
};

const globalStore = globalThis as typeof globalThis & {
  __threeDSuiteInquiryItemAttempts?: Map<string, StoredAttempt>;
};
const attempts = globalStore.__threeDSuiteInquiryItemAttempts ?? new Map<string, StoredAttempt>();
if (!globalStore.__threeDSuiteInquiryItemAttempts) globalStore.__threeDSuiteInquiryItemAttempts = attempts;

function keyOf(ref: Pick<InquiryAttemptRef, 'licenseId' | 'runId' | 'target' | 'index'>): string {
  return `${ref.licenseId}::${ref.runId}::${ref.index}`;
}

function buildControllerBag() {
  return {
    scan: new AbortController(),
    captcha: new AbortController(),
    submit: new AbortController(),
  } satisfies Record<InquiryOperationKind, AbortController>;
}

const transitions: Record<InquiryItemState, InquiryItemState[]> = {
  PENDING: ['SCANNING'],
  SCANNING: ['FORM_FOUND', 'CAPTCHA_CHECKING', 'SKIPPED_NO_FORM', 'SKIPPED_CAPTCHA_REQUIRED', 'TIMEOUT_SCAN', 'FAILED'],
  FORM_FOUND: ['CAPTCHA_CHECKING', 'READY_TO_SUBMIT', 'FAILED'],
  CAPTCHA_CHECKING: ['CAPTCHA_REQUIRED', 'READY_TO_SUBMIT', 'CAPTCHA_VERIFIED', 'FAILED'],
  CAPTCHA_REQUIRED: ['CAPTCHA_SOLVING', 'SKIPPED_CAPTCHA_REQUIRED', 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED', 'FAILED'],
  CAPTCHA_SOLVING: ['CAPTCHA_VERIFIED', 'CAPTCHA_FAILED', 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED', 'FAILED'],
  CAPTCHA_VERIFIED: ['READY_TO_SUBMIT', 'SUBMITTING', 'FAILED'],
  CAPTCHA_FAILED: ['REVIEW_REQUIRED_CAPTCHA_UNSOLVED', 'FAILED'],
  READY_TO_SUBMIT: ['SUBMITTING', 'FAILED'],
  SUBMITTING: ['SUBMITTED', 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED', 'TIMEOUT_SUBMIT', 'FAILED'],
  SUBMITTED: [],
  SKIPPED_NO_FORM: [],
  SKIPPED_CAPTCHA_REQUIRED: [],
  REVIEW_REQUIRED_CAPTCHA_UNSOLVED: [],
  TIMEOUT_SCAN: [],
  TIMEOUT_SUBMIT: [],
  FAILED: [],
};

function abortController(controller: AbortController, reason: string): void {
  if (!controller.signal.aborted) controller.abort(reason);
}

function abortAllControllers(current: StoredAttempt, reason: string): void {
  abortController(current.controllers.scan, reason);
  abortController(current.controllers.captcha, reason);
  abortController(current.controllers.submit, reason);
}

function clearTimers(current: StoredAttempt): void {
  for (const timer of current.timers) clearTimeout(timer);
  current.timers.clear();
}

function pushDebug(current: StoredAttempt, message: string): void {
  current.debugEvents.push(message);
  if (current.debugEvents.length > 50) current.debugEvents = current.debugEvents.slice(-50);
}

function isCurrentStoredAttempt(current: StoredAttempt | undefined, ref: InquiryAttemptRef): current is StoredAttempt {
  return !!current && current.attemptId === ref.attemptId && current.sessionGeneration === ref.sessionGeneration;
}

function currentFor(ref: InquiryAttemptRef): StoredAttempt | null {
  const current = attempts.get(keyOf(ref));
  if (!isCurrentStoredAttempt(current, ref)) return null;
  return current;
}

function isTerminalState(state: InquiryItemState): state is InquiryTerminalState {
  return (
    state === 'SUBMITTED' ||
    state === 'SKIPPED_NO_FORM' ||
    state === 'SKIPPED_CAPTCHA_REQUIRED' ||
    state === 'REVIEW_REQUIRED_CAPTCHA_UNSOLVED' ||
    state === 'TIMEOUT_SCAN' ||
    state === 'TIMEOUT_SUBMIT' ||
    state === 'FAILED'
  );
}

function snapshotOf(current: StoredAttempt): InquiryItemSnapshot {
  return {
    ...current,
    aborted:
      current.controllers.scan.signal.aborted ||
      current.controllers.captcha.signal.aborted ||
      current.controllers.submit.signal.aborted,
  };
}

export function startInquiryItemAttempt(input: Omit<InquiryAttemptRef, 'attemptId'> & { attemptId?: string }): InquiryAttemptRef {
  const key = keyOf(input);
  const previous = attempts.get(key);
  if (previous) {
    clearTimers(previous);
    abortAllControllers(previous, 'superseded');
  }
  const attemptSequence = (previous?.attemptSequence || 0) + 1;
  const attemptId = input.attemptId || `attempt-${attemptSequence}`;
  const now = new Date().toISOString();
  const stored: StoredAttempt = {
    ...input,
    attemptId,
    state: 'PENDING',
    createdAt: now,
    updatedAt: now,
    terminalEmitted: false,
    captchaDetected: false,
    captchaClassificationLocked: false,
    controllers: buildControllerBag(),
    timers: new Set<NodeJS.Timeout>(),
    invalidTransitionDebugKeys: new Set<string>(),
    debugEvents: [],
    attemptSequence,
  };
  attempts.set(key, stored);
  transitionInquiryItemState({ ...stored }, 'SCANNING');
  return {
    licenseId: stored.licenseId,
    runId: stored.runId,
    target: stored.target,
    index: stored.index,
    attemptId: stored.attemptId,
    sessionGeneration: stored.sessionGeneration,
  };
}

export function isCurrentInquiryItemAttempt(ref: InquiryAttemptRef): boolean {
  return currentFor(ref) !== null;
}

export function isActiveInquiryItemAttempt(ref: InquiryAttemptRef): boolean {
  const current = currentFor(ref);
  if (!current) return false;
  if (current.cancelledAt || current.terminalState) return false;
  return !current.controllers.scan.signal.aborted;
}

export function getInquiryItemAttemptSignal(ref: InquiryAttemptRef, operation: InquiryOperationKind = 'scan'): AbortSignal | null {
  const current = currentFor(ref);
  return current ? current.controllers[operation].signal : null;
}

export function getInquiryItemAttempt(ref: InquiryAttemptRef): InquiryItemSnapshot | null {
  const current = currentFor(ref);
  return current ? snapshotOf(current) : null;
}

export function isTerminalInquiryItemState(state: InquiryItemState): state is InquiryTerminalState {
  return isTerminalState(state);
}

export function isTerminalInquiryItemAttempt(ref: InquiryAttemptRef): boolean {
  const current = currentFor(ref);
  return !!current?.terminalState;
}

export function canEmitInquiryProgress(ref: InquiryAttemptRef): boolean {
  const current = currentFor(ref);
  return !!current && !current.terminalState && !current.cancelledAt && !current.controllers.scan.signal.aborted;
}

export function drainInquiryItemDebugEvents(ref: InquiryAttemptRef): string[] {
  const current = currentFor(ref);
  if (!current) return [];
  const entries = [...current.debugEvents];
  current.debugEvents = [];
  return entries;
}

export function registerInquiryItemTimer(ref: InquiryAttemptRef, timer: NodeJS.Timeout): boolean {
  const current = currentFor(ref);
  if (!current || current.terminalState) {
    clearTimeout(timer);
    return false;
  }
  current.timers.add(timer);
  return true;
}

export function clearInquiryItemTimer(ref: InquiryAttemptRef, timer: NodeJS.Timeout): void {
  const current = currentFor(ref);
  clearTimeout(timer);
  current?.timers.delete(timer);
}

export function renewInquiryItemOperation(ref: InquiryAttemptRef, operation: InquiryOperationKind): AbortSignal | null {
  const current = currentFor(ref);
  if (!current || current.terminalState) return null;
  abortController(current.controllers[operation], `${operation}_renewed`);
  current.controllers[operation] = new AbortController();
  current.updatedAt = new Date().toISOString();
  return current.controllers[operation].signal;
}

export function abortInquiryItemOperations(
  ref: InquiryAttemptRef,
  reason: string,
  operations?: InquiryOperationKind[]
): boolean {
  const current = currentFor(ref);
  if (!current) return false;
  const targets = operations || (['scan', 'captcha', 'submit'] as InquiryOperationKind[]);
  for (const operation of targets) abortController(current.controllers[operation], reason);
  current.updatedAt = new Date().toISOString();
  return true;
}

export function transitionInquiryItemState(ref: InquiryAttemptRef, next: InquiryItemState): boolean {
  const current = currentFor(ref);
  if (!current) return false;
  if (current.terminalState) {
    pushDebug(
      current,
      `[debug] invalid transition ignored item=${current.index + 1} attempt=${current.attemptId} from=${current.state} to=${next}`
    );
    return false;
  }
  if (current.state === next) return true;
  if (!transitions[current.state].includes(next)) {
    const debugKey = `${current.state}->${next}`;
    if (!current.invalidTransitionDebugKeys.has(debugKey)) {
      current.invalidTransitionDebugKeys.add(debugKey);
      pushDebug(
        current,
        `[debug] invalid transition ignored item=${current.index + 1} attempt=${current.attemptId} from=${current.state} to=${next}`
      );
    }
    return false;
  }
  current.state = next;
  current.updatedAt = new Date().toISOString();
  return true;
}

export function emitInquiryItemTerminal(
  ref: InquiryAttemptRef,
  terminalState: InquiryTerminalState,
  reasonCode: InquiryTerminalReasonCode,
  reason?: string
): boolean {
  const current = currentFor(ref);
  if (!current) return false;
  if (current.terminalEmitted || current.terminalState) return false;
  if (!isTerminalState(terminalState)) return false;
  const transitionAllowed = current.state === terminalState || transitions[current.state].includes(terminalState);
  if (!transitionAllowed) {
    const debugKey = `${current.state}->${terminalState}`;
    if (!current.invalidTransitionDebugKeys.has(debugKey)) {
      current.invalidTransitionDebugKeys.add(debugKey);
      pushDebug(
        current,
        `[debug] invalid terminal transition ignored item=${current.index + 1} attempt=${current.attemptId} from=${current.state} to=${terminalState}`
      );
    }

    export function markInquiryItemCaptchaDetected(ref: InquiryAttemptRef, captchaType?: string): boolean {
      const current = currentFor(ref);
      if (!current) return false;
      current.captchaDetected = true;
      current.captchaClassificationLocked = true;
      if (captchaType) current.captchaType = captchaType;
      current.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }
  current.state = terminalState;
  current.terminalState = terminalState;
  current.terminalReasonCode = reasonCode;
  current.terminalReason = reason || reasonCode;
  current.terminalEmitted = true;
  current.cancelledAt = new Date().toISOString();
  current.updatedAt = current.cancelledAt;
  clearTimers(current);
  abortAllControllers(current, reason || reasonCode);
  return true;
}

export function finishInquiryItemAttempt(
  ref: InquiryAttemptRef,
  terminalState: InquiryTerminalState,
  reasonCode: InquiryTerminalReasonCode,
  reason?: string
): boolean {
  return emitInquiryItemTerminal(ref, terminalState, reasonCode, reason);
}

export function cancelInquiryItemAttempt(
  ref: InquiryAttemptRef,
  terminalState: Exclude<InquiryTerminalState, 'SUBMITTED'>,
  reasonCode: Exclude<InquiryTerminalReasonCode, 'submitted_success'>,
  reason?: string
): boolean {
  return emitInquiryItemTerminal(ref, terminalState, reasonCode, reason);
}

export function formatAttemptStep(message: string, ref: Pick<InquiryAttemptRef, 'attemptId' | 'sessionGeneration'>): string {
  return `[attempt:${ref.attemptId}|gen:${ref.sessionGeneration}] ${message}`;
}
