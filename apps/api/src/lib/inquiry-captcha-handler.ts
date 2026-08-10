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
  private page: any;

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
    this.page = page;

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
      this.page = page;

      // Check for Turnstile
      const hasTurnstile = await page.evaluate(
        () => !!(window as any).turnstile && document.querySelector('.cf-turnstile')
      );
      if (hasTurnstile) {
        return { detected: true, type: 'turnstile' };
      }

      // Check for reCAPTCHA
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
        // Check for data-sitekey attribute
        const container = document.querySelector('[data-sitekey]');
        if (container && !document.querySelector('[data-sitekey][data-callback]')) {
          // Not v3 (v3 has data-callback)
          return container.getAttribute('data-sitekey');
        }

        // Check iframe method
        const iframes = document.querySelectorAll('iframe[src*="recaptcha"]');
        if (iframes.length > 0) {
          for (const iframe of iframes) {
            const src = iframe.getAttribute('src') || '';
            if (!src.includes('v3')) {
              const match = src.match(/k=([^&]+)/);
              if (match) return match[1];
            }
          }
        }

        return null;
      });

      return siteKey ? { siteKey } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v2 detection error:', error);
      return null;
    }
  }

  private async detectRecaptchaV3(
    page: any
  ): Promise<{ siteKey: string; minScore?: number } | null> {
    try {
      const result = await page.evaluate(() => {
        // Check for data-sitekey with data-callback (v3 indicator)
        const container = document.querySelector('[data-sitekey][data-callback]');
        if (container) {
          return container.getAttribute('data-sitekey');
        }

        // Check script src for v3
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const src = script.src || '';
          if (src.includes('recaptcha') && src.includes('render=')) {
            const match = src.match(/render=([^&]+)/);
            if (match) return match[1];
          }
        }

        return null;
      });

      return result ? { siteKey: result, minScore: 0.9 } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] reCAPTCHA v3 detection error:', error);
      return null;
    }
  }

  private async detectTurnstile(
    page: any
  ): Promise<{ siteKey: string } | null> {
    try {
      const siteKey = await page.evaluate(() => {
        const container = document.querySelector('.cf-turnstile');
        return container?.getAttribute('data-sitekey') || null;
      });

      return siteKey ? { siteKey } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] Turnstile detection error:', error);
      return null;
    }
  }

  private async detectHcaptcha(
    page: any
  ): Promise<{ siteKey: string } | null> {
    try {
      const siteKey = await page.evaluate(() => {
        const container = document.querySelector('[data-sitekey]');
        if (container) {
          const src = (container.parentElement?.querySelector('script') as any)?.src || '';
          if (src.includes('hcaptcha')) {
            return container.getAttribute('data-sitekey');
          }
        }
        return null;
      });

      return siteKey ? { siteKey } : null;
    } catch (error) {
      console.error('[Inquiry CAPTCHA] hCaptcha detection error:', error);
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

      const queued = await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'reCAPTCHA v2',
        siteKey: captcha.siteKey,
      });
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solving',
        attempts: 1,
      });

      console.log('[Inquiry CAPTCHA] Solving reCAPTCHA v2...');
      const token = await this.solver.solveRecaptchaV2(pageUrl, captcha.siteKey);

      // Inject token
      await this.injectRecaptchaV2Token(token);
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solved',
        solvedAt: new Date(),
        attempts: 1,
      });

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

      const queued = await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'reCAPTCHA v3',
        siteKey: captcha.siteKey,
        minScore: captcha.minScore,
      });
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solving',
        attempts: 1,
      });

      console.log('[Inquiry CAPTCHA] Solving reCAPTCHA v3...');
      const token = await this.solver.solveRecaptchaV3(
        pageUrl,
        captcha.siteKey,
        captcha.minScore
      );

      // Inject token for v3
      await this.injectRecaptchaV3Token(token);
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solved',
        solvedAt: new Date(),
        attempts: 1,
      });

      console.log('[Inquiry CAPTCHA] reCAPTCHA v3 solved and injected');
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

      const queued = await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'Cloudflare Turnstile',
        websiteKey: captcha.siteKey,
      });
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solving',
        attempts: 1,
      });

      console.log('[Inquiry CAPTCHA] Solving Cloudflare Turnstile...');
      const token = await this.solver.solveTurnstile(pageUrl, captcha.siteKey);

      // Inject token
      await this.injectTurnstileToken(token);
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solved',
        solvedAt: new Date(),
        attempts: 1,
      });

      console.log('[Inquiry CAPTCHA] Cloudflare Turnstile solved and injected');
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

      const queued = await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'hCaptcha',
        siteKey: captcha.siteKey,
      });
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solving',
        attempts: 1,
      });

      console.log('[Inquiry CAPTCHA] Solving hCaptcha...');
      const token = await this.solver.solveHcaptcha(pageUrl, captcha.siteKey);

      // Inject token
      await this.injectHcaptchaToken(token);
      await CaptchaStore.updateCaptchaQueue(queued.id, {
        status: 'solved',
        solvedAt: new Date(),
        attempts: 1,
      });

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

  // Token injection methods - Based on 2Captcha documentation

  private async markCaptchaSolved(provider: string): Promise<void> {
    try {
      await this.page.evaluate((provider: string) => {
        document.documentElement.setAttribute(
          'data-3d-suite-captcha-solved-at',
          String(Date.now())
        );
        document.documentElement.setAttribute(
          'data-3d-suite-captcha-provider',
          provider
        );
        document.body.setAttribute(
          'data-3d-suite-captcha-solved-at',
          String(Date.now())
        );
      }, provider);
    } catch {}
  }

  private async ensureResponseField(
    selectors: string[],
    name: string,
    token: string
  ): Promise<void> {
    await this.page.evaluate(
      (args: { selectors: string[]; name: string; token: string }) => {
        const dispatchUpdates = (node: HTMLInputElement | HTMLTextAreaElement) => {
          node.value = args.token;
          node.textContent = args.token;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
          node.dispatchEvent(new Event('blur', { bubbles: true }));
        };

        for (const selector of args.selectors) {
          const existing = document.querySelector(
            selector
          ) as HTMLInputElement | HTMLTextAreaElement | null;
          if (existing) {
            dispatchUpdates(existing);
            return;
          }
        }

        const created = document.createElement('textarea');
        created.name = args.name;
        if (args.name === 'g-recaptcha-response') created.id = 'g-recaptcha-response';
        created.style.display = 'none';
        dispatchUpdates(created);
        const form = document.querySelector('form') || document.body;
        form.appendChild(created);
      },
      { selectors, name, token }
    );
  }

  private async injectRecaptchaV2Token(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting reCAPTCHA v2 token...');
      await this.ensureResponseField(
        [
          '#g-recaptcha-response',
          'textarea[name="g-recaptcha-response"]',
          'input[name="g-recaptcha-response"]',
        ],
        'g-recaptcha-response',
        token
      );
      await this.page.evaluate((token: string) => {
        const responseField = document.getElementById('g-recaptcha-response');
        if (responseField) responseField.style.display = 'block';

        // 2. Call the callback function if it exists
        if (typeof (window as any).recaptchaCallback === 'function') {
          (window as any).recaptchaCallback(token);
        }

        // 3. Alternative: Call grecaptcha callback
        if ((window as any).grecaptcha) {
          try {
            (window as any).grecaptcha?.callback?.(token);
          } catch (e) {
            console.log('No grecaptcha callback');
          }
        }
      }, token);
      await this.markCaptchaSolved('recaptcha');
      console.log('[Inquiry CAPTCHA] reCAPTCHA v2 token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject reCAPTCHA v2 token:', error.message);
    }
  }

  private async injectRecaptchaV3Token(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting reCAPTCHA v3 token...');
      await this.ensureResponseField(
        [
          '#g-recaptcha-response',
          'textarea[name="g-recaptcha-response"]',
          'input[name="g-recaptcha-response"]',
        ],
        'g-recaptcha-response',
        token
      );
      await this.page.evaluate((token: string) => {
        const responseField = document.getElementById('g-recaptcha-response');
        if (responseField) (responseField as any).value = token;
        const callback = (window as any).recaptchaCallback || (window as any).__recaptchaCallback;
        if (typeof callback === 'function') {
          callback(token);
        }
      }, token);
      await this.markCaptchaSolved('recaptcha');
      console.log('[Inquiry CAPTCHA] reCAPTCHA v3 token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject reCAPTCHA v3 token:', error.message);
    }
  }

  private async injectTurnstileToken(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting Turnstile token...');
      await this.ensureResponseField(
        [
          'input[name="cf-turnstile-response"]',
          'textarea[name="cf-turnstile-response"]',
          'input[name="g-recaptcha-response"]',
          'textarea[name="g-recaptcha-response"]',
        ],
        'cf-turnstile-response',
        token
      );
      await this.page.evaluate((token: string) => {
        let tokenField = document.querySelector(
          'input[name="cf-turnstile-response"]'
        ) as any;
        if (!tokenField) {
          tokenField = document.querySelector(
            'input[name="g-recaptcha-response"]'
          ) as any;
        }
        if (tokenField) {
          tokenField.value = token;
          tokenField.style.display = 'block';
        }

        // 2. Call the Turnstile callback if it exists
        if (typeof (window as any).turnstileCallback === 'function') {
          (window as any).turnstileCallback(token);
        }

        // 3. Alternative callback names
        if (typeof (window as any).__turnstileCallback === 'function') {
          (window as any).__turnstileCallback(token);
        }
      }, token);
      await this.markCaptchaSolved('turnstile');
      console.log('[Inquiry CAPTCHA] Turnstile token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject Turnstile token:', error.message);
    }
  }

  private async injectHcaptchaToken(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting hCaptcha token...');
      await this.ensureResponseField(
        [
          'textarea[name="h-captcha-response"]',
          'input[name="h-captcha-response"]',
        ],
        'h-captcha-response',
        token
      );
      await this.page.evaluate((token: string) => {
        const responseField = document.querySelector(
          'textarea[name="h-captcha-response"]'
        ) as any;
        if (responseField) {
          responseField.value = token;
          responseField.style.display = 'block';
        }

        // Alternative response field name
        const altField = document.querySelector(
          'input[name="h-captcha-response"]'
        ) as any;
        if (altField) {
          altField.value = token;
        }

        // 2. Call the callback if it exists
        if (typeof (window as any).hcaptchaCallback === 'function') {
          (window as any).hcaptchaCallback(token);
        }

        // 3. Call hcaptcha.getResponse()
        if ((window as any).hcaptcha?.getResponse) {
          try {
            (window as any).hcaptcha.getResponse = () => token;
          } catch (e) {
            console.log('Could not set hcaptcha.getResponse()');
          }
        }
      }, token);
      await this.markCaptchaSolved('hcaptcha');
      console.log('[Inquiry CAPTCHA] hCaptcha token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject hCaptcha token:', error.message);
    }
  }
}
