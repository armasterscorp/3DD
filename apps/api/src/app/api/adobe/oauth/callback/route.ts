import { NextRequest, NextResponse } from 'next/server';
import { stopDolphinProfile } from '@/lib/dolphin-browser';
import {
  cleanupExpiredAdobeOAuthStates,
  getAdobeOAuthStore,
} from '@/lib/adobe-oauth-store';

export const dynamic = 'force-dynamic';

type AdobeTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_access_point?: string;
  web_access_point?: string;
  error?: string;
  message?: string;
};

function normalizeBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function exchangeCode(
  tokenBase: string,
  params: URLSearchParams
): Promise<AdobeTokenResponse> {
  const response = await fetch(`${normalizeBase(tokenBase)}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await response.text();
  let payload: AdobeTokenResponse = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      payload.error || payload.message || `Adobe token exchange failed: HTTP ${response.status}`
    );
  }

  return payload;
}

async function loadAdobeUser(
  apiAccessPoint: string,
  accessToken: string
): Promise<{ email?: string | null; userName?: string | null }> {
  try {
    const response = await fetch(
      `${normalizeBase(apiAccessPoint)}/api/rest/v6/users/me`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    );

    if (!response.ok) return {};
    const data = await response.json() as any;

    return {
      email: data.email || null,
      userName:
        data.fullName ||
        [data.firstName, data.lastName].filter(Boolean).join(' ') ||
        null,
    };
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  cleanupExpiredAdobeOAuthStates();

  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const callbackApiAccessPoint =
    url.searchParams.get('api_access_point') ||
    url.searchParams.get('apiAccessPoint') ||
    '';

  const store = getAdobeOAuthStore();
  const pending = store.pending.get(state);

  if (!code || !state || !pending) {
    return new NextResponse(
      '<h2>Adobe connection failed</h2><p>Missing or expired OAuth state/code.</p>',
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: pending.clientId,
      client_secret: pending.clientSecret,
      redirect_uri: pending.redirectUri,
    });

    const candidates = [
      callbackApiAccessPoint,
      process.env.ADOBE_OAUTH_TOKEN_BASE || '',
      'https://secure.na1.adobesign.com',
    ].filter(Boolean);

    let token: AdobeTokenResponse | null = null;
    let lastError: unknown = null;

    for (const candidate of Array.from(new Set(candidates))) {
      try {
        token = await exchangeCode(candidate, params);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!token?.access_token || !token.refresh_token) {
      throw lastError || new Error('Adobe did not return OAuth tokens.');
    }

    const apiAccessPoint =
      token.api_access_point ||
      callbackApiAccessPoint ||
      'https://api.na1.adobesign.com';

    const webAccessPoint =
      token.web_access_point ||
      'https://secure.na1.adobesign.com';

    const user = await loadAdobeUser(apiAccessPoint, token.access_token);

    store.connection = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      apiAccessPoint,
      webAccessPoint,
      connectedAt: new Date().toISOString(),
      email: user.email || null,
      userName: user.userName || null,
    };

    store.pending.delete(state);
    await stopDolphinProfile(pending.dolphinProfileId);

    return NextResponse.redirect(
      process.env.ADOBE_DASHBOARD_URL ||
      'http://localhost:7200/dashboard?adobe=connected'
    );
  } catch (error) {
    store.pending.delete(state);
    await stopDolphinProfile(pending.dolphinProfileId);

    return new NextResponse(
      `<h2>Adobe connection failed</h2><pre>${String(
        error instanceof Error ? error.message : error
      )}</pre>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
