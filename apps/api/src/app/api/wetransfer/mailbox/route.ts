import { NextRequest, NextResponse } from 'next/server';
import {
  createTempMailboxIO,
  listMailboxMessages,
  getMailboxMessage,
} from '@/lib/temp-mail-io';

/**
 * POST /api/wetransfer/mailbox
 *
 * Create a new temp-mail.io mailbox.
 *
 * REAL integration: calls POST https://api.temp-mail.io/v1/emails
 *
 * Body: { apiKey: string }
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const apiKey = body.apiKey ? String(body.apiKey).trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
  }

  try {
    const { mailbox, rateLimit } = await createTempMailboxIO(apiKey);
    return NextResponse.json({
      email: mailbox.email,
      token: mailbox.token ?? null,
      rateLimit,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * GET /api/wetransfer/mailbox
 *
 * List messages or fetch a specific message for a temp-mail.io mailbox.
 *
 * REAL integration.
 *
 * Query params:
 *   - email  (required) temp mailbox address
 *   - apiKey (required) temp-mail.io API key
 *   - messageId (optional) fetch a specific message
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const email = params.get('email') ?? '';
  const apiKey = params.get('apiKey') ?? '';
  const messageId = params.get('messageId') ?? '';

  if (!email || !apiKey) {
    return NextResponse.json(
      { error: 'email and apiKey query params are required' },
      { status: 400 }
    );
  }

  try {
    if (messageId) {
      const { message, rateLimit } = await getMailboxMessage(messageId, apiKey);
      return NextResponse.json({ message, rateLimit });
    }

    const { messages, rateLimit } = await listMailboxMessages(email, apiKey);
    return NextResponse.json({ messages, rateLimit });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
