const DEFAULT_CAPTCHA_SOLVE_TIMEOUT_MS = 65_000;
const DEFAULT_INQUIRY_PREPARE_TIMEOUT_MS = 120_000;
const DEFAULT_INQUIRY_SUBMIT_TIMEOUT_MS = 90_000;
const DEFAULT_CAPTCHA_TOKEN_TTL_MS = 110_000;

type EnvShape = Record<string, string | undefined>;

export type CaptchaTokenSnapshot = {
  recaptchaResponse?: string | null;
  hcaptchaResponse?: string | null;
  turnstileResponse?: string | null;
  solvedAt?: number | null;
};

function boundedInteger(
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(String(rawValue || '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getCaptchaSolveTimeoutMs(env: EnvShape = process.env): number {
  return boundedInteger(
    env.INQUIRY_CAPTCHA_SOLVE_TIMEOUT_MS || env.CAPTCHA_SOLVE_TIMEOUT_MS,
    DEFAULT_CAPTCHA_SOLVE_TIMEOUT_MS,
    5_000,
    180_000
  );
}

export function getInquiryPhaseTimeoutMs(
  phase: 'prepare' | 'submit',
  env: EnvShape = process.env
): number {
  if (phase === 'prepare') {
    return boundedInteger(
      env.INQUIRY_PREPARE_TIMEOUT_MS,
      DEFAULT_INQUIRY_PREPARE_TIMEOUT_MS,
      30_000,
      240_000
    );
  }

  return boundedInteger(
    env.INQUIRY_SUBMIT_TIMEOUT_MS,
    DEFAULT_INQUIRY_SUBMIT_TIMEOUT_MS,
    20_000,
    180_000
  );
}

export function getCaptchaTokenTtlMs(env: EnvShape = process.env): number {
  return boundedInteger(
    env.INQUIRY_CAPTCHA_TOKEN_TTL_MS,
    DEFAULT_CAPTCHA_TOKEN_TTL_MS,
    30_000,
    180_000
  );
}

export function getCaptchaApiKeyFromEnv(
  env: EnvShape = process.env
): string | null {
  for (const key of [
    'TWOCAPTCHA_API_KEY',
    'TWO_CAPTCHA_API_KEY',
    'CAPTCHA_API_KEY',
  ] as const) {
    const value = String(env[key] || '').trim();
    if (value) return value;
  }
  return null;
}

export function maskSecret(value: string, visible = 4): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= visible) return '*'.repeat(trimmed.length);
  return `${'*'.repeat(Math.max(8, trimmed.length - visible))}${trimmed.slice(-visible)}`;
}

export function extractCaptchaProviderError(
  value: unknown,
  fallback = 'Unknown error'
): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return fallback;

  const candidate = value as Record<string, unknown>;
  for (const field of ['request', 'error_text', 'error', 'message'] as const) {
    const next = candidate[field];
    if (typeof next === 'string' && next.trim()) return next.trim();
  }
  return fallback;
}

export function hasFreshCaptchaToken(
  snapshot: CaptchaTokenSnapshot,
  now = Date.now(),
  ttlMs = DEFAULT_CAPTCHA_TOKEN_TTL_MS
): boolean {
  const hasToken = Boolean(
    String(snapshot.recaptchaResponse || '').trim() ||
      String(snapshot.hcaptchaResponse || '').trim() ||
      String(snapshot.turnstileResponse || '').trim()
  );
  if (!hasToken) return false;

  const solvedAt = Number(snapshot.solvedAt || 0);
  if (!Number.isFinite(solvedAt) || solvedAt <= 0) return true;
  return now - solvedAt <= ttlMs;
}

export async function readCaptchaTokenSnapshot(
  page: any
): Promise<CaptchaTokenSnapshot> {
  try {
    return await page.evaluate(() => {
      const readValue = (selectors: string[]) => {
        for (const selector of selectors) {
          const node = document.querySelector(
            selector
          ) as HTMLInputElement | HTMLTextAreaElement | null;
          const value = String(
            ('value' in (node || {}) ? node?.value : '') || node?.textContent || ''
          ).trim();
          if (value) return value;
        }
        return '';
      };

      const solvedAt =
        document.documentElement.getAttribute('data-3d-suite-captcha-solved-at') ||
        document.body.getAttribute('data-3d-suite-captcha-solved-at') ||
        '';

      return {
        recaptchaResponse: readValue([
          '#g-recaptcha-response',
          'textarea[name="g-recaptcha-response"]',
          'input[name="g-recaptcha-response"]',
        ]),
        hcaptchaResponse: readValue([
          'textarea[name="h-captcha-response"]',
          'input[name="h-captcha-response"]',
        ]),
        turnstileResponse: readValue([
          'textarea[name="cf-turnstile-response"]',
          'input[name="cf-turnstile-response"]',
        ]),
        solvedAt: solvedAt ? Number.parseInt(solvedAt, 10) : null,
      };
    });
  } catch {
    return {};
  }
}
