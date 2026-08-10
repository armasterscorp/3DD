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
        error: error.message,
      };
    }
  }

  /**
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
