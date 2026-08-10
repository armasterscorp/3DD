import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium, Page } from 'playwright';
import type { BrowserProxyConfig } from './browser-proxy-types';
import {
  clearDolphinBrowserSession,
  isDolphinEnabled,
  launchDolphinBrowser,
  stopDolphinProfile,
} from './dolphin-browser';
import {
  buildPlaywrightProxyLaunchOptions,
  getBrowserProxyDiagnostics,
} from './browser-proxy';

const WETRANSFER_URL = (process.env.WETRANSFER_WEB_URL || 'https://wetransfer.com').trim();
const WETRANSFER_LOGIN_URL = `${WETRANSFER_URL.replace(/\/$/, '')}/log-in`;

type VerificationResolution = {
  verificationLink?: string;
  verificationCode?: string;
  mailboxMessageCount?: number;
  detail?: string;
};

export type WeTransferSendPhase =
  | 'opening_browser'
  | 'loading_wetransfer'
  | 'navigating_to_login'
  | 'signup_clicked'
  | 'sender_email_entered'
  | 'verification_code_requested'
  | 'awaiting_sender_verification'
  | 'verification_received'
  | 'verification_submitted'
  | 'terms_accepted'
  | 'uploader_visible'
  | 'preparing_attachment'
  | 'upload_started'
  | 'upload_completed'
  | 'send_submitted'
  | 'send_confirmed'
  | 'failed';

export type WeTransferSendPhaseUpdate = {
  phase: WeTransferSendPhase;
  detail: string;
};

export type WeTransferSendOptions = {
  attachmentPath?: string;
  senderEmail?: string;
  onVerificationRequired?: () => Promise<VerificationResolution | null>;
  proxyConfig?: BrowserProxyConfig | null;
  dolphinProfileId?: string;
};

function isHeadlessEnabled(): boolean {
  return (process.env.WETRANSFER_HEADLESS || 'true').trim().toLowerCase() !== 'false';
}

function getWeTransferUserAgent(): string {
  return (
    process.env.WETRANSFER_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/150.0.0.0 Safari/537.36'
  ).trim();
}

async function createFreshWeTransferPage(browser: any): Promise<Page> {
  if (isDolphinEnabled()) {
    const contexts = browser.contexts();
    const context = contexts[0];
    if (!context) {
      throw new Error('Dolphin browser connected but no browser context was available');
    }

    const existingPages = context.pages();
    const page = existingPages[0] ?? (await context.newPage());

    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    console.log(
      `DOLPHIN BROWSER SESSION | contexts=${contexts.length} | pages=${context.pages().length}`
    );

    return page;
  }

  const context = await browser.newContext({
    userAgent: getWeTransferUserAgent(),
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    storageState: { cookies: [], origins: [] },
  });

  const cookies = await context.cookies();
  console.log(
    `FRESH BROWSER SESSION | cookies=${cookies.length} | userAgent=${getWeTransferUserAgent()}`
  );

  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  return page;
}

async function launchWeTransferBrowser(
  proxyConfig: BrowserProxyConfig | null | undefined,
  onPhase: ((update: WeTransferSendPhaseUpdate) => void) | undefined,
  launchPath: string,
  dolphinProfileId?: string
) {
  if (isDolphinEnabled()) {
    onPhase?.({
      phase: 'opening_browser',
      detail: `Launching Dolphin{anty} browser profile | path=${launchPath}`,
    });

    const { browser, profileId, endpoint } = await launchDolphinBrowser(dolphinProfileId);
    console.log(
      `DOLPHIN ACTIVE | profileId=${profileId} | endpoint=${endpoint} | path=${launchPath}`
    );
    return browser;
  }

  onPhase?.({
    phase: 'opening_browser',
    detail: getBrowserProxyDiagnostics(proxyConfig, 'launchWeTransferBrowser', launchPath),
  });
  onPhase?.({ phase: 'opening_browser', detail: 'Launching automation browser' });

  return chromium.launch({
    headless: isHeadlessEnabled(),
    ...buildPlaywrightProxyLaunchOptions(proxyConfig),
  });
}

async function openWeTransferLoginPage(
  page: Page,
  proxyConfig: BrowserProxyConfig | null | undefined,
  onPhase: ((update: WeTransferSendPhaseUpdate) => void) | undefined,
  launchPath: string
): Promise<void> {
  const maxAttempts = proxyConfig?.enabled ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      onPhase?.({
        phase: 'loading_wetransfer',
        detail: `Loading ${WETRANSFER_LOGIN_URL} | helper=launchWeTransferBrowser | path=${launchPath} | attempt=${attempt}/${maxAttempts}`,
      });
      console.log('========================================');
      console.log('PLAYWRIGHT NETWORK DIAGNOSTICS');
      console.log('========================================');
      console.log('Checking Playwright public exit IP...');
      try {
        await page.goto('https://api.ipify.org?format=json', {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        const ipResponse = await page.textContent('body');
        console.log(`PLAYWRIGHT EXIT IP | ${ipResponse ?? 'unknown'}`);
      } catch (error) {
        console.error(
          'PLAYWRIGHT EXIT IP CHECK FAILED |',
          error instanceof Error ? error.message : String(error)
        );
      }
      console.log('Opening WeTransfer...');
      await page.goto(WETRANSFER_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForStableDom(page);
      await dismissConsentAndPopups(page);
      const finalUrl = page.url();
      onPhase?.({
        phase: 'navigating_to_login',
        detail: `Login page reachable (final URL: ${finalUrl}) | helper=launchWeTransferBrowser | path=${launchPath}`,
      });
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry =
        proxyConfig?.enabled &&
        attempt < maxAttempts &&
        /ERR_TUNNEL_CONNECTION_FAILED/i.test(message);

      if (!shouldRetry) {
        throw error;
      }

      onPhase?.({
        phase: 'loading_wetransfer',
        detail: `Proxy tunnel failed while loading WeTransfer (attempt ${attempt}/${maxAttempts}); retrying once`,
      });
      await page.waitForTimeout(1200);
    }
  }
}

const BUTTON_HINTS = [
  'Accept',
  'Accept all',
  'I agree',
  'I accept',
  'Continue',
  'Got it',
  'Agree',
  'Understood',
  'Allow all',
];

const SEND_BUTTON_HINTS = [
  'Transfer',
  'Send',
  'Get a link',
  'Continue',
  'Proceed',
  'Create transfer',
];

async function clickFirstVisibleByText(page: Page, hints: string[]): Promise<boolean> {
  for (const hint of hints) {
    const candidates = page
      .locator('button, [role="button"], input[type="button"], input[type="submit"], a')
      .filter({ hasText: hint });
    const count = await candidates.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = candidates.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ timeout: 60000 }).catch(() => undefined);
        return true;
      }
    }
  }
  return false;
}

async function dismissConsentAndPopups(page: Page): Promise<void> {
  await clickFirstVisibleByText(page, BUTTON_HINTS);
}

async function waitForStableDom(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);
}

async function isUploaderVisible(page: Page): Promise<boolean> {
  const hasFileInput =
    (await page.locator('input[type="file"]').count().catch(() => 0)) > 0;

  const addFilesVisible = await page
    .getByText(/add files/i)
    .first()
    .isVisible()
    .catch(() => false);

  const recipientVisible = await page
    .locator('input#autosuggest[name="autosuggest"]')
    .first()
    .isVisible()
    .catch(() => false);

  return hasFileInput || addFilesVisible || recipientVisible;
}

/**
 * Attempt to attach a file to the WeTransfer upload area using multiple selector strategies.
 *
 * Strategy order:
 *   A) hidden input path  — look for input[type="file"] directly
 *   B) file chooser path  — click an "Add files" trigger and intercept the file chooser
 *      B1: getByRole button with name "Add files"
 *      B2: [role="button"] containing "Add files" text
 *      B3: button element containing "Add files" text
 *      B4: button that contains img[src*="add-files"] (WeTransfer-specific SVG)
 *      B5: img[src*="add-files"] parent element (catches non-button wrappers)
 *      B6: getByText "Add files" (any visible element)
 *
 * Logs the winning strategy via `onLog`. On total failure, throws with the list of
 * attempted strategies so logs are diagnostic rather than generic.
 */
async function uploadAttachment(
  page: Page,
  attachmentPath: string,
  onLog?: (msg: string) => void
): Promise<void> {
  // Strategy A: direct hidden file input
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    onLog?.('hidden input path: found input[type="file"] — setting files directly');
    await fileInput.setInputFiles(attachmentPath);
    return;
  }
  onLog?.('hidden input path: input[type="file"] absent — trying file chooser path');

  // Strategy B: trigger file chooser via "Add files" UI
  type LocatorDef = { label: string; locator: ReturnType<Page['locator']> };
  const addFilesTargets: LocatorDef[] = [
    {
      label: 'add-files text: getByRole(button, "Add files")',
      locator: page.getByRole('button', { name: /add files/i }),
    },
    {
      label: 'add-files text: [role="button"] hasText /add files/i',
      locator: page.locator('[role="button"]').filter({ hasText: /add files/i }),
    },
    {
      label: 'add-files text: button hasText /add files/i',
      locator: page.locator('button').filter({ hasText: /add files/i }),
    },
    {
      // WeTransfer-specific: button wrapping the add-files-v2.svg image
      label: 'add-files text: button:has(img[src*="add-files"])',
      locator: page.locator('button:has(img[src*="add-files"])'),
    },
    {
      // WeTransfer-specific: any ancestor of the add-files img that is clickable
      label: 'add-files text: img[src*="add-files"] parent element',
      locator: page.locator('img[src*="add-files"]').locator('xpath=..'),
    },
    {
      label: 'add-files text: getByText("Add files", exact)',
      locator: page.getByText('Add files', { exact: true }),
    },
  ];

  const attemptedLabels: string[] = [];

  for (const { label, locator } of addFilesTargets) {
    let count = 0;
    try { count = await locator.count(); } catch { /* skip */ }
    if (count === 0) {
      attemptedLabels.push(`${label} (DOM cue absent)`);
      continue;
    }

    const el = locator.first();
    const visible = await el.isVisible().catch(() => false);
    if (!visible) {
      attemptedLabels.push(`${label} (found but not visible)`);
      continue;
    }

    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 60000 }),
        el.click({ timeout: 60000 }),
      ]);
      onLog?.(`file chooser path: succeeded via ${label}`);
      await fileChooser.setFiles(attachmentPath);
      return;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      attemptedLabels.push(`${label} (click did not open file chooser: ${reason})`);
    }
  }

  throw new Error(
    `Could not find file input or upload trigger on WeTransfer page. ` +
      `Strategies attempted: ${attemptedLabels.join('; ')}`
  );
}


async function waitForWeTransferUploadReady(
  page: Page,
  filename: string,
  onLog?: (msg: string) => void
): Promise<void> {
  const timeoutMs = Number(
    process.env.WETRANSFER_UPLOAD_WAIT_MS || 180000
  );

  const itemsCount = page
    .locator('span.uploader__add-more--desktop__items-count--text')
    .first();

  await itemsCount.waitFor({
    state: 'visible',
    timeout: timeoutMs,
  });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = ((await itemsCount.textContent().catch(() => '')) || '').trim();

    onLog?.(
      `upload wait | filename="${filename}" | itemsCount="${text}"`
    );

    if (/^1\s+item$/i.test(text) || /^1\s+items$/i.test(text)) {
      onLog?.(
        `upload ready | WeTransfer shows "${text}" for "${filename}"`
      );

      // Small settle delay before recipient entry.
      await page.waitForTimeout(2000);
      return;
    }

    await page.waitForTimeout(1000);
  }

  throw new Error(
    `Timed out waiting for WeTransfer to show "1 item" after uploading "${filename}"`
  );
}


/**
 * Fill an email field on the WeTransfer page.
 *
 * Recipient mode strategy order:
 *   1) input#autosuggest  (WeTransfer current stable ID)
 *   2) input[name="autosuggest"]
 *   3) getByLabel(/email to/i)  (WeTransfer current label text)
 *   4) heuristic placeholder/name selectors
 *   5) first input[type="email"]
 *
 * Logs the winning strategy via `onLog`.
 */
async function fillEmailField(
  page: Page,
  targetEmail: string,
  mode: 'recipient' | 'sender',
  onLog?: (msg: string) => void
): Promise<boolean> {
  const normalized = targetEmail.trim();
  if (!normalized) return false;

  if (mode === 'recipient') {
    // Strategy 1 & 2: WeTransfer stable selectors observed in current DOM
    const stableSelectors = [
      { label: 'recipient field detection: input#autosuggest', selector: 'input#autosuggest' },
      { label: 'recipient field detection: input[name="autosuggest"]', selector: 'input[name="autosuggest"]' },
    ];
    for (const { label, selector } of stableSelectors) {
      const field = page.locator(selector).first();
      if (await field.isVisible().catch(() => false)) {
        onLog?.(label);
        await field.fill(normalized);
        // Confirm the autosuggest entry so WeTransfer registers the recipient
        await field.press('Enter').catch(() => undefined);
        await page.waitForTimeout(300);
        return true;
      }
    }

    // Strategy 3: getByLabel "Email to"
    const byLabel = page.getByLabel(/email to/i);
    if (await byLabel.isVisible().catch(() => false)) {
      onLog?.('recipient field detection: getByLabel("Email to")');
      await byLabel.fill(normalized);
      await byLabel.press('Enter').catch(() => undefined);
      await page.waitForTimeout(300);
      return true;
    }

    // Strategy 4: heuristic placeholder/name selectors
    const heuristicSelectors = [
      'input[placeholder*="email" i][name*="recipient" i]',
      'input[placeholder*="to" i][type="email"]',
      'input[name*="recipient" i][type="email"]',
    ];
    for (const selector of heuristicSelectors) {
      const field = page.locator(selector).first();
      if (await field.isVisible().catch(() => false)) {
        onLog?.(`recipient field detection: heuristic selector ${selector}`);
        await field.fill(normalized);
        return true;
      }
    }

    // Strategy 5: first visible email input
    const emailFields = page.locator('input[type="email"]');
    const count = await emailFields.count();
    if (count > 0) {
      onLog?.('recipient field detection: first input[type="email"] fallback');
      await emailFields.first().fill(normalized);
      return true;
    }

    onLog?.('recipient field detection: no matching field found');
    return false;
  }

  // sender mode
  const senderHints = [
    'input[placeholder*="your" i][type="email"]',
    'input[placeholder*="from" i][type="email"]',
    'input[name*="sender" i][type="email"]',
  ];
  for (const selector of senderHints) {
    const field = page.locator(selector).first();
    if (await field.isVisible().catch(() => false)) {
      await field.fill(normalized);
      return true;
    }
  }
  const emailFields = page.locator('input[type="email"]');
  const count = await emailFields.count();
  if (count === 0) return false;
  if (count > 1) {
    await emailFields.nth(1).fill(normalized);
    return true;
  }
  return false;
}

function extractTransferLinkFromHtml(html: string): string | undefined {
  const matches = html.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const preferred = matches.find((value) => /wetransfer\.com\/(downloads|transfers)/i.test(value));
  return preferred || matches[0];
}

function getAntiBotHint(html: string): string | null {
  const text = html.toLowerCase();
  if (text.includes('captcha') || text.includes('cloudflare') || text.includes('verify you are human')) {
    return 'WeTransfer browser flow appears blocked by anti-bot verification (captcha/human check).';
  }
  return null;
}

/**
 * Perform the explicit WeTransfer signup/login flow observed in live Playwright inspection:
 *   1. Navigate to /log-in
 *   2. Click "Sign up"
 *   3. Fill input#email with senderEmail
 *   4. Click "Continue"
 *   5. Poll temp mailbox for verification code (via onVerificationRequired)
 *   6. Fill input#verificationCode
 *   7. Click "Verify"
 *   8. If [data-testid="accept-terms"] appears, click "I agree"
 *   9. Wait for the uploader UI to become visible
 */
async function performSignupAndVerification(
  page: Page,
  senderEmail: string,
  options: WeTransferSendOptions,
  onPhase?: (update: WeTransferSendPhaseUpdate) => void
): Promise<void> {
  // Give every Playwright action/navigation in this flow at least 60 seconds.
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  // Step 1: Navigate to the login page
  await openWeTransferLoginPage(page, options.proxyConfig, onPhase, 'send-signup');

  // Step 2: Click "Sign up". WeTransfer currently renders this as an <a href="/signup?..."> link.
  // IMPORTANT: wait for the element to appear instead of using isVisible(), which is an immediate check.
  let signUpClicked = false;

  const signUpHrefLink = page.locator('a[href^="/signup"], a[href*="/signup?"]').first();

  try {
    await signUpHrefLink.waitFor({ state: 'visible', timeout: 60000 });

    const href = await signUpHrefLink.getAttribute('href').catch(() => null);

    try {
      await signUpHrefLink.click({ timeout: 60000 });
      signUpClicked = true;
    } catch (clickError) {
      // If a cookie banner/overlay intercepts the click, navigate directly to the real signup href.
      if (href) {
        await page.goto(new URL(href, page.url()).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        signUpClicked = true;
      } else {
        throw clickError;
      }
    }
  } catch {
    // Accessibility/text fallbacks in case WeTransfer changes the signup URL structure.
    const signUpCandidates = [
      page.getByRole('link', { name: /^sign up$/i }).first(),
      page.getByRole('button', { name: /^sign up$/i }).first(),
      page.getByText('Sign up', { exact: true }).first(),
    ];

    for (const candidate of signUpCandidates) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: 60000 });
        await candidate.click({ timeout: 60000 });
        signUpClicked = true;
        break;
      } catch {
        // Try the next fallback selector.
      }
    }
  }

  if (!signUpClicked) {
    throw new Error(
      `Could not find or open the WeTransfer Sign up link after waiting 60 seconds. Current URL: ${page.url()}`
    );
  }

  onPhase?.({ phase: 'signup_clicked', detail: 'Opened WeTransfer Sign up page' });
  await page.waitForTimeout(1500);
  await waitForStableDom(page);

  // Log only the auth requests that matter for OTP debugging.
  // Avoid flooding the console with CSS, JS, images, fonts, and hCaptcha assets.
  const authResponseLogger = async (response: any) => {
    const url = response.url();
    const status = response.status();
    const method = response.request().method();

    const isPasswordlessSignup =
      method === 'POST' && url.includes('/api/v1/signup/passwordless');
    const isPasswordlessVerify =
      method === 'POST' && /passwordless.*verify|verify.*passwordless/i.test(url);
    const isRelevantAuthError =
      method === 'POST' && /auth\.wetransfer\.com/i.test(url) && status >= 400;

    if (!isPasswordlessSignup && !isPasswordlessVerify && !isRelevantAuthError) return;

    let bodyPreview = '';
    try {
      const contentType = response.headers()['content-type'] || '';
      if (/json|text/i.test(contentType)) {
        bodyPreview = (await response.text()).replace(/\s+/g, ' ').slice(0, 500);
      }
    } catch {
      // Some responses cannot be read; status + URL are still useful.
    }

    const detail = `WeTransfer HTTP | ${status} ${method} ${url}${bodyPreview ? ` | ${bodyPreview}` : ''}`;
    console.log(detail);
    onPhase?.({ phase: 'verification_code_requested', detail });
  };

  page.on('response', authResponseLogger);

  // Step 3: Enter the sender email using normal keyboard events instead of setting the value instantly.
  const emailInput = page.locator('input#email').first();
  await emailInput.waitFor({ state: 'visible', timeout: 60000 });
  await emailInput.click({ timeout: 60000 });
  await emailInput.fill('');

  const typingDelayMs = Number.parseInt(
    process.env.WETRANSFER_EMAIL_TYPING_DELAY_MS || '100',
    10
  );
  await emailInput.pressSequentially(senderEmail, {
    delay: Number.isFinite(typingDelayMs) ? Math.max(0, typingDelayMs) : 100,
  });

  const enteredEmail = await emailInput.inputValue();
  console.log(`EMAIL INPUT CHECK | expected=${senderEmail} | actual=${enteredEmail}`);

  if (enteredEmail !== senderEmail) {
    throw new Error(
      `Email field mismatch before submission: expected ${senderEmail}, got ${enteredEmail}`
    );
  }

  console.log(`WETRANSFER EMAIL ENTERED | ${senderEmail}`);
  onPhase?.({
    phase: 'sender_email_entered',
    detail: `Sender email entered and verified in field: ${senderEmail}`,
  });

  // Prepare both signals BEFORE submitting the email so we cannot miss the HTTP 201.
  const verificationCodeInput = page.locator(
    'input#verificationCode, input[name="verificationCode"]'
  ).first();
  const captchaWaitMs = Number.parseInt(
    process.env.WETRANSFER_CAPTCHA_WAIT_MS || '600000',
    10
  );

  const passwordless201Promise = page
    .waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/v1/signup/passwordless') &&
        response.status() === 201,
      { timeout: captchaWaitMs }
    )
    .then(() => 'http_201' as const)
    .catch(() => null);

  const otpFieldPromise = verificationCodeInput
    .waitFor({ state: 'visible', timeout: captchaWaitMs })
    .then(() => 'otp_field' as const)
    .catch(() => null);

  // Step 4: Click "Continue"
  const continueBtn = page.getByRole('button', { name: /continue/i }).first();
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click({ timeout: 60000 });
  } else {
    await emailInput.press('Enter');
  }

  console.log(
    `EMAIL SUBMITTED | ${senderEmail} | waiting for CAPTCHA completion / passwordless HTTP 201 / OTP field`
  );
  onPhase?.({
    phase: 'verification_code_requested',
    detail:
      'Submitted email. Waiting for successful passwordless signup or OTP field (complete any CAPTCHA manually if shown)',
  });

  onPhase?.({
    phase: 'awaiting_sender_verification',
    detail: `Waiting up to ${Math.round(
      captchaWaitMs / 1000
    )} seconds for WeTransfer to accept signup. Complete any CAPTCHA manually in the open browser.`,
  });

  // Start polling as soon as EITHER:
  //   A) WeTransfer confirms POST /api/v1/signup/passwordless with HTTP 201, OR
  //   B) the OTP input becomes visible.
  // This prevents the mailbox polling callback from being skipped after CAPTCHA.
  const trigger = await Promise.race([passwordless201Promise, otpFieldPromise]);

  if (!trigger) {
    page.off('response', authResponseLogger);
    throw new Error(
      `Timed out waiting for WeTransfer passwordless signup HTTP 201 or OTP field. Current URL: ${page.url()}`
    );
  }

  const triggerDetail =
    trigger === 'http_201'
      ? 'WeTransfer passwordless signup returned HTTP 201'
      : 'WeTransfer verification-code field detected';

  console.log(`OTP POLLING STARTED | trigger=${trigger} | mailbox=${senderEmail}`);
  onPhase?.({
    phase: 'verification_code_requested',
    detail: `${triggerDetail}. OTP POLLING STARTED for ${senderEmail}`,
  });

  // Step 5: Poll temp mailbox for verification code
  if (!options.onVerificationRequired) {
    throw new Error(
      'Signup verification required but no verification callback provided. ' +
        'Ensure the session was initialised with a temp-mail.io mailbox.'
    );
  }

  const resolution = await options.onVerificationRequired();
  page.off('response', authResponseLogger);

  if (resolution && !resolution.verificationCode && resolution.detail) {
    const detailCodeMatch = resolution.detail.match(
      /(?:your\s+code\s+is|verification\s+code|code)\s*[:\-]?\s*\b([A-Z0-9]{6})\b/i
    );
    if (detailCodeMatch?.[1]) {
      resolution.verificationCode = detailCodeMatch[1].toUpperCase();
      console.log(
        `WETRANSFER OTP | extracted code from verification detail: ${resolution.verificationCode}`
      );
    }
  }

  if (!resolution?.verificationCode && !resolution?.verificationLink) {
    const currentUrl = page.url();
    throw new Error(
      `${resolution?.detail || 'No verification code received in temp mailbox after signup'} ` +
        `(last successful stage: verification_code_requested, current URL: ${currentUrl})`
    );
  }

  onPhase?.({
    phase: 'verification_received',
    detail:
      resolution.detail ||
      `Verification code received${resolution.mailboxMessageCount !== undefined ? ` (mailbox messages: ${resolution.mailboxMessageCount})` : ''}`,
  });

  // Step 6 & 7: Fill input#verificationCode and click "Verify"
  if (resolution.verificationCode) {
    const verificationCode = resolution.verificationCode.trim().toUpperCase();

    console.log(`WETRANSFER OTP SUBMIT | code=${verificationCode}`);
    onPhase?.({
      phase: 'verification_received',
      detail: `OTP received. Filling #verificationCode with ${verificationCode}`,
    });

    const verificationCodeInput = page
      .locator('input#verificationCode[name="verificationCode"]')
      .first();

    await verificationCodeInput.waitFor({
      state: 'visible',
      timeout: 60000,
    });

    await verificationCodeInput.click({ timeout: 60000 });
    await verificationCodeInput.fill('');
    await verificationCodeInput.fill(verificationCode);

    const actualCode = await verificationCodeInput.inputValue();

    console.log(
      `WETRANSFER OTP INPUT CHECK | expected=${verificationCode} | actual=${actualCode}`
    );

    if (actualCode !== verificationCode) {
      throw new Error(
        `Verification code field mismatch: expected ${verificationCode}, got ${actualCode}`
      );
    }

    const verifyButtonCandidates = [
      page.getByRole('button', { name: /^verify$/i }).first(),
      page.locator('button[type="submit"]').filter({ hasText: /verify/i }).first(),
      page.locator('button:has-text("Verify")').first(),
    ];

    let verifyClicked = false;

    for (const candidate of verifyButtonCandidates) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: 60000 });
        if (await candidate.isEnabled().catch(() => false)) {
          await candidate.click({ timeout: 60000 });
          verifyClicked = true;
          break;
        }
      } catch {
        // Try next candidate.
      }
    }

    if (!verifyClicked) {
      throw new Error('Could not find or click WeTransfer Verify button');
    }

    console.log(`WETRANSFER VERIFY CLICKED | currentURL=${page.url()}`);
    onPhase?.({
      phase: 'verification_submitted',
      detail: `Verification code submitted. Waiting for WeTransfer callback redirect. Current URL: ${page.url()}`,
    });

    // Wait for the auth flow to leave the OTP page or enter callback.
    try {
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith('/account/callback') ||
          !url.hostname.includes('auth.wetransfer.com'),
        { timeout: 120000 }
      );
    } catch {
      // Continue to callback handling below even if this navigation event is missed.
    }

    console.log(`WETRANSFER POST-VERIFY URL | ${page.url()}`);
  } else if (resolution.verificationLink) {
    // If a magic link was provided instead of a code, navigate directly
    await page.goto(resolution.verificationLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForStableDom(page);
    onPhase?.({ phase: 'verification_submitted', detail: 'Followed verification link' });
  }

  // Step 8: After verification WeTransfer may show an onboarding/terms page.
  // Wait up to 2 minutes for the "I agree" / accept terms control.
  onPhase?.({
    phase: 'verification_submitted',
    detail: 'Verification submitted. Waiting for WeTransfer terms/onboarding screen.',
  });

  const termsCandidates = [
    page.locator('[data-testid="accept-terms"]').first(),
    page.getByRole('button', { name: /^i agree$/i }).first(),
    page.getByRole('button', { name: /^agree$/i }).first(),
    page.getByRole('button', { name: /^accept$/i }).first(),
    page.getByRole('button', { name: /^accept all$/i }).first(),
    page.getByText('I agree', { exact: true }).first(),
  ];

  let termsAccepted = false;
  const termsDeadline = Date.now() + 120000;

  while (Date.now() < termsDeadline && !termsAccepted) {
    if (await isUploaderVisible(page)) {
      break;
    }

    for (const candidate of termsCandidates) {
      try {
        if (await candidate.isVisible({ timeout: 1000 })) {
          console.log(`WETRANSFER TERMS | found agreement control at ${page.url()}`);
          await candidate.click({ timeout: 60000 });
          termsAccepted = true;

          onPhase?.({
            phase: 'terms_accepted',
            detail: `Clicked WeTransfer "I agree" / terms control (URL: ${page.url()})`,
          });

          await page.waitForTimeout(3000);
          await waitForStableDom(page);
          break;
        }
      } catch {
        // Try the next selector.
      }
    }

    if (!termsAccepted) {
      onPhase?.({
        phase: 'verification_submitted',
        detail: `Waiting for "I agree" or uploader UI (current URL: ${page.url()})`,
      });
      await page.waitForTimeout(2000);
    }
  }

  // Step 9: Wait up to 2 additional minutes for the uploader UI.
  let uploaderVisible = false;
  const uploaderDeadline = Date.now() + 120000;

  while (Date.now() < uploaderDeadline) {
    if (await isUploaderVisible(page)) {
      uploaderVisible = true;
      break;
    }

    onPhase?.({
      phase: 'verification_submitted',
      detail: `Waiting for WeTransfer uploader UI (current URL: ${page.url()})`,
    });

    await page.waitForTimeout(2000);
  }

  const postSignupUrl = page.url();
  if (!uploaderVisible) {
    throw new Error(
      `Uploader UI did not appear after signup/verification ` +
        `(last successful stage: verification_submitted, current URL: ${postSignupUrl})`
    );
  }

  onPhase?.({ phase: 'uploader_visible', detail: `Uploader UI is visible (URL: ${postSignupUrl})` });
}



function isWeTransferRootRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';

    return (
      host === 'wetransfer.com' &&
      path === '/' &&
      !parsed.pathname.includes('/downloads/') &&
      !parsed.pathname.includes('/transfers/')
    );
  } catch {
    return false;
  }
}


async function waitForWeTransferAuthCallbackToFinish(
  page: Page,
  onPhase?: (update: WeTransferSendPhaseUpdate) => void
): Promise<void> {
  const timeoutMs = Number(
    process.env.WETRANSFER_AUTH_CALLBACK_WAIT_MS || 300000
  );
  const startedAt = Date.now();

  console.log(`WETRANSFER CALLBACK WAIT START | ${page.url()}`);
  onPhase?.({
    phase: 'verification_submitted',
    detail: `Waiting for WeTransfer account callback redirect to finish (current URL: ${page.url()})`,
  });

  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();

    let isCallback = false;
    try {
      const parsed = new URL(currentUrl);
      isCallback =
        parsed.hostname.replace(/^www\./, '') === 'wetransfer.com' &&
        parsed.pathname.startsWith('/account/callback');
    } catch {
      isCallback = currentUrl.includes('/account/callback');
    }

    if (!isCallback) {
      console.log(`WETRANSFER CALLBACK FINISHED | ${currentUrl}`);
      onPhase?.({
        phase: 'verification_submitted',
        detail: `WeTransfer account callback finished (current URL: ${currentUrl})`,
      });

      // Give the destination page a moment to mount the authenticated app.
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
      } catch {
        // SPA transition may not trigger a full document navigation.
      }

      await page.waitForTimeout(3000);
      return;
    }

    onPhase?.({
      phase: 'verification_submitted',
      detail: `Still on temporary WeTransfer callback URL; waiting before upload (current URL: ${currentUrl})`,
    });

    await page.waitForTimeout(2000);
  }

  throw new Error(
    `Timed out waiting for WeTransfer account callback redirect to finish (current URL: ${page.url()})`
  );
}

async function ensureUploaderReadyAfterRedirect(
  page: Page,
  onPhase?: (update: WeTransferSendPhaseUpdate) => void
): Promise<void> {
  const timeoutMs = Number(
    process.env.WETRANSFER_POST_VERIFY_UPLOADER_WAIT_MS || 180000
  );

  const rootUrl = `${WETRANSFER_URL.replace(/\/$/, '')}/`;

  for (let recoveryAttempt = 1; recoveryAttempt <= 2; recoveryAttempt += 1) {
    const deadline = Date.now() + timeoutMs;

    onPhase?.({
      phase: 'uploader_visible',
      detail:
        `Post-verification uploader recovery attempt ${recoveryAttempt}/2 | current URL: ${page.url()}`,
    });

    while (Date.now() < deadline) {
      const currentUrl = page.url();
      const onCallbackUrl = currentUrl.includes('/account/callback');

      const uploaderVisible =
        !onCallbackUrl && (await isUploaderVisible(page));

      onPhase?.({
        phase: 'uploader_visible',
        detail: `Uploader check | visible=${uploaderVisible} | callback=${onCallbackUrl} | URL=${currentUrl}`,
      });

      if (uploaderVisible) {
        onPhase?.({
          phase: 'uploader_visible',
          detail: `Uploader UI detected after authentication redirect completed (URL: ${currentUrl})`,
        });
        return;
      }

      if (onCallbackUrl) {
        onPhase?.({
          phase: 'verification_submitted',
          detail: `Uploader check paused because browser is still on temporary callback URL: ${currentUrl}`,
        });
      }

      // WeTransfer often redirects verified accounts to the homepage first.
      // Let the SPA finish rendering before forcing a navigation.
      await page.waitForTimeout(2000);
    }

    if (recoveryAttempt === 1) {
      onPhase?.({
        phase: 'loading_wetransfer',
        detail:
          `Uploader did not appear after redirect. Reloading WeTransfer homepage and retrying uploader detection: ${rootUrl}`,
      });

      await page.goto(rootUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      await page.waitForTimeout(3000);
      await dismissConsentAndPopups(page).catch(() => undefined);
    }
  }

  throw new Error(
    `Uploader UI did not appear after verification redirect recovery ` +
      `(current URL: ${page.url()})`
  );
}

async function confirmSend(page: Page): Promise<{ transferUrl?: string }> {
  const successTextChecks = [
    'Transfer sent',
    "You've sent",
    'Files are on their way',
    'Your transfer is ready',
    'Email sent',
  ];

  try {
    await page.waitForFunction(
      (texts) => {
        const bodyText = document.body?.innerText || '';
        return texts.some((text: string) => bodyText.toLowerCase().includes(text.toLowerCase()));
      },
      successTextChecks,
      { timeout: 60000 }
    );
  } catch {
    // Continue with HTML-based fallback below.
  }

  const html = await page.content();
  const antiBotHint = getAntiBotHint(html);
  if (antiBotHint) {
    throw new Error(antiBotHint);
  }

  const sentDetected =
    /transfer sent|files are on their way|your transfer is ready|email sent|download link/i.test(html);

  if (!sentDetected) {
    throw new Error('WeTransfer did not show a send confirmation page after submitting transfer.');
  }

  return { transferUrl: extractTransferLinkFromHtml(html) };
}

export async function probeWeTransferWebsite(
  onPhase?: (update: WeTransferSendPhaseUpdate) => void,
  proxyConfig?: BrowserProxyConfig | null,
  launchPath = 'probe'
): Promise<{ success: boolean; error?: string }> {
  let browser;
  try {
    browser = await launchWeTransferBrowser(proxyConfig, onPhase, launchPath);

    const page = await createFreshWeTransferPage(browser);
    await openWeTransferLoginPage(page, proxyConfig, onPhase, launchPath);

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function createWeTransferTransfer(
  filename: string,
  fileBuffer: Buffer,
  recipientEmails: string[],
  message?: string,
  onPhase?: (update: WeTransferSendPhaseUpdate) => void,
  options: WeTransferSendOptions = {}
): Promise<{ success: boolean; downloadUrl?: string; error?: string }> {
  let browser;
  let activeDolphinProfileId: number | null = null;
  try {
    const normalizedRecipients = Array.from(
      new Set(recipientEmails.map((email) => email.trim()).filter(Boolean))
    ).slice(0, 10);

    if (!normalizedRecipients.length) {
      throw new Error('At least one recipient email is required for WeTransfer send');
    }

    const attachmentPath = options.attachmentPath?.trim();
    if (!attachmentPath) {
      throw new Error('Attachment path is required for browser upload');
    }

    const attachmentStats = await stat(attachmentPath).catch(() => null);
    if (!attachmentStats || !attachmentStats.isFile() || attachmentStats.size <= 0) {
      throw new Error(`Attachment file is missing or empty: ${attachmentPath}`);
    }

    const senderEmail = (options.senderEmail || '').trim();
    if (!senderEmail) {
      throw new Error(
        'Sender email (temp mailbox) is required for the WeTransfer signup/login flow'
      );
    }

    browser = await launchWeTransferBrowser(
      options.proxyConfig,
      onPhase,
      'send-transfer',
      options.dolphinProfileId
    );

    if (isDolphinEnabled()) {
      const rawProfileId =
        options.dolphinProfileId || process.env.DOLPHIN_PROFILE_ID || '';
      const parsedProfileId = Number(rawProfileId);

      if (Number.isInteger(parsedProfileId) && parsedProfileId > 0) {
        activeDolphinProfileId = parsedProfileId;
      }
    }

    const page = await createFreshWeTransferPage(browser);

    // Perform signup + verification flow before touching the uploader.
    await performSignupAndVerification(page, senderEmail, options, onPhase);

    // IMPORTANT: OTP verification may first land on a temporary OAuth callback:
    // https://wetransfer.com/account/callback?...code=...&state=...
    // Never upload on that transient page. Wait until WeTransfer finishes the
    // authentication redirect and lands on the authenticated application first.
    await waitForWeTransferAuthCallbackToFinish(page, onPhase);

    // Now wait for the authenticated homepage/uploader to mount.
    await ensureUploaderReadyAfterRedirect(page, onPhase);

    onPhase?.({ phase: 'preparing_attachment', detail: `Using file ${path.basename(attachmentPath)}` });
    onPhase?.({ phase: 'upload_started', detail: `Uploading "${filename}" (${fileBuffer.length} bytes)` });

    const uploadStrategyLog: string[] = [];
    let confirmation: { transferUrl?: string } | null = null;
    let transferAttemptError = '';

    for (let transferAttempt = 1; transferAttempt <= 2 && !confirmation; transferAttempt += 1) {
      let transferClickedThisAttempt = false;

      try {
        onPhase?.({
          phase: 'upload_started',
          detail: `Transfer attempt ${transferAttempt}/2 | preparing uploader at ${page.url()}`,
        });

        await ensureUploaderReadyAfterRedirect(page, onPhase);

        onPhase?.({
          phase: 'upload_started',
          detail: `Transfer attempt ${transferAttempt}/2 | attaching "${filename}"`,
        });

        await uploadAttachment(page, attachmentPath, (msg) => {
          uploadStrategyLog.push(`attempt ${transferAttempt}: ${msg}`);
          onPhase?.({ phase: 'upload_started', detail: msg });
        });

        onPhase?.({
          phase: 'upload_started',
          detail: `File selected. Waiting for WeTransfer to finish uploading "${filename}" before sending.`,
        });

        await waitForWeTransferUploadReady(page, filename, (msg) => {
          onPhase?.({ phase: 'upload_started', detail: msg });
        });

        onPhase?.({
          phase: 'upload_completed',
          detail: `Upload fully ready for "${filename}" [transfer attempt ${transferAttempt}/2]`,
        });

        console.log(
          `UPLOAD READY -> MOVING TO EMAIL TO | filename=${filename} | url=${page.url()}`
        );

        console.log(
          `RECIPIENT BATCH STAGE START | count=${normalizedRecipients.length} | recipients=${normalizedRecipients.join(', ')} | url=${page.url()}`
        );

        onPhase?.({
          phase: 'send_submitted',
          detail: `Recipient batch started (${normalizedRecipients.length}/10): ${normalizedRecipients.join(', ')}`,
        });

        for (
          let recipientIndex = 0;
          recipientIndex < normalizedRecipients.length;
          recipientIndex += 1
        ) {
          const normalizedRecipient = normalizedRecipients[recipientIndex];

          let recipientInput = page
            .locator('input#autosuggest[name="autosuggest"]')
            .first();

          if (!(await recipientInput.isVisible().catch(() => false))) {
            const emailToLabel = page
              .getByText(/^Email to$/i, { exact: true })
              .first();

            if (await emailToLabel.isVisible().catch(() => false)) {
              const forAttr = await emailToLabel
                .getAttribute('for')
                .catch(() => null);

              if (forAttr) {
                recipientInput = page.locator(`#${forAttr}`).first();
              }
            }
          }

          await recipientInput.waitFor({
            state: 'visible',
            timeout: 60000,
          });

          await recipientInput.click({ timeout: 60000 });
          await recipientInput.fill('');
          await page.waitForTimeout(250);

          console.log(
            `RECIPIENT TYPING | ${recipientIndex + 1}/${normalizedRecipients.length} | ${normalizedRecipient}`
          );

          await recipientInput.pressSequentially(normalizedRecipient, {
            delay: 80,
          });

          const recipientActual = await recipientInput.inputValue();

          if (recipientActual !== normalizedRecipient) {
            throw new Error(
              `Recipient email field mismatch: expected ${normalizedRecipient}, got ${recipientActual}`
            );
          }

          await recipientInput.press('Enter');
          await page.waitForTimeout(800);

          console.log(
            `RECIPIENT COMMITTED | ${recipientIndex + 1}/${normalizedRecipients.length} | ${normalizedRecipient}`
          );

          onPhase?.({
            phase: 'send_submitted',
            detail: `Recipient committed ${recipientIndex + 1}/${normalizedRecipients.length}: ${normalizedRecipient}`,
          });
        }

        console.log(
          `ALL RECIPIENTS COMMITTED | count=${normalizedRecipients.length} | ${normalizedRecipients.join(', ')}`
        );

        const transferByTestId = page
          .locator('button[data-testid="uploaderForm-transfer-button"]')
          .first();

        await transferByTestId.waitFor({
          state: 'visible',
          timeout: 60000,
        });

        await transferByTestId.click({ timeout: 60000 });
        transferClickedThisAttempt = true;

        console.log(
          `TRANSFER CLICKED | recipients=${normalizedRecipients.join(', ')} | url=${page.url()}`
        );

        onPhase?.({
          phase: 'send_submitted',
          detail: `Transfer submission clicked for ${normalizedRecipients.length} recipient(s) [attempt ${transferAttempt}/2]`,
        });

        // Give WeTransfer time to process the send, then let confirmation
        // detection determine whether the transfer actually succeeded.
        await page.waitForTimeout(3000);

        try {
          confirmation = await confirmSend(page);
        } catch (confirmationError: unknown) {
          const confirmationMessage =
            confirmationError instanceof Error
              ? confirmationError.message
              : String(confirmationError);

          // Important: once Transfer has been clicked, do not retry the send.
          // A missing confirmation is ambiguous and retrying can duplicate delivery.
          if (transferClickedThisAttempt) {
            onPhase?.({
              phase: 'send_submitted',
              detail:
                `Transfer was clicked, but confirmation could not be detected. ` +
                `Not retrying to avoid duplicate send. Detail: ${confirmationMessage}`,
            });

            console.log(
              `TRANSFER CLICKED BUT UNCONFIRMED | no retry | recipients=${normalizedRecipients.join(', ')} | detail=${confirmationMessage}`
            );

            // Treat as submitted but unconfirmed; return a placeholder confirmation
            // so the outer retry loop stops and no second Transfer click occurs.
            confirmation = {};
            break;
          }

          throw confirmationError;
        }
      } catch (error: unknown) {
        transferAttemptError =
          error instanceof Error ? error.message : String(error);

        onPhase?.({
          phase: 'send_submitted',
          detail: `Transfer attempt ${transferAttempt}/2 failed: ${transferAttemptError}`,
        });

        if (transferAttempt < 2 && !transferClickedThisAttempt) {
          const rootUrl = `${WETRANSFER_URL.replace(/\/$/, '')}/`;

          onPhase?.({
            phase: 'loading_wetransfer',
            detail:
              `Transfer was not clicked on attempt ${transferAttempt}/2. Retrying once. Reloading ${rootUrl}`,
          });

          await page.goto(rootUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });

          await page.waitForTimeout(3000);
          await dismissConsentAndPopups(page).catch(() => undefined);
          await ensureUploaderReadyAfterRedirect(page, onPhase);
        }
      }
    }

    if (!confirmation) {
      throw new Error(
        `Transfer failed after retry: ${transferAttemptError || 'unknown error'}`
      );
    }
    if (confirmation.transferUrl) {
      onPhase?.({
        phase: 'send_confirmed',
        detail: `Transfer confirmed for ${normalizedRecipients.length} recipient(s)`,
      });
    } else {
      onPhase?.({
        phase: 'send_submitted',
        detail:
          `Transfer submitted once for ${normalizedRecipients.length} recipient(s). Confirmation was not detected; no retry was performed to avoid duplicate delivery.`,
      });
    }

    return {
      success: true,
      downloadUrl: confirmation.transferUrl,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    onPhase?.({ phase: 'failed', detail: message });
    return {
      success: false,
      error: message,
    };
  } finally {
    if (browser && isDolphinEnabled()) {
      // Clear cookies and browser storage while the profile is still connected.
      await clearDolphinBrowserSession(browser);

      // Close the Playwright/CDP browser connection.
      await browser.close().catch(() => undefined);

      // Explicitly stop the Dolphin profile so the Anty browser process is
      // actually terminated rather than left running/disconnected.
      if (activeDolphinProfileId) {
        await stopDolphinProfile(activeDolphinProfileId);
      }
    } else {
      await browser?.close().catch(() => undefined);
    }
  }
}


export type WeTransferSequentialJob = {
  recipientEmail: string;
  filename: string;
  fileBuffer: Buffer;
  attachmentPath: string;
  message?: string;
};

export async function createWeTransferSequentialTransfers(
  jobs: WeTransferSequentialJob[],
  onPhase?: (update: WeTransferSendPhaseUpdate) => void,
  options: WeTransferSendOptions = {}
): Promise<{
  success: boolean;
  results: Array<{
    recipientEmail: string;
    filename: string;
    success: boolean;
    downloadUrl?: string;
    error?: string;
  }>;
  error?: string;
}> {
  let browser;
  let activeDolphinProfileId: number | null = null;

  const normalizedJobs = jobs
    .map((job) => ({
      ...job,
      recipientEmail: String(job.recipientEmail || '').trim(),
      filename: String(job.filename || '').trim(),
      attachmentPath: String(job.attachmentPath || '').trim(),
    }))
    .filter(
      (job) =>
        job.recipientEmail &&
        job.filename &&
        job.attachmentPath &&
        job.fileBuffer?.length > 0
    )
    .slice(0, 10);

  const results: Array<{
    recipientEmail: string;
    filename: string;
    success: boolean;
    downloadUrl?: string;
    error?: string;
  }> = [];

  try {
    if (!normalizedJobs.length) {
      throw new Error('At least one sequential WeTransfer job is required');
    }

    const senderEmail = (options.senderEmail || '').trim();

    if (!senderEmail) {
      throw new Error(
        'Sender email (temp mailbox) is required for the WeTransfer signup/login flow'
      );
    }

    // Validate all files before launching the browser.
    for (const job of normalizedJobs) {
      const stats = await stat(job.attachmentPath).catch(() => null);

      if (!stats || !stats.isFile() || stats.size <= 0) {
        throw new Error(
          `Attachment file is missing or empty: ${job.attachmentPath}`
        );
      }
    }

    browser = await launchWeTransferBrowser(
      options.proxyConfig,
      onPhase,
      'send-transfer',
      options.dolphinProfileId
    );

    if (isDolphinEnabled()) {
      const rawProfileId =
        options.dolphinProfileId || process.env.DOLPHIN_PROFILE_ID || '';
      const parsedProfileId = Number(rawProfileId);

      if (Number.isInteger(parsedProfileId) && parsedProfileId > 0) {
        activeDolphinProfileId = parsedProfileId;
      }
    }

    const page = await createFreshWeTransferPage(browser);

    // Sign up / verify ONCE for this account batch.
    await performSignupAndVerification(
      page,
      senderEmail,
      options,
      onPhase
    );

    await waitForWeTransferAuthCallbackToFinish(page, onPhase);
    await ensureUploaderReadyAfterRedirect(page, onPhase);

    for (let jobIndex = 0; jobIndex < normalizedJobs.length; jobIndex += 1) {
      const job = normalizedJobs[jobIndex];
      const recipient = job.recipientEmail;

      try {
        onPhase?.({
          phase: 'preparing_attachment',
          detail:
            `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ` +
            `${recipient} | ${job.filename}`,
        });

        // For transfers after the first, return to a clean uploader.
        if (jobIndex > 0) {
          const rootUrl = `${WETRANSFER_URL.replace(/\/$/, '')}/`;

          onPhase?.({
            phase: 'loading_wetransfer',
            detail:
              `Returning to uploader for transfer ${jobIndex + 1}/${normalizedJobs.length}: ${rootUrl}`,
          });

          await page.goto(rootUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });

          await dismissConsentAndPopups(page).catch(() => undefined);
          await ensureUploaderReadyAfterRedirect(page, onPhase);
        }

        onPhase?.({
          phase: 'upload_started',
          detail:
            `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ` +
            `uploading "${job.filename}" for ${recipient}`,
        });

        await uploadAttachment(page, job.attachmentPath, (msg) => {
          onPhase?.({
            phase: 'upload_started',
            detail:
              `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ${msg}`,
          });
        });

        await waitForWeTransferUploadReady(page, job.filename, (msg) => {
          onPhase?.({
            phase: 'upload_started',
            detail:
              `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ${msg}`,
          });
        });

        onPhase?.({
          phase: 'upload_completed',
          detail:
            `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ` +
            `upload ready "${job.filename}"`,
        });

        console.log(
          `WETRANSFER SEQUENTIAL RECIPIENT | ${jobIndex + 1}/${normalizedJobs.length} | ${recipient}`
        );

        let recipientInput = page
          .locator('input#autosuggest[name="autosuggest"]')
          .first();

        if (!(await recipientInput.isVisible().catch(() => false))) {
          const emailToLabel = page
            .getByText(/^Email to$/i, { exact: true })
            .first();

          if (await emailToLabel.isVisible().catch(() => false)) {
            const forAttr = await emailToLabel
              .getAttribute('for')
              .catch(() => null);

            if (forAttr) {
              recipientInput = page.locator(`#${forAttr}`).first();
            }
          }
        }

        await recipientInput.waitFor({
          state: 'visible',
          timeout: 60000,
        });

        await recipientInput.click({ timeout: 60000 });
        await recipientInput.fill('');

        // Fast single-recipient entry.
        await recipientInput.pressSequentially(recipient, {
          delay: 40,
        });

        const actual = await recipientInput.inputValue();

        if (actual !== recipient) {
          throw new Error(
            `Recipient email field mismatch: expected ${recipient}, got ${actual}`
          );
        }

        await recipientInput.press('Enter');
        await page.waitForTimeout(500);

        onPhase?.({
          phase: 'send_submitted',
          detail:
            `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ` +
            `recipient committed: ${recipient}`,
        });

        const transferButton = page
          .locator('button[data-testid="uploaderForm-transfer-button"]')
          .first();

        await transferButton.waitFor({
          state: 'visible',
          timeout: 60000,
        });

        await transferButton.click({ timeout: 60000 });

        onPhase?.({
          phase: 'send_submitted',
          detail:
            `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ` +
            `Transfer clicked for ${recipient}`,
        });

        await page.waitForTimeout(3000);

        let confirmation: { transferUrl?: string } = {};

        try {
          confirmation = await confirmSend(page);
        } catch (confirmationError: unknown) {
          const detail =
            confirmationError instanceof Error
              ? confirmationError.message
              : String(confirmationError);

          // Transfer was already clicked. Do not click again.
          onPhase?.({
            phase: 'send_submitted',
            detail:
              `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} | ` +
              `clicked but confirmation not detected; no retry to avoid duplicate. ${detail}`,
          });
        }

        results.push({
          recipientEmail: recipient,
          filename: job.filename,
          success: true,
          downloadUrl: confirmation.transferUrl,
        });

        onPhase?.({
          phase: confirmation.transferUrl
            ? 'send_confirmed'
            : 'send_submitted',
          detail:
            `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} complete | ` +
            `${recipient} | ${job.filename}`,
        });

        console.log(
          `WETRANSFER SEQUENTIAL COMPLETE | ${jobIndex + 1}/${normalizedJobs.length} | ${recipient} | ${job.filename}`
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);

        results.push({
          recipientEmail: recipient,
          filename: job.filename,
          success: false,
          error: message,
        });

        onPhase?.({
          phase: 'failed',
          detail:
            `Sequential transfer ${jobIndex + 1}/${normalizedJobs.length} failed | ` +
            `${recipient} | ${message}`,
        });

        console.error(
          `WETRANSFER SEQUENTIAL FAILED | ${jobIndex + 1}/${normalizedJobs.length} | ${recipient} | ${message}`
        );

        // Try to recover the uploader for the next lead, but do not recreate
        // the account or browser session.
        if (jobIndex < normalizedJobs.length - 1) {
          const rootUrl = `${WETRANSFER_URL.replace(/\/$/, '')}/`;

          await page
            .goto(rootUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 60000,
            })
            .catch(() => undefined);

          await dismissConsentAndPopups(page).catch(() => undefined);
          await ensureUploaderReadyAfterRedirect(page, onPhase).catch(
            () => undefined
          );
        }
      }
    }

    const successful = results.filter((item) => item.success).length;

    return {
      success: successful === normalizedJobs.length,
      results,
      error:
        successful === normalizedJobs.length
          ? undefined
          : `${successful}/${normalizedJobs.length} sequential transfer(s) completed successfully`,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);

    onPhase?.({
      phase: 'failed',
      detail: message,
    });

    return {
      success: false,
      results,
      error: message,
    };
  } finally {
    // IMPORTANT: cleanup only ONCE, after all up-to-10 one-recipient
    // transfers for this account/session are finished.
    if (browser && isDolphinEnabled()) {
      await clearDolphinBrowserSession(browser);
      await browser.close().catch(() => undefined);

      if (activeDolphinProfileId) {
        await stopDolphinProfile(activeDolphinProfileId);
      }
    } else {
      await browser?.close().catch(() => undefined);
    }
  }
}
