<<<<<<< HEAD
import { prisma } from '@/lib/prisma';
=======
import fs from 'node:fs';
import path from 'node:path';

/**
 * 2Captcha Store. Configuration is persisted per license so the dashboard
 * test route and Inquiry worker always read the same API key, even across
 * Next.js route workers/restarts. CAPTCHA queue remains runtime-local.
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

const dataDir = path.join(process.cwd(), '.3dsuite-data');
const configFile = path.join(dataDir, 'captcha-config.json');

type PersistedCaptchaConfig = Omit<CaptchaConfig, 'lastTestAt'> & { lastTestAt?: string };

function readConfigs(): Record<string, PersistedCaptchaConfig> {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfigs(configs: Record<string, PersistedCaptchaConfig>): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const temp = `${configFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(configs, null, 2), 'utf8');
  fs.renameSync(temp, configFile);
}

function toRuntimeConfig(config: PersistedCaptchaConfig | undefined): CaptchaConfig | null {
  if (!config) return null;
  return {
    ...config,
    lastTestAt: config.lastTestAt ? new Date(config.lastTestAt) : undefined,
  };
}

const configStore = new Map<string, CaptchaConfig>();
const queueStore = new Map<string, QueueItem>();
let queueIdCounter = 0;
>>>>>>> 4fa24fd (Inquiry captcha fixes)

export class CaptchaStore {
  /**
   * Save or update captcha config for a user
   */
  static async saveCaptchaConfig(
    userId: string,
    apiKey: string
<<<<<<< HEAD
  ): Promise<any> {
    return prisma.captchaConfig.upsert({
      where: { userId },
      update: {
        apiKey,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        apiKey,
        isActive: true,
      },
    });
=======
  ): Promise<CaptchaConfig> {
    const config: CaptchaConfig = {
      userId,
      apiKey,
      isActive: true,
      lastTestAt: new Date(),
      lastTestStatus: 'success',
    };
    configStore.set(userId, config);
    const configs = readConfigs();
    configs[userId] = { ...config, lastTestAt: config.lastTestAt?.toISOString() };
    writeConfigs(configs);
    console.log(`[CaptchaStore] Config saved for user ${userId}`);
    return config;
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Get captcha config for a user
   */
<<<<<<< HEAD
  static async getCaptchaConfig(userId: string): Promise<any | null> {
    return prisma.captchaConfig.findUnique({
      where: { userId },
    });
=======
  static async getCaptchaConfig(userId: string): Promise<CaptchaConfig | null> {
    const persisted = toRuntimeConfig(readConfigs()[userId]);
    if (persisted) {
      configStore.set(userId, persisted);
      return persisted;
    }
    return configStore.get(userId) || null;
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Update captcha config test status
   */
  static async updateTestStatus(
    userId: string,
    status: 'success' | 'failed',
    error?: string
<<<<<<< HEAD
  ): Promise<any> {
    return prisma.captchaConfig.update({
      where: { userId },
      data: {
        lastTestAt: new Date(),
        lastTestStatus: status,
        testError: error || null,
      },
    });
=======
  ): Promise<CaptchaConfig | null> {
    const config = await this.getCaptchaConfig(userId);
    if (!config) return null;

    config.lastTestAt = new Date();
    config.lastTestStatus = status;
    config.testError = error;

    configStore.set(userId, config);
    const configs = readConfigs();
    configs[userId] = { ...config, lastTestAt: config.lastTestAt?.toISOString() };
    writeConfigs(configs);
    console.log(`[CaptchaStore] Test status updated: ${status} for user ${userId}`);
    return config;
>>>>>>> 4fa24fd (Inquiry captcha fixes)
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
<<<<<<< HEAD
  }): Promise<any> {
    return prisma.captchaQueue.create({
      data: {
        userId: data.userId,
        inquiryRunId: data.inquiryRunId,
        targetUrl: data.targetUrl,
        captchaType: data.captchaType,
        siteKey: data.siteKey,
        websiteKey: data.websiteKey,
        minScore: data.minScore,
        pageAction: data.pageAction,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
=======
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
>>>>>>> 4fa24fd (Inquiry captcha fixes)
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
<<<<<<< HEAD
  ): Promise<any> {
    return prisma.captchaQueue.update({
      where: { id },
      data,
    });
=======
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
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Get captcha queue for user
   */
<<<<<<< HEAD
  static async getUserCaptchaQueue(userId: string): Promise<any[]> {
    return prisma.captchaQueue.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
=======
  static async getUserCaptchaQueue(userId: string): Promise<QueueItem[]> {
    const items = Array.from(queueStore.values()).filter(
      (item) => item.userId === userId
    );
    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Get captcha queue by run ID
   */
<<<<<<< HEAD
  static async getRunCaptchaQueue(inquiryRunId: string): Promise<any[]> {
    return prisma.captchaQueue.findMany({
      where: { inquiryRunId },
      orderBy: { createdAt: 'desc' },
    });
=======
  static async getRunCaptchaQueue(inquiryRunId: string): Promise<QueueItem[]> {
    const items = Array.from(queueStore.values()).filter(
      (item) => item.inquiryRunId === inquiryRunId
    );
    return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Get pending captchas for a user
   */
<<<<<<< HEAD
  static async getPendingCaptchas(userId: string): Promise<any[]> {
    return prisma.captchaQueue.findMany({
      where: {
        userId,
        status: 'pending',
      },
      orderBy: { createdAt: 'asc' },
    });
=======
  static async getPendingCaptchas(userId: string): Promise<QueueItem[]> {
    const items = Array.from(queueStore.values()).filter(
      (item) => item.userId === userId && item.status === 'pending'
    );
    return items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Clear captcha queue for user
   */
<<<<<<< HEAD
  static async clearUserCaptchaQueue(userId: string): Promise<any> {
    return prisma.captchaQueue.deleteMany({
      where: { userId },
    });
=======
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
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Delete specific captcha from queue
   */
<<<<<<< HEAD
  static async deleteCaptcha(id: string): Promise<any> {
    return prisma.captchaQueue.delete({
      where: { id },
    });
=======
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
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }

  /**
   * Clean up expired entries
   */
<<<<<<< HEAD
  static async cleanupExpiredEntries(): Promise<any> {
    return prisma.captchaQueue.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
=======
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
>>>>>>> 4fa24fd (Inquiry captcha fixes)
  }
}
