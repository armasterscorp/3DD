import { prisma } from '@/lib/prisma';

export class CaptchaStore {
  /**
   * Save or update captcha config for a user
   */
  static async saveCaptchaConfig(
    userId: string,
    apiKey: string
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
  }

  /**
   * Get captcha config for a user
   */
  static async getCaptchaConfig(userId: string): Promise<any | null> {
    return prisma.captchaConfig.findUnique({
      where: { userId },
    });
  }

  /**
   * Update captcha config test status
   */
  static async updateTestStatus(
    userId: string,
    status: 'success' | 'failed',
    error?: string
  ): Promise<any> {
    return prisma.captchaConfig.update({
      where: { userId },
      data: {
        lastTestAt: new Date(),
        lastTestStatus: status,
        testError: error || null,
      },
    });
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
  ): Promise<any> {
    return prisma.captchaQueue.update({
      where: { id },
      data,
    });
  }

  /**
   * Get captcha queue for user
   */
  static async getUserCaptchaQueue(userId: string): Promise<any[]> {
    return prisma.captchaQueue.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get captcha queue by run ID
   */
  static async getRunCaptchaQueue(inquiryRunId: string): Promise<any[]> {
    return prisma.captchaQueue.findMany({
      where: { inquiryRunId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get pending captchas for a user
   */
  static async getPendingCaptchas(userId: string): Promise<any[]> {
    return prisma.captchaQueue.findMany({
      where: {
        userId,
        status: 'pending',
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Clear captcha queue for user
   */
  static async clearUserCaptchaQueue(userId: string): Promise<any> {
    return prisma.captchaQueue.deleteMany({
      where: { userId },
    });
  }

  /**
   * Delete specific captcha from queue
   */
  static async deleteCaptcha(id: string): Promise<any> {
    return prisma.captchaQueue.delete({
      where: { id },
    });
  }

  /**
   * Clean up expired entries
   */
  static async cleanupExpiredEntries(): Promise<any> {
    return prisma.captchaQueue.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }
}
