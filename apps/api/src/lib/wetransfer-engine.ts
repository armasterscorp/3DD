import {
  createUnifiedTempMailbox,
  getUnifiedTempMessage,
  listUnifiedTempMessages,
  normalizeTempMailProvider,
  tempMailProviderLabel,
  TempMailProvider,
  UnifiedTempMailbox,
  UnifiedTempMessage,
} from './temp-mail-provider';
import {
  createWeTransferTransfer,
  createWeTransferSequentialTransfers,
  WeTransferSequentialJob,
  probeWeTransferWebsite,
  WeTransferSendPhase,
} from './wetransfer';
import type { BrowserProxyConfig } from './browser-proxy-types';
import { isDolphinEnabled } from './dolphin-browser';

export type WeTransferStepStatus =
  | 'pending'
  | 'running'
  | 'opening_browser'
  | 'loading_wetransfer'
  | 'awaiting_sender_verification'
  | 'waiting_for_verification'
  | 'verification_received'
  | 'preparing_attachment'
  | 'upload_started'
  | 'upload_completed'
  | 'send_submitted'
  | 'send_confirmed'
  | 'success'
  | 'failed'
  | 'stopped';

export type WeTransferExecutionStep = {
  id: string;
  label: string;
  status: WeTransferStepStatus;
  detail?: string;
  timestamp?: string;
  isReal: boolean;
};

export type WeTransferSession = {
  id: string;
  campaignId: string;
  tempMailbox: UnifiedTempMailbox | null;
  mailboxMessageCount: number | null;
  latestError: string | null;
  steps: WeTransferExecutionStep[];
  createdAt: string;
  updatedAt: string;
  status:
    | 'initializing'
    | 'ready'
    | 'sending'
    | 'stopped'
    | 'completed'
    | 'completed_with_errors'
    | 'failed';
};

export type WeTransferSendResult = {
  success: boolean;
  leadEmail: string;
  step: string;
  detail?: string;
  transferUrl?: string;
  confirmationStatus: 'confirmed' | 'failed';
};

const SETUP_STEP_DEFS: Array<{ id: string; label: string }> = [
  {
    id: 'create_mailbox',
    label: 'Create temp mailbox',
  },
  {
    id: 'open_wetransfer',
    label: 'Open WeTransfer in automation browser',
  },
  {
    id: 'create_account',
    label: 'Prepare browser-based sender flow',
  },
  {
    id: 'verify_email',
    label: 'Handle sender verification email',
  },
];

const LEAD_STEP_DEFS: Array<{ id: string; label: string }> = [
  {
    id: 'upload_file',
    label: 'Upload PDF/document to WeTransfer',
  },
  {
    id: 'send_to_lead',
    label: 'Send WeTransfer transfer to lead',
  },
];

function makeSteps(): WeTransferExecutionStep[] {
  return [...SETUP_STEP_DEFS, ...LEAD_STEP_DEFS].map((def) => ({
    ...def,
    status: 'pending' as WeTransferStepStatus,
    isReal: true,
  }));
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function extractFirstLink(messageText: string): string | null {
  const matches = messageText.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const preferred = matches.find((value) => /wetransfer\.com/i.test(value));
  return preferred ?? matches[0] ?? null;
}

function extractVerificationCode(messageText: string): string | null {
  // WeTransfer currently sends six-character alphanumeric codes such as KDRMSP,
  // not only numeric OTPs. Prefer explicit phrases first to avoid matching random words.
  const explicitCode = messageText.match(
    /(?:verification\s*code|your\s*code\s*is|code|otp)\s*[:\-]?\s*([A-Z0-9]{6})\b/i
  );
  if (explicitCode?.[1]) return explicitCode[1].toUpperCase();

  // Fallback for email bodies that put the code on its own line after explanatory text.
  const standaloneCode = messageText.match(/(?:^|\n)\s*([A-Z0-9]{6})\s*(?:\n|$)/im);
  return standaloneCode?.[1]?.toUpperCase() ?? null;
}

function messageMayBeWeTransferVerification(message: UnifiedTempMessage): boolean {
  const subject = (message.subject || '').toLowerCase();
  const from = (message.from || '').toLowerCase();
  const body = `${message.body_text || ''}\n${message.body_html || ''}`.toLowerCase();
  return (
    from.includes('wetransfer') ||
    subject.includes('wetransfer') ||
    subject.includes('verif') ||
    subject.includes('confirm') ||
    body.includes('wetransfer')
  );
}

async function enrichMessageIfNeeded(
  mailbox: UnifiedTempMailbox,
  message: UnifiedTempMessage
): Promise<UnifiedTempMessage> {
  if ((message.body_text || message.body_html || '').trim()) {
    return message;
  }

  try {
    return await getUnifiedTempMessage(mailbox, message.id);
  } catch {
    return message;
  }
}

async function pollForVerificationEmail(
  mailbox: UnifiedTempMailbox,
  onProgress: (
    attempt: number,
    messageCount: number,
    delayMs: number,
  ) => void
): Promise<{
  found: boolean;
  messageCount: number;
  subject?: string;
  verificationLink?: string;
  verificationCode?: string;
}> {
  // Default: poll every 5 seconds until the OTP is found.
  // Set WETRANSFER_VERIFICATION_POLL_ATTEMPTS to a positive number to impose a limit;
  // leave it unset or set it to 0 for unlimited polling.
  const maxAttempts = Number.parseInt(process.env.WETRANSFER_VERIFICATION_POLL_ATTEMPTS || '0', 10);
  const delayMs = Number.parseInt(process.env.WETRANSFER_VERIFICATION_POLL_DELAY_MS || '5000', 10);

  let latestCount = 0;
  let attempt = 0;
  while (maxAttempts <= 0 || attempt < maxAttempts) {
    attempt += 1;
    const messages = await listUnifiedTempMessages(mailbox);
    latestCount = messages.length;
    onProgress(attempt, latestCount, delayMs);

    const candidates = messages
      .filter(messageMayBeWeTransferVerification)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    for (const candidate of candidates) {
      const detailed = await enrichMessageIfNeeded(mailbox, candidate);
      const content = `${detailed.body_text || ''}\n${detailed.body_html || ''}`;
      const verificationLink = extractFirstLink(content) || undefined;
      const verificationCode = extractVerificationCode(content) || undefined;
      if (verificationLink || verificationCode) {
        return {
          found: true,
          messageCount: latestCount,
          subject: detailed.subject || undefined,
          verificationLink,
          verificationCode,
        };
      }
    }

    await pause(delayMs);
  }

  return { found: false, messageCount: latestCount };
}

export async function initWeTransferSession(
  campaignId: string,
  tempMailProvider: string = 'mailslurp',
  tempMailApiKey?: string,
  onStep?: (step: WeTransferExecutionStep, logLine: string) => void,
  proxyConfig?: BrowserProxyConfig | null
): Promise<WeTransferSession> {
  const session: WeTransferSession = {
    id: makeId('wt_session'),
    campaignId,
    tempMailbox: null,
    mailboxMessageCount: null,
    latestError: null,
    steps: makeSteps(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: 'initializing',
  };

  function stepUpdate(stepId: string, status: WeTransferStepStatus, detail?: string): void {
    const step = session.steps.find((s) => s.id === stepId);
    if (!step) return;
    step.status = status;
    step.detail = detail;
    step.timestamp = nowIso();
    session.updatedAt = nowIso();
    if (typeof onStep === 'function') {
      onStep(step, `[${step.label}] ${status}${detail ? ': ' + detail : ''}`);
    }
  }

  const normalizedProvider: TempMailProvider =
    normalizeTempMailProvider(tempMailProvider);

  stepUpdate(
    'create_mailbox',
    'running',
    `Provider: ${tempMailProviderLabel(normalizedProvider)}`
  );

  try {
    const providerApiKey = (
      tempMailApiKey ||
      (normalizedProvider === 'mailslurp'
        ? process.env.MAILSLURP_API_KEY
        : process.env.TEMP_MAIL_IO_API_KEY) ||
      ''
    ).trim();

    if (!providerApiKey) {
      throw new Error(
        `${tempMailProviderLabel(normalizedProvider)} API key is required.`
      );
    }

    const mailbox = await createUnifiedTempMailbox(
      normalizedProvider,
      providerApiKey
    );

    session.tempMailbox = mailbox;
    session.latestError = null;

    stepUpdate(
      'create_mailbox',
      'success',
      `Mailbox: ${mailbox.email} | provider=${normalizedProvider}`
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    stepUpdate('create_mailbox', 'failed', msg);
    session.latestError = msg;
    session.status = 'failed';
    return session;
  }

  stepUpdate('open_wetransfer', 'opening_browser');

  if (isDolphinEnabled()) {
    // Important: do NOT start the Dolphin profile during session initialization.
    // Next.js may execute the session and send routes in separate module contexts,
    // so an in-memory cached browser connection is not reliable across routes.
    // Start Dolphin exactly once when the real send-transfer flow begins.
    stepUpdate(
      'open_wetransfer',
      'success',
      'Dolphin mode enabled. Browser launch probe skipped; the Dolphin profile will start once at send time.'
    );
  } else {
    if (proxyConfig?.enabled) {
      stepUpdate(
        'open_wetransfer',
        'opening_browser',
        `Proxy enabled: ${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`
      );
    }

    const probeResult = await probeWeTransferWebsite((phaseUpdate) => {
      if (phaseUpdate.phase === 'opening_browser') {
        stepUpdate('open_wetransfer', 'opening_browser', phaseUpdate.detail);
      } else if (phaseUpdate.phase === 'loading_wetransfer') {
        stepUpdate('open_wetransfer', 'loading_wetransfer', phaseUpdate.detail);
      } else if (phaseUpdate.phase === 'navigating_to_login') {
        stepUpdate('open_wetransfer', 'loading_wetransfer', phaseUpdate.detail);
      }
    }, proxyConfig);

    if (!probeResult.success) {
      const detail =
        probeResult.error ||
        'Failed to open WeTransfer in browser automation mode.';
      stepUpdate('open_wetransfer', 'failed', detail);
      session.latestError = detail;
      session.status = 'failed';
      return session;
    }

    stepUpdate(
      'open_wetransfer',
      'success',
      'WeTransfer login page reached successfully. Signup/verification will happen at send time.'
    );
  }

  stepUpdate('create_account', 'success', `Browser transport mode is active. Sender email will use ${tempMailProviderLabel(normalizedProvider)} inbox.`);
  stepUpdate('verify_email', 'success', `${tempMailProviderLabel(normalizedProvider)} verification mailbox is ready and will be polled during signup flow.`);

  session.status = 'ready';
  return session;
}

export async function sendLeadViaWeTransfer(
  session: WeTransferSession,
  leadEmails: string[],
  filename: string,
  options?: {
    fileSource?: 'upload' | 'generated';
    attachmentBytes?: number;
    leadName?: string;
    ctaLink?: string;
    fileBuffer?: Buffer;
    attachmentPath?: string;
    proxyConfig?: BrowserProxyConfig | null;
    dolphinProfileId?: string;
  },
  onStep?: (step: WeTransferExecutionStep, logLine: string) => void
): Promise<WeTransferSendResult> {
  const normalizedLeadEmails = Array.from(
    new Set(leadEmails.map((email) => email.trim()).filter(Boolean))
  ).slice(0, 10);
  const leadEmail = normalizedLeadEmails[0] || '';

  if (!normalizedLeadEmails.length) {
    return {
      success: false,
      leadEmail: '',
      step: 'send_to_lead',
      detail: 'At least one recipient email is required',
      confirmationStatus: 'failed',
    };
  }

  if (!session.tempMailbox) {
    session.latestError = 'No temp mailbox in session – session may have failed during init';
    session.status = 'failed';
    return {
      success: false,
      leadEmail,
      step: 'send_to_lead',
      detail: session.latestError,
      confirmationStatus: 'failed',
    };
  }

  if (!options?.fileBuffer || options.fileBuffer.length <= 0) {
    const detail = 'No attachment bytes provided for WeTransfer upload';
    session.latestError = detail;
    session.status = 'failed';
    return {
      success: false,
      leadEmail,
      step: 'upload_file',
      detail,
      confirmationStatus: 'failed',
    };
  }

  if (!options?.attachmentPath) {
    const detail = 'No on-disk attachment path provided for browser upload';
    session.latestError = detail;
    session.status = 'failed';
    return {
      success: false,
      leadEmail,
      step: 'upload_file',
      detail,
      confirmationStatus: 'failed',
    };
  }

  session.status = 'sending';
  session.updatedAt = nowIso();

  for (const stepId of ['upload_file', 'send_to_lead']) {
    const step = session.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = 'pending';
      step.detail = undefined;
      step.timestamp = undefined;
    }
  }

  function stepUpdate(stepId: string, status: WeTransferStepStatus, detail?: string): void {
    const step = session.steps.find((s) => s.id === stepId);
    if (!step) return;
    step.status = status;
    step.detail = detail;
    step.timestamp = nowIso();
    session.updatedAt = nowIso();
    if (typeof onStep === 'function') {
      onStep(step, `[${step.label}] ${status}${detail ? ': ' + detail : ''}`);
    }
  }

  stepUpdate(
    'upload_file',
    'preparing_attachment',
    `preparing_attachment | ${filename} | ${options.fileBuffer.length} bytes | source=${options.fileSource ?? 'unknown'}`
  );
  stepUpdate('send_to_lead', 'running', `Preparing browser send for ${normalizedLeadEmails.length} recipient(s): ${normalizedLeadEmails.join(', ')}`);

  let transferUrl: string | undefined;
  const mailboxEmail = session.tempMailbox.email;

  const result = await createWeTransferTransfer(
    filename,
    options.fileBuffer,
    normalizedLeadEmails,
    options?.ctaLink?.trim()
      ? `Secure link for ${options.leadName || leadEmail}: ${options.ctaLink}`
      : `Secure file package for ${options.leadName || leadEmail}`,
    (phaseUpdate) => {
      const phase = phaseUpdate.phase as WeTransferSendPhase;
      if (phase === 'opening_browser') {
        stepUpdate('open_wetransfer', 'opening_browser', phaseUpdate.detail);
      } else if (phase === 'loading_wetransfer') {
        stepUpdate('open_wetransfer', 'loading_wetransfer', phaseUpdate.detail);
      } else if (phase === 'navigating_to_login') {
        stepUpdate('open_wetransfer', 'loading_wetransfer', phaseUpdate.detail);
      } else if (phase === 'signup_clicked') {
        stepUpdate('create_account', 'running', phaseUpdate.detail);
      } else if (phase === 'sender_email_entered') {
        stepUpdate('create_account', 'running', phaseUpdate.detail);
      } else if (phase === 'verification_code_requested') {
        stepUpdate('verify_email', 'waiting_for_verification', phaseUpdate.detail);
      } else if (phase === 'awaiting_sender_verification') {
        stepUpdate('verify_email', 'awaiting_sender_verification', phaseUpdate.detail);
      } else if (phase === 'verification_received') {
        stepUpdate('verify_email', 'verification_received', phaseUpdate.detail);
      } else if (phase === 'verification_submitted') {
        stepUpdate('verify_email', 'verification_received', phaseUpdate.detail);
      } else if (phase === 'terms_accepted') {
        stepUpdate('create_account', 'success', phaseUpdate.detail);
      } else if (phase === 'uploader_visible') {
        stepUpdate('open_wetransfer', 'success', phaseUpdate.detail);
      } else if (phase === 'preparing_attachment') {
        stepUpdate('upload_file', 'preparing_attachment', phaseUpdate.detail);
      } else if (phase === 'upload_started') {
        stepUpdate('upload_file', 'upload_started', `upload_started | ${phaseUpdate.detail}`);
      } else if (phase === 'upload_completed') {
        stepUpdate('upload_file', 'upload_completed', `upload_completed | ${phaseUpdate.detail}`);
      } else if (phase === 'send_submitted') {
        stepUpdate('send_to_lead', 'send_submitted', `send_submitted | ${phaseUpdate.detail}`);
      } else if (phase === 'send_confirmed') {
        stepUpdate('send_to_lead', 'send_confirmed', `send_confirmed | ${phaseUpdate.detail}`);
      } else if (phase === 'failed') {
        stepUpdate('send_to_lead', 'failed', `failed | ${phaseUpdate.detail}`);
      }
    },
    {
      attachmentPath: options.attachmentPath,
      senderEmail: mailboxEmail,
      proxyConfig: options.proxyConfig,
      dolphinProfileId: options.dolphinProfileId,
      onVerificationRequired:
          async () => {
              console.log(`OTP POLLING CALLBACK ENTERED | mailbox=${mailboxEmail}`);
              stepUpdate(
                'verify_email',
                'waiting_for_verification',
                `OTP POLLING STARTED | mailbox=${mailboxEmail} | interval=5s`
              );

              const verificationResult = await pollForVerificationEmail(
                session.tempMailbox!,
                (attempt, messageCount, delayMs) => {
                  session.mailboxMessageCount = messageCount;
                  const pollLine = `polling_for_code | provider=mailslurp | attempt ${attempt} | mailbox=${mailboxEmail} | ${messageCount} message(s) | checking again in ${Math.round(delayMs / 1000)}s`;
                  console.log(pollLine);
                  stepUpdate(
                    'verify_email',
                    'waiting_for_verification',
                    pollLine
                  );
                }
              );
              session.mailboxMessageCount = verificationResult.messageCount;

              if (!verificationResult.found) {
                return {
                  mailboxMessageCount: verificationResult.messageCount,
                  detail: `verification_failed | No WeTransfer verification email received (${verificationResult.messageCount} messages checked)`,
                };
              }

              return {
                verificationLink: verificationResult.verificationLink,
                verificationCode: verificationResult.verificationCode,
                mailboxMessageCount: verificationResult.messageCount,
                detail: `verification_received | ${verificationResult.subject || 'WeTransfer verification message detected'}`,
              };
            },
    }
  );

  if (!result.success) {
    const detail = result.error || `WeTransfer send failed for ${leadEmail}`;
    session.latestError = detail;
    if (session.steps.find((step) => step.id === 'upload_file')?.status === 'upload_started') {
      stepUpdate('upload_file', 'failed', `failed | ${detail}`);
    }
    stepUpdate('send_to_lead', 'failed', `failed | ${detail}`);
    session.status = 'ready';
    return {
      success: false,
      leadEmail,
      step: 'send_to_lead',
      detail,
      confirmationStatus: 'failed',
    };
  }

  transferUrl = result.downloadUrl;
  if (session.steps.find((step) => step.id === 'upload_file')?.status !== 'upload_completed') {
    stepUpdate('upload_file', 'upload_completed', `upload_completed | ${filename}`);
  }
  stepUpdate(
    'send_to_lead',
    'send_confirmed',
    `send_confirmed | ${leadEmail}${transferUrl ? ` | ${transferUrl}` : ''}`
  );
  session.latestError = null;
  session.status = 'ready';

  return {
    success: true,
    leadEmail,
    step: 'send_to_lead',
    transferUrl,
    detail: transferUrl
      ? `Confirmed WeTransfer send for ${leadEmail}: ${transferUrl}`
      : `Confirmed WeTransfer send for ${leadEmail}`,
    confirmationStatus: 'confirmed',
  };
}


export async function sendSequentialLeadBatchViaWeTransfer(
  session: WeTransferSession,
  jobs: Array<{
    recipientEmail: string;
    filename: string;
    fileBuffer: Buffer;
    attachmentPath: string;
    leadName?: string;
    ctaLink?: string;
  }>,
  options?: {
    fileSource?: 'upload' | 'generated';
    proxyConfig?: BrowserProxyConfig | null;
    dolphinProfileId?: string;
  },
  onStep?: (step: WeTransferExecutionStep, logLine: string) => void
): Promise<{
  success: boolean;
  results: Array<{
    recipientEmail: string;
    filename: string;
    success: boolean;
    transferUrl?: string;
    error?: string;
  }>;
  detail?: string;
}> {
  const normalizedJobs = jobs
    .map((job) => ({
      ...job,
      recipientEmail: job.recipientEmail.trim(),
    }))
    .filter((job) => job.recipientEmail)
    .slice(0, 10);

  if (!normalizedJobs.length) {
    return {
      success: false,
      results: [],
      detail: 'At least one recipient job is required',
    };
  }

  if (!session.tempMailbox) {
    return {
      success: false,
      results: [],
      detail:
        'No temp mailbox in session – session may have failed during init',
    };
  }

  session.status = 'sending';
  session.updatedAt = nowIso();

  function stepUpdate(
    stepId: string,
    status: WeTransferStepStatus,
    detail?: string
  ): void {
    const step = session.steps.find((s) => s.id === stepId);
    if (!step) return;

    step.status = status;
    step.detail = detail;
    step.timestamp = nowIso();
    session.updatedAt = nowIso();

    if (typeof onStep === 'function') {
      onStep(
        step,
        `[${step.label}] ${status}${detail ? ': ' + detail : ''}`
      );
    }
  }

  stepUpdate(
    'send_to_lead',
    'running',
    `Starting ${normalizedJobs.length} sequential one-recipient transfer(s) using one WeTransfer account`
  );

  const mailboxEmail = session.tempMailbox.email;

  const browserJobs: WeTransferSequentialJob[] = normalizedJobs.map(
    (job) => ({
      recipientEmail: job.recipientEmail,
      filename: job.filename,
      fileBuffer: job.fileBuffer,
      attachmentPath: job.attachmentPath,
      message: job.ctaLink?.trim()
        ? `Secure link for ${job.leadName || job.recipientEmail}: ${job.ctaLink}`
        : `Secure file package for ${job.leadName || job.recipientEmail}`,
    })
  );

  const result = await createWeTransferSequentialTransfers(
    browserJobs,
    (phaseUpdate) => {
      const phase = phaseUpdate.phase as WeTransferSendPhase;

      if (phase === 'opening_browser') {
        stepUpdate(
          'open_wetransfer',
          'opening_browser',
          phaseUpdate.detail
        );
      } else if (
        phase === 'loading_wetransfer' ||
        phase === 'navigating_to_login'
      ) {
        stepUpdate(
          'open_wetransfer',
          'loading_wetransfer',
          phaseUpdate.detail
        );
      } else if (
        phase === 'signup_clicked' ||
        phase === 'sender_email_entered'
      ) {
        stepUpdate(
          'create_account',
          'running',
          phaseUpdate.detail
        );
      } else if (
        phase === 'verification_code_requested' ||
        phase === 'awaiting_sender_verification'
      ) {
        stepUpdate(
          'verify_email',
          'waiting_for_verification',
          phaseUpdate.detail
        );
      } else if (
        phase === 'verification_received' ||
        phase === 'verification_submitted'
      ) {
        stepUpdate(
          'verify_email',
          'verification_received',
          phaseUpdate.detail
        );
      } else if (phase === 'terms_accepted') {
        stepUpdate(
          'create_account',
          'success',
          phaseUpdate.detail
        );
      } else if (phase === 'uploader_visible') {
        stepUpdate(
          'open_wetransfer',
          'success',
          phaseUpdate.detail
        );
      } else if (phase === 'preparing_attachment') {
        stepUpdate(
          'upload_file',
          'preparing_attachment',
          phaseUpdate.detail
        );
      } else if (phase === 'upload_started') {
        stepUpdate(
          'upload_file',
          'upload_started',
          phaseUpdate.detail
        );
      } else if (phase === 'upload_completed') {
        stepUpdate(
          'upload_file',
          'upload_completed',
          phaseUpdate.detail
        );
      } else if (phase === 'send_submitted') {
        stepUpdate(
          'send_to_lead',
          'send_submitted',
          phaseUpdate.detail
        );
      } else if (phase === 'send_confirmed') {
        stepUpdate(
          'send_to_lead',
          'send_confirmed',
          phaseUpdate.detail
        );
      } else if (phase === 'failed') {
        stepUpdate(
          'send_to_lead',
          'failed',
          phaseUpdate.detail
        );
      }
    },
    {
      senderEmail: mailboxEmail,
      proxyConfig: options?.proxyConfig,
      dolphinProfileId: options?.dolphinProfileId,
      onVerificationRequired: async () => {
        const verificationResult = await pollForVerificationEmail(
          session.tempMailbox!,
          (attempt, messageCount, delayMs) => {
            session.mailboxMessageCount = messageCount;

            stepUpdate(
              'verify_email',
              'waiting_for_verification',
              `polling_for_code | attempt ${attempt} | mailbox=${mailboxEmail} | ` +
                `${messageCount} message(s) | checking again in ${Math.round(
                  delayMs / 1000
                )}s`
            );
          }
        );

        session.mailboxMessageCount =
          verificationResult.messageCount;

        if (!verificationResult.found) {
          return {
            mailboxMessageCount:
              verificationResult.messageCount,
            detail:
              'verification_failed | No WeTransfer verification email received',
          };
        }

        return {
          verificationLink:
            verificationResult.verificationLink,
          verificationCode:
            verificationResult.verificationCode,
          mailboxMessageCount:
            verificationResult.messageCount,
          detail:
            `verification_received | ${
              verificationResult.subject ||
              'WeTransfer verification message detected'
            }`,
        };
      },
    }
  );

  session.status = 'ready';
  session.latestError = result.success
    ? null
    : result.error || 'One or more sequential transfers failed';

  const mappedResults = result.results.map((item) => ({
    recipientEmail: item.recipientEmail,
    filename: item.filename,
    success: item.success,
    transferUrl: item.downloadUrl,
    error: item.error,
  }));

  return {
    success: result.success,
    results: mappedResults,
    detail: result.error,
  };
}
