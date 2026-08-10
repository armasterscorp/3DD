/**
 * 2Captcha Store - In-Memory Version (No Database)
 * Stores CAPTCHA queue and configuration in memory
 */

interface CaptchaConfig {
  userId: string;
  apiKey: string;
  isActive: boolean;
  lastTestAt?: Date;
  lastTestStatus?: string;
  testError?: string;
}

interface QueueItem {
  id: string;
  userId: string;
  inquiryRunId: string;
  targetUrl: string;
  captchaType: string;
  status: string;
  siteKey?: string;
  websiteKey?: string;
  minScore?: number;
  pageAction?: string;
  taskId?: string;
  solution?: string;
  error?: string;
  attempts: number;
  cost: number;
  createdAt: Date;
  solvedAt?: Date;
  expiresAt: Date;
}

// In-memory storage
const configStore = new Map<string, CaptchaConfig>();
const queueStore = new Map<string, QueueItem>();
let queueIdCounter = 0;

export class CaptchaStore {
  /**
   * Save or update captcha config for a user
   */
  static async saveCaptchaConfig(
    userId: string,
    apiKey: string
  ): Promise<CaptchaConfig> {
    const config: CaptchaConfig = {
      userId,
      apiKey,
      isActive: true,
      lastTestAt: new Date(),
      lastTestStatus: 'success',
    };
    configStore.set(userId, config);
    console.log(`[CaptchaStore] Config saved for user ${userId}`);
    return config;
  }

  /**
   * Get captcha config for a user
   */
  static async getCaptchaConfig(userId: string): Promise<CaptchaConfig | null> {
    return configStore.get(userId) || null;
  }

  /**
   * Update captcha config test status
   */
  static async updateTestStatus(
    userId: string,
    status: 'success' | 'failed',
    error?: string
  ): Promise<CaptchaConfig | null> {
    const config = configStore.get(userId);
    if (!config) return null;

    config.lastTestAt = new Date();
    config.lastTestStatus = status;
    config.testError = error;

    configStore.set(userId, config);
    console.log(`[CaptchaStore] Test status updated: ${status} for user ${userId}`);
    return config;
  }

  /**
   * Add captcha to queue
   */
  static async queueCaptcha(data: {
    userId: string;
    inquiryRunId: string;
    targetUrl: string;
    captchaType: string;
    siteKey?: string;
    websiteKey?: string;
    minScore?: number;
    pageAction?: string;
  }): Promise<QueueItem> {
    const id = `captcha-${++queueIdCounter}`;
    const item: QueueItem = {
      id,
      userId: data.userId,
      inquiryRunId: data.inquiryRunId,
      targetUrl: data.targetUrl,
      captchaType: data.captchaType,
      siteKey: data.siteKey,
      websiteKey: data.websiteKey,
      minScore: data.minScore,
      pageAction: data.pageAction,
      status: 'pending',
      attempts: 0,
      cost: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    };

    queueStore.set(id, item);
    console.log(`[CaptchaStore] Queued: ${id} - ${data.captchaType}`);
    return item;
  }

  /**
   * Update captcha queue entry
   */
  static async updateCaptchaQueue(
    id: string,
    data: {
      taskId?: string;
      status?: string;
      solution?: string;
      error?: string;
      attempts?: number;
      cost?: number;
      solvedAt?: Date;
    }
  ): Promise<QueueItem | null> {
    const item = queueStore.get(id);
    if (!item) return null;

    if (data.taskId !== undefined) item.taskId = data.taskId;
    if (data.status !== undefined) item.status = data.status;
    if (data.solution !== undefined) item.solution = data.solution;
    if (data.error !== undefined) item.error = data.error;
    if (data.attempts !== undefined) item.attempts = data.attempts;
    if (data.cost !== undefined) item.cost = data.cost;
    if (data.solvedAt !== undefined) item.solvedAt = data.solvedAt;

    queueStore.set(id, item);
    console.log(`[CaptchaStore] Updated: ${id} - status: ${data.status}`);
    return item;
  }

  /**
   * Get captcha queue for user
   */
  static async getUserCaptchaQueue(userId: string): Promise<QueueItem[]> {
    const items = Array.from(queueStore.values()).filter(
      (item) => item.userId === userId
    );
    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get captcha queue by run ID
   */
  static async getRunCaptchaQueue(inquiryRunId: string): Promise<QueueItem[]> {
    const items = Array.from(queueStore.values()).filter(
      (item) => item.inquiryRunId === inquiryRunId
    );
    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get pending captchas for a user
   */
  static async getPendingCaptchas(userId: string): Promise<QueueItem[]> {
    const items = Array.from(queueStore.values()).filter(
      (item) => item.userId === userId && item.status === 'pending'
    );
    return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /**
   * Clear captcha queue for user
   */
  static async clearUserCaptchaQueue(userId: string): Promise<number> {
    let count = 0;
    for (const [key, item] of queueStore.entries()) {
      if (item.userId === userId) {
        queueStore.delete(key);
        count++;
      }
    }
    console.log(`[CaptchaStore] Cleared ${count} items for user ${userId}`);
    return count;
  }

  /**
   * Delete specific captcha from queue
   */
  static async deleteCaptcha(id: string): Promise<boolean> {
    const deleted = queueStore.delete(id);
    if (deleted) {
      console.log(`[CaptchaStore] Deleted: ${id}`);
    }
    return deleted;
  }

  /**
   * Get queue stats for user
   */
  static async getQueueStats(
    userId: string
  ): Promise<{ total: number; pending: number; solving: number; solved: number; failed: number }> {
    const items = Array.from(queueStore.values()).filter(
      (item) => item.userId === userId
    );

    return {
      total: items.length,
      pending: items.filter((i) => i.status === 'pending').length,
      solving: items.filter((i) => i.status === 'solving').length,
      solved: items.filter((i) => i.status === 'solved').length,
      failed: items.filter((i) => i.status === 'failed').length,
    };
  }

  /**
   * Clean up expired entries
   */
  static async cleanupExpiredEntries(): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const [key, item] of queueStore.entries()) {
      if (item.expiresAt < now) {
        queueStore.delete(key);
        count++;
      }
    }
    console.log(`[CaptchaStore] Cleaned up ${count} expired entries`);
    return count;
  }
}
