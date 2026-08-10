type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';
type LogStatus = 'success' | 'error' | 'warning' | 'info';

type LocalCampaign = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  templatePdfUrl: string;
  placeholders: string[];
  status: CampaignStatus;
  totalLeads: number;
  processedLeads: number;
  failedLeads: number;
  successLeads: number;
  createdAt: Date;
  updatedAt: Date;
};

type LocalLead = {
  id: string;
  campaignId: string;
  email: string;
  name: string;
  company: string | null;
  referenceNumber: string | null;
  customFields: Record<string, unknown>;
  status: string;
  sentAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type LocalCampaignLog = {
  id: string;
  campaignId: string;
  leadId: string | null;
  action: string;
  details: string | null;
  status: LogStatus;
  createdAt: Date;
};

type DashboardSessionState = {
  provider: string;
  batchSize: string;
  delay: string;
  rotateIds: boolean;
  subject: string;
  message: string;
  recipientsCount: number;
  files: Array<{ name: string; size: number }>;
  updatedAt: string;
};

type RuntimeEvent = {
  id: string;
  type: string;
  createdAt: string;
  details: Record<string, unknown>;
};

import type { WeTransferSession } from './wetransfer-engine';
import type { BrowserProxyConfig } from './browser-proxy-types';

export type { BrowserProxyConfig };

type RuntimeState = {
  campaigns: Map<string, LocalCampaign>;
  leadsByCampaign: Map<string, LocalLead[]>;
  logsByCampaign: Map<string, LocalCampaignLog[]>;
  events: RuntimeEvent[];
  dashboardSession: DashboardSessionState | null;
  /** Keyed by campaignId (or a standalone key for dashboard-level sessions) */
  weTransferSessions: Map<string, WeTransferSession>;
  /** Outbound browser proxy configuration for Chromium/Playwright automation */
  browserProxyConfig: BrowserProxyConfig | null;
};

const globalForRuntime = globalThis as typeof globalThis & {
  __runtimeState?: RuntimeState;
};

function getState(): RuntimeState {
  if (!globalForRuntime.__runtimeState) {
    globalForRuntime.__runtimeState = {
      campaigns: new Map(),
      leadsByCampaign: new Map(),
      logsByCampaign: new Map(),
      events: [],
      dashboardSession: null,
      weTransferSessions: new Map(),
      browserProxyConfig: null,
    };
  }
  // Initialise weTransferSessions for state objects created before this field existed
  if (!globalForRuntime.__runtimeState.weTransferSessions) {
    globalForRuntime.__runtimeState.weTransferSessions = new Map();
  }
  return globalForRuntime.__runtimeState;
}

function makeId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function addEvent(type: string, details: Record<string, unknown>) {
  const state = getState();
  state.events.unshift({
    id: makeId('event'),
    type,
    createdAt: new Date().toISOString(),
    details,
  });
  state.events = state.events.slice(0, 200);
}

function addCampaignLog(
  campaignId: string,
  action: string,
  status: LogStatus,
  details?: Record<string, unknown>,
  leadId?: string
) {
  const state = getState();
  const existing = state.logsByCampaign.get(campaignId) || [];
  existing.unshift({
    id: makeId('log'),
    campaignId,
    leadId: leadId || null,
    action,
    status,
    details: details ? JSON.stringify(details) : null,
    createdAt: new Date(),
  });
  state.logsByCampaign.set(campaignId, existing.slice(0, 200));
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getLocalModeReason() {
  if (!isDatabaseConfigured()) {
    return 'DATABASE_URL is not configured';
  }
  return 'database access unavailable';
}

export function listCampaignsLocal() {
  const state = getState();
  return Array.from(state.campaigns.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export function createCampaignLocal(input: {
  name: string;
  description?: string;
  templatePdfUrl: string;
  placeholders: string[];
  userId?: string;
}) {
  const state = getState();
  const now = new Date();
  const campaign: LocalCampaign = {
    id: makeId('cmp'),
    userId: input.userId || 'local-user',
    name: input.name,
    description: input.description || null,
    templatePdfUrl: input.templatePdfUrl,
    placeholders: input.placeholders,
    status: 'draft',
    totalLeads: 0,
    processedLeads: 0,
    failedLeads: 0,
    successLeads: 0,
    createdAt: now,
    updatedAt: now,
  };
  state.campaigns.set(campaign.id, campaign);
  state.leadsByCampaign.set(campaign.id, []);
  state.logsByCampaign.set(campaign.id, []);
  addCampaignLog(campaign.id, 'campaign_created_local', 'info', { mode: 'local-memory' });
  addEvent('campaign.created', { campaignId: campaign.id, name: campaign.name });
  return campaign;
}

export function getCampaignLocal(campaignId: string) {
  const state = getState();
  const campaign = state.campaigns.get(campaignId);
  if (!campaign) return null;
  return {
    ...campaign,
    leads: [...(state.leadsByCampaign.get(campaignId) || [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    ),
    logs: [...(state.logsByCampaign.get(campaignId) || [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    ),
  };
}

export function updateCampaignLocal(
  campaignId: string,
  update: Partial<Pick<LocalCampaign, 'name' | 'description' | 'status'>>
) {
  const state = getState();
  const campaign = state.campaigns.get(campaignId);
  if (!campaign) return null;
  const next = { ...campaign, ...update, updatedAt: new Date() };
  state.campaigns.set(campaignId, next);
  addEvent('campaign.updated', { campaignId, status: next.status });
  return next;
}

export function deleteCampaignLocal(campaignId: string) {
  const state = getState();
  const existed = state.campaigns.delete(campaignId);
  state.leadsByCampaign.delete(campaignId);
  state.logsByCampaign.delete(campaignId);
  if (existed) addEvent('campaign.deleted', { campaignId });
  return existed;
}

export function listLeadsLocal(campaignId: string) {
  const state = getState();
  return [...(state.leadsByCampaign.get(campaignId) || [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export function importLeadsLocal(
  campaignId: string,
  leads: Array<Record<string, unknown>>
) {
  const state = getState();
  const campaign = state.campaigns.get(campaignId);
  if (!campaign) return null;

  const existing = state.leadsByCampaign.get(campaignId) || [];
  const existingEmails = new Set(existing.map((lead) => lead.email.toLowerCase()));
  let imported = 0;

  for (const lead of leads) {
    const email = String(lead.email || '').trim().toLowerCase();
    const name = String(lead.name || '').trim();
    if (!email || !name || existingEmails.has(email)) continue;
    existingEmails.add(email);
    imported += 1;
    existing.push({
      id: makeId('lead'),
      campaignId,
      email,
      name,
      company: lead.company ? String(lead.company) : null,
      referenceNumber: lead.referenceNumber ? String(lead.referenceNumber) : null,
      customFields: (lead.customFields as Record<string, unknown>) || {},
      status: 'pending',
      sentAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  campaign.totalLeads += imported;
  campaign.updatedAt = new Date();
  state.leadsByCampaign.set(campaignId, existing);
  state.campaigns.set(campaignId, campaign);

  addCampaignLog(campaignId, 'imported_leads_local', 'success', { imported });
  addEvent('campaign.leads.imported', { campaignId, imported });
  return imported;
}

export function startCampaignLocal(campaignId: string) {
  const state = getState();
  const campaign = state.campaigns.get(campaignId);
  if (!campaign) return null;
  const leads = state.leadsByCampaign.get(campaignId) || [];
  const queued = leads.filter((lead) => lead.status === 'pending').length;
  campaign.status = 'active';
  campaign.updatedAt = new Date();
  state.campaigns.set(campaignId, campaign);
  addCampaignLog(campaignId, 'campaign_started_local', 'info', { queued });
  addEvent('campaign.started', { campaignId, queued });
  return { campaign, queued };
}

export function stopCampaignLocal(campaignId: string) {
  const state = getState();
  const campaign = state.campaigns.get(campaignId);
  if (!campaign) return null;
  campaign.status = 'paused';
  campaign.updatedAt = new Date();
  state.campaigns.set(campaignId, campaign);
  addCampaignLog(campaignId, 'campaign_stopped_local', 'info', { mode: 'local-memory' });
  addEvent('campaign.stopped', { campaignId });
  return campaign;
}

export function validateCampaignLocal(campaignId: string) {
  const campaign = getCampaignLocal(campaignId);
  if (!campaign) return null;
  const errors: string[] = [];
  const warnings: string[] = [];
  const pendingLeads = campaign.leads.filter((lead) => lead.status === 'pending');

  if (!campaign.templatePdfUrl) errors.push('Template PDF is not configured');
  if (!campaign.placeholders?.length) errors.push('No placeholders defined');
  if (!campaign.leads.length) errors.push('No leads imported. Please import leads first.');
  if (campaign.status === 'active') errors.push('Campaign is already running');
  if (!pendingLeads.length && campaign.leads.length > 0) warnings.push('All leads have already been processed');
  warnings.push('Running in local in-memory mode; data resets when API restarts.');

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
}

export function updateDashboardSessionLocal(input: Omit<DashboardSessionState, 'updatedAt'>) {
  const state = getState();
  const next: DashboardSessionState = { ...input, updatedAt: new Date().toISOString() };
  state.dashboardSession = next;
  addEvent('dashboard.session.updated', {
    provider: input.provider,
    recipientsCount: input.recipientsCount,
    files: input.files.length,
  });
  return next;
}

export function getDashboardSessionLocal() {
  return getState().dashboardSession;
}

export function recordUploadMetadataLocal(details: {
  filename: string;
  importedRows: number;
  source: 'csv';
}) {
  addEvent('dashboard.upload.csv', details);
}

export function listRuntimeEventsLocal(limit = 50) {
  return getState().events.slice(0, limit);
}

// ─── WeTransfer session store ────────────────────────────────────────────────

export function getWeTransferSessionLocal(key: string) {
  return getState().weTransferSessions.get(key) ?? null;
}

export function setWeTransferSessionLocal(
  key: string,
  session: import('./wetransfer-engine').WeTransferSession
) {
  const state = getState();
  state.weTransferSessions.set(key, session);
  addEvent('wetransfer.session.updated', {
    key,
    sessionId: session.id,
    status: session.status,
    mailbox: session.tempMailbox?.email ?? null,
  });
  return session;
}

export function clearWeTransferSessionLocal(key: string) {
  getState().weTransferSessions.delete(key);
  addEvent('wetransfer.session.cleared', { key });
}

// ─── Browser proxy config store ──────────────────────────────────────────────

export function getBrowserProxyConfigLocal(): BrowserProxyConfig | null {
  return getState().browserProxyConfig;
}

export function setBrowserProxyConfigLocal(config: BrowserProxyConfig): BrowserProxyConfig {
  const state = getState();
  state.browserProxyConfig = config;
  addEvent('browser.proxy.config.updated', {
    enabled: config.enabled,
    protocol: config.enabled ? config.protocol : null,
    host: config.enabled ? config.host : null,
    port: config.enabled ? config.port : null,
    // username and password are intentionally omitted from event logs
  });
  return config;
}
