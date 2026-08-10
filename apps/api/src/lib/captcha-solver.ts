/**
 * 2Captcha Solver - In-Memory Version (No Database)
 * Stores API key in memory during the session
 */

interface SolveResponse {
  success: boolean;
  captchaId?: string;
  error?: string;
}

interface SolutionResponse {
  success: boolean;
  solution?: string;
  error?: string;
}

// In-memory storage for API keys per user
const apiKeyStore = new Map<string, string>();

export class TwoCaptchaSolver {
  private apiKey: string;
  private baseUrl = 'https://2captcha.com/api';
  private pollInterval = 2000; // 2 seconds
  private maxAttempts = 30; // 1 minute max wait

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Test connection to 2Captcha API
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `apikey=${this.apiKey}&json=1`,
      });

      const data = await response.json();

      if (data.status === 255) {
        return { success: false, error: 'Invalid API key' };
      }

      if (data.status === 0) {
        return { success: false, error: data.error || 'API error' };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Solve reCAPTCHA v2
   */
  async solveRecaptchaV2(pageUrl: string, siteKey: string): Promise<string> {
    console.log(`[2Captcha] Solving reCAPTCHA v2 for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'post',
      captchafile: 'base64:',
      pageurl: pageUrl,
      googlekey: siteKey,
      json: 1,
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
      method: 'post',
      captchafile: 'base64:',
      pageurl: pageUrl,
      googlekey: siteKey,
      version: 'v3',
      action: pageAction || '',
      min_score: minScore,
      json: 1,
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
      method: 'post',
      captchafile: 'base64:',
      pageurl: pageUrl,
      key: websiteKey,
      type: 4,
      json: 1,
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
      method: 'post',
      captchafile: 'base64:',
      pageurl: pageUrl,
      sitekey: siteKey,
      type: 7,
      json: 1,
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
      method: 'post',
      captchafile: base64Image,
      json: 1,
      ...options,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    return await this.pollForSolution(response.captchaId!);
  }

  /**
   * Send captcha to 2Captcha
   */
  private async sendCaptcha(params: Record<string, any>): Promise<SolveResponse> {
    try {
      const searchParams = new URLSearchParams();
      searchParams.append('apikey', this.apiKey);

      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      }

      const response = await fetch(`${this.baseUrl}/captcha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: searchParams.toString(),
      });

      const data = await response.json();

      if (data.status === 1) {
        return { success: true, captchaId: data.captcha };
      }

      return { success: false, error: data.error || 'Unknown error' };
    } catch (error: any) {
      return { success: false, error: error.message };
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
        const response = await fetch(
          `${this.baseUrl}/result?apikey=${this.apiKey}&captcha=${captchaId}&json=1`
        );
        const data = await response.json();

        if (data.status === 1) {
          console.log(`[2Captcha] Solution received for captcha ${captchaId}`);
          return data.request;
        }

        if (data.status === 0 && data.request === 'CAPCHA_NOT_READY') {
          continue;
        }

        if (data.status === 0) {
          throw new Error(data.error || 'Solution not available');
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
      const response = await fetch(
        `${this.baseUrl}/report?apikey=${this.apiKey}&captcha=${captchaId}&action=report&json=1`
      );
      const data = await response.json();
      return data.status === 1;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Store API key in memory for a user
 */
export function setUserApiKey(userId: string, apiKey: string): void {
  apiKeyStore.set(userId, apiKey);
  console.log(`[2Captcha] API key stored for user ${userId}`);
}

/**
 * Get stored API key for a user
 */
export function getUserApiKey(userId: string): string | null {
  return apiKeyStore.get(userId) || null;
}

/**
 * Clear API key for a user
 */
export function clearUserApiKey(userId: string): void {
  apiKeyStore.delete(userId);
  console.log(`[2Captcha] API key cleared for user ${userId}`);
}
