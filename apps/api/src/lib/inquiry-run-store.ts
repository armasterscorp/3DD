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
  createdAt: string;
};

export type InquiryStoredLog = {
  id: string;
  licenseId: string;
  runId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  createdAt: string;
};

type LicenseBucket = { results: InquiryStoredResult[]; logs?: InquiryStoredLog[] };
type PersistentStore = Record<string, LicenseBucket>;
export type InquiryRunState = { mode: RunMode; sessionId?: string; runId?: string; targets?: string[]; totalTargets?: number; index?: number; currentTarget?: string; updatedAt: string };
type RunState = InquiryRunState;

const globalStore = globalThis as typeof globalThis & {
  __threeDSuiteInquiryRunStates?: Map<string, RunState>;
};
const runStates = globalStore.__threeDSuiteInquiryRunStates ?? new Map<string, RunState>();
if (!globalStore.__threeDSuiteInquiryRunStates) globalStore.__threeDSuiteInquiryRunStates = runStates;

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

export class InquiryRunStoppedError extends Error {
  constructor() {
    super('Inquiry run stopped by user.');
    this.name = 'InquiryRunStoppedError';
  }
}

export async function inquiryCheckpoint(licenseIdValue: string): Promise<void> {
  const licenseId = safeLicenseId(licenseIdValue);
  for (;;) {
    const state = getInquiryRunState(licenseId);
    if (state.mode === 'stopped') throw new InquiryRunStoppedError();
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

export function addInquiryLog(input: { licenseId: string; runId: string; level: 'info' | 'success' | 'warning' | 'error'; message: string }): InquiryStoredLog {
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
