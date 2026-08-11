import fs from 'node:fs';
import path from 'node:path';

type RunMode = 'idle' | 'running' | 'paused' | 'stopped' | 'complete';
export type InquiryResultStatus = 'submitted' | 'failed' | 'captcha' | 'review';

export type InquiryStoredResult = {
  id: string;
  licenseId: string;
  runId: string;
  sessionId: string;
  status: InquiryResultStatus;
  target: string;
  contactUrl?: string;
  reason?: string;
  captchaProvider?: string;
  values?: Record<string, unknown>;
  attemptId?: string;
  sessionGeneration?: number;
  targetIndex?: number;
  createdAt: string;
};

export type InquiryStoredLog = {
  id: string;
  licenseId: string;
  runId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  attemptId?: string;
  sessionGeneration?: number;
  targetIndex?: number;
  target?: string;
  createdAt: string;
};

type LicenseBucket = { results: InquiryStoredResult[]; logs?: InquiryStoredLog[] };
type PersistentStore = Record<string, LicenseBucket>;
export type InquiryRunState = { mode: RunMode; sessionId?: string; runId?: string; targets?: string[]; totalTargets?: number; index?: number; currentTarget?: string; updatedAt: string };
type RunState = InquiryRunState;
export type InquiryRuntimeContext = {
  licenseId: string;
  runId: string;
  stopped: boolean;
  createdAt: string;
  stopRequestedAt?: string;
};

const globalStore = globalThis as typeof globalThis & {
  __threeDSuiteInquiryRunStates?: Map<string, RunState>;
};
const runStates = globalStore.__threeDSuiteInquiryRunStates ?? new Map<string, RunState>();
if (!globalStore.__threeDSuiteInquiryRunStates) globalStore.__threeDSuiteInquiryRunStates = runStates;
const globalRuntimeStore = globalThis as typeof globalThis & {
  __threeDSuiteInquiryRuntimeContexts?: Map<string, InquiryRuntimeContext>;
  __threeDSuiteInquiryActiveRunIds?: Map<string, string>;
};
const runtimeContexts = globalRuntimeStore.__threeDSuiteInquiryRuntimeContexts ?? new Map<string, InquiryRuntimeContext>();
const activeRunIds = globalRuntimeStore.__threeDSuiteInquiryActiveRunIds ?? new Map<string, string>();
if (!globalRuntimeStore.__threeDSuiteInquiryRuntimeContexts) globalRuntimeStore.__threeDSuiteInquiryRuntimeContexts = runtimeContexts;
if (!globalRuntimeStore.__threeDSuiteInquiryActiveRunIds) globalRuntimeStore.__threeDSuiteInquiryActiveRunIds = activeRunIds;

const dataDir = path.join(process.cwd(), '.3dsuite-data');
const dataFile = path.join(dataDir, 'inquiry-results.json');

function safeLicenseId(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Missing license context.');
  return raw.slice(0, 200);
}

export function getInquiryLicenseId(request: Request): string {
  return safeLicenseId(request.headers.get('x-3d-suite-license-id'));
}

function readStore(): PersistentStore {
  try {
    const text = fs.readFileSync(dataFile, 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: PersistentStore): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2), 'utf8');
}

function runtimeKey(licenseIdValue: string, runIdValue: string): string {
  const licenseId = safeLicenseId(licenseIdValue);
  const runId = String(runIdValue || '').trim();
  if (!runId) throw new Error('Missing Inquiry run id.');
  return `${licenseId}::${runId}`;
}

export function setInquiryRunState(licenseIdValue: string, mode: RunMode, details: { sessionId?: string; runId?: string; targets?: string[]; totalTargets?: number; index?: number; currentTarget?: string } = {}): RunState {
  const licenseId = safeLicenseId(licenseIdValue);
  const previous = runStates.get(licenseId);
  const state: RunState = {
    mode,
    sessionId: details.sessionId ?? previous?.sessionId,
    runId: details.runId ?? previous?.runId,
    targets: details.targets ?? previous?.targets,
    totalTargets: details.totalTargets ?? previous?.totalTargets,
    index: details.index ?? previous?.index,
    currentTarget: details.currentTarget ?? previous?.currentTarget,
    updatedAt: new Date().toISOString(),
  };
  runStates.set(licenseId, state);
  return state;
}

export function getInquiryRunState(licenseIdValue: string): RunState {
  const licenseId = safeLicenseId(licenseIdValue);
  return runStates.get(licenseId) || { mode: 'idle', updatedAt: new Date().toISOString() };
}

export function createInquiryRunContext(licenseIdValue: string, runIdValue: string): InquiryRuntimeContext {
  const licenseId = safeLicenseId(licenseIdValue);
  const runId = String(runIdValue || '').trim();
  if (!runId) throw new Error('Missing Inquiry run id.');
  const context: InquiryRuntimeContext = {
    licenseId,
    runId,
    stopped: false,
    createdAt: new Date().toISOString(),
  };
  activeRunIds.set(licenseId, runId);
  runtimeContexts.set(runtimeKey(licenseId, runId), context);
  return context;
}

export function getInquiryRunContext(licenseIdValue: string, runIdValue: string): InquiryRuntimeContext | null {
  const licenseId = safeLicenseId(licenseIdValue);
  const runId = String(runIdValue || '').trim();
  if (!runId) return null;
  return runtimeContexts.get(runtimeKey(licenseId, runId)) || null;
}

export function getActiveInquiryRunId(licenseIdValue: string): string | undefined {
  const licenseId = safeLicenseId(licenseIdValue);
  return activeRunIds.get(licenseId);
}

export function stopInquiryRunContext(licenseIdValue: string, runIdValue?: string): boolean {
  const licenseId = safeLicenseId(licenseIdValue);
  const runId = String(runIdValue || activeRunIds.get(licenseId) || '').trim();
  if (!runId) return false;
  const context = runtimeContexts.get(runtimeKey(licenseId, runId));
  if (!context) return false;
  context.stopped = true;
  context.stopRequestedAt = new Date().toISOString();
  return true;
}

export function clearInquiryRunContext(licenseIdValue: string, runIdValue: string): void {
  const licenseId = safeLicenseId(licenseIdValue);
  const runId = String(runIdValue || '').trim();
  if (!runId) return;
  runtimeContexts.delete(runtimeKey(licenseId, runId));
  if (activeRunIds.get(licenseId) === runId) activeRunIds.delete(licenseId);
}

export function getInquiryRunDiagnostics(licenseIdValue: string, runIdValue: string): {
  runId: string;
  activeRunId?: string;
  contextExists: boolean;
  stopped: boolean;
  isActive: boolean;
} {
  const licenseId = safeLicenseId(licenseIdValue);
  const runId = String(runIdValue || '').trim();
  const activeRunId = activeRunIds.get(licenseId);
  const context = runId ? runtimeContexts.get(runtimeKey(licenseId, runId)) : undefined;
  return {
    runId,
    activeRunId,
    contextExists: !!context,
    stopped: !!context?.stopped,
    isActive: !!runId && activeRunId === runId && !!context && !context.stopped,
  };
}

export function isInquiryRunActive(licenseIdValue: string, runIdValue: string): boolean {
  return getInquiryRunDiagnostics(licenseIdValue, runIdValue).isActive;
}

export class InquiryRunStoppedError extends Error {
  public readonly code: 'stopped_by_user' | 'stale_run_context';
  constructor(code: 'stopped_by_user' | 'stale_run_context' = 'stopped_by_user') {
    super(code === 'stopped_by_user' ? 'Inquiry run stopped by user.' : 'Inquiry run context is no longer active.');
    this.name = 'InquiryRunStoppedError';
    this.code = code;
  }
}

/**
 * Checkpoint for long-running inquiry operations. Throws if the run has been
 * stopped or if a different run has become active for this license (stale-run
 * detection). Pass `expectedRunId` to enable run-scoped cancellation isolation;
 * without it only the global stopped flag is checked.
 */
export async function inquiryCheckpoint(licenseIdValue: string, expectedRunId?: string): Promise<void> {
  const licenseId = safeLicenseId(licenseIdValue);
  for (;;) {
    const state = getInquiryRunState(licenseId);
    if (expectedRunId) {
      const diagnostics = getInquiryRunDiagnostics(licenseId, expectedRunId);
      if (diagnostics.stopped || state.mode === 'stopped') throw new InquiryRunStoppedError('stopped_by_user');
      if (!diagnostics.isActive) throw new InquiryRunStoppedError('stale_run_context');
    } else {
      if (state.mode === 'stopped') throw new InquiryRunStoppedError('stopped_by_user');
    }
    if (state.mode !== 'paused') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function addInquiryResult(input: Omit<InquiryStoredResult, 'id' | 'createdAt' | 'licenseId'> & { licenseId: string }): InquiryStoredResult {
  const licenseId = safeLicenseId(input.licenseId);
  const store = readStore();
  const bucket = store[licenseId] || { results: [], logs: [] };
  const result: InquiryStoredResult = {
    ...input,
    licenseId,
    id: `inqr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  };
  bucket.results.push(result);
  if (bucket.results.length > 1500) bucket.results = bucket.results.slice(-1500);
  store[licenseId] = bucket;
  writeStore(store);
  return result;
}

export function addInquiryLog(input: {
  licenseId: string;
  runId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  attemptId?: string;
  sessionGeneration?: number;
  targetIndex?: number;
  target?: string;
}): InquiryStoredLog {
  const licenseId = safeLicenseId(input.licenseId);
  const store = readStore();
  const bucket = store[licenseId] || { results: [], logs: [] };
  const log: InquiryStoredLog = {
    ...input, licenseId,
    id: `inql_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  };
  const logs = Array.isArray(bucket.logs) ? bucket.logs : [];
  logs.push(log);
  bucket.logs = logs.length > 3000 ? logs.slice(-3000) : logs;
  store[licenseId] = bucket;
  writeStore(store);
  return log;
}

export function getInquiryResults(licenseIdValue: string, runId?: string) {
  const licenseId = safeLicenseId(licenseIdValue);
  const store = readStore();
  const all = store[licenseId]?.results || [];
  const allLogs = Array.isArray(store[licenseId]?.logs) ? store[licenseId]!.logs! : [];
  const runResults = runId ? all.filter((item) => item.runId === runId) : [];
  const captchaRows = all.filter((item) => item.status === 'captcha');
  const reviewRows = all.filter((item) => item.status === 'review');
  const savedCaptcha = Array.from(new Map(captchaRows.map((item) => [item.target.toLowerCase(), item])).values());
  const savedReview = Array.from(new Map(reviewRows.map((item) => [item.target.toLowerCase(), item])).values());
  return {
    runResults,
    runLogs: runId ? allLogs.filter((item) => item.runId === runId) : [],
    savedCaptcha,
    savedReview,
    counts: {
      submitted: runResults.filter((item) => item.status === 'submitted').length,
      failed: runResults.filter((item) => item.status === 'failed').length,
      captcha: runResults.filter((item) => item.status === 'captcha').length,
      review: runResults.filter((item) => item.status === 'review').length,
      savedCaptcha: savedCaptcha.length,
      savedReview: savedReview.length,
    },
  };
}

export function clearInquiryCaptchaResults(licenseIdValue: string): number {
  const licenseId = safeLicenseId(licenseIdValue);
  const store = readStore();
  const bucket = store[licenseId] || { results: [], logs: [] };
  const before = bucket.results.length;
  bucket.results = bucket.results.filter((item) => item.status !== 'captcha');
  store[licenseId] = bucket;
  writeStore(store);
  return before - bucket.results.length;
}

export function clearInquiryReviewResults(licenseIdValue: string): number {
  const licenseId = safeLicenseId(licenseIdValue);
  const store = readStore();
  const bucket = store[licenseId] || { results: [], logs: [] };
  const before = bucket.results.length;
  bucket.results = bucket.results.filter((item) => item.status !== 'review');
  store[licenseId] = bucket;
  writeStore(store);
  return before - bucket.results.length;
}
