import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { launchDolphinBrowser } from '@/lib/dolphin-browser';
import {
  cleanupExpiredAdobeOAuthStates,
  getAdobeOAuthStore,
} from '@/lib/adobe-oauth-store';

export const dynamic = 'force-dynamic';

const DEFAULT_SCOPE = [
  'user_read:account',
  'agreement_read:account',
  'agreement_write:account',
  'agreement_send:account',
].join(' ');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const clientId = String(body.clientId || '').trim();
    const clientSecret = String(body.clientSecret || '').trim();
    const redirectUri = String(body.redirectUri || '').trim();
    const dolphinProfileId = Number(body.dolphinProfileId);

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.json(
        { success: false, error: 'Adobe Client ID, Client Secret, and Redirect URI are required.' },
        { status: 400 }
      );
    }

    if (!Number.isInteger(dolphinProfileId) || dolphinProfileId <= 0) {
      return NextResponse.json(
        { success: false, error: 'A valid Dolphin profile ID is required.' },
        { status: 400 }
      );
    }

    cleanupExpiredAdobeOAuthStates();
    const state = crypto.randomBytes(24).toString('hex');

    const authorizeUrl =
      process.env.ADOBE_OAUTH_AUTHORIZE_URL ||
      'https://secure.na1.adobesign.com/public/oauth/v2';

    const params = new URLSearchParams({
      redirect_uri: redirectUri,
      response_type: 'code',
      client_id: clientId,
      state,
      scope: process.env.ADOBE_OAUTH_SCOPES || DEFAULT_SCOPE,
    });

    const authorizationUrl = `${authorizeUrl}?${params.toString()}`;

    getAdobeOAuthStore().pending.set(state, {
      state,
      clientId,
      clientSecret,
      redirectUri,
      dolphinProfileId,
      createdAt: Date.now(),
    });

    const { browser } = await launchDolphinBrowser(dolphinProfileId);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    await page.goto(authorizationUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.bringToFront().catch(() => undefined);

    return NextResponse.json({
      success: true,
      state,
      authorizationUrl,
      dolphinProfileId,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
