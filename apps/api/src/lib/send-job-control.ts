export type SendJobStatus =
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed';

export type SendJobEvent = {
  seq: number;
  at: number;
  payload: Record<string, unknown>;
};

export type SendJob = {
  id: string;
  senderMode: 'smtp' | 'microsoft';
  projectName: string;
  status: SendJobStatus;
  total: number;
  current: number;
  sent: number;
  failed: number;
  createdAt: number;
  updatedAt: number;
  events: SendJobEvent[];
  nextEventSeq: number;
  clearedThroughSeq: number;
  error?: string;
};

type JobStore = Map<string, SendJob>;

const globalForSendJobs = globalThis as typeof globalThis & {
  __threeDSuiteSendJobs?: JobStore;
};

const jobs: JobStore =
  globalForSendJobs.__threeDSuiteSendJobs || new Map<string, SendJob>();

globalForSendJobs.__threeDSuiteSendJobs = jobs;

// Keep enough history for long campaigns while still bounding API memory use.
const MAX_EVENTS = 20_000;

function pushEvent(
  job: SendJob,
  payload: Record<string, unknown>
): SendJobEvent {
  const event: SendJobEvent = {
    seq: job.nextEventSeq,
    at: Date.now(),
    payload,
  };

  job.nextEventSeq += 1;
  job.events.push(event);

  if (job.events.length > MAX_EVENTS) {
    job.events.splice(0, job.events.length - MAX_EVENTS);
  }

  job.updatedAt = event.at;
  return event;
}

export function registerSendJob(
  id: string,
  senderMode: 'smtp' | 'microsoft',
  total: number,
  projectName = senderMode === 'microsoft'
    ? 'Microsoft Project'
    : 'SMTP Project'
): SendJob {
  const now = Date.now();
  const existing = jobs.get(id);

  if (
    existing &&
    ['running', 'paused', 'stopping'].includes(existing.status)
  ) {
    return existing;
  }

  const job: SendJob = {
    id,
    senderMode,
    projectName,
    status: 'running',
    total,
    current: 0,
    sent: 0,
    failed: 0,
    createdAt: now,
    updatedAt: now,
    events: [],
    nextEventSeq: 1,
    clearedThroughSeq: 0,
  };

  jobs.set(id, job);

  pushEvent(job, {
    type: 'job_started',
    total,
    senderMode,
    projectName,
  });

  return job;
}

export function getSendJob(id: string): SendJob | undefined {
  return jobs.get(id);
}

export function getSendJobEvents(
  id: string,
  afterSeq = 0
):
  | {
      events: SendJobEvent[];
      cursor: number;
      clearedThroughSeq: number;
    }
  | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  const effectiveAfter = Math.max(
    Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0,
    job.clearedThroughSeq
  );

  const events = job.events.filter((event) => event.seq > effectiveAfter);
  const cursor = events.length
    ? events[events.length - 1].seq
    : effectiveAfter;

  return {
    events,
    cursor,
    clearedThroughSeq: job.clearedThroughSeq,
  };
}

export function clearSendJobEvents(id: string): SendJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  // Advance the clear watermark so a reconnecting browser cannot replay
  // events that existed before the user pressed Clear Logs.
  job.clearedThroughSeq = Math.max(
    job.clearedThroughSeq,
    job.nextEventSeq - 1
  );
  job.events = [];
  job.updatedAt = Date.now();

  return job;
}

export function setSendJobAction(
  id: string,
  action: 'pause' | 'resume' | 'stop'
): SendJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  let changed = false;

  if (action === 'pause' && job.status === 'running') {
    job.status = 'paused';
    changed = true;
  } else if (action === 'resume' && job.status === 'paused') {
    job.status = 'running';
    changed = true;
  } else if (
    action === 'stop' &&
    ['running', 'paused'].includes(job.status)
  ) {
    job.status = 'stopping';
    changed = true;
  }

  job.updatedAt = Date.now();

  if (changed) {
    pushEvent(job, {
      type: 'job_control',
      action,
      status: job.status,
    });
  }

  return job;
}

export function recordSendJobEvent(
  id: string,
  payload: Record<string, unknown>
): SendJobEvent | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  const event = pushEvent(job, payload);

  if (payload.type === 'result') {
    job.current = Math.min(job.total, job.current + 1);
    if (payload.success === true) job.sent += 1;
    else job.failed += 1;
  } else if (payload.type === 'complete') {
    job.current = Number(payload.total ?? job.total) || job.total;
    job.sent = Number(payload.sentCount ?? job.sent) || 0;
    job.failed = Number(payload.failedCount ?? job.failed) || 0;
    job.status = job.status === 'stopping' ? 'stopped' : 'completed';
  } else if (payload.type === 'fatal') {
    job.status = 'failed';
    job.error = String(payload.error || 'Send job failed');
  } else if (payload.type === 'stopped') {
    job.current = Number(payload.current ?? job.current) || job.current;
    job.sent = Number(payload.sentCount ?? job.sent) || job.sent;
    job.failed = Number(payload.failedCount ?? job.failed) || job.failed;
    job.status = 'stopped';
  }

  job.updatedAt = Date.now();
  return event;
}

export async function waitForSendJob(
  id: string
): Promise<'run' | 'stop'> {
  while (true) {
    const job = jobs.get(id);
    if (!job) return 'stop';

    if (
      job.status === 'stopping' ||
      job.status === 'stopped' ||
      job.status === 'failed'
    ) {
      return 'stop';
    }

    if (job.status === 'running') {
      return 'run';
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function finishStoppedJob(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'stopped';
  job.updatedAt = Date.now();
}
