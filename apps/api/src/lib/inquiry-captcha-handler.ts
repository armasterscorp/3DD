<<<<<<< HEAD
/**
 * Inquiry Worker - 2Captcha Integration
 * 
 * This file shows how to integrate 2Captcha solving into the inquiry backend worker.
 * Add this logic to your inquiry-backend-worker.ts where form processing occurs.
 */

import { Page } from 'playwright';
import { TwoCaptchaSolver } from './captcha-solver';
import { CaptchaStore } from './captcha-store';

interface CaptchaDetectionResult {
  detected: boolean;
  type?: string;
  siteKey?: string;
  websiteKey?: string;
  action?: string;
  minScore?: number;
}

export class InquiryCaptchaHandler {
  private userId: string;
  private inquiryRunId: string;
  private solver?: TwoCaptchaSolver;

  constructor(userId: string, inquiryRunId: string, solverApiKey?: string) {
    this.userId = userId;
    this.inquiryRunId = inquiryRunId;
    if (solverApiKey) {
      this.solver = new TwoCaptchaSolver(solverApiKey);
    }
  }

  /**
   * Detect CAPTCHA on current page
   */
  async detectCaptcha(page: Page): Promise<CaptchaDetectionResult> {
    try {
      // Check for reCAPTCHA v2 (checkbox)
      if (await page.locator('[data-sitekey]').first().isVisible({ timeout: 2000 })) {
        const siteKey = await page.locator('[data-sitekey]').first().getAttribute('data-sitekey');
        console.log(`[Captcha] Detected reCAPTCHA v2 on ${page.url()}`);
        return {
          detected: true,
          type: 'recaptcha_v2',
          siteKey: siteKey || undefined,
        };
      }

      // Check for reCAPTCHA v3 (invisible, in page context)
      const v3Check = await page.evaluate(() => {
        return (window as any).grecaptcha?.enterprise?.execute !== undefined ||
               (window as any).grecaptcha?.execute !== undefined;
      });
      if (v3Check) {
        console.log(`[Captcha] Detected reCAPTCHA v3 on ${page.url()}`);
        // Try to get sitekey from page source or meta tags
        const siteKey = await page.evaluate(() => {
          return document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') ||
                 (document.querySelector('script[src*="recaptcha"]') as any)?.src?.match(/key=([^&]+)/)?.[1];
        });
        return {
          detected: true,
          type: 'recaptcha_v3',
          siteKey: siteKey || undefined,
          minScore: 0.9,
        };
      }

      // Check for Cloudflare Turnstile
      if (await page.locator('[data-sitekey][data-sitekey*="3x"]').first().isVisible({ timeout: 2000 })) {
        const websiteKey = await page.locator('[data-sitekey]').first().getAttribute('data-sitekey');
        console.log(`[Captcha] Detected Cloudflare Turnstile on ${page.url()}`);
        return {
          detected: true,
          type: 'turnstile',
          websiteKey: websiteKey || undefined,
        };
      }

      // Check for hCaptcha
      if (await page.locator('[data-sitekey][class*="h-captcha"]').first().isVisible({ timeout: 2000 })) {
        const siteKey = await page.locator('[data-sitekey]').first().getAttribute('data-sitekey');
        console.log(`[Captcha] Detected hCaptcha on ${page.url()}`);
        return {
          detected: true,
          type: 'hcaptcha',
          siteKey: siteKey || undefined,
        };
      }

      // Check for image captcha (usually in an img element or canvas)
      if (await page.locator('img[alt*="captcha" i]').first().isVisible({ timeout: 2000 })) {
        console.log(`[Captcha] Detected image captcha on ${page.url()}`);
        return {
          detected: true,
          type: 'image',
        };
      }

      return { detected: false };
    } catch (error: any) {
      console.log(`[Captcha] Detection check completed (no captcha or timeout): ${error.message}`);
      return { detected: false };
    }
  }

  /**
   * Handle CAPTCHA - detect, queue, and solve
   */
  async handleCaptcha(page: Page): Promise<{
    handled: boolean;
    status: 'solved' | 'failed' | 'queued_for_review';
    error?: string;
    token?: string;
  }> {
    try {
      // Check if solver is configured
      if (!this.solver) {
        console.log('[Captcha] No solver configured, queuing for review');
        return {
          handled: false,
          status: 'queued_for_review',
          error: 'No 2Captcha solver configured',
        };
      }

      // Detect CAPTCHA type
      const detection = await this.detectCaptcha(page);
      if (!detection.detected) {
        return {
          handled: false,
          status: 'solved', // No captcha to handle
        };
      }

      // Queue in database
      const queueItem = await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.inquiryRunId,
        targetUrl: page.url(),
        captchaType: detection.type || 'unknown',
        siteKey: detection.siteKey,
        websiteKey: detection.websiteKey,
        minScore: detection.minScore,
        pageAction: detection.action,
      });

      console.log(`[Captcha] Queued: ${queueItem.id} - ${detection.type} on ${page.url()}`);

      // Attempt to solve
      let token: string | undefined;

      try {
        switch (detection.type) {
          case 'recaptcha_v2':
            if (!detection.siteKey) {
              throw new Error('Missing sitekey for reCAPTCHA v2');
            }
            token = await this.solver.solveRecaptchaV2(page.url(), detection.siteKey);
            break;

          case 'recaptcha_v3':
            if (!detection.siteKey) {
              throw new Error('Missing sitekey for reCAPTCHA v3');
            }
            token = await this.solver.solveRecaptchaV3(
              page.url(),
              detection.siteKey,
              detection.minScore || 0.9,
              detection.action
            );
            break;

          case 'turnstile':
            if (!detection.websiteKey) {
              throw new Error('Missing websiteKey for Turnstile');
            }
            token = await this.solver.solveTurnstile(page.url(), detection.websiteKey);
            break;

          case 'hcaptcha':
            if (!detection.siteKey) {
              throw new Error('Missing sitekey for hCaptcha');
            }
            // hCaptcha uses same API as reCAPTCHA v2 but with hCaptchaTaskProxyless
            // You may need to extend the solver to support this
            token = await this.solver.solveRecaptchaV2(page.url(), detection.siteKey);
            break;

          default:
            throw new Error(`Unsupported CAPTCHA type: ${detection.type}`);
        }

        if (!token) {
          throw new Error('Solver returned empty token');
        }

        // Update queue with solution
        await CaptchaStore.updateCaptchaQueue(queueItem.id, {
          status: 'solved',
          solution: token,
          solvedAt: new Date(),
        });

        console.log(`[Captcha] Solved: ${queueItem.id}`);

        // Inject token into page
        await this.injectCaptchaToken(page, detection.type, token);

        return {
          handled: true,
          status: 'solved',
          token,
        };
      } catch (solveError: any) {
        // Update queue with failure
        await CaptchaStore.updateCaptchaQueue(queueItem.id, {
          status: 'failed',
          error: solveError.message,
          attempts: 1,
        });

        console.error(`[Captcha] Failed to solve: ${solveError.message}`);
        return {
          handled: false,
          status: 'failed',
          error: solveError.message,
        };
      }
    } catch (error: any) {
      console.error(`[Captcha] Handler error: ${error.message}`);
      return {
        handled: false,
        status: 'queued_for_review',
=======
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

      // Detect provider-specific widgets before generic reCAPTCHA [data-sitekey]
      // detection. hCaptcha and Turnstile also use data-sitekey and were
      // previously being misclassified as reCAPTCHA v2.
      const turnstile = await this.detectTurnstile(page);
      if (turnstile) {
        console.log('[Inquiry CAPTCHA] Detected Cloudflare Turnstile');
        return await this.solveTurnstile(turnstile, pageUrl);
      }

      const hcaptcha = await this.detectHcaptcha(page);
      if (hcaptcha) {
        console.log('[Inquiry CAPTCHA] Detected hCaptcha');
        return await this.solveHcaptcha(hcaptcha, pageUrl);
      }

      // Detect reCAPTCHA v3 before v2 when an explicit render/action setup is
      // present, then fall back to the normal v2 checkbox/widget detector.
      const recaptchaV3 = await this.detectRecaptchaV3(page);
      if (recaptchaV3) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v3');
        return await this.solveRecaptchaV3(recaptchaV3, pageUrl);
      }

      const recaptchaV2 = await this.detectRecaptchaV2(page);
      if (recaptchaV2) {
        console.log('[Inquiry CAPTCHA] Detected reCAPTCHA v2');
        return await this.solveRecaptchaV2(recaptchaV2, pageUrl);
      }

      console.log('[Inquiry CAPTCHA] No CAPTCHA detected');
      return { handled: false, status: 'not_found' };
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Error:', error.message);
      return {
        handled: false,
        status: 'failed',
>>>>>>> 4fa24fd (Inquiry captcha fixes)
        error: error.message,
      };
    }
  }

  /**
<<<<<<< HEAD
   * Inject CAPTCHA token into page
   */
  private async injectCaptchaToken(
    page: Page,
    type: string | undefined,
    token: string
  ): Promise<void> {
    try {
      switch (type) {
        case 'recaptcha_v2':
          // Inject into hidden textarea
          await page.evaluate((token) => {
            const textarea = document.getElementById('g-recaptcha-response') as any;
            if (textarea) {
              textarea.innerHTML = token;
            }
            // Trigger any change/blur events
            textarea?.dispatchEvent(new Event('change', { bubbles: true }));
            textarea?.dispatchEvent(new Event('blur', { bubbles: true }));
          }, token);
          break;

        case 'recaptcha_v3':
          // reCAPTCHA v3 is injected via callback - execute the callback if found
          await page.evaluate((token) => {
            (window as any).__grecaptcha_callback?.(token);
          }, token);
          break;

        case 'turnstile':
          // Inject into Turnstile callback
          await page.evaluate((token) => {
            (window as any).turnstile?.remove?.();
            (window as any).__turnstile_callback?.(token);
          }, token);
          break;

        case 'hcaptcha':
          // Similar to reCAPTCHA v2
          await page.evaluate((token) => {
            const textarea = document.getElementById('h-captcha-response') as any;
            if (textarea) {
              textarea.innerHTML = token;
            }
            textarea?.dispatchEvent(new Event('change', { bubbles: true }));
          }, token);
          break;
      }

      console.log(`[Captcha] Token injected for ${type}`);
    } catch (error: any) {
      console.error(`[Captcha] Token injection error: ${error.message}`);
      // Continue - token may have been injected despite error
    }
  }

  /**
   * Check if CAPTCHA challenge appears after clicking submit
   * Call this after a form submission to detect if a CAPTCHA appeared
   */
  async checkPostSubmitCaptcha(page: Page, timeout: number = 3000): Promise<CaptchaDetectionResult> {
    try {
      await page.waitForTimeout(500); // Brief wait for page to update
      return await this.detectCaptcha(page);
    } catch (error) {
      return { detected: false };
    }
  }
}

/**
 * Example usage in inquiry-backend-worker.ts:
 * 
 * // Initialize handler
 * const captchaHandler = new InquiryCaptchaHandler(
 *   userId,
 *   runId,
 *   captchaConfig?.apiKey // Optional - only if configured
 * );
 * 
 * // During form processing, before submitting:
 * const captchaResult = await captchaHandler.handleCaptcha(page);
 * 
 * if (!captchaResult.handled) {
 *   if (captchaResult.status === 'failed') {
 *     // CAPTCHA solving failed - queue for review
 *     await queueForReview(target, 'CAPTCHA - solving failed: ' + captchaResult.error);
 *     continue;
 *   } else if (captchaResult.status === 'queued_for_review') {
 *     // No solver configured - queue for review
 *     await queueForReview(target, 'CAPTCHA detected - no solver configured');
 *     continue;
 *   }
 * }
 * 
 * // Continue with form submission
 * await submitForm(page);
 * 
 * // Check if new CAPTCHA appeared after submission
 * const postSubmitCaptcha = await captchaHandler.checkPostSubmitCaptcha(page);
 * if (postSubmitCaptcha.detected) {
 *   const handleResult = await captchaHandler.handleCaptcha(page);
 *   if (!handleResult.handled) {
 *     await queueForReview(target, 'Post-submit CAPTCHA failed to solve');
 *   }
 * }
 */
=======
   * Check for CAPTCHA after form submission
   */
  async checkPostSubmitCaptcha(page: any): Promise<{
    detected: boolean;
    type?: string;
  }> {
    try {
      this.page = page;

      const provider = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script')).map((s: any) => String(s.src || ''));
        const iframes = Array.from(document.querySelectorAll('iframe')).map((f: any) => String(f.src || ''));
        const joined = `${scripts.join(' ')} ${iframes.join(' ')}`.toLowerCase();

        if (
          document.querySelector('.cf-turnstile, [data-cf-turnstile], input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]') ||
          joined.includes('challenges.cloudflare.com') || joined.includes('turnstile')
        ) return 'turnstile';

        if (
          document.querySelector('.h-captcha, [data-hcaptcha-widget-id], input[name="h-captcha-response"], textarea[name="h-captcha-response"]') ||
          joined.includes('hcaptcha.com') || joined.includes('hcaptcha')
        ) return 'hcaptcha';

        if (
          document.querySelector('.g-recaptcha, textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"], #g-recaptcha-response') ||
          joined.includes('google.com/recaptcha') || joined.includes('gstatic.com/recaptcha') ||
          !!(window as any).grecaptcha
        ) return 'recaptcha';

        const body = String(document.body?.innerText || '');
        if (/captcha|human verification|verify (?:that )?you are human|i am not a robot|security check/i.test(body)) {
          return 'unknown';
        }
        return null;
      });

      return {
        detected: !!provider,
        type: provider || undefined,
      };
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
        // Only accept Google reCAPTCHA-specific containers. Generic
        // [data-sitekey] is also used by hCaptcha and Turnstile.
        const container = document.querySelector('.g-recaptcha[data-sitekey], [data-sitekey][data-recaptcha-widget-id]');
        if (container) return container.getAttribute('data-sitekey');

        const iframes = document.querySelectorAll('iframe[src*="google.com/recaptcha"], iframe[src*="gstatic.com/recaptcha"], iframe[src*="recaptcha/api2"]');
        for (const iframe of iframes) {
          const src = iframe.getAttribute('src') || '';
          const match = src.match(/[?&]k=([^&]+)/);
          if (match) return match[1];
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
        const container = document.querySelector('.cf-turnstile[data-sitekey], [data-cf-turnstile][data-sitekey]');
        if (container) return container.getAttribute('data-sitekey');
        const frame = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
        const src = frame?.getAttribute('src') || '';
        const match = src.match(/[?&](?:sitekey|k)=([^&]+)/i);
        return match ? match[1] : null;
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
        const container = document.querySelector('.h-captcha[data-sitekey], [data-hcaptcha-widget-id][data-sitekey]');
        if (container) return container.getAttribute('data-sitekey');

        const frame = document.querySelector('iframe[src*="hcaptcha.com"]');
        const src = frame?.getAttribute('src') || '';
        const match = src.match(/[?&](?:sitekey|k)=([^&]+)/i);
        if (match) return match[1];

        const hasHcaptchaScript = Array.from(document.querySelectorAll('script')).some((script: any) => String(script.src || '').includes('hcaptcha.com'));
        if (hasHcaptchaScript) {
          const generic = document.querySelector('[data-sitekey]');
          return generic?.getAttribute('data-sitekey') || null;
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

      console.log('[Inquiry CAPTCHA] Solving reCAPTCHA v2...');
      const token = await this.solver.solveRecaptchaV2(pageUrl, captcha.siteKey);

      // Inject token
      await this.injectRecaptchaV2Token(token);

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'reCAPTCHA v2',
        siteKey: captcha.siteKey,
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

      console.log('[Inquiry CAPTCHA] Solving reCAPTCHA v3...');
      const token = await this.solver.solveRecaptchaV3(
        pageUrl,
        captcha.siteKey,
        captcha.minScore
      );

      // Inject token for v3
      await this.injectRecaptchaV3Token(token);

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'reCAPTCHA v3',
        siteKey: captcha.siteKey,
        minScore: captcha.minScore,
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

      console.log('[Inquiry CAPTCHA] Solving Cloudflare Turnstile...');
      const token = await this.solver.solveTurnstile(pageUrl, captcha.siteKey);

      // Inject token
      await this.injectTurnstileToken(token);

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'Cloudflare Turnstile',
        websiteKey: captcha.siteKey,
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

      console.log('[Inquiry CAPTCHA] Solving hCaptcha...');
      const token = await this.solver.solveHcaptcha(pageUrl, captcha.siteKey);

      // Inject token
      await this.injectHcaptchaToken(token);

      // Queue the CAPTCHA
      await CaptchaStore.queueCaptcha({
        userId: this.userId,
        inquiryRunId: this.runId,
        targetUrl: pageUrl,
        captchaType: 'hCaptcha',
        siteKey: captcha.siteKey,
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

  private async injectRecaptchaV2Token(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting reCAPTCHA v2 token...');
      await this.page.evaluate((token: string) => {
        // 1. Set the token in the hidden response field
        const responseField = document.getElementById('g-recaptcha-response');
        if (responseField) {
          (responseField as any).value = token;
          responseField.style.display = 'block';
        }

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
      console.log('[Inquiry CAPTCHA] reCAPTCHA v2 token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject reCAPTCHA v2 token:', error.message);
    }
  }

  private async injectRecaptchaV3Token(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting reCAPTCHA v3 token...');
      await this.page.evaluate((token: string) => {
        // 1. Set token in hidden field
        const responseField = document.getElementById('g-recaptcha-response');
        if (responseField) {
          (responseField as any).value = token;
        }

        // 2. Call the callback if it exists
        const callback = (window as any).recaptchaCallback || (window as any).__recaptchaCallback;
        if (typeof callback === 'function') {
          callback(token);
        }
      }, token);
      console.log('[Inquiry CAPTCHA] reCAPTCHA v3 token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject reCAPTCHA v3 token:', error.message);
    }
  }

  private async injectTurnstileToken(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting Turnstile token...');
      await this.page.evaluate((token: string) => {
        // 1. Set token in the hidden input field
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
      console.log('[Inquiry CAPTCHA] Turnstile token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject Turnstile token:', error.message);
    }
  }

  private async injectHcaptchaToken(token: string): Promise<void> {
    try {
      console.log('[Inquiry CAPTCHA] Injecting hCaptcha token...');
      await this.page.evaluate((token: string) => {
        // 1. Set token in hidden field
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
      console.log('[Inquiry CAPTCHA] hCaptcha token injected');
    } catch (error: any) {
      console.error('[Inquiry CAPTCHA] Failed to inject hCaptcha token:', error.message);
    }
  }
}
>>>>>>> 4fa24fd (Inquiry captcha fixes)
