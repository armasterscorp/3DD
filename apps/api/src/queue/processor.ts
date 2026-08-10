import Queue from 'bull';
import { prisma } from '@/lib/prisma';
import { processCampaignLead } from '@/lib/campaign-processor';

const redis = {
  host: process.env.REDIS_URL?.split('://')[1]?.split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
};

const campaignQueue = new Queue('campaign-processing', {
  redis,
  settings: {
    maxStalledCount: 2,
    lockDuration: 30000,
    lockRenewTime: 15000,
  },
});

// Process jobs
campaignQueue.process(async (job) => {
  const {
    campaignId,
    leadId,
    email,
    name,
    company,
    referenceNumber,
    customFields,
    templatePdfUrl,
    placeholders,
  } = job.data;

  console.log(`Processing lead ${leadId} for campaign ${campaignId}`);

  const result = await processCampaignLead(
    campaignId,
    leadId,
    email,
    name,
    company,
    referenceNumber,
    customFields,
    templatePdfUrl,
    placeholders
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  return result;
});

// Event handlers
campaignQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

campaignQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

campaignQueue.on('stalled', (job) => {
  console.warn(`Job ${job.id} stalled`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing queue...');
  await campaignQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing queue...');
  await campaignQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});

console.log('Campaign queue processor started');
