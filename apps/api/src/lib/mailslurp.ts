/**
 * MailSlurp integration for temporary mailbox management.
 * Uses the REST API directly so no additional npm dependency is required.
 */

const MAILSLURP_BASE = process.env.MAILSLURP_BASE_URL?.trim() || 'https://api.mailslurp.com';

export type MailSlurpMailbox = {
  id: string;
  email: string;
  apiKey: string;
};

export type MailSlurpMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  created_at: string;
};

function headers(apiKey: string): HeadersInit {
  return {
    'x-api-key': apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function readError(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export async function createMailSlurpMailbox(apiKey: string): Promise<MailSlurpMailbox> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error('MailSlurp API key is required. Set MAILSLURP_API_KEY or provide the API key in the session request.');
  }

  const expiresIn = Number.parseInt(process.env.MAILSLURP_INBOX_EXPIRES_MS || '1800000', 10);

  const response = await fetch(`${MAILSLURP_BASE}/inboxes/withOptions`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      name: `3d-suite-${Date.now()}`,
      description: '3D Suite WeTransfer verification inbox',
      useDomainPool: true,
      useShortAddress: true,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 1800000,
      tags: ['3d-suite', 'wetransfer'],
    }),
  });

  if (!response.ok) {
    throw new Error(`MailSlurp inbox creation failed [${response.status}]: ${await readError(response)}`);
  }

  const inbox = (await response.json()) as {
    id?: string;
    emailAddress?: string;
    email?: string;
  };

  const id = String(inbox.id || '');
  const email = String(inbox.emailAddress || inbox.email || '');
  if (!id || !email) {
    throw new Error('MailSlurp inbox creation returned an invalid inbox response');
  }

  return { id, email, apiKey: key };
}

export async function listMailSlurpMessages(mailbox: MailSlurpMailbox): Promise<MailSlurpMessage[]> {
  const url = new URL(`${MAILSLURP_BASE}/inboxes/${encodeURIComponent(mailbox.id)}/emails/paginated`);
  url.searchParams.set('page', '0');
  url.searchParams.set('size', '30');
  url.searchParams.set('sort', 'DESC');
  url.searchParams.set('unreadOnly', 'false');

  const response = await fetch(url.toString(), {
    headers: headers(mailbox.apiKey),
  });

  if (!response.ok) {
    throw new Error(`MailSlurp list messages failed [${response.status}]: ${await readError(response)}`);
  }

  const data = (await response.json()) as any;
  const messages: any[] = Array.isArray(data?.content)
    ? data.content
    : Array.isArray(data)
      ? data
      : [];

  return messages.map((message) => ({
    id: String(message.id || ''),
    from: String(message.from || message.sender || ''),
    to: Array.isArray(message.to) ? message.to.join(', ') : String(message.to || ''),
    subject: String(message.subject || ''),
    body_text: String(message.bodyExcerpt || message.preview || ''),
    created_at: String(message.createdAt || message.updatedAt || new Date().toISOString()),
  }));
}

export async function getMailSlurpMessage(
  mailbox: MailSlurpMailbox,
  messageId: string
): Promise<MailSlurpMessage> {
  const response = await fetch(`${MAILSLURP_BASE}/emails/${encodeURIComponent(messageId)}`, {
    headers: headers(mailbox.apiKey),
  });

  if (!response.ok) {
    throw new Error(`MailSlurp get message failed [${response.status}]: ${await readError(response)}`);
  }

  const message = (await response.json()) as any;
  const html = Array.isArray(message.body) ? message.body.join('\n') : String(message.body || '');

  return {
    id: String(message.id || messageId),
    from: String(message.from || ''),
    to: Array.isArray(message.to) ? message.to.join(', ') : String(message.to || ''),
    subject: String(message.subject || ''),
    body_text: String(message.body || message.bodyExcerpt || ''),
    body_html: html,
    created_at: String(message.createdAt || message.updatedAt || new Date().toISOString()),
  };
}
