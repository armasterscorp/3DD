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
  getInquiryRunState,
  inquiryCheckpoint,
  InquiryRunStoppedError,
  setInquiryRunState,
} from '../inquiry-run-store';

// Use unique license prefixes per test suite to avoid globalThis state pollution.
const LIC = 'test-iso';

function licId(suffix: string) {
  return `${LIC}-${suffix}`;
}

describe('inquiry run isolation', () => {
  // ── A) start run after previous stopped run ───────────────────────────────

  it('A) new run proceeds normally after previous run was stopped', async () => {
    const licenseId = licId('a');
    const runA = 'run-a-stopped';
    const runB = 'run-b-fresh';

    // Previous run ends in stopped state.
    setInquiryRunState(licenseId, 'stopped', { runId: runA });
    expect(getInquiryRunState(licenseId).mode).toBe('stopped');

    // New run starts — control route sets mode=running with new runId.
    setInquiryRunState(licenseId, 'running', { runId: runB });

    // The checkpoint for the new run must NOT throw.
    await expect(inquiryCheckpoint(licenseId, runB)).resolves.toBeUndefined();

    // State should still be running.
    expect(getInquiryRunState(licenseId).mode).toBe('running');
    expect(getInquiryRunState(licenseId).runId).toBe(runB);
  });

  // ── B) restored cache must not force stopped state ────────────────────────

  it('B) restoring campaign data must not restore operational stop flag', () => {
    const licenseId = licId('b');
    const runId = 'run-b-cache';

    // Simulate server-side in-memory state after a previous stopped run.
    setInquiryRunState(licenseId, 'stopped', { runId });

    // "Restore" is simulated by calling setInquiryRunState with running + same
    // or new runId, which is what the control route does when action=start.
    const newRunId = 'run-b-cache-new';
    setInquiryRunState(licenseId, 'running', { runId: newRunId });

    // Runtime state is fresh — not stopped.
    const state = getInquiryRunState(licenseId);
    expect(state.mode).toBe('running');
    expect(state.runId).toBe(newRunId);
  });

  // ── C) old run stop event must not cancel new run ─────────────────────────

  it('C) stale stop from old runId does not abort new run checkpoint', async () => {
    const licenseId = licId('c');
    const oldRunId = 'run-c-old';
    const newRunId = 'run-c-new';

    // Old run was stopped (mode=stopped kept in global map).
    setInquiryRunState(licenseId, 'stopped', { runId: oldRunId });

    // New run is started — state is overwritten to running with new runId.
    setInquiryRunState(licenseId, 'running', { runId: newRunId });

    // New run's checkpoint with its own runId must pass.
    await expect(inquiryCheckpoint(licenseId, newRunId)).resolves.toBeUndefined();

    // Old run's stale checkpoint with old runId must throw stale_run_context
    // (not stopped_by_user), because the mode is now running but runId differs.
    const staleError = await inquiryCheckpoint(licenseId, oldRunId).then(
      () => null,
      (e) => e
    );
    expect(staleError).toBeInstanceOf(InquiryRunStoppedError);
    expect((staleError as InquiryRunStoppedError).code).toBe('stale_run_context');
  });

  // ── D) explicit stop cancels the active run ───────────────────────────────

  it('D) explicit stop for active run throws stopped_by_user', async () => {
    const licenseId = licId('d');
    const runId = 'run-d-active';

    setInquiryRunState(licenseId, 'running', { runId });

    // User explicitly stops the run.
    setInquiryRunState(licenseId, 'stopped', { runId });

    // Checkpoint for this run must now throw stopped_by_user.
    const err = await inquiryCheckpoint(licenseId, runId).then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(InquiryRunStoppedError);
    expect((err as InquiryRunStoppedError).code).toBe('stopped_by_user');
    expect((err as InquiryRunStoppedError).message).toBe('Inquiry run stopped by user.');
  });

  // ── E) reason code "stopped_by_user" only for explicit user stop ──────────

  it('E) stale_run_context does not report stopped_by_user', async () => {
    const licenseId = licId('e');
    const activeRunId = 'run-e-active';
    const staleRunId = 'run-e-stale';

    // New run is active.
    setInquiryRunState(licenseId, 'running', { runId: activeRunId });

    // Stale callback from old run calls checkpoint with the old runId.
    const staleErr = await inquiryCheckpoint(licenseId, staleRunId).then(
      () => null,
      (e) => e
    );
    expect(staleErr).toBeInstanceOf(InquiryRunStoppedError);
    expect((staleErr as InquiryRunStoppedError).code).toBe('stale_run_context');
    // Message must NOT say "stopped by user".
    expect((staleErr as InquiryRunStoppedError).message).not.toContain('stopped by user');

    // Only a genuine stop + same runId should yield stopped_by_user.
    setInquiryRunState(licenseId, 'stopped', { runId: activeRunId });
    const userStopErr = await inquiryCheckpoint(licenseId, activeRunId).then(
      () => null,
      (e) => e
    );
    expect(userStopErr).toBeInstanceOf(InquiryRunStoppedError);
    expect((userStopErr as InquiryRunStoppedError).code).toBe('stopped_by_user');
    expect((userStopErr as InquiryRunStoppedError).message).toBe('Inquiry run stopped by user.');
  });
});
