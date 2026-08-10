import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';
import {
  clearAdobeBrowserSession,
  getAdobeBrowserStore,
} from '@/lib/adobe-browser-store';

export const dynamic = 'force-dynamic';

function getAdobeUserDataDir(): string {
  return (
    process.env.ADOBE_BROWSER_USER_DATA_DIR ||
    path.join(os.homedir(), '.3d-suite', 'adobe-browser-profile')
  );
}

async function closeExistingSession(): Promise<void> {
  const store = getAdobeBrowserStore();
  const existing = store.session;

  if (!existing) return;

  try {
    await existing.context.close();
  } catch {}

  clearAdobeBrowserSession();
}

export async function POST() {
  try {
    const store = getAdobeBrowserStore();

    if (store.session && !store.session.page.isClosed()) {
      await store.session.page.bringToFront().catch(() => undefined);

      return NextResponse.json({
        success: true,
        connected: true,
        loggedIn: false,
        profileId: store.session.sessionId,
        currentUrl: store.session.page.url(),
      });
    }

    await closeExistingSession();

    const userDataDir = getAdobeUserDataDir();

    let context;

    try {
      // Prefer the user's installed Google Chrome for a normal-browser experience.
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: false,
        viewport: null,
        args: ['--start-maximized'],
      });
    } catch {
      // Fall back to Playwright Chromium when Google Chrome is unavailable.
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        args: ['--start-maximized'],
      });
    }

    const pages = context.pages();
    const page =
      pages.find((candidate) => !candidate.isClosed()) ||
      (await context.newPage());

    await page.goto('https://acrobat.adobe.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });

    await page.bringToFront().catch(() => undefined);

    const sessionId = crypto.randomUUID();

    store.session = {
      sessionId,
      context,
      page,
      startedAt: new Date().toISOString(),
      userDataDir,
    };

    return NextResponse.json({
      success: true,
      connected: true,
      loggedIn: false,
      profileId: sessionId,
      currentUrl: page.url(),
      message:
        'Adobe opened in a normal Chrome browser window. Log in manually.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        connected: false,
        loggedIn: false,
        error:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
