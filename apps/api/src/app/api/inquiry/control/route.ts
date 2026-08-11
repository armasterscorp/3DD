import { NextRequest, NextResponse } from 'next/server';
import { closeInquirySession } from '@/lib/inquiry-browser-store';
import {
  createInquiryRunContext,
  getInquiryLicenseId,
  getInquiryRunState,
  setInquiryRunState,
  stopInquiryRunContext,
} from '@/lib/inquiry-run-store';
import { startInquiryBackendWorker } from '@/lib/inquiry-backend-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const licenseId = getInquiryLicenseId(request);
    return NextResponse.json({ success: true, state: getInquiryRunState(licenseId) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const licenseId = getInquiryLicenseId(request);
    const body = await request.json();
    const action = String(body.action || '').toLowerCase();
    const sessionId = String(body.sessionId || '').trim() || undefined;
    const runId = String(body.runId || '').trim() || undefined;
    const targets = Array.isArray(body.targets) ? body.targets.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 5000) : undefined;
    const totalTargets = Number.isFinite(Number(body.totalTargets)) ? Math.max(0, Number(body.totalTargets)) : undefined;
    const index = Number.isFinite(Number(body.index)) ? Math.max(0, Number(body.index)) : undefined;
    const currentTarget = String(body.currentTarget || '').trim() || undefined;
    if (!['start', 'pause', 'resume', 'stop', 'progress'].includes(action)) throw new Error('Invalid Inquiry control action.');
    const previous = getInquiryRunState(licenseId);
    if (action === 'start' && runId) createInquiryRunContext(licenseId, runId);
    if (action === 'stop') stopInquiryRunContext(licenseId, previous.runId || runId);
    const mode = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : action === 'progress' ? previous.mode : 'running';
    const state = setInquiryRunState(licenseId, mode, { sessionId, runId, targets, totalTargets, index, currentTarget });
    if (action === 'start' && body.autoSubmit !== false && runId && sessionId && targets?.length) {
      const profile = body.profile && typeof body.profile === 'object' ? body.profile as Record<string, unknown> : {};
      startInquiryBackendWorker({ licenseId, runId, sessionId, targets, startIndex: index || 0, profile });
    }
    if (action === 'stop') {
      // The backend run state is authoritative. The dashboard may have a stale
      // sessionId after recovery/recycling, so terminate both references safely.
      const ownedSessionIds = Array.from(new Set([previous.sessionId, sessionId].filter(Boolean) as string[]));
      await Promise.all(ownedSessionIds.map((id) => closeInquirySession(id, licenseId).catch(() => undefined)));
    }
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
