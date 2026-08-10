import Queue from 'bull';
import { prisma } from '@/lib/prisma';

const redis = {
  host: process.env.REDIS_URL?.split('://')[1]?.split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
};

export const campaignQueue = new Queue('campaign-processing', {
  redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
  },
});

export interface CampaignJobData {
  campaignId: string;
  leadId: string;
  email: string;
  name: string;
  company?: string;
  referenceNumber?: string;
  customFields?: Record<string, any>;
  placeholders: Record<string, string>;
  templatePdfUrl: string;
}

// Log queue events
campaignQueue.on('failed', async (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
  await prisma.campaignLog.create({
    data: {
      campaignId: job.data.campaignId,
      leadId: job.data.leadId,
      action: 'process_failed',
      status: 'error',
      details: err.message,
    },
  });
});

campaignQueue.on('completed', async (job) => {
  console.log(`Job ${job.id} completed`);
  await prisma.campaignLog.create({
    data: {
      campaignId: job.data.campaignId,
      leadId: job.data.leadId,
      action: 'process_completed',
      status: 'success',
    },
  });
});
