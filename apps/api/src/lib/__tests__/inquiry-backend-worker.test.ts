import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prepareMock, submitMock, closeSessionMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  submitMock: vi.fn(),
  closeSessionMock: vi.fn(async () => undefined),
}));

vi.mock('@/app/api/inquiry/prepare/route', () => ({ POST: prepareMock }));
vi.mock('@/app/api/inquiry/submit/route', () => ({ POST: submitMock }));
vi.mock('@/lib/inquiry-browser-store', () => ({ closeInquirySession: closeSessionMock }));

import { startInquiryBackendWorker } from '../inquiry-backend-worker';
import {
  clearInquiryRunContext,
  createInquiryRunContext,
  getInquiryResults,
  getInquiryRunState,
  setInquiryRunState,
} from '../inquiry-run-store';

async function flushRun(licenseId: string, mode: 'complete' | 'stopped') {
  for (let i = 0; i < 20; i += 1) {
    await vi.runAllTimersAsync();
    await Promise.resolve();
    if (getInquiryRunState(licenseId).mode === mode) return;
  }
  throw new Error(`Run did not reach ${mode}.`);
}

describe('inquiry backend worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prepareMock.mockReset();
    submitMock.mockReset();
    closeSessionMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('processes 10 leads without immediate run_context_invalid flood and logs completion breakdown', async () => {
    const licenseId = 'worker-a';
    const runId = `run-worker-a-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = 'sessionaaa';
    const targets = Array.from({ length: 10 }, (_, i) => `lead-${i + 1}.example.com`);

    prepareMock.mockImplementation(async (request: Request) => {
      const body = await request.json();
      return Response.json({
        success: true,
        classification: 'form_found',
        contactUrl: `https://${String(body.target)}/contact`,
      });
    });
    submitMock.mockImplementation(async () =>
      Response.json({
        success: true,
        confirmation: 'mock submission confirmed',
        currentUrl: 'https://example.com/thank-you',
      })
    );

    createInquiryRunContext(licenseId, runId);
    setInquiryRunState(licenseId, 'running', { runId, sessionId, targets, totalTargets: targets.length, index: 0, currentTarget: targets[0] });
    startInquiryBackendWorker({ licenseId, runId, sessionId, targets, startIndex: 0, profile: {} });

    await flushRun(licenseId, 'complete');

    const { runLogs, counts } = getInquiryResults(licenseId, runId);
    expect(runLogs.some((item) => item.message.includes('run_context_invalid'))).toBe(false);
    expect(runLogs.some((item) => item.message.includes('[debug] run_start run-context'))).toBe(true);
    expect(runLogs.some((item) => item.message.includes('[debug] item_1 run-context'))).toBe(true);
    expect(runLogs.some((item) => item.message.includes('1/10 — checking lead-1.example.com for a contact form'))).toBe(true);
    expect(runLogs.some((item) => item.message.includes('Inquiry automatic run complete — 10/10 processed (success 10, skipped/review 0, failed 0)'))).toBe(true);
    expect(counts.submitted).toBe(10);
  });

  it('aborts once with a single run-level fatal when the run context is missing', async () => {
    const licenseId = 'worker-b';
    const runId = `run-worker-b-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = 'sessionbbb';
    const targets = ['fatal.example.com', 'ignored.example.com'];

    setInquiryRunState(licenseId, 'running', { runId, sessionId, targets, totalTargets: targets.length, index: 0, currentTarget: targets[0] });
    startInquiryBackendWorker({ licenseId, runId, sessionId, targets, startIndex: 0, profile: {} });

    await flushRun(licenseId, 'stopped');

    const { runLogs } = getInquiryResults(licenseId, runId);
    const fatalLogs = runLogs.filter((item) => item.message.includes('Inquiry automatic run aborted'));
    const invalidLogs = runLogs.filter((item) => item.message.includes('run_context_invalid'));
    expect(fatalLogs).toHaveLength(1);
    expect(invalidLogs).toHaveLength(0);
    expect(runLogs.filter((item) => item.message.includes('checking '))).toHaveLength(0);
    clearInquiryRunContext(licenseId, runId);
  });
});
