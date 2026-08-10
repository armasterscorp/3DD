import axios, { AxiosInstance } from 'axios';

export interface CaptchaTaskResult {
  errorId: number;
  errorDescription?: string;
  status: string;
  solution?: {
    gRecaptchaResponse?: string;
    token?: string;
    text?: string;
  };
  cost: string;
  ip: string;
  createTime: number;
  endTime?: number;
  solveCount?: number;
}

export interface CaptchaTaskRequest {
  type: string;
  [key: string]: any;
}

export class TwoCaptchaSolver {
  private apiKey: string;
  private apiUrl = 'https://api.2captcha.com';
  private axiosInstance: AxiosInstance;
  private maxAttempts = 60; // 3 minutes with 3 second intervals
  private pollInterval = 3000; // 3 seconds

  constructor(apiKey: string) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('2Captcha API key is required');
    }
    this.apiKey = apiKey.trim();
    this.axiosInstance = axios.create({
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Solve reCAPTCHA v2 (checkbox or invisible)
   */
  async solveRecaptchaV2(
    websiteUrl: string,
    websiteKey: string,
    isInvisible: boolean = false
  ): Promise<string> {
    console.log(`[2Captcha] Solving reCAPTCHA v2 for ${websiteUrl}`);
    const taskId = await this.createTask({
      type: 'RecaptchaV2TaskProxyless',
      websiteURL: websiteUrl,
      websiteKey,
      isInvisible,
    });

    return this.pollTaskResult(taskId);
  }

  /**
   * Solve reCAPTCHA v3
   */
  async solveRecaptchaV3(
    websiteUrl: string,
    websiteKey: string,
    minScore: number = 0.9,
    pageAction?: string
  ): Promise<string> {
    console.log(`[2Captcha] Solving reCAPTCHA v3 for ${websiteUrl}`);
    const taskId = await this.createTask({
      type: 'RecaptchaV3TaskProxyless',
      websiteURL: websiteUrl,
      websiteKey,
      minScore,
      pageAction,
      isEnterprise: false,
    });

    return this.pollTaskResult(taskId);
  }

  /**
   * Solve Cloudflare Turnstile
   */
  async solveTurnstile(
    websiteUrl: string,
    websiteKey: string,
    data?: string,
    pagedata?: string,
    action?: string
  ): Promise<string> {
    console.log(`[2Captcha] Solving Cloudflare Turnstile for ${websiteUrl}`);
    const taskId = await this.createTask({
      type: 'TurnstileTaskProxyless',
      websiteURL: websiteUrl,
      websiteKey,
      data,
      pagedata,
      action,
    });

    return this.pollTaskResult(taskId);
  }

  /**
   * Solve normal image captcha
   */
  async solveImageCaptcha(
    base64Image: string,
    options?: {
      phrase?: boolean;
      case?: boolean;
      numeric?: number;
      math?: boolean;
      minLength?: number;
      maxLength?: number;
    }
  ): Promise<string> {
    console.log(`[2Captcha] Solving image captcha`);
    const taskId = await this.createTask({
      type: 'ImageToTextTask',
      body: base64Image,
      ...options,
    });

    return this.pollTaskResult(taskId);
  }

  /**
   * Create a task in 2Captcha
   */
  private async createTask(task: CaptchaTaskRequest): Promise<string> {
    try {
      const response = await this.axiosInstance.post<any>(
        `${this.apiUrl}/createTask`,
        {
          clientKey: this.apiKey,
          task,
          languagePool: 'en',
        }
      );

      if (response.data.errorId && response.data.errorId !== 0) {
        const errorMsg = response.data.errorDescription || 'Unknown error';
        console.error(`[2Captcha] Task creation failed: ${errorMsg}`);
        throw new Error(`2Captcha Error ${response.data.errorId}: ${errorMsg}`);
      }

      const taskId = response.data.taskId;
      console.log(`[2Captcha] Task created: ${taskId}`);
      return taskId;
    } catch (error: any) {
      console.error('[2Captcha] Failed to create task:', error.message);
      throw error;
    }
  }

  /**
   * Poll for task result with exponential backoff
   */
  private async pollTaskResult(taskId: string): Promise<string> {
    let attempt = 0;
    let backoffMs = this.pollInterval;

    while (attempt < this.maxAttempts) {
      await this.sleep(backoffMs);

      try {
        const response = await this.axiosInstance.post<CaptchaTaskResult>(
          `${this.apiUrl}/getTaskResult`,
          {
            clientKey: this.apiKey,
            taskId,
          }
        );

        if (response.data.errorId && response.data.errorId !== 0) {
          const errorMsg = response.data.errorDescription || 'Unknown error';
          console.error(`[2Captcha] Task ${taskId} error: ${errorMsg}`);
          throw new Error(`Task error: ${errorMsg}`);
        }

        if (response.data.status === 'ready') {
          const solution =
            response.data.solution?.gRecaptchaResponse ||
            response.data.solution?.token ||
            response.data.solution?.text;

          console.log(`[2Captcha] Task ${taskId} solved in ${attempt + 1} attempts`);
          return solution;
        }

        // Increase backoff for next attempt
        backoffMs = Math.min(backoffMs + 500, 5000);
      } catch (error: any) {
        console.error(`[2Captcha] Poll attempt ${attempt + 1} failed:`, error.message);
        // Continue polling on error
      }

      attempt++;
    }

    const timeoutMsg = `Captcha solving timeout after ${this.maxAttempts} attempts`;
    console.error(`[2Captcha] ${timeoutMsg}`);
    throw new Error(timeoutMsg);
  }

  /**
   * Test API key connectivity
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.axiosInstance.post(
        `${this.apiUrl}/getBalance`,
        {
          clientKey: this.apiKey,
        },
        { timeout: 5000 }
      );

      if (response.data.errorId && response.data.errorId !== 0) {
        return {
          success: false,
          error: response.data.errorDescription || 'Invalid API key',
        };
      }

      console.log(`[2Captcha] Connection successful. Balance: ${response.data.balance}`);
      return { success: true };
    } catch (error: any) {
      const msg = error.message || 'Connection test failed';
      console.error(`[2Captcha] Connection test failed: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Report incorrect solution (request refund)
   */
  async reportIncorrect(taskId: string): Promise<void> {
    try {
      await this.axiosInstance.post(`${this.apiUrl}/reportIncorrect`, {
        clientKey: this.apiKey,
        taskId,
      });
      console.log(`[2Captcha] Reported task ${taskId} as incorrect`);
    } catch (error: any) {
      console.error(`[2Captcha] Failed to report incorrect: ${error.message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
