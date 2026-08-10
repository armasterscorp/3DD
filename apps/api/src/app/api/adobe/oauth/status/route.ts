import { NextResponse } from 'next/server';
import { getAdobeOAuthStore } from '@/lib/adobe-oauth-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const connection = getAdobeOAuthStore().connection;

  if (!connection) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    email: connection.email || null,
    userName: connection.userName || null,
    apiAccessPoint: connection.apiAccessPoint,
    webAccessPoint: connection.webAccessPoint,
    connectedAt: connection.connectedAt,
    expiresAt: connection.expiresAt,
  });
}

export async function DELETE() {
  const store = getAdobeOAuthStore();
  const connection = store.connection;

  if (connection) {
    try {
      const base = connection.apiAccessPoint.replace(/\/+$/, '');
      await fetch(`${base}/oauth/v2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: connection.refreshToken }).toString(),
      });
    } catch {
      // Local disconnect still proceeds if revoke fails.
    }
  }

  store.connection = null;
  return NextResponse.json({ success: true });
}
