import { NextRequest, NextResponse } from 'next/server';

import {
  readGmailConnections,
  removeGmailConnection,
} from '@/lib/gmail-oauth-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const connections = await readGmailConnections();

    return NextResponse.json({
      success: true,
      accounts: connections.map((item) => ({
        email: item.email,
        connectedAt: item.connectedAt,
        profileDirectory: item.profileDirectory || null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        accounts: [],
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || '').trim();

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          error: 'email is required',
        },
        { status: 400 }
      );
    }

    const connections = await readGmailConnections();

    const target = connections.find(
      (item) =>
        item.email.toLowerCase() === email.toLowerCase()
    );

    // Best-effort Google token revocation before removing locally.
    if (target?.refreshToken) {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: target.refreshToken,
        }).toString(),
      }).catch(() => undefined);
    }

    await removeGmailConnection(email);

    return NextResponse.json({
      success: true,
      email,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}
