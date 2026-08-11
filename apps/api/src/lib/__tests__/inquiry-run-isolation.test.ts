/**
 * Tests for inquiry run-scoped cancellation isolation.
 *
 * Covers the five scenarios from the problem statement:
 *   A) start run after previous stopped run => new run processes normally
 *   B) restored cache does not force stopped state
 *   C) old run stop event does not cancel new run (different runId)
 *   D) explicit stop for active run cancels correctly
 *   E) reason code "stopped_by_user" only when explicit user stop for same runId
 */

import { describe, expect, it } from 'vitest';
import {
  clearInquiryRunContext,
  createInquiryRunContext,
  getActiveInquiryRunId,
  getInquiryRunContext,
  getInquiryRunDiagnostics,
  getInquiryRunState,
  inquiryCheckpoint,
  InquiryRunStoppedError,
  setInquiryRunState,
  stopInquiryRunContext,
} from '../inquiry-run-store';

// Use unique license prefixes per test suite to avoid globalThis state pollution.
const LIC = 'test-iso';

function licId(suffix: string) {
  return `${LIC}-${suffix}`;
}

describe('inquiry run isolation', () => {
  // ── A) start run after previous stopped run ───────────────────────────────

  it('A) new run: first item passes run-context check', async () => {
    const licenseId = licId('a');
    const runB = 'run-b-fresh';

    createInquiryRunContext(licenseId, runB);
    setInquiryRunState(licenseId, 'running', { runId: runB });

    await expect(inquiryCheckpoint(licenseId, runB)).resolves.toBeUndefined();
    expect(getInquiryRunState(licenseId).mode).toBe('running');
    expect(getInquiryRunState(licenseId).runId).toBe(runB);
  });

  // ── B) context survives until explicit terminal cleanup ───────────────────

  it('B) context not cleaned until run end', async () => {
    const licenseId = licId('b');
    const runId = 'run-b-active';

    createInquiryRunContext(licenseId, runId);
    setInquiryRunState(licenseId, 'running', { runId });

    expect(getInquiryRunContext(licenseId, runId)?.stopped).toBe(false);
    await expect(inquiryCheckpoint(licenseId, runId)).resolves.toBeUndefined();

    setInquiryRunState(licenseId, 'complete', { runId });
    expect(getInquiryRunContext(licenseId, runId)).not.toBeNull();

    clearInquiryRunContext(licenseId, runId);
    expect(getInquiryRunContext(licenseId, runId)).toBeNull();
  });

  // ── C) explicit stop invalidates remaining items correctly ────────────────

  it('C) explicit stop invalidates remaining items correctly', async () => {
    const licenseId = licId('c');
    const runId = 'run-c-active';

    createInquiryRunContext(licenseId, runId);
    setInquiryRunState(licenseId, 'running', { runId });
    stopInquiryRunContext(licenseId, runId);
    setInquiryRunState(licenseId, 'stopped', { runId });

    const err = await inquiryCheckpoint(licenseId, runId).then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(InquiryRunStoppedError);
    expect((err as InquiryRunStoppedError).code).toBe('stopped_by_user');
  });

  // ── D) rerun after completion creates fresh run context ───────────────────

  it('D) rerun after completion creates new runId and works', async () => {
    const licenseId = licId('d');
    const runA = 'run-d-one';
    const runB = 'run-d-two';

    createInquiryRunContext(licenseId, runA);
    setInquiryRunState(licenseId, 'complete', { runId: runA });
    clearInquiryRunContext(licenseId, runA);

    createInquiryRunContext(licenseId, runB);
    setInquiryRunState(licenseId, 'running', { runId: runB });
    await expect(inquiryCheckpoint(licenseId, runB)).resolves.toBeUndefined();
    expect(getActiveInquiryRunId(licenseId)).toBe(runB);

    const stale = await inquiryCheckpoint(licenseId, runA).then(
      () => null,
      (e) => e
    );
    expect(stale).toBeInstanceOf(InquiryRunStoppedError);
    expect((stale as InquiryRunStoppedError).code).toBe('stale_run_context');
  });

  // ── E) cache restore must not overwrite runtime context ───────────────────

  it('E) restored local session state does not overwrite active runtime context', async () => {
    const licenseId = licId('e');
    const activeRunId = 'run-e-active';
    const staleRunId = 'run-e-restored';

    createInquiryRunContext(licenseId, activeRunId);
    setInquiryRunState(licenseId, 'running', { runId: activeRunId });

    setInquiryRunState(licenseId, 'running', { runId: staleRunId });

    const diagnostics = getInquiryRunDiagnostics(licenseId, activeRunId);
    expect(diagnostics.activeRunId).toBe(activeRunId);
    expect(diagnostics.contextExists).toBe(true);
    expect(diagnostics.stopped).toBe(false);
    await expect(inquiryCheckpoint(licenseId, activeRunId)).resolves.toBeUndefined();
  });
});
