import {
  createMailSlurpMailbox,
  getMailSlurpMessage,
  listMailSlurpMessages,
} from './mailslurp';
import {
  createTempMailboxIO,
  getMailboxMessage,
  listMailboxMessages,
} from './temp-mail-io';

export type TempMailProvider = 'mailslurp' | 'tempmailio';

export type UnifiedTempMailbox = {
  provider: TempMailProvider;
  id?: string;
  email: string;
  apiKey: string;
  token?: string;
};

export type UnifiedTempMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  created_at: string;
};

export function normalizeTempMailProvider(value: unknown): TempMailProvider {
  return String(value || '').toLowerCase() === 'tempmailio'
    ? 'tempmailio'
    : 'mailslurp';
}

export function tempMailProviderLabel(provider: TempMailProvider): string {
  return provider === 'tempmailio' ? 'Temp-Mail.io' : 'MailSlurp';
}

export async function createUnifiedTempMailbox(
  provider: TempMailProvider,
  apiKey: string
): Promise<UnifiedTempMailbox> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error(`${tempMailProviderLabel(provider)} API key is required`);
  }

  if (provider === 'tempmailio') {
    const { mailbox } = await createTempMailboxIO(key);
    return {
      provider,
      email: mailbox.email,
      token: mailbox.token,
      apiKey: key,
    };
  }

  const mailbox = await createMailSlurpMailbox(key);
  return {
    provider,
    id: mailbox.id,
    email: mailbox.email,
    apiKey: key,
  };
}

export async function listUnifiedTempMessages(
  mailbox: UnifiedTempMailbox
): Promise<UnifiedTempMessage[]> {
  if (mailbox.provider === 'tempmailio') {
    const { messages } = await listMailboxMessages(mailbox.email, mailbox.apiKey);
    return messages.map((message) => ({
      id: String(message.id || ''),
      from: String(message.from || ''),
      to: String(message.to || ''),
      subject: String(message.subject || ''),
      body_text: String(message.body_text || ''),
      body_html: String(message.body_html || ''),
      created_at: String(message.created_at || new Date().toISOString()),
    }));
  }

  if (!mailbox.id) {
    throw new Error('MailSlurp mailbox ID is missing');
  }

  return listMailSlurpMessages({
    id: mailbox.id,
    email: mailbox.email,
    apiKey: mailbox.apiKey,
  });
}

export async function getUnifiedTempMessage(
  mailbox: UnifiedTempMailbox,
  messageId: string
): Promise<UnifiedTempMessage> {
  if (mailbox.provider === 'tempmailio') {
    const { message } = await getMailboxMessage(messageId, mailbox.apiKey);
    return {
      id: String(message.id || messageId),
      from: String(message.from || ''),
      to: String(message.to || ''),
      subject: String(message.subject || ''),
      body_text: String(message.body_text || ''),
      body_html: String(message.body_html || ''),
      created_at: String(message.created_at || new Date().toISOString()),
    };
  }

  if (!mailbox.id) {
    throw new Error('MailSlurp mailbox ID is missing');
  }

  return getMailSlurpMessage(
    { id: mailbox.id, email: mailbox.email, apiKey: mailbox.apiKey },
    messageId
  );
}
