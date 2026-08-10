import { NextRequest, NextResponse } from 'next/server';

import {
  cleanupExpiredGmailPending,
  gmailPendingStore,
  upsertGmailConnection,
} from '@/lib/gmail-oauth-store';

export const dynamic = 'force-dynamic';



async function completeGmailOAuthFromUrl(
  callbackUrl: string
): Promise<{
  success: boolean;
  email?: string;
  error?: string;
  status: number;
}> {
  cleanupExpiredGmailPending();

  let url: URL;

  try {
    url = new URL(callbackUrl);
  } catch {
    return {
      success: false,
      error: 'Invalid OAuth callback URL.',
      status: 400,
    };
  }

  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const errorParam = url.searchParams.get('error') || '';

  if (errorParam) {
    return {
      success: false,
      error: `Google OAuth error: ${errorParam}`,
      status: 400,
    };
  }

  const pending = gmailPendingStore().get(state);

  if (!code || !state || !pending) {
    return {
      success: false,
      error:
        'Missing or expired OAuth state/code. Generate a new OAuth URL and try again.',
      status: 400,
    };
  }

  try {
    const tokenResponse = await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: pending.googleClientId,
          client_secret: pending.googleClientSecret,
          redirect_uri: pending.googleRedirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      }
    );

    const tokenText = await tokenResponse.text();
    const token = tokenText ? JSON.parse(tokenText) : {};

    if (!tokenResponse.ok || !token.access_token) {
      throw new Error(
        token.error_description ||
          token.error ||
          `Google token exchange failed: HTTP ${tokenResponse.status}`
      );
    }

    // We intentionally do NOT call Gmail users.getProfile here.
    // That endpoint does not accept gmail.send by itself.
    // The OAuth request includes `openid email`, so use Google's
    // OpenID userinfo endpoint only to identify the connected account.
    const profileResponse = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      }
    );

    const profileText = await profileResponse.text();
    const profile = profileText ? JSON.parse(profileText) : {};

    if (!profileResponse.ok || !profile.email) {
      throw new Error(
        profile.error_description ||
          profile.error ||
          `Unable to identify connected Google account: HTTP ${profileResponse.status}`
      );
    }

    const refreshToken = token.refresh_token || '';

    if (!refreshToken) {
      throw new Error(
        'Google did not return a refresh token. Reconnect with consent and try again.'
      );
    }

    const email = String(profile.email);

    await upsertGmailConnection({
      email,
      accessToken: String(token.access_token),
      refreshToken: String(refreshToken),
      expiresAt:
        Date.now() + Number(token.expires_in || 3600) * 1000,
      connectedAt: new Date().toISOString(),
      profileDirectory: pending.profileDirectory,
      googleClientId: pending.googleClientId,
      googleClientSecret: pending.googleClientSecret,
      googleRedirectUri: pending.googleRedirectUri,
    });

    gmailPendingStore().delete(state);

    return {
      success: true,
      email,
      status: 200,
    };
  } catch (error) {
    gmailPendingStore().delete(state);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      status: 500,
    };
  }
}

export async function GET(request: NextRequest) {
  const result = await completeGmailOAuthFromUrl(request.url);

  if (!result.success) {
    return new NextResponse(
      `<h2>Gmail connection failed</h2><pre>${result.error || 'Unknown error'}</pre>`,
      {
        status: result.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }

  return NextResponse.redirect(
    'http://localhost:7200/dashboard?gmail=connected'
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const callbackUrl = String(body.callbackUrl || '').trim();

    if (!callbackUrl) {
      return NextResponse.json(
        {
          success: false,
          error: 'callbackUrl is required.',
        },
        { status: 400 }
      );
    }

    const result = await completeGmailOAuthFromUrl(callbackUrl);

    return NextResponse.json(
      {
        success: result.success,
        email: result.email,
        error: result.error,
      },
      { status: result.status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
