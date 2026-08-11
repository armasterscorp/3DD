export type InquiryItemState =
  | 'SCANNING'
  | 'FORM_FOUND'
  | 'CAPTCHA_SOLVING'
  | 'READY_TO_SUBMIT'
  | 'SUBMITTING'
  | 'DONE'
  | 'SKIPPED'
  | 'REVIEW_REQUIRED'
  | 'TIMEOUT'
  | 'FAILED';

type TerminalState = Extract<InquiryItemState, 'DONE' | 'SKIPPED' | 'REVIEW_REQUIRED' | 'TIMEOUT' | 'FAILED'>;

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
  terminalState?: TerminalState;
  terminalReason?: string;
  createdAt: string;
  updatedAt: string;
  abortController: AbortController;
};

const globalStore = globalThis as typeof globalThis & {
  __threeDSuiteInquiryItemAttempts?: Map<string, StoredAttempt>;
};
const attempts = globalStore.__threeDSuiteInquiryItemAttempts ?? new Map<string, StoredAttempt>();
if (!globalStore.__threeDSuiteInquiryItemAttempts) globalStore.__threeDSuiteInquiryItemAttempts = attempts;

function keyOf(ref: Pick<InquiryAttemptRef, 'licenseId' | 'runId' | 'target' | 'index'>): string {
  return `${ref.licenseId}::${ref.runId}::${ref.index}::${ref.target.toLowerCase()}`;
}

const transitions: Record<InquiryItemState, InquiryItemState[]> = {
  SCANNING: ['FORM_FOUND', 'CAPTCHA_SOLVING', 'SKIPPED', 'REVIEW_REQUIRED', 'TIMEOUT', 'FAILED'],
  FORM_FOUND: ['CAPTCHA_SOLVING', 'READY_TO_SUBMIT', 'SKIPPED', 'REVIEW_REQUIRED', 'TIMEOUT', 'FAILED'],
  CAPTCHA_SOLVING: ['READY_TO_SUBMIT', 'REVIEW_REQUIRED', 'SKIPPED', 'TIMEOUT', 'FAILED'],
  READY_TO_SUBMIT: ['SUBMITTING', 'REVIEW_REQUIRED', 'SKIPPED', 'TIMEOUT', 'FAILED'],
  SUBMITTING: ['DONE', 'REVIEW_REQUIRED', 'SKIPPED', 'TIMEOUT', 'FAILED'],
  DONE: [],
  SKIPPED: [],
  REVIEW_REQUIRED: [],
  TIMEOUT: [],
  FAILED: [],
};

export function startInquiryItemAttempt(input: Omit<InquiryAttemptRef, 'attemptId'> & { attemptId?: string }): InquiryAttemptRef {
  const key = keyOf(input);
  const previous = attempts.get(key);
  if (previous) {
    previous.abortController.abort('superseded');
  }
  const attemptId = input.attemptId || `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const stored: StoredAttempt = {
    ...input,
    attemptId,
    state: 'SCANNING',
    createdAt: now,
    updatedAt: now,
    abortController: new AbortController(),
  };
  attempts.set(key, stored);
  return { ...stored };
}

export function isCurrentInquiryItemAttempt(ref: InquiryAttemptRef): boolean {
  const current = attempts.get(keyOf(ref));
  if (!current) return false;
  return current.attemptId === ref.attemptId && current.sessionGeneration === ref.sessionGeneration;
}

export function isActiveInquiryItemAttempt(ref: InquiryAttemptRef): boolean {
  const current = attempts.get(keyOf(ref));
  if (!current) return false;
  if (current.attemptId !== ref.attemptId || current.sessionGeneration !== ref.sessionGeneration) return false;
  if (current.terminalState) return false;
  return !current.abortController.signal.aborted;
}

export function getInquiryItemAttemptSignal(ref: InquiryAttemptRef): AbortSignal | null {
  const current = attempts.get(keyOf(ref));
  if (!current) return null;
  if (current.attemptId !== ref.attemptId || current.sessionGeneration !== ref.sessionGeneration) return null;
  return current.abortController.signal;
}

export function transitionInquiryItemState(ref: InquiryAttemptRef, next: InquiryItemState): boolean {
  const current = attempts.get(keyOf(ref));
  if (!current) return false;
  if (current.attemptId !== ref.attemptId || current.sessionGeneration !== ref.sessionGeneration) return false;
  if (current.state === next) return true;
  if (!transitions[current.state].includes(next)) return false;
  current.state = next;
  current.updatedAt = new Date().toISOString();
  return true;
}

export function finishInquiryItemAttempt(ref: InquiryAttemptRef, terminalState: TerminalState, reason?: string): boolean {
  const current = attempts.get(keyOf(ref));
  if (!current) return false;
  if (current.attemptId !== ref.attemptId || current.sessionGeneration !== ref.sessionGeneration) return false;
  if (current.terminalState) return false;
  if (!transitionInquiryItemState(ref, terminalState)) return false;
  current.terminalState = terminalState;
  current.terminalReason = reason;
  current.abortController.abort(reason || terminalState);
  current.updatedAt = new Date().toISOString();
  return true;
}

export function cancelInquiryItemAttempt(ref: InquiryAttemptRef, terminalState: Exclude<TerminalState, 'DONE'>, reason?: string): boolean {
  return finishInquiryItemAttempt(ref, terminalState, reason);
}

export function formatAttemptStep(message: string, ref: Pick<InquiryAttemptRef, 'attemptId' | 'sessionGeneration'>): string {
  return `[attempt:${ref.attemptId}|gen:${ref.sessionGeneration}] ${message}`;
}
