/**
 * Mail.tm integration for temporary mailbox management.
 * Docs: https://docs.mail.tm/
 */

const MAIL_TM_BASE = process.env.MAIL_TM_BASE_URL?.trim() || 'https://api.mail.tm';

export type MailTmMailbox = {
  id: string;
  email: string;
  password: string;
  token: string;
};

export type MailTmMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  created_at: string;
};

type HydraCollection<T> = {
  'hydra:member'?: T[];
  'hydra:totalItems'?: number;
};

function randomString(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function readError(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export async function createMailTmMailbox(): Promise<MailTmMailbox> {
  const domainsResponse = await fetch(`${MAIL_TM_BASE}/domains?page=1`, {
    headers: { Accept: 'application/ld+json' },
  });

  if (!domainsResponse.ok) {
    throw new Error(`Mail.tm domains request failed [${domainsResponse.status}]: ${await readError(domainsResponse)}`);
  }

  const domainsData = (await domainsResponse.json()) as HydraCollection<{
    id: string;
    domain: string;
    isActive?: boolean;
  }>;
  const activeDomains = (domainsData['hydra:member'] || []).filter((domain) => domain.isActive !== false);
  if (!activeDomains.length) {
    throw new Error('Mail.tm returned no active domains');
  }

  // Randomize domain choice so repeated mailbox creation is not pinned to one domain.
  const domain = activeDomains[Math.floor(Math.random() * activeDomains.length)].domain;
  const address = `${randomString(14)}@${domain}`;
  const password = `${randomString(18)}A1!`;

  const accountResponse = await fetch(`${MAIL_TM_BASE}/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/ld+json',
    },
    body: JSON.stringify({ address, password }),
  });

  if (!accountResponse.ok) {
    throw new Error(`Mail.tm account creation failed [${accountResponse.status}]: ${await readError(accountResponse)}`);
  }

  const account = (await accountResponse.json()) as { id?: string; address?: string };
  const accountId = String(account.id || '');
  const mailboxEmail = String(account.address || address);
  if (!accountId || !mailboxEmail) {
    throw new Error('Mail.tm account creation returned an invalid account');
  }

  const tokenResponse = await fetch(`${MAIL_TM_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ address: mailboxEmail, password }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Mail.tm token request failed [${tokenResponse.status}]: ${await readError(tokenResponse)}`);
  }

  const tokenData = (await tokenResponse.json()) as { token?: string };
  const token = String(tokenData.token || '');
  if (!token) {
    throw new Error('Mail.tm returned an empty bearer token');
  }

  return { id: accountId, email: mailboxEmail, password, token };
}

export async function listMailTmMessages(mailbox: MailTmMailbox): Promise<MailTmMessage[]> {
  const response = await fetch(`${MAIL_TM_BASE}/messages?page=1`, {
    headers: {
      Authorization: `Bearer ${mailbox.token}`,
      Accept: 'application/ld+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Mail.tm list messages failed [${response.status}]: ${await readError(response)}`);
  }

  const data = (await response.json()) as HydraCollection<any>;
  return (data['hydra:member'] || []).map((message) => ({
    id: String(message.id || ''),
    from: String(message.from?.address || message.from?.name || ''),
    to: Array.isArray(message.to)
      ? message.to.map((item: any) => item?.address || '').filter(Boolean).join(', ')
      : '',
    subject: String(message.subject || ''),
    body_text: String(message.intro || ''),
    created_at: String(message.createdAt || message.updatedAt || new Date().toISOString()),
  }));
}

export async function getMailTmMessage(
  mailbox: MailTmMailbox,
  messageId: string
): Promise<MailTmMessage> {
  const response = await fetch(`${MAIL_TM_BASE}/messages/${encodeURIComponent(messageId)}`, {
    headers: {
      Authorization: `Bearer ${mailbox.token}`,
      Accept: 'application/ld+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Mail.tm get message failed [${response.status}]: ${await readError(response)}`);
  }

  const message = (await response.json()) as any;
  return {
    id: String(message.id || messageId),
    from: String(message.from?.address || message.from?.name || ''),
    to: Array.isArray(message.to)
      ? message.to.map((item: any) => item?.address || '').filter(Boolean).join(', ')
      : '',
    subject: String(message.subject || ''),
    body_text: String(message.text || ''),
    body_html: Array.isArray(message.html) ? message.html.join('\n') : String(message.html || ''),
    created_at: String(message.createdAt || message.updatedAt || new Date().toISOString()),
  };
}
