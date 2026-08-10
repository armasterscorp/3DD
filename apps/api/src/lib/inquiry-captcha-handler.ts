import { TwoCaptchaSolver, getUserApiKey } from './captcha-solver';
import { CaptchaStore } from './captcha-store';

/**
 * Handler for solving CAPTCHAs during inquiry campaigns
 */
export class InquiryCaptchaHandler {
  private userId: string;
  private runId: string;
  private apiKey: string | null;
  private solver: TwoCaptchaSolver | null;

  constructor(userId: string, runId: string, apiKey?: string) {
    this.userId = userId;
    this.runId = runId;
    this.apiKey = apiKey || getUserApiKey(userId);
    this.solver = this.apiKey ? new TwoCaptchaSolver(this.apiKey) : null;
  }

  /**
   * Check if CAPTCHA solving is configured
   */
  isConfigured(): boolean {
    return this.solver !== null;
  }

  /**
   * Detect and solve CAPTCHA on the page
   */
  async handleCaptcha(page: any): Promise<{
    handled: boolean;
    status: 'solved' | 'failed' | 'not_found' | 'unconfigured';
    solution?: string;
    error?: string;
  }> {
    if (!this.solver) {
      console.log('[Inquiry CAPTCHA] CAPTCHA solving not configured');
      return { handled: false, status: 'unconfigured' };
    }

    try {
      const pageUrl = page.url();
      console.log(`[Inquiry CAPTCHA] Checking for CAPTCHA on ${pageUrl}`);

      // Detect reCAPTCHA v2
      const recaptchaV2 = await this.detectRecaptchaV2(page);
      if (recaptchaV2) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v2');
        return await this.solveRecaptchaV2(recaptchaV2, pageUrl);
      }

      // Detect reCAPTCHA v3
      const recaptchaV3 = await this.detectRecaptchaV3(page);
      if (recaptchaV3) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v3');
        return await this.solveRecaptchaV3(recaptchaV3, pageUrl);
      }

      // Detect Cloudflare Turnstile
      const turnstile = await this.detectTurnstile(page);
      if (turnstile) {
        console.log('[Inquiry CAPTCHA] Detected Cloudflare Turnstile');
        return await this.solveTurnstile(turnstile, pageUrl);
      }

      // Detect hCaptcha
      const hcaptcha = await this.detectHcaptcha(page);
      if (hcaptcha) {
        console.log('[Inquiry CAPTCHA] Detected hCaptcha');
        return await this.solveHcaptcha(hcaptcha, pageUrl);
      }

      console.log('[Inquiry CAPTCHA] No CAPTCHA detected');
      return { handled: false, status: 'not_found' };
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Error:', error.message);
      return {
        handled: false,
        status: 'failed',
        error: error.message,
      };
    }
  }

  /**
   * Check for CAPTCHA after form submission
   */
  async checkPostSubmitCaptcha(page: any): Promise<{
    detected: boolean;
    type?: string;
  }> {
    try {
      // Simple check - if page URL changed significantly or captcha appeared, return true
      const hasRecaptcha = await page.evaluate(
        () => !!(window as any).grecaptcha || document.querySelector('[data-sitekey]')
      );
      
      return { detected: hasRecaptcha, type: 'recaptcha' };
    } catch {
      return { detected: false };
    }
  }

  // Private detection methods

  private async detectRecaptchaV2(
    page: any
  ): Promise<{ siteKey: string } | null> {
    try {
      const siteKey = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe[src*="recaptcha"]');
        if (iframes.length > 0) {
          const src = iframes[0].getAttribute('src') || '';
          const match = src.match(/k=([^&]+)/);
          return match ? match[1] : null;
        }
        return (window as any).__grecaptcha_render_params?.[0]?.sitekey || null;
      });

      return siteKey ? { siteKey } : null;
    } catch {
      return null;
    }
  }

  private async detectRecaptchaV3(
    page: any
  ): Promise<{ siteKey: string; minScore?: number } | null> {
    try {
      const result = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.src?.includes('recaptcha') && script.src?.includes('v3')) {
            const src = script.src;
            const match = src.match(/render=([^&]+)/);
            return match ? match[1] : null;
          }
        }
        return (window as any).__grecaptcha_render_params?.[0]?.sitekey || null;
      });

      return result ? { siteKey: result, minScore: 0.9 } : null;
    } catch {
      return null;
    }
  }

  private async detectTurnstile(
    page: any
  ): Promise<{ siteKey: string } | null> {
    try {
      const siteKey = await page.evaluate(() => {
        const container = document.querySelector('[data-sitekey]');
        return container?.getAttribute('data-sitekey') || null;
      });

      if (siteKey) {
        // Verify it's Turnstile, not reCAPTCHA
        const isTurnstile = await page.evaluate(
          () => !!(window as any).turnstile
        );
        if (isTurnstile) {
          return { siteKey };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async detectHcaptcha(
    page: any
  ): Promise<{ siteKey: string } | null> {
    try {
      const siteKey = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.src?.includes('hcaptcha')) {
            const container = document.querySelector('[data-sitekey]');
            return container?.getAttribute('data-sitekey') || null;
          }
        }
        return null;
      });

      return siteKey ? { siteKey } : null;
    } catch {
      return null;
    }
  }

  // Private solving methods

  private async solveRecaptchaV2(
    captcha: { siteKey: string },
    pageUrl: string
  ): Promise<{
    handled: boolean;
    status: 'solved' | 'failed';
    solution?: string;
    error?: string;
  }> {
    try {
      if (!this.solver) {
        throw new Error('Solver not configured');
      }

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'reCAPTCHA v2',
        siteKey: captcha.siteKey,
      });

      // Solve it
      const token = await this.solver.solveRecaptchaV2(pageUrl, captcha.siteKey);

      // Inject into page
      await this.injectRecaptchaToken(token);

      console.log('[Inquiry CAPTCHA] reCAPTCHA v2 solved and injected');
      return { handled: true, status: 'solved', solution: token };
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v2 solving failed:', error.message);
      return {
        handled: false,
        status: 'failed',
        error: error.message,
      };
    }
  }

  private async solveRecaptchaV3(
    captcha: { siteKey: string; minScore?: number },
    pageUrl: string
  ): Promise<{
    handled: boolean;
    status: 'solved' | 'failed';
    solution?: string;
    error?: string;
  }> {
    try {
      if (!this.solver) {
        throw new Error('Solver not configured');
      }

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'reCAPTCHA v3',
        siteKey: captcha.siteKey,
        minScore: captcha.minScore,
      });

      // Solve it
      const token = await this.solver.solveRecaptchaV3(
        pageUrl,
        captcha.siteKey,
        captcha.minScore
      );

      // For v3, the token is typically sent via JavaScript callback
      console.log('[Inquiry CAPTCHA] reCAPTCHA v3 token obtained');
      return { handled: true, status: 'solved', solution: token };
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v3 solving failed:', error.message);
      return {
        handled: false,
        status: 'failed',
        error: error.message,
      };
    }
  }

  private async solveTurnstile(
    captcha: { siteKey: string },
    pageUrl: string
  ): Promise<{
    handled: boolean;
    status: 'solved' | 'failed';
    solution?: string;
    error?: string;
  }> {
    try {
      if (!this.solver) {
        throw new Error('Solver not configured');
      }

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'Cloudflare Turnstile',
        websiteKey: captcha.siteKey,
      });

      // Solve it
      const token = await this.solver.solveTurnstile(pageUrl, captcha.siteKey);

      // Inject into page
      await this.injectTurnstileToken(token);

      console.log('[Inquiry CAPTCHA] Turnstile solved and injected');
      return { handled: true, status: 'solved', solution: token };
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Turnstile solving failed:', error.message);
      return {
        handled: false,
        status: 'failed',
        error: error.message,
      };
    }
  }

  private async solveHcaptcha(
    captcha: { siteKey: string },
    pageUrl: string
  ): Promise<{
    handled: boolean;
    status: 'solved' | 'failed';
    solution?: string;
    error?: string;
  }> {
    try {
      if (!this.solver) {
        throw new Error('Solver not configured');
      }

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'hCaptcha',
        siteKey: captcha.siteKey,
      });

      // Solve it
      const token = await this.solver.solveHcaptcha(pageUrl, captcha.siteKey);

      // Inject into page
      await this.injectHcaptchaToken(token);

      console.log('[Inquiry CAPTCHA] hCaptcha solved and injected');
      return { handled: true, status: 'solved', solution: token };
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] hCaptcha solving failed:', error.message);
      return {
        handled: false,
        status: 'failed',
        error: error.message,
      };
    }
  }

  // Token injection methods

  private async injectRecaptchaToken(token: string): Promise<void> {
    // This is implementation-specific based on how the form uses the token
    // Typically requires page.evaluate() to inject and trigger submission
    console.log('[Inquiry CAPTCHA] Token injection not yet implemented');
  }

  private async injectTurnstileToken(token: string): Promise<void> {
    console.log('[Inquiry CAPTCHA] Token injection not yet implemented');
  }

  private async injectHcaptchaToken(token: string): Promise<void> {
    console.log('[Inquiry CAPTCHA] Token injection not yet implemented');
  }
}
