/**
 * 2Captcha Solver - In-Memory Version (No Database)
 * Uses official 2Captcha API endpoints based on their documentation
 */

import { CaptchaStore } from './captcha-store';
import {
  extractCaptchaProviderError,
  getCaptchaApiKeyFromEnv,
  maskSecret,
} from './inquiry-captcha-utils';

interface SolveResponse {
  success: boolean;
  captchaId?: string;
  error?: string;
}

// In-memory storage for API keys per user
const apiKeyStore = new Map<string, string>();

export class TwoCaptchaSolver {
  private apiKey: string;
  private inUrl = 'https://2captcha.com/in.php'; // Submit captcha
  private resUrl = 'https://2captcha.com/res.php'; // Get result
  private pollInterval = 2000; // 2 seconds
  private maxAttempts = 30; // 1 minute max wait

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Test connection to 2Captcha API
   * A valid API key will either:
   * - Accept a captcha submission (status 1) 
   * - Return an image error (status 0 with ERROR_ZERO_CAPTCHA_FILESIZE) - this proves API key works
   * An invalid API key will:
   * - Return ERROR_INVALID_CAPTCHA_ID or similar authentication error
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('[2Captcha] Testing connection with API key:', maskSecret(this.apiKey));
      
      // Test with a simple text captcha (cheapest and simplest)
      const params = new URLSearchParams();
      params.append('key', this.apiKey);
      params.append('method', 'post');
      params.append('captchafile', 'base64:'); // Empty image
      params.append('json', '1');

      const response = await fetch(this.inUrl, {
        method: 'POST',
        body: params.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const responseText = await response.text();
      console.log('[2Captcha] Test response status:', response.status);
      console.log('[2Captcha] Test response text:', responseText);

      try {
        const data = JSON.parse(responseText);
        console.log('[2Captcha] Test response JSON status:', data?.status);

        // Status 1 = success (captcha was accepted)
        if (data.status === 1) {
          console.log('[2Captcha] ✓ API key is valid - captcha accepted');
          return { success: true };
        }

        // Status 0 with these errors = API key works, just image is invalid
        if (data.status === 0) {
          const errorRequest = data.request || data.error_text || '';
          
          // These errors mean the API key is valid but image is bad
          const validKeyErrors = [
            'ERROR_ZERO_CAPTCHA_FILESIZE',
            'ERROR_CAPTCHA_EMPTY',
            'ERROR_WRONG_FILE_EXTENSION',
            'ERROR_FILE_SIZE_IS_TOO_BIG',
          ];

          if (validKeyErrors.some(err => errorRequest.includes(err))) {
            console.log('[2Captcha] ✓ API key is valid (image validation error is expected)');
            return { success: true };
          }

          // These errors mean API key is INVALID
          const invalidKeyErrors = [
            'ERROR_INVALID_CAPTCHA_ID',
            'ERROR_INVALID_CAPTCHA_ID',
            'ERROR_BAD_CAPTCHA',
            'ERROR_INVALID',
          ];

          if (invalidKeyErrors.some(err => errorRequest.includes(err))) {
            console.log('[2Captcha] ✗ API key is invalid:', errorRequest);
            return { success: false, error: `Invalid API key: ${errorRequest}` };
          }

          // Any other error
          console.log('[2Captcha] ✓ API key appears valid (got:', errorRequest + ')');
          return { success: true };
        }

        // Unexpected status
        return { success: false, error: `Unexpected status: ${data.status}` };
      } catch (parseError) {
        // Handle plain text response
        if (responseText.startsWith('OK')) {
          console.log('[2Captcha] ✓ API key is valid');
          return { success: true };
        }
        if (responseText.startsWith('ERROR')) {
          const error = responseText.substring(6).trim();
          console.log('[2Captcha] ✗ API error:', error);
          return { success: false, error };
        }
        return { success: false, error: `Unknown response: ${responseText}` };
      }
    } catch (error: any) {
      console.error('[2Captcha] Connection test error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  }

  /**
   * Solve reCAPTCHA v2
   */
  async solveRecaptchaV2(pageUrl: string, siteKey: string): Promise<string> {
    console.log(`[2Captcha] Solving reCAPTCHA v2 for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    return await this.pollForSolution(response.captchaId!);
  }

  /**
   * Solve reCAPTCHA v3
   */
  async solveRecaptchaV3(
    pageUrl: string,
    siteKey: string,
    minScore: number = 0.9,
    pageAction?: string
  ): Promise<string> {
    console.log(`[2Captcha] Solving reCAPTCHA v3 for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      version: 'v3',
      action: pageAction || '',
      min_score: minScore,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    return await this.pollForSolution(response.captchaId!);
  }

  /**
   * Solve Cloudflare Turnstile
   */
  async solveTurnstile(pageUrl: string, websiteKey: string): Promise<string> {
    console.log(`[2Captcha] Solving Turnstile for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'turnstile',
      sitekey: websiteKey,
      pageurl: pageUrl,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    return await this.pollForSolution(response.captchaId!);
  }

  /**
   * Solve hCaptcha
   */
  async solveHcaptcha(pageUrl: string, siteKey: string): Promise<string> {
    console.log(`[2Captcha] Solving hCaptcha for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'hcaptcha',
      sitekey: siteKey,
      pageurl: pageUrl,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    return await this.pollForSolution(response.captchaId!);
  }

  /**
   * Solve image CAPTCHA
   */
  async solveImageCaptcha(
    base64Image: string,
    options?: { numeric?: number; minLen?: number; maxLen?: number }
  ): Promise<string> {
    console.log('[2Captcha] Solving image CAPTCHA');

    const response = await this.sendCaptcha({
      method: 'base64',
      captchafile: base64Image,
      ...options,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    return await this.pollForSolution(response.captchaId!);
  }

  /**
   * Send captcha to 2Captcha using their official API
   */
  private async sendCaptcha(params: Record<string, any>): Promise<SolveResponse> {
    try {
      const searchParams = new URLSearchParams();
      searchParams.append('key', this.apiKey);
      searchParams.append('json', '1'); // Request JSON response

      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      }

      console.log('[2Captcha] Sending to:', this.inUrl);
      const response = await fetch(this.inUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: searchParams.toString(),
      });

      const responseText = await response.text();
      console.log('[2Captcha] Response status:', response.status);
      console.log('[2Captcha] Response body:', responseText.substring(0, 200));

      // Parse JSON response
      try {
        const data = JSON.parse(responseText);

        if (data.status === 1) {
          return { success: true, captchaId: data.request };
        }

        if (data.status === 0) {
          return {
            success: false,
            error: extractCaptchaProviderError(data, 'Unknown error'),
          };
        }

        return { success: false, error: 'Invalid response status' };
      } catch (parseError) {
        // Handle plain text response
        if (responseText.startsWith('OK')) {
          const parts = responseText.split('|');
          if (parts[1]) {
            return { success: true, captchaId: parts[1] };
          }
        }
        if (responseText.startsWith('ERROR')) {
          return { success: false, error: responseText.substring(6).trim() };
        }
        return { success: false, error: `Invalid response: ${responseText}` };
      }
    } catch (error: any) {
      console.error('[2Captcha] Send error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  }

  /**
   * Poll for solution
   */
  private async pollForSolution(captchaId: string): Promise<string> {
    let attempts = 0;

    while (attempts < this.maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
      attempts++;

      try {
        const params = new URLSearchParams();
        params.append('key', this.apiKey);
        params.append('action', 'get');
        params.append('id', captchaId);
        params.append('json', '1');

        const response = await fetch(`${this.resUrl}?${params.toString()}`);
        const responseText = await response.text();

        console.log('[2Captcha] Poll attempt', attempts, '- response:', responseText.substring(0, 100));

        // Try JSON
        try {
          const data = JSON.parse(responseText);

          if (data.status === 1) {
            console.log(`[2Captcha] Solution received for captcha ${captchaId}`);
            return data.request;
          }

          if (data.status === 0 && data.request === 'CAPCHA_NOT_READY') {
            continue;
          }

          if (data.status === 0) {
            throw new Error(
              extractCaptchaProviderError(data, 'Solution not available')
            );
          }
        } catch (parseError) {
          // Handle plain text response
          if (responseText.startsWith('OK')) {
            const parts = responseText.split('|');
            if (parts[1]) {
              console.log(`[2Captcha] Solution received for captcha ${captchaId}`);
              return parts[1];
            }
          }
          if (responseText === 'CAPCHA_NOT_READY') {
            continue;
          }
          if (responseText.startsWith('ERROR')) {
            throw new Error(responseText.substring(6).trim());
          }
        }
      } catch (error: any) {
        console.error('[2Captcha] Poll error:', error.message);
        continue;
      }
    }

    throw new Error('Captcha solving timeout');
  }

  /**
   * Report incorrect solution
   */
  async reportIncorrect(captchaId: string): Promise<boolean> {
    try {
      const params = new URLSearchParams();
      params.append('key', this.apiKey);
      params.append('action', 'report');
      params.append('id', captchaId);
      params.append('json', '1');

      const response = await fetch(`${this.resUrl}?${params.toString()}`);
      const responseText = await response.text();

      try {
        const data = JSON.parse(responseText);
        return data.status === 1;
      } catch {
        return responseText.startsWith('OK');
      }
    } catch (error) {
      return false;
    }
  }
}

/**
 * Store API key in memory for a user
 */
export function setUserApiKey(userId: string, apiKey: string): void {
  const value = apiKey.trim();
  if (!value) {
    apiKeyStore.delete(userId);
    return;
  }
  apiKeyStore.set(userId, value);
  console.log(`[2Captcha] API key stored for user ${userId}`);
}

/**
 * Get stored API key for a user
 */
export function getUserApiKey(userId: string): string | null {
  return apiKeyStore.get(userId) || getCaptchaApiKeyFromEnv();
}

export async function resolveUserApiKey(userId: string): Promise<string | null> {
  const direct = apiKeyStore.get(userId);
  if (direct) return direct;

  const config = await CaptchaStore.getCaptchaConfig(userId);
  const stored = String(config?.apiKey || '').trim();
  if (stored && config?.isActive !== false) {
    apiKeyStore.set(userId, stored);
    return stored;
  }

  return getCaptchaApiKeyFromEnv();
}

/**
 * Clear API key for a user
 */
export function clearUserApiKey(userId: string): void {
  apiKeyStore.delete(userId);
  console.log(`[2Captcha] API key cleared for user ${userId}`);
}
