import { NextResponse } from 'next/server';

import {
  clearAdobeBrowserSession,
  getAdobeBrowserStore,
} from '@/lib/adobe-browser-store';

export const dynamic = 'force-dynamic';

async function detectLoggedIn(): Promise<{
  connected: boolean;
  loggedIn: boolean;
  profileId?: string;
  currentUrl?: string;
}> {
  const session = getAdobeBrowserStore().session;

  if (!session || session.page.isClosed()) {
    return { connected: false, loggedIn: false };
  }

  const page = session.page;
  const currentUrl = page.url();

  let loggedIn = false;

  try {
    const loginUrl =
      /adobelogin\.com|\/signin|\/login|accounts\.adobe\.com/i.test(
        currentUrl
      );

    if (
      !loginUrl &&
      /acrobat\.adobe\.com|documentcloud\.adobe\.com/i.test(currentUrl)
    ) {
      const loggedInIndicators = [
        'button[aria-label*="account" i]',
        'button[aria-label*="profile" i]',
        '[data-testid*="avatar" i]',
        '[data-testid*="profile" i]',
        'a[href*="/files"]',
        'button:has-text("Upload")',
        'button:has-text("Share")',
      ];

      for (const selector of loggedInIndicators) {
        if (
          await page
            .locator(selector)
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          loggedIn = true;
          break;
        }
      }

      if (!loggedIn) {
        const bodyText = await page
          .locator('body')
          .innerText()
          .catch(() => '');

        loggedIn =
          /\bYour documents\b|\bRecent\b|\bDocuments\b|\bUpload\b|\bShare\b/i.test(
            bodyText
          ) &&
          !/\bSign in\b|\bLog in\b/i.test(bodyText);
      }
    }
  } catch {}

  return {
    connected: true,
    loggedIn,
    profileId: session.sessionId,
    currentUrl,
  };
}

export async function GET() {
  const status = await detectLoggedIn();

  return NextResponse.json({
    ...status,
    lastCheckedAt: new Date().toISOString(),
  });
}

export async function DELETE() {
  const store = getAdobeBrowserStore();
  const session = store.session;

  if (session) {
    try {
      await session.context.close();
    } catch {}
  }

  clearAdobeBrowserSession();

  return NextResponse.json({
    success: true,
    connected: false,
    loggedIn: false,
  });
}
