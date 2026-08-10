/**
 * temp-mail.io integration
 *
 * Base URL: https://api.temp-mail.io
 * Authentication: X-API-Key header required on all endpoints
 *
 * This module is the REAL integration for temporary mailbox management.
 * It is used by the WeTransfer engine to create mailboxes for account
 * registration and to poll for verification emails.
 */

const TEMP_MAIL_IO_BASE = process.env.TEMP_MAIL_IO_BASE_URL?.trim() || 'https://api.temp-mail.io';

export type TempMailIOMailbox = {
  email: string;
  token?: string;
};

export type TempMailIOMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  created_at: string;
};

export type TempMailIORateLimitInfo = {
  limit?: string;
  remaining?: string;
  reset?: string;
};

function extractRateLimit(headers: Headers): TempMailIORateLimitInfo {
  return {
    limit: headers.get('x-ratelimit-limit') ?? undefined,
    remaining: headers.get('x-ratelimit-remaining') ?? undefined,
    reset: headers.get('x-ratelimit-reset') ?? undefined,
  };
}

/**
 * Create a new temporary mailbox
 * POST /v1/emails
 *
 * REAL integration.
 */
export async function createTempMailboxIO(
  apiKey: string
): Promise<{ mailbox: TempMailIOMailbox; rateLimit: TempMailIORateLimitInfo }> {
  const response = await fetch(`${TEMP_MAIL_IO_BASE}/v1/emails`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
  });

  const rateLimit = extractRateLimit(response.headers);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`temp-mail.io mailbox creation failed [${response.status}]: ${body}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const email = String(
    data.email ?? data.address ?? data.name ?? ''
  );

  if (!email) {
    throw new Error('temp-mail.io returned an empty email address');
  }

  return {
    mailbox: {
      email,
      token: data.token ? String(data.token) : undefined,
    },
    rateLimit,
  };
}

/**
 * List messages for a temporary mailbox
 * GET /v1/emails/{email}/messages
 *
 * REAL integration.
 */
export async function listMailboxMessages(
  email: string,
  apiKey: string
): Promise<{ messages: TempMailIOMessage[]; rateLimit: TempMailIORateLimitInfo }> {
  const encoded = encodeURIComponent(email);
  const response = await fetch(`${TEMP_MAIL_IO_BASE}/v1/emails/${encoded}/messages`, {
    headers: { 'X-API-Key': apiKey },
  });

  const rateLimit = extractRateLimit(response.headers);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`temp-mail.io list messages failed [${response.status}]: ${body}`);
  }

  const data = (await response.json()) as unknown;
  const messages: TempMailIOMessage[] = Array.isArray(data)
    ? (data as TempMailIOMessage[])
    : ((data as Record<string, unknown>).messages as TempMailIOMessage[] | undefined) ?? [];

  return { messages, rateLimit };
}

/**
 * Fetch a specific message
 * GET /v1/messages/{id}
 *
 * REAL integration.
 */
export async function getMailboxMessage(
  messageId: string,
  apiKey: string
): Promise<{ message: TempMailIOMessage; rateLimit: TempMailIORateLimitInfo }> {
  const encoded = encodeURIComponent(messageId);
  const response = await fetch(`${TEMP_MAIL_IO_BASE}/v1/messages/${encoded}`, {
    headers: { 'X-API-Key': apiKey },
  });

  const rateLimit = extractRateLimit(response.headers);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`temp-mail.io get message failed [${response.status}]: ${body}`);
  }

  const data = (await response.json()) as TempMailIOMessage;
  return { message: data, rateLimit };
}
