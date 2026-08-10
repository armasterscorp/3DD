import { prisma, hasDatabaseUrl, isDatabaseReachable } from '@/lib/prisma';
import {
  createCampaignLocal,
  deleteCampaignLocal,
  getCampaignLocal,
  getDashboardSessionLocal,
  getLocalModeReason,
  importLeadsLocal,
  isDatabaseConfigured,
  listCampaignsLocal,
  listLeadsLocal,
  listRuntimeEventsLocal,
  recordUploadMetadataLocal,
  startCampaignLocal,
  stopCampaignLocal,
  updateCampaignLocal,
  updateDashboardSessionLocal,
  validateCampaignLocal,
} from '@/lib/local-store';

export type ApiMode = 'database' | 'local-memory';

type ModeResult<T> = {
  mode: ApiMode;
  data: T;
  degradedReason?: string;
};

async function withFallback<T>(
  dbAction: () => Promise<T>,
  localAction: () => T
): Promise<ModeResult<T>> {
  if (!hasDatabaseUrl()) {
    return {
      mode: 'local-memory',
      data: localAction(),
      degradedReason: getLocalModeReason(),
    };
  }

  try {
    return {
      mode: 'database',
      data: await dbAction(),
    };
  } catch (error: any) {
    return {
      mode: 'local-memory',
      data: localAction(),
      degradedReason: error?.message || getLocalModeReason(),
    };
  }
}

export async function getHealthSummary() {
  const dbConfigured = isDatabaseConfigured();
  const dbReachable = dbConfigured ? await isDatabaseReachable() : false;
  const localMode = !dbConfigured || !dbReachable;
  return {
    mode: localMode ? ('local-memory' as const) : ('database' as const),
    status: localMode ? ('degraded' as const) : ('ok' as const),
    database: {
      configured: dbConfigured,
      reachable: dbReachable,
    },
    message: localMode
      ? 'Running in local in-memory mode. Data is session-only and resets on restart.'
      : 'Database connected.',
    runtimeEvents: listRuntimeEventsLocal(20),
  };
}

export async function listCampaigns() {
  return withFallback(
    async () =>
      prisma.campaign.findMany({
        orderBy: { createdAt: 'desc' },
      }),
    () => listCampaignsLocal()
  );
}

export async function createCampaign(input: {
  name: string;
  description?: string;
  templatePdfUrl: string;
  placeholders: string[];
  userId?: string;
}) {
  return withFallback(
    async () => {
      let user = await prisma.user.findFirst();
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: input.userId || 'default@3dsuite.com',
            name: 'Default User',
          },
        });
      }

      return prisma.campaign.create({
        data: {
          userId: user.id,
          name: input.name,
          description: input.description,
          templatePdfUrl: input.templatePdfUrl,
          placeholders: input.placeholders,
          status: 'draft',
        },
      });
    },
    () => createCampaignLocal(input)
  );
}

export async function getCampaignById(campaignId: string) {
  return withFallback(
    async () =>
      prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          leads: { orderBy: { createdAt: 'desc' } },
          logs: { orderBy: { createdAt: 'desc' }, take: 100 },
        },
      }),
    () => getCampaignLocal(campaignId)
  );
}

export async function updateCampaign(
  campaignId: string,
  update: { name?: string; description?: string; status?: string }
) {
  return withFallback(
    async () =>
      prisma.campaign.update({
        where: { id: campaignId },
        data: {
          ...(update.name && { name: update.name }),
          ...(update.description !== undefined && { description: update.description }),
          ...(update.status && { status: update.status }),
        },
      }),
    () =>
      updateCampaignLocal(campaignId, {
        ...(update.name !== undefined && { name: update.name }),
        ...(update.description !== undefined && { description: update.description || null }),
        ...(update.status !== undefined && { status: update.status as 'draft' | 'active' | 'paused' | 'completed' }),
      })
  );
}

export async function deleteCampaign(campaignId: string) {
  return withFallback(
    async () => prisma.campaign.delete({ where: { id: campaignId } }),
    () => deleteCampaignLocal(campaignId)
  );
}

export async function listLeads(campaignId: string) {
  return withFallback(
    async () =>
      prisma.lead.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
      }),
    () => listLeadsLocal(campaignId)
  );
}

export async function importLeads(campaignId: string, leads: Array<Record<string, unknown>>) {
  return withFallback(
    async () => {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) {
        return { ok: false as const, status: 404, message: 'Campaign not found', count: 0 };
      }

      const createdLeads = await prisma.lead.createMany({
        data: leads.map((lead) => ({
          campaignId,
          email: String(lead.email || ''),
          name: String(lead.name || ''),
          company: lead.company ? String(lead.company) : undefined,
          referenceNumber: lead.referenceNumber ? String(lead.referenceNumber) : undefined,
          customFields: (lead.customFields as Record<string, unknown>) || {},
          status: 'pending',
        })),
        skipDuplicates: true,
      });

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { totalLeads: { increment: createdLeads.count } },
      });

      await prisma.campaignLog.create({
        data: {
          campaignId,
          action: 'imported_leads',
          status: 'success',
          details: JSON.stringify({ count: createdLeads.count }),
        },
      });

      return { ok: true as const, status: 201, message: `Imported ${createdLeads.count} leads`, count: createdLeads.count };
    },
    () => {
      const count = importLeadsLocal(campaignId, leads);
      if (count === null) {
        return { ok: false as const, status: 404, message: 'Campaign not found', count: 0 };
      }
      return { ok: true as const, status: 201, message: `Imported ${count} leads`, count };
    }
  );
}

export async function validateCampaign(campaignId: string) {
  return withFallback(
    async () => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { leads: true },
      });

      if (!campaign) return null;

      const errors: string[] = [];
      const warnings: string[] = [];
      const pendingLeads = campaign.leads.filter((lead) => lead.status === 'pending');

      if (!campaign.templatePdfUrl) errors.push('Template PDF is not configured');
      if (!campaign.placeholders?.length) errors.push('No placeholders defined');
      if (!campaign.leads.length) errors.push('No leads imported. Please import leads first.');
      if (campaign.status === 'active') errors.push('Campaign is already running');
      if (!pendingLeads.length && campaign.leads.length > 0) warnings.push('All leads have already been processed');

      const missingConfig: string[] = [];
      if (!process.env.WETRANSFER_API_KEY) missingConfig.push('WeTransfer API key');
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) missingConfig.push('Email configuration');
      if (!process.env.TEMP_EMAIL_PROVIDER) missingConfig.push('Temporary email provider');
      if (missingConfig.length) errors.push(`Missing system configuration: ${missingConfig.join(', ')}`);

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        summary: {
          totalLeads: campaign.leads.length,
          pendingLeads: pendingLeads.length,
          status: campaign.status,
          placeholders: campaign.placeholders,
        },
      };
    },
    () => validateCampaignLocal(campaignId)
  );
}

export async function startCampaign(campaignId: string) {
  return withFallback(
    async () => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { leads: true },
      });
      if (!campaign) return { ok: false as const, status: 404, message: 'Campaign not found', queued: 0, errors: ['Campaign does not exist'] };

      if (campaign.status === 'active') {
        return { ok: false as const, status: 400, message: 'Campaign is already running', queued: 0, errors: ['Campaign is already running'] };
      }

      const pendingLeads = campaign.leads.filter((lead) => lead.status === 'pending');
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'active' } });

      let queued = 0;
      try {
        const { campaignQueue } = await import('@/lib/queue');
        for (const lead of pendingLeads) {
          await campaignQueue.add(
            {
              campaignId,
              leadId: lead.id,
              email: lead.email,
              name: lead.name,
              company: lead.company,
              referenceNumber: lead.referenceNumber,
              customFields: lead.customFields as Record<string, unknown>,
              templatePdfUrl: campaign.templatePdfUrl,
              placeholders: campaign.placeholders,
            },
            { delay: Math.random() * 2000 }
          );
          queued += 1;
        }
      } catch {
        queued = pendingLeads.length;
      }

      await prisma.campaignLog.create({
        data: {
          campaignId,
          action: 'campaign_started',
          status: 'success',
          details: JSON.stringify({ leadsQueued: queued }),
        },
      });

      return {
        ok: true as const,
        status: 200,
        message: `Campaign started successfully. ${queued} leads queued for processing.`,
        queued,
      };
    },
    () => {
      const started = startCampaignLocal(campaignId);
      if (!started) return { ok: false as const, status: 404, message: 'Campaign not found', queued: 0, errors: ['Campaign does not exist'] };
      return {
        ok: true as const,
        status: 200,
        message: `Campaign started in local mode. ${started.queued} leads ready for simulated processing.`,
        queued: started.queued,
      };
    }
  );
}

export async function stopCampaign(campaignId: string) {
  return withFallback(
    async () => {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) return { ok: false as const, status: 404, message: 'Campaign not found', jobsStopped: 0 };
      if (campaign.status !== 'active') {
        return { ok: false as const, status: 400, message: 'Campaign is not currently running', jobsStopped: 0 };
      }

      let removed = 0;
      try {
        const { campaignQueue } = await import('@/lib/queue');
        const jobs = await campaignQueue.getJobs(['waiting', 'active']);
        const campaignJobs = jobs.filter((job) => job.data.campaignId === campaignId);
        for (const job of campaignJobs) {
          await job.remove();
          removed += 1;
        }
      } catch {
        removed = 0;
      }

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'paused' },
      });
      await prisma.campaignLog.create({
        data: {
          campaignId,
          action: 'campaign_stopped',
          status: 'info',
          details: JSON.stringify({ jobsRemoved: removed }),
        },
      });
      return { ok: true as const, status: 200, message: `Campaign stopped successfully. ${removed} pending jobs cancelled.`, jobsStopped: removed };
    },
    () => {
      const campaign = stopCampaignLocal(campaignId);
      if (!campaign) return { ok: false as const, status: 404, message: 'Campaign not found', jobsStopped: 0 };
      return { ok: true as const, status: 200, message: 'Campaign stopped in local mode.', jobsStopped: 0 };
    }
  );
}

export async function updateDashboardSession(input: {
  provider: string;
  batchSize: string;
  delay: string;
  rotateIds: boolean;
  subject: string;
  message: string;
  recipientsCount: number;
  files: Array<{ name: string; size: number }>;
}) {
  return {
    mode: 'local-memory' as const,
    data: updateDashboardSessionLocal(input),
    degradedReason: 'dashboard session state is in-memory',
  };
}

export async function getDashboardSession() {
  return {
    mode: 'local-memory' as const,
    data: getDashboardSessionLocal(),
    degradedReason: 'dashboard session state is in-memory',
  };
}

export function recordCsvUpload(filename: string, importedRows: number) {
  recordUploadMetadataLocal({ filename, importedRows, source: 'csv' });
}
