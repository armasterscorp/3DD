import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

type InquirySession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  targetUrl?: string;
  contactUrl?: string;
  lastPreparedAt?: string;
  profile?: Record<string, unknown>;
  runId?: string;
  licenseId: string;
};

const globalForInquiry = globalThis as typeof globalThis & {
  __threeDSuiteInquirySessions?: Map<string, InquirySession>;
};

const sessions = globalForInquiry.__threeDSuiteInquirySessions ?? new Map<string, InquirySession>();
if (!globalForInquiry.__threeDSuiteInquirySessions) globalForInquiry.__threeDSuiteInquirySessions = sessions;

export function cleanInquirySessionId(value: unknown): string {
  const raw = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(raw)) throw new Error('Invalid Inquiry browser session id.');
  return raw;
}

function cleanLicenseId(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Missing license context.');
  return raw.slice(0, 200);
}

function sessionKey(licenseIdValue: unknown, sessionIdValue: unknown): string {
  return `${cleanLicenseId(licenseIdValue)}::${cleanInquirySessionId(sessionIdValue)}`;
}

export async function getInquirySession(sessionId: string, licenseId: string, create = false): Promise<InquirySession | null> {
  const id = cleanInquirySessionId(sessionId);
  const owner = cleanLicenseId(licenseId);
  const key = sessionKey(owner, id);
  const existing = sessions.get(key);
  if (existing && !existing.page.isClosed()) return existing;
  if (!create) return null;

  if (existing) {
    try { await existing.context.close(); } catch {}
    try { await existing.browser.close(); } catch {}
    sessions.delete(key);
  }

  // Each licensed Inquiry session gets its own Chromium process + isolated context.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const session: InquirySession = { browser, context, page, licenseId: owner };
  sessions.set(key, session);
  return session;
}

export async function closeInquirySession(sessionId: string, licenseId: string): Promise<void> {
  const key = sessionKey(licenseId, sessionId);
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  try { await session.context.close(); } catch {}
  try { await session.browser.close(); } catch {}
}
