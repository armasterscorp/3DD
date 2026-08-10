import { NextRequest, NextResponse } from 'next/server';
import {
  clearSendJobEvents,
  getSendJob,
  getSendJobEvents,
  setSendJobAction,
} from '@/lib/send-job-control';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function publicJob(job: NonNullable<ReturnType<typeof getSendJob>>) {
  // Do not return the whole event array in the job object. Logs are delivered
  // separately using the cursor so polling stays lightweight on long runs.
  const { events: _events, ...snapshot } = job;
  return snapshot;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const job = getSendJob(params.jobId);
  if (!job) {
    return NextResponse.json(
      { error: 'Send job not found' },
      { status: 404 }
    );
  }

  const afterRaw = request.nextUrl.searchParams.get('after') || '0';
  const after = Math.max(0, Math.floor(Number(afterRaw) || 0));
  const logResult = getSendJobEvents(params.jobId, after);

  return NextResponse.json({
    success: true,
    job: publicJob(job),
    events: logResult?.events || [],
    logCursor: logResult?.cursor || job.clearedThroughSeq || 0,
    clearedThroughSeq:
      logResult?.clearedThroughSeq || job.clearedThroughSeq || 0,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
  };
  const action = body.action;

  if (action === 'clear-logs') {
    const job = clearSendJobEvents(params.jobId);
    if (!job) {
      return NextResponse.json(
        { error: 'Send job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      job: publicJob(job),
      logCursor: job.clearedThroughSeq,
    });
  }

  if (
    action !== 'pause' &&
    action !== 'resume' &&
    action !== 'stop'
  ) {
    return NextResponse.json(
      { error: 'Action must be pause, resume, stop, or clear-logs' },
      { status: 400 }
    );
  }

  const job = setSendJobAction(params.jobId, action);
  if (!job) {
    return NextResponse.json(
      { error: 'Send job not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    job: publicJob(job),
  });
}
