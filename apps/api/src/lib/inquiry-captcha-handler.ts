import { TwoCaptchaSolver, getUserApiKey } from './captcha-solver';
import { CaptchaStore } from './captcha-store';

/**
 * Detected CAPTCHA descriptor returned by the private detectors.
 * provider distinguishes the exact widget type so the solver uses the
 * correct API method and parameters without falling back to reCAPTCHA.
 */
export type CaptchaProviderType =
  | 'recaptcha_v2'
  | 'recaptcha_v2_enterprise'
  | 'recaptcha_v3'
  | 'recaptcha_v3_enterprise'
  | 'turnstile_standalone'
  | 'turnstile_challenge'
  | 'hcaptcha';

interface DetectedCaptcha {
  provider: CaptchaProviderType;
  siteKey?: string;
  minScore?: number;
  pageAction?: string;
  isEnterprise: boolean;
}

/**
 * Handler for solving CAPTCHAs during inquiry campaigns.
 */
export class InquiryCaptchaHandler {
  private userId: string;
  private runId: string;
  private apiKey: string | null;
  private solver: TwoCaptchaSolver | null;
  private page: any;

  constructor(userId: string, runId: string, apiKey?: string) {
    this.userId = userId;
    this.runId = runId;
    this.apiKey = apiKey || getUserApiKey(userId);
    this.solver = this.apiKey ? new TwoCaptchaSolver(this.apiKey) : null;
  }

  /**
   * Check if CAPTCHA solving is configured.
   */
  isConfigured(): boolean {
    return this.solver !== null;
  }

  /**
   * Detect and solve CAPTCHA on the page.
   *
   * Status values:
   *   solved           – token injected, page accepted it
   *   not_found        – no CAPTCHA widget detected on the page
   *   solver_unavailable – solver is not configured (no API key)
   *   failed           – solver is configured but the solve attempt failed
   */
  async handleCaptcha(page: any): Promise<{
    handled: boolean;
    status: 'solved' | 'failed' | 'not_found' | 'solver_unavailable';
    providerType?: CaptchaProviderType;
    solution?: string;
    error?: string;
  }> {
    this.page = page;

    if (!this.solver) {
      console.log('[Inquiry CAPTCHA] Solver not configured (no API key)');
      return { handled: false, status: 'solver_unavailable' };
    }

    try {
      const pageUrl = page.url();
      console.log(`[Inquiry CAPTCHA] Checking for CAPTCHA on ${pageUrl}`);

      // Detect provider-specific widgets in priority order.
      // Turnstile and hCaptcha share the data-sitekey attribute with reCAPTCHA
      // so they must be checked first to avoid mis-classification.
      const turnstile = await this.detectTurnstile(page);
      if (turnstile) {
        console.log(`[Inquiry CAPTCHA] Detected ${turnstile.provider}`);
        return await this.solveDetected(turnstile, pageUrl);
      }

      const hcaptcha = await this.detectHcaptcha(page);
      if (hcaptcha) {
        console.log('[Inquiry CAPTCHA] Detected hCaptcha');
        return await this.solveDetected(hcaptcha, pageUrl);
      }

      // reCAPTCHA enterprise scripts must be tested before standard ones
      // because both expose grecaptcha.execute.
      const recaptchaV3Enterprise = await this.detectRecaptchaV3Enterprise(page);
      if (recaptchaV3Enterprise) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v3 Enterprise');
        return await this.solveDetected(recaptchaV3Enterprise, pageUrl);
      }

      const recaptchaV3 = await this.detectRecaptchaV3(page);
      if (recaptchaV3) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v3');
        return await this.solveDetected(recaptchaV3, pageUrl);
      }

      const recaptchaV2Enterprise = await this.detectRecaptchaV2Enterprise(page);
      if (recaptchaV2Enterprise) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v2 Enterprise');
        return await this.solveDetected(recaptchaV2Enterprise, pageUrl);
      }

      const recaptchaV2 = await this.detectRecaptchaV2(page);
      if (recaptchaV2) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v2');
        return await this.solveDetected(recaptchaV2, pageUrl);
      }

      console.log('[Inquiry CAPTCHA] No CAPTCHA widget detected');
      return { handled: false, status: 'not_found' };
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Error in handleCaptcha:', error.message);
      return { handled: false, status: 'failed', error: error.message };
    }
  }

  /**
   * Check for CAPTCHA presence after form submission.
   * Returns only confirmed CAPTCHA widgets; does NOT fall back to reCAPTCHA
   * merely because the grecaptcha SDK is loaded (v3 badge / analytics use it
   * without presenting a challenge).
   */
  async checkPostSubmitCaptcha(page: any): Promise<{
    detected: boolean;
    type?: CaptchaProviderType | 'unknown';
  }> {
    try {
      this.page = page;

      const provider = await page.evaluate((): string | null => {
        const scripts = Array.from(document.querySelectorAll('script')).map((s: any) => String(s.src || ''));
        const iframes = Array.from(document.querySelectorAll('iframe')).map((f: any) => String(f.src || ''));
        const joined = `${scripts.join(' ')} ${iframes.join(' ')}`.toLowerCase();

        // Turnstile: standalone widget or full challenge iframe.
        if (
          document.querySelector('.cf-turnstile, [data-cf-turnstile], input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]')
        ) return 'turnstile_standalone';
        if (
          joined.includes('challenges.cloudflare.com/cdn-cgi/challenge-platform') ||
          document.querySelector('iframe[src*="challenges.cloudflare.com"]')
        ) return 'turnstile_challenge';

        // hCaptcha
        if (
          document.querySelector('.h-captcha, [data-hcaptcha-widget-id], input[name="h-captcha-response"], textarea[name="h-captcha-response"]') ||
          joined.includes('hcaptcha.com')
        ) return 'hcaptcha';

        // reCAPTCHA – must have an actual visible widget or response field, not
        // just the grecaptcha SDK (which is present on any v3 badge page).
        const hasWidget = !!(
          document.querySelector('.g-recaptcha[data-sitekey], textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"], #g-recaptcha-response') ||
          document.querySelector('iframe[src*="google.com/recaptcha/api2/anchor"], iframe[src*="gstatic.com/recaptcha"]')
        );
        if (hasWidget) {
          const isEnterprise = joined.includes('/recaptcha/enterprise');
          const hasV3Action = Array.from(document.querySelectorAll('script')).some((s: any) =>
            /render=/.test(s.src || '') && /recaptcha/.test(s.src || '')
          );
          if (isEnterprise) return hasV3Action ? 'recaptcha_v3_enterprise' : 'recaptcha_v2_enterprise';
          return hasV3Action ? 'recaptcha_v3' : 'recaptcha_v2';
        }

        // Challenge-like text as last resort (no provider SDK matched above).
        const body = String(document.body?.innerText || '');
        if (/captcha|human verification|verify (?:that )?you are human|i am not a robot|security check/i.test(body)) {
          return 'unknown';
        }
        return null;
      }).catch(() => null);

      return {
        detected: !!provider,
        type: (provider as CaptchaProviderType | 'unknown') || undefined,
      };
    } catch {
      return { detected: false };
    }
  }

  // ── Private detectors ──────────────────────────────────────────────────────

  private async detectTurnstile(page: any): Promise<DetectedCaptcha | null> {
    try {
      const result = await page.evaluate((): { siteKey: string; isChallenge: boolean } | null => {
        // Full-page Cloudflare challenge (cdn-cgi/challenge-platform)
        const challengeFrame = document.querySelector('iframe[src*="challenges.cloudflare.com/cdn-cgi/challenge-platform"]');
        if (challengeFrame) {
          const src = challengeFrame.getAttribute('src') || '';
          const match = src.match(/[?&](?:sitekey|k)=([^&]+)/i);
          return { siteKey: match ? match[1] : 'unknown', isChallenge: true };
        }

        // Standalone Turnstile widget
        const widget =
          document.querySelector('.cf-turnstile[data-sitekey]') ||
          document.querySelector('[data-cf-turnstile][data-sitekey]');
        if (widget) return { siteKey: widget.getAttribute('data-sitekey') || '', isChallenge: false };

        // Turnstile iframe (non-challenge)
        const frame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
        if (frame) {
          const src = frame.getAttribute('src') || '';
          const match = src.match(/[?&](?:sitekey|k)=([^&]+)/i);
          return { siteKey: match ? match[1] : 'unknown', isChallenge: false };
        }
        return null;
      });

      if (!result) return null;
      return {
        provider: result.isChallenge ? 'turnstile_challenge' : 'turnstile_standalone',
        siteKey: result.siteKey,
        isEnterprise: false,
      };
    } catch (error) {
      console.error('[Inquiry CAPTCHA] Turnstile detection error:', error);
      return null;
    }
  }

  private async detectHcaptcha(page: any): Promise<DetectedCaptcha | null> {
    try {
      const siteKey = await page.evaluate((): string | null => {
        const container =
          document.querySelector('.h-captcha[data-sitekey]') ||
          document.querySelector('[data-hcaptcha-widget-id][data-sitekey]');
        if (container) return container.getAttribute('data-sitekey');

        const frame = document.querySelector('iframe[src*="hcaptcha.com"]') as HTMLIFrameElement | null;
        if (frame) {
          const match = (frame.src || '').match(/[?&](?:sitekey|k)=([^&]+)/i);
          if (match) return match[1];
        }

        const hasHcaptchaScript = Array.from(document.querySelectorAll('script')).some(
          (s: any) => String(s.src || '').includes('hcaptcha.com')
        );
        if (hasHcaptchaScript) {
          const generic = document.querySelector('[data-sitekey]');
          return generic?.getAttribute('data-sitekey') || null;
        }
        return null;
      });

      return siteKey ? { provider: 'hcaptcha', siteKey, isEnterprise: false } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] hCaptcha detection error:', error);
      return null;
    }
  }

  private async detectRecaptchaV2(page: any): Promise<DetectedCaptcha | null> {
    try {
      const siteKey = await page.evaluate((): string | null => {
        // Only Google reCAPTCHA containers; hCaptcha/Turnstile also use data-sitekey.
        const container =
          document.querySelector('.g-recaptcha[data-sitekey]') ||
          document.querySelector('[data-sitekey][data-recaptcha-widget-id]');
        if (container) return container.getAttribute('data-sitekey');

        const iframes = document.querySelectorAll(
          'iframe[src*="google.com/recaptcha/api2/anchor"], iframe[src*="gstatic.com/recaptcha/releases"], iframe[src*="recaptcha/api2"]'
        );
        for (const iframe of Array.from(iframes)) {
          const src = iframe.getAttribute('src') || '';
          const match = src.match(/[?&]k=([^&]+)/);
          if (match) return match[1];
        }
        return null;
      });

      return siteKey ? { provider: 'recaptcha_v2', siteKey, isEnterprise: false } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v2 detection error:', error);
      return null;
    }
  }

  private async detectRecaptchaV2Enterprise(page: any): Promise<DetectedCaptcha | null> {
    try {
      const siteKey = await page.evaluate((): string | null => {
        const isEnterprise = Array.from(document.querySelectorAll('script')).some(
          (s: any) => /recaptcha\/enterprise/i.test(s.src || '')
        );
        if (!isEnterprise) return null;

        // Enterprise v2 has a visible widget, not just a render= script.
        const hasV3Render = Array.from(document.querySelectorAll('script')).some(
          (s: any) => /render=/.test(s.src || '') && /recaptcha/.test(s.src || '')
        );
        if (hasV3Render) return null; // That's enterprise v3.

        const container =
          document.querySelector('.g-recaptcha[data-sitekey]') ||
          document.querySelector('[data-sitekey][data-recaptcha-widget-id]');
        if (container) return container.getAttribute('data-sitekey');

        const iframes = document.querySelectorAll(
          'iframe[src*="google.com/recaptcha/enterprise/anchor"], iframe[src*="recaptcha/enterprise"]'
        );
        for (const iframe of Array.from(iframes)) {
          const src = iframe.getAttribute('src') || '';
          const match = src.match(/[?&]k=([^&]+)/);
          if (match) return match[1];
        }
        return null;
      });

      return siteKey ? { provider: 'recaptcha_v2_enterprise', siteKey, isEnterprise: true } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v2 Enterprise detection error:', error);
      return null;
    }
  }

  private async detectRecaptchaV3(page: any): Promise<DetectedCaptcha | null> {
    try {
      const result = await page.evaluate((): { siteKey: string } | null => {
        // v3 is identified by a render= key in the script src (not enterprise).
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const src = script.src || '';
          if (/recaptcha/.test(src) && /render=/.test(src) && !/enterprise/i.test(src)) {
            const match = src.match(/render=([^&]+)/);
            if (match && match[1] !== 'explicit') return { siteKey: match[1] };
          }
        }
        // Also check explicit data-sitekey with a v3 callback attribute.
        const container = document.querySelector('[data-sitekey][data-action]');
        if (container) {
          const key = container.getAttribute('data-sitekey');
          if (key) return { siteKey: key };
        }
        return null;
      });

      return result ? { provider: 'recaptcha_v3', siteKey: result.siteKey, minScore: 0.9, isEnterprise: false } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v3 detection error:', error);
      return null;
    }
  }

  private async detectRecaptchaV3Enterprise(page: any): Promise<DetectedCaptcha | null> {
    try {
      const result = await page.evaluate((): { siteKey: string } | null => {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const src = script.src || '';
          if (/recaptcha\/enterprise/i.test(src) && /render=/.test(src)) {
            const match = src.match(/render=([^&]+)/);
            if (match && match[1] !== 'explicit') return { siteKey: match[1] };
          }
        }
        // Enterprise grecaptcha.enterprise.execute present with a sitekey.
        if ((window as any).grecaptcha?.enterprise?.execute) {
          const container = document.querySelector('[data-sitekey]');
          const key = container?.getAttribute('data-sitekey');
          if (key) return { siteKey: key };
        }
        return null;
      });

      return result
        ? { provider: 'recaptcha_v3_enterprise', siteKey: result.siteKey, minScore: 0.9, isEnterprise: true }
        : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v3 Enterprise detection error:', error);
      return null;
    }
  }

  // ── Private solver dispatcher ──────────────────────────────────────────────

  private async solveDetected(
    captcha: DetectedCaptcha,
    pageUrl: string
  ): Promise<{
    handled: boolean;
    status: 'solved' | 'failed';
    providerType: CaptchaProviderType;
    solution?: string;
    error?: string;
  }> {
    if (!this.solver) {
      return { handled: false, status: 'failed', providerType: captcha.provider, error: 'Solver not configured' };
    }

    try {
      let token: string;

      switch (captcha.provider) {
        case 'recaptcha_v2':
        case 'recaptcha_v2_enterprise':
          if (!captcha.siteKey) throw new Error(`Missing sitekey for ${captcha.provider}`);
          token = await this.solver.solveRecaptchaV2(pageUrl, captcha.siteKey, captcha.isEnterprise);
          await this.injectRecaptchaV2Token(token);
          break;

        case 'recaptcha_v3':
        case 'recaptcha_v3_enterprise':
          if (!captcha.siteKey) throw new Error(`Missing sitekey for ${captcha.provider}`);
          token = await this.solver.solveRecaptchaV3(
            pageUrl,
            captcha.siteKey,
            captcha.minScore ?? 0.9,
            captcha.pageAction,
            captcha.isEnterprise
          );
          await this.injectRecaptchaV3Token(token);
          break;

        case 'turnstile_standalone':
        case 'turnstile_challenge':
          if (!captcha.siteKey) throw new Error(`Missing sitekey for ${captcha.provider}`);
          token = await this.solver.solveTurnstile(pageUrl, captcha.siteKey);
          await this.injectTurnstileToken(token);
          break;

        case 'hcaptcha':
          if (!captcha.siteKey) throw new Error('Missing sitekey for hCaptcha');
          token = await this.solver.solveHcaptcha(pageUrl, captcha.siteKey);
          await this.injectHcaptchaToken(token);
          break;

        default: {
          const _exhaustive: never = captcha.provider;
          throw new Error(`Unsupported CAPTCHA provider: ${_exhaustive}`);
        }
      }

      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: captcha.provider,
        siteKey: captcha.siteKey,
        minScore: captcha.minScore,
        pageAction: captcha.pageAction,
      });

      console.log(`[Inquiry CAPTCHA] ${captcha.provider} solved and injected`);
      return { handled: true, status: 'solved', providerType: captcha.provider, solution: token };
    } catch (error: any) {
      console.error(`[Inquiry CAPTCHA] ${captcha.provider} solving failed:`, error.message);
      return { handled: false, status: 'failed', providerType: captcha.provider, error: error.message };
    }
  }

  // ── Token injection ────────────────────────────────────────────────────────

  private async injectRecaptchaV2Token(token: string): Promise<void> {
    try {
      await this.page.evaluate((t: string) => {
        const field = document.getElementById('g-recaptcha-response');
        if (field) { (field as HTMLInputElement).value = t; field.style.display = 'block'; }
        if (typeof (window as any).recaptchaCallback === 'function') (window as any).recaptchaCallback(t);
        try { (window as any).grecaptcha?.callback?.(t); } catch {}
      }, token);
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v2 token injection failed:', error.message);
    }
  }

  private async injectRecaptchaV3Token(token: string): Promise<void> {
    try {
      await this.page.evaluate((t: string) => {
        const field = document.getElementById('g-recaptcha-response');
        if (field) (field as HTMLInputElement).value = t;
        const cb = (window as any).recaptchaCallback || (window as any).__recaptchaCallback;
        if (typeof cb === 'function') cb(t);
      }, token);
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v3 token injection failed:', error.message);
    }
  }

  private async injectTurnstileToken(token: string): Promise<void> {
    try {
      await this.page.evaluate((t: string) => {
        const field =
          (document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement) ||
          (document.querySelector('input[name="g-recaptcha-response"]') as HTMLInputElement);
        if (field) { field.value = t; field.style.display = 'block'; }
        if (typeof (window as any).turnstileCallback === 'function') (window as any).turnstileCallback(t);
        if (typeof (window as any).__turnstileCallback === 'function') (window as any).__turnstileCallback(t);
      }, token);
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Turnstile token injection failed:', error.message);
    }
  }

  private async injectHcaptchaToken(token: string): Promise<void> {
    try {
      await this.page.evaluate((t: string) => {
        const area =
          (document.querySelector('textarea[name="h-captcha-response"]') as HTMLTextAreaElement) ||
          (document.querySelector('input[name="h-captcha-response"]') as HTMLInputElement);
        if (area) { area.value = t; (area as HTMLElement).style.display = 'block'; }
        if (typeof (window as any).hcaptchaCallback === 'function') (window as any).hcaptchaCallback(t);
        try { if ((window as any).hcaptcha?.getResponse) (window as any).hcaptcha.getResponse = () => t; } catch {}
      }, token);
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] hCaptcha token injection failed:', error.message);
    }
  }
}
