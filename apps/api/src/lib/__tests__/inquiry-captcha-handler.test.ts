/**
 * Unit tests for InquiryCaptchaHandler
 *
 * Each test covers one detection/routing branch of the 3-checkpoint CAPTCHA flow:
 *   Checkpoint 1 – homepage (before form discovery)
 *   Checkpoint 2 – contact page (after navigation, before form fill)
 *   Checkpoint 3 – post-submit (after the form action is clicked)
 *
 * Playwright page objects are replaced with lightweight mock objects so that
 * the tests run without a browser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InquiryCaptchaHandler } from '../inquiry-captcha-handler';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal mock page whose `evaluate` function returns the supplied value. */
function makePage(evaluateReturn: unknown, url = 'https://example.com/contact') {
  return {
    url: () => url,
    evaluate: vi.fn().mockResolvedValue(evaluateReturn),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };
}

/** A solver stub that always returns a token. */
const SOLVER_TOKEN = 'test-token-abc';

vi.mock('../captcha-solver', () => {
  class TwoCaptchaSolverMock {
    async solveRecaptchaV2(_url: string, _key: string, isEnterprise?: boolean) {
      return SOLVER_TOKEN;
    }
    async solveRecaptchaV3(_url: string, _key: string, _score?: number, _action?: string, isEnterprise?: boolean) {
      return SOLVER_TOKEN;
    }
    async solveTurnstile(_url: string, _key: string) {
      return SOLVER_TOKEN;
    }
    async solveHcaptcha(_url: string, _key: string) {
      return SOLVER_TOKEN;
    }
  }
  return {
    TwoCaptchaSolver: TwoCaptchaSolverMock,
    getUserApiKey: (_: string) => null,
    setUserApiKey: () => {},
    clearUserApiKey: () => {},
  };
});

vi.mock('../captcha-store', () => ({
  CaptchaStore: {
    queueCaptcha: vi.fn().mockResolvedValue({ id: 'q-1' }),
    updateCaptchaQueue: vi.fn().mockResolvedValue(null),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('InquiryCaptchaHandler.handleCaptcha', () => {
  let handler: InquiryCaptchaHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new InquiryCaptchaHandler('user1', 'run1', 'apikey-123');
  });

  // ── solver_unavailable ────────────────────────────────────────────────────

  it('returns solver_unavailable when no API key is configured', async () => {
    const noKeyHandler = new InquiryCaptchaHandler('user1', 'run1');
    const page = makePage(null);
    const result = await noKeyHandler.handleCaptcha(page);
    expect(result.status).toBe('solver_unavailable');
    expect(result.handled).toBe(false);
    // isConfigured() must be consistent
    expect(noKeyHandler.isConfigured()).toBe(false);
  });

  // ── not_found ─────────────────────────────────────────────────────────────

  it('returns not_found when page has no CAPTCHA widget', async () => {
    // All detectors return null → no widget found
    const page = makePage(null);
    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('not_found');
    expect(result.handled).toBe(false);
  });

  // ── Turnstile standalone ──────────────────────────────────────────────────

  it('detects and solves Turnstile standalone widget', async () => {
    // Simulate detectTurnstile → { siteKey, isChallenge: false }
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        // detectTurnstile call returns standalone
        .mockResolvedValueOnce({ siteKey: 'ts-key-1', isChallenge: false })
        // injectTurnstileToken call
        .mockResolvedValueOnce(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('solved');
    expect(result.providerType).toBe('turnstile_standalone');
    expect(result.solution).toBe(SOLVER_TOKEN);
  });

  // ── Turnstile challenge ───────────────────────────────────────────────────

  it('detects and solves Turnstile challenge (full-page)', async () => {
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        .mockResolvedValueOnce({ siteKey: 'ts-challenge-key', isChallenge: true })
        .mockResolvedValueOnce(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('solved');
    expect(result.providerType).toBe('turnstile_challenge');
  });

  // ── hCaptcha ──────────────────────────────────────────────────────────────

  it('detects and solves hCaptcha', async () => {
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        // detectTurnstile → null
        .mockResolvedValueOnce(null)
        // detectHcaptcha → siteKey
        .mockResolvedValueOnce('hc-key-1')
        // injectHcaptchaToken
        .mockResolvedValueOnce(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('solved');
    expect(result.providerType).toBe('hcaptcha');
  });

  // ── reCAPTCHA v2 ──────────────────────────────────────────────────────────

  it('detects and solves reCAPTCHA v2', async () => {
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        .mockResolvedValueOnce(null)   // detectTurnstile
        .mockResolvedValueOnce(null)   // detectHcaptcha
        .mockResolvedValueOnce(null)   // detectRecaptchaV3Enterprise
        .mockResolvedValueOnce(null)   // detectRecaptchaV3
        .mockResolvedValueOnce(null)   // detectRecaptchaV2Enterprise
        .mockResolvedValueOnce('rc-v2-key') // detectRecaptchaV2 → siteKey
        .mockResolvedValueOnce(undefined),  // injectRecaptchaV2Token
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('solved');
    expect(result.providerType).toBe('recaptcha_v2');
  });

  // ── reCAPTCHA v2 Enterprise ───────────────────────────────────────────────

  it('detects and solves reCAPTCHA v2 Enterprise (not misclassified as standard)', async () => {
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        .mockResolvedValueOnce(null)         // detectTurnstile
        .mockResolvedValueOnce(null)         // detectHcaptcha
        .mockResolvedValueOnce(null)         // detectRecaptchaV3Enterprise
        .mockResolvedValueOnce(null)         // detectRecaptchaV3
        .mockResolvedValueOnce('rc-ent-key') // detectRecaptchaV2Enterprise → siteKey
        .mockResolvedValueOnce(undefined),   // injectRecaptchaV2Token
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('solved');
    expect(result.providerType).toBe('recaptcha_v2_enterprise');
  });

  // ── reCAPTCHA v3 ──────────────────────────────────────────────────────────

  it('detects and solves reCAPTCHA v3', async () => {
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        .mockResolvedValueOnce(null)                       // detectTurnstile
        .mockResolvedValueOnce(null)                       // detectHcaptcha
        .mockResolvedValueOnce(null)                       // detectRecaptchaV3Enterprise
        .mockResolvedValueOnce({ siteKey: 'rc-v3-key' })  // detectRecaptchaV3
        .mockResolvedValueOnce(undefined),                 // injectRecaptchaV3Token
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('solved');
    expect(result.providerType).toBe('recaptcha_v3');
  });

  // ── reCAPTCHA v3 Enterprise ───────────────────────────────────────────────

  it('detects and solves reCAPTCHA v3 Enterprise (checked before standard v3)', async () => {
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        .mockResolvedValueOnce(null)                             // detectTurnstile
        .mockResolvedValueOnce(null)                             // detectHcaptcha
        .mockResolvedValueOnce({ siteKey: 'rc-v3-ent-key' })    // detectRecaptchaV3Enterprise
        .mockResolvedValueOnce(undefined),                       // injectRecaptchaV3Token
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.status).toBe('solved');
    expect(result.providerType).toBe('recaptcha_v3_enterprise');
  });

  // ── provider priority (Turnstile beats reCAPTCHA) ────────────────────────

  it('does not fall back to reCAPTCHA when Turnstile is present', async () => {
    // Turnstile widget is detected; later detectors should never be reached.
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn()
        .mockResolvedValueOnce({ siteKey: 'ts-priority', isChallenge: false })
        .mockResolvedValueOnce(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handler.handleCaptcha(page);
    expect(result.providerType).toBe('turnstile_standalone');
    // Only 2 evaluate calls: detectTurnstile + injectTurnstileToken
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});

// ── checkPostSubmitCaptcha ─────────────────────────────────────────────────

describe('InquiryCaptchaHandler.checkPostSubmitCaptcha', () => {
  let handler: InquiryCaptchaHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new InquiryCaptchaHandler('user1', 'run1', 'apikey-123');
  });

  it('returns detected=false when there is no CAPTCHA widget', async () => {
    const page = makePage(null);
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(false);
  });

  it('detects Turnstile standalone without falling back to reCAPTCHA', async () => {
    // Turnstile widget present; grecaptcha SDK also present (should be ignored)
    const page = makePage('turnstile_standalone');
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('turnstile_standalone');
  });

  it('detects Turnstile challenge page', async () => {
    const page = makePage('turnstile_challenge');
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('turnstile_challenge');
  });

  it('does NOT report reCAPTCHA when only the grecaptcha SDK badge is present (no widget)', async () => {
    // The page has grecaptcha SDK loaded for v3 analytics/badge but no widget.
    // evaluate() returns null – the SDK-only heuristic has been removed.
    const page = makePage(null);
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(false);
  });

  it('detects reCAPTCHA v2 when a real widget is present', async () => {
    const page = makePage('recaptcha_v2');
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('recaptcha_v2');
  });

  it('detects reCAPTCHA v2 Enterprise', async () => {
    const page = makePage('recaptcha_v2_enterprise');
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('recaptcha_v2_enterprise');
  });

  it('detects hCaptcha widget', async () => {
    const page = makePage('hcaptcha');
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('hcaptcha');
  });

  it('detects unknown challenge text', async () => {
    const page = makePage('unknown');
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('unknown');
  });

  it('returns detected=false on evaluate error', async () => {
    const page = {
      url: () => 'https://example.com',
      evaluate: vi.fn().mockRejectedValue(new Error('evaluate crashed')),
    };
    const result = await handler.checkPostSubmitCaptcha(page);
    expect(result.detected).toBe(false);
  });
});
