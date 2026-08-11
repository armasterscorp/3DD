/**
 * 2Captcha Solver - In-Memory Version (No Database)
 * Uses official 2Captcha API endpoints based on their documentation
 */

interface SolveResponse {
  success: boolean;
  captchaId?: string;
  error?: string;
}

/** Thrown when the local poll-attempt limit is reached. */
export class CaptchaSolverTimeoutError extends Error {
  public readonly code = 'captcha_solver_timeout' as const;
  constructor(captchaId?: string) {
    super(`Captcha solving timeout${captchaId ? ` (provider id: ${captchaId})` : ''}`);
    this.name = 'CaptchaSolverTimeoutError';
  }
}

/** Thrown when an AbortSignal fires while polling. */
export class CaptchaCancelledError extends Error {
  public readonly code = 'captcha_cancelled' as const;
  constructor(reason?: string) {
    super(`Captcha solve cancelled${reason ? `: ${reason}` : ''}`);
    this.name = 'CaptchaCancelledError';
  }
}

/** Options accepted by the public solve methods and pollForSolution. */
export interface CaptchaSolveOptions {
  /** Abort signal; when aborted the poll loop stops and CaptchaCancelledError is thrown. */
  signal?: AbortSignal;
  /**
   * Called once with the provider-assigned captcha ID immediately after the
   * in.php call succeeds.  Use it to update a job-registry entry.
   */
  onCaptchaId?: (id: string) => void;
  /**
   * Called on every poll tick so the caller can update `lastPollAt`.
   */
  onPollTick?: () => void;
  /** Structured context included in every log line for this job. */
  logContext?: { jobKey?: string; runId?: string; itemId?: string; attemptId?: string };
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
      console.log('[2Captcha] Testing connection with API key:', this.apiKey.substring(0, 10) + '...');
      
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
        console.log('[2Captcha] Test response JSON:', data);

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
   * Solve reCAPTCHA v2 (standard or enterprise)
   */
  async solveRecaptchaV2(pageUrl: string, siteKey: string, isEnterprise = false, options?: CaptchaSolveOptions): Promise<string> {
    console.log(`[2Captcha] Solving reCAPTCHA v2${isEnterprise ? ' Enterprise' : ''} for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      ...(isEnterprise ? { enterprise: 1 } : {}),
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    options?.onCaptchaId?.(response.captchaId!);
    return await this.pollForSolution(response.captchaId!, options);
  }

  /**
   * Solve reCAPTCHA v3 (standard or enterprise)
   */
  async solveRecaptchaV3(
    pageUrl: string,
    siteKey: string,
    minScore: number = 0.9,
    pageAction?: string,
    isEnterprise = false,
    options?: CaptchaSolveOptions
  ): Promise<string> {
    console.log(`[2Captcha] Solving reCAPTCHA v3${isEnterprise ? ' Enterprise' : ''} for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      version: 'v3',
      action: pageAction || '',
      min_score: minScore,
      ...(isEnterprise ? { enterprise: 1 } : {}),
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    options?.onCaptchaId?.(response.captchaId!);
    return await this.pollForSolution(response.captchaId!, options);
  }

  /**
   * Solve Cloudflare Turnstile
   */
  async solveTurnstile(pageUrl: string, websiteKey: string, options?: CaptchaSolveOptions): Promise<string> {
    console.log(`[2Captcha] Solving Turnstile for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'turnstile',
      sitekey: websiteKey,
      pageurl: pageUrl,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    options?.onCaptchaId?.(response.captchaId!);
    return await this.pollForSolution(response.captchaId!, options);
  }

  /**
   * Solve hCaptcha
   */
  async solveHcaptcha(pageUrl: string, siteKey: string, options?: CaptchaSolveOptions): Promise<string> {
    console.log(`[2Captcha] Solving hCaptcha for ${pageUrl}`);

    const response = await this.sendCaptcha({
      method: 'hcaptcha',
      sitekey: siteKey,
      pageurl: pageUrl,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to submit captcha');
    }

    options?.onCaptchaId?.(response.captchaId!);
    return await this.pollForSolution(response.captchaId!, options);
  }

  /**
   * Solve image CAPTCHA
   */
  async solveImageCaptcha(
    base64Image: string,
    options?: { numeric?: number; minLen?: number; maxLen?: number },
    solveOptions?: CaptchaSolveOptions
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

    solveOptions?.onCaptchaId?.(response.captchaId!);
    return await this.pollForSolution(response.captchaId!, solveOptions);
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
          return { success: false, error: data.error || 'Unknown error' };
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
   * Poll for solution — abortable, with throttled logging (every 4 polls).
   *
   * Throws CaptchaSolverTimeoutError when maxAttempts is reached.
   * Throws CaptchaCancelledError when the AbortSignal fires.
   */
  private async pollForSolution(captchaId: string, options?: CaptchaSolveOptions): Promise<string> {
    const { signal, onPollTick, logContext } = options ?? {};
    const ctxTag = logContext
      ? ` [runId=${logContext.runId ?? '?'} item=${logContext.itemId ?? '?'} attempt=${logContext.attemptId ?? '?'} job=${logContext.jobKey ?? captchaId}]`
      : ` [captchaId=${captchaId}]`;

    let attempts = 0;

    while (attempts < this.maxAttempts) {
      // Check abort signal before each sleep.
      if (signal?.aborted) {
        throw new CaptchaCancelledError(String(signal.reason ?? 'aborted'));
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));

      // Check again after the sleep (the signal may have fired during the wait).
      if (signal?.aborted) {
        throw new CaptchaCancelledError(String(signal.reason ?? 'aborted'));
      }

      attempts++;
      onPollTick?.();

      // Log every 4th poll attempt and on the first one.
      const shouldLog = attempts === 1 || attempts % 4 === 0;

      try {
        const params = new URLSearchParams();
        params.append('key', this.apiKey);
        params.append('action', 'get');
        params.append('id', captchaId);
        params.append('json', '1');

        const response = await fetch(`${this.resUrl}?${params.toString()}`);
        const responseText = await response.text();

        if (shouldLog) {
          console.log(`[2Captcha] Poll attempt ${attempts}/${this.maxAttempts}${ctxTag} — ${responseText.substring(0, 80)}`);
        }

        // Try JSON
        try {
          const data = JSON.parse(responseText);

          if (data.status === 1) {
            console.log(`[2Captcha] Solution received${ctxTag}`);
            return data.request;
          }

          if (data.status === 0 && data.request === 'CAPCHA_NOT_READY') {
            continue;
          }

          if (data.status === 0) {
            throw new Error(data.error || 'Solution not available');
          }
        } catch (parseError) {
          // Handle plain text response
          if (responseText.startsWith('OK')) {
            const parts = responseText.split('|');
            if (parts[1]) {
              console.log(`[2Captcha] Solution received${ctxTag}`);
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
        // Re-throw typed errors without wrapping.
        if (error instanceof CaptchaCancelledError || error instanceof CaptchaSolverTimeoutError) throw error;
        if (shouldLog) console.error('[2Captcha] Poll error', ctxTag, error.message);
        continue;
      }
    }

    throw new CaptchaSolverTimeoutError(captchaId);
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
