'use client';

import React from 'react';
import axios from 'axios';
import { AdobeRemoteBrowser } from '@/components/AdobeRemoteBrowser';
import { CaptchaQueue } from '@/components/captcha-queue';
import { CaptchaSettings } from '@/components/captcha-settings';
import {
  Activity,
  ArrowLeft,
  Copy,
  FileText,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Link2,
  Mail,
  Menu,
  RefreshCw,
  Save,
  Send,
  Settings,
  Shield,
  Square,
  Upload,
  UserCog,
  Users,
  X,
  Zap,
} from 'lucide-react';

type SenderKey = 'wetransfer' | 'adobe' | 'inquiry' | 'gmail' | 'smtp' | 'microsoft' | 'quickbooks' | 'docusign';
type LeadStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
type RunState = 'idle' | 'running' | 'stopped' | 'completed' | 'completed_with_errors' | 'failed';
type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'stopped' | 'system';
type ModalKey =
  | 'credentials'
  | 'leads'
  | 'settings'
  | 'logs'
  | 'attach-host'
  | 'rmm'
  | 'browser'
  | 'antired'
  | 'redirect-generator'
  | 'domains'
  | 'campaign-redirect'
  | 'payload'
  | 'b2b'
  | 'blast'
  | 'browser-proxy';

type Lead = {
  id: string;
  rawInput: string;
  normalized: string;
  email?: string;
  name?: string;
  status: LeadStatus;
  senderStatus: Partial<Record<SenderKey, LeadStatus>>;
  addedAt: string;
  sentAt?: string;
  failedAt?: string;
  metadata?: Record<string, string>;
};

type RuntimeLog = {
  id: string;
  timestamp: string;
  sender: SenderKey | 'system';
  level: LogLevel;
  message: string;
};

type SenderConfig = {
  connected: boolean;
  fileType: string;
  fileSource: 'upload' | 'generate';
  attachmentNameTemplate: string;
  convertHtmlToPdf: boolean;
  replaceBatchPlaceholdersInPdf: boolean;
  dolphinProfileIds: string[];
  randomizeDolphinProfiles: boolean;
  orientation: 'landscape' | 'portrait';
  design: string;
  generatedLayout: 'classic' | 'highlight';
  generatedTitle: string;
  generatedSubtitle: string;
  generatedBodyText: string;
  ctaLink: string;
  cta: 'button' | 'qr';
  useCustomMessage: boolean;
  rateLimitDelay: number;
  tempProvider: string;
  poolSize: number;
  autoRotate: boolean;
  notes: string;
};

type DashboardSettings = {
  proxy: string;
  defaultDelay: number;
  defaultFileType: string;
  defaultOrientation: 'landscape' | 'portrait';
  defaultCta: 'button' | 'qr';
  defaultTempProvider: string;
};

type BrowserProxyPanelState = {
  enabled: boolean;
  protocol: 'http' | 'socks5';
  host: string;
  port: string;
  username: string;
  /** Never loaded back from server; user must re-enter to change */
  password: string;
};

type BrowserProxyTestApiResponse = {
  success?: boolean;
  message?: string;
  diagnostics?: string;
  error?: string;
};

type BrowserProxyTestResult = {
  level: 'success' | 'error' | 'warning';
  message: string;
  diagnostics?: string;
};

type CloudflareRedirectConfig = {
  accountId: string;
  apiToken: string;
  namespaceId: string;
  publicBaseUrl: string;
};

type CloudflareRedirectItem = {
  alias: string;
  destination: string;
  statusCode: 301 | 302 | 307 | 308;
  createdAt?: string;
  updatedAt?: string;
  redirectUrl: string;
};


type CredentialsState = {
  wetransfer: {
    provider: 'mailslurp' | 'tempmailio';
    account: string;
    proxy: string;
    mailSlurpApiKey: string;
    tempMailIoApiKey: string;
  };
  adobe: { tenant: string };
  quickbooks: { companyId: string; environment: string };
  docusign: { accountId: string; integrationKey: string };
};

type AdobeConnectionStatus = {
  connected: boolean;
  loggedIn?: boolean;
  profileId?: string | null;
  currentUrl?: string | null;
  lastCheckedAt?: string | null;
  error?: string | null;
};

type Toast = { id: string; message: string; level: LogLevel };

type WeTransferStepStatus =
  | 'pending'
  | 'running'
  | 'opening_browser'
  | 'loading_wetransfer'
  | 'awaiting_sender_verification'
  | 'waiting_for_verification'
  | 'verification_received'
  | 'preparing_attachment'
  | 'upload_started'
  | 'upload_completed'
  | 'send_submitted'
  | 'send_confirmed'
  | 'success'
  | 'failed'
  | 'stopped';

type WeTransferStep = {
  id: string;
  label: string;
  status: WeTransferStepStatus;
  detail?: string;
  timestamp?: string;
  isReal: boolean;
};

type WeTransferSessionState = {
  sessionId: string | null;
  status:
    | 'idle'
    | 'initializing'
    | 'ready'
    | 'sending'
    | 'stopped'
    | 'completed'
    | 'completed_with_errors'
    | 'failed';
  mailbox: string | null;
  mailboxMessageCount: number | null;
  latestError: string | null;
  attachment: WeTransferAttachmentDebug | null;
  steps: WeTransferStep[];
};

type WeTransferAttachmentDebug = {
  name: string | null;
  source: 'uploaded' | 'generated';
  mimeType: string | null;
  sizeBytes: number | null;
  readiness: 'ready' | 'missing';
  detail: string;
};

type WeTransferSessionApiResponse = {
  sessionId?: string;
  status?: WeTransferSessionState['status'];
  mailbox?: { email?: string | null } | null;
  mailboxMessageCount?: number | null;
  latestError?: string | null;
  steps?: WeTransferStep[];
  logs?: string[];
  error?: string;
};

type WeTransferSendLeadApiResponse = {
  success?: boolean;
  confirmationStatus?: 'confirmed' | 'failed';
  detail?: string | null;
  error?: string;
  transferUrl?: string | null;
  logs?: string[];
  steps?: WeTransferStep[];
  mailboxUsed?: string | null;
  mailboxMessageCount?: number | null;
  latestError?: string | null;
  attachment?: {
    name: string;
    source: 'uploaded' | 'generated';
    mimeType: string | null;
    sizeBytes: number;
    ready: boolean;
  } | null;
};

const SENDER_KEYS: SenderKey[] = ['wetransfer', 'adobe', 'inquiry', 'gmail', 'smtp', 'microsoft', 'quickbooks', 'docusign'];

const SENDERS: Array<{ key: SenderKey; label: string }> = [
  { key: 'wetransfer', label: 'WeTransfer' },
  { key: 'adobe', label: 'Adobe Acrobat' },
  { key: 'inquiry', label: 'Inquiry' },
  { key: 'gmail', label: 'Gmail' },
  { key: 'smtp', label: 'SMTP' },
  { key: 'microsoft', label: 'Microsoft' },
  { key: 'quickbooks', label: 'QuickBooks' },
  { key: 'docusign', label: 'DocuSign' },
];

const SIDEBAR_ITEMS: Array<{ id: 'crm-sender' | ModalKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'credentials', label: 'Credentials', icon: UserCog },
  { id: 'leads', label: 'Leads Management', icon: Users },
  { id: 'attach-host', label: 'Attach / Host', icon: FolderOpen },
  { id: 'rmm', label: '3D RMM', icon: LayoutDashboard },
  { id: 'browser', label: '3D Browser', icon: Globe },
  { id: 'crm-sender', label: 'CRM Sender', icon: Send },
  { id: 'antired', label: 'AntiRed + Landing', icon: Shield },
  { id: 'redirect-generator', label: 'Redirect Generator', icon: Link2 },
  { id: 'domains', label: 'Domains', icon: Globe },
  { id: 'campaign-redirect', label: 'Campaign Redirect', icon: RefreshCw },
  { id: 'payload', label: 'Payload', icon: FileText },
  { id: 'b2b', label: 'B2B Sender', icon: Mail },
  { id: 'blast', label: '3D Blast', icon: Zap },
  { id: 'browser-proxy', label: 'Browser Proxy', icon: Globe },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'logs', label: 'Logs', icon: Activity },
];

function nowIso() {
  return new Date().toISOString();
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString();
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) return 'unknown';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getWeTransferAttachmentDebug(
  config: SenderConfig,
  uploadFile: File | null
): WeTransferAttachmentDebug {
  const ctaLink = safeTrim(config.ctaLink);
  if (config.fileSource === 'upload') {
    if (!uploadFile) {
      return {
        name: null,
        source: 'uploaded',
        mimeType: null,
        sizeBytes: null,
        readiness: 'missing',
        detail: 'Upload attachment mode is selected but no file is attached. Choose an attachment before sending.',
      };
    }

    return {
      name: uploadFile.name || null,
      source: 'uploaded',
      mimeType: uploadFile.type || null,
      sizeBytes: uploadFile.size || null,
      readiness: uploadFile.size > 0 ? 'ready' : 'missing',
      detail:
        uploadFile.size > 0
          ? 'Selected attachment is ready and will be uploaded to WeTransfer for each lead.'
          : 'Uploaded file is empty and cannot be sent.',
    };
  }

  return {
    name: 'per-lead-generated-proposal.pdf',
    source: 'generated',
    mimeType: 'application/pdf',
    sizeBytes: null,
    readiness: 'ready',
    detail: ctaLink
      ? 'PDF will be generated per lead at send time.'
      : 'PDF will be generated per lead at send time. CTA link is currently empty.',
  };
}

async function parseApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`Empty response from API (HTTP ${response.status})`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from API (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
}

function normalizeLead(value: string) {
  return value.trim().toLowerCase();
}

function parseLeadIdentity(raw: string): { email?: string; name?: string } {
  const line = raw.trim();
  if (!line) return {};

  const angleMatch = line.match(/^"?([^"<]+?)"?\s*<\s*([^\s<>]+@[^\s<>]+)\s*>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].trim() || undefined,
      email: angleMatch[2].trim().toLowerCase(),
    };
  }

  const csvParts = line.split(/[,\t;|]/).map((part) => part.trim()).filter(Boolean);
  if (csvParts.length >= 2) {
    const firstIsEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(csvParts[0]);
    const secondIsEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(csvParts[1]);
    if (firstIsEmail) {
      return { email: csvParts[0].toLowerCase(), name: csvParts[1] || undefined };
    }
    if (secondIsEmail) {
      return { email: csvParts[1].toLowerCase(), name: csvParts[0] || undefined };
    }
  }

  const plainEmailMatch = line.match(/[^\s@<>,;|]+@[^\s@<>,;|]+\.[^\s@<>,;|]+/);
  if (plainEmailMatch) {
    return { email: plainEmailMatch[0].toLowerCase() };
  }

  return {};
}

function parseLeadLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupeLeads(existing: Lead[], values: string[]) {
  const known = new Set(existing.map((lead) => lead.normalized));
  const added: Lead[] = [];

  values.forEach((raw) => {
    const identity = parseLeadIdentity(raw);
    const normalized = normalizeLead(identity.email || raw);
    if (!normalized || known.has(normalized)) return;
    known.add(normalized);
    added.push({
      id: makeId('lead'),
      rawInput: raw,
      normalized,
      email: identity.email,
      name: identity.name,
      status: 'pending',
      senderStatus: {},
      addedAt: nowIso(),
    });
  });

  return added;
}

function createDefaultSenderConfig(): SenderConfig {
  return {
    connected: true,
    fileType: 'PDF',
    fileSource: 'upload',
    attachmentNameTemplate: '{OriginalFile}',
    convertHtmlToPdf: false,
    replaceBatchPlaceholdersInPdf: false,
    dolphinProfileIds: [],
    randomizeDolphinProfiles: false,
    orientation: 'landscape',
    design: 'Modern',
    generatedLayout: 'classic',
    generatedTitle: 'Business Proposal Pack',
    generatedSubtitle: 'Tender-ready document set for review',
    generatedBodyText:
      'Please review this pack and use the secure call-to-action link to continue.',
    ctaLink: '',
    cta: 'button',
    useCustomMessage: true,
    rateLimitDelay: 2,
    tempProvider: 'TempMail',
    poolSize: 20,
    autoRotate: true,
    notes: '',
  };
}

function createDefaultSenderConfigs(): Record<SenderKey, SenderConfig> {
  return {
    wetransfer: createDefaultSenderConfig(),
    adobe: createDefaultSenderConfig(),
    inquiry: createDefaultSenderConfig(),
    gmail: createDefaultSenderConfig(),
    smtp: createDefaultSenderConfig(),
    microsoft: createDefaultSenderConfig(),
    quickbooks: createDefaultSenderConfig(),
    docusign: createDefaultSenderConfig(),
  };
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function safeTrim(value: unknown): string {
  return normalizeString(value).trim();
}

function isSenderKey(value: unknown): value is SenderKey {
  return typeof value === 'string' && SENDER_KEYS.includes(value as SenderKey);
}

function normalizeSenderConfig(value: unknown): SenderConfig {
  const defaults = createDefaultSenderConfig();
  if (!value || typeof value !== 'object') return defaults;
  const config = value as Partial<SenderConfig>;

  return {
    ...defaults,
    connected: typeof config.connected === 'boolean' ? config.connected : defaults.connected,
    fileType: normalizeString(config.fileType, defaults.fileType),
    fileSource: config.fileSource === 'generate' ? 'generate' : 'upload',
    attachmentNameTemplate: normalizeString(config.attachmentNameTemplate, defaults.attachmentNameTemplate),
    convertHtmlToPdf: Boolean(config.convertHtmlToPdf),
    replaceBatchPlaceholdersInPdf: Boolean(config.replaceBatchPlaceholdersInPdf),
    dolphinProfileIds: Array.isArray(config.dolphinProfileIds)
      ? config.dolphinProfileIds.map((item) => String(item).trim()).filter(Boolean)
      : defaults.dolphinProfileIds,
    randomizeDolphinProfiles: Boolean(config.randomizeDolphinProfiles),
    orientation: config.orientation === 'portrait' ? 'portrait' : 'landscape',
    design: normalizeString(config.design, defaults.design),
    generatedLayout: config.generatedLayout === 'highlight' ? 'highlight' : 'classic',
    generatedTitle: normalizeString(config.generatedTitle, defaults.generatedTitle),
    generatedSubtitle: normalizeString(config.generatedSubtitle, defaults.generatedSubtitle),
    generatedBodyText: normalizeString(config.generatedBodyText, defaults.generatedBodyText),
    ctaLink: normalizeString(config.ctaLink),
    cta: config.cta === 'qr' ? 'qr' : 'button',
    useCustomMessage:
      typeof config.useCustomMessage === 'boolean' ? config.useCustomMessage : defaults.useCustomMessage,
    rateLimitDelay:
      typeof config.rateLimitDelay === 'number' && Number.isFinite(config.rateLimitDelay)
        ? config.rateLimitDelay
        : defaults.rateLimitDelay,
    tempProvider: normalizeString(config.tempProvider, defaults.tempProvider),
    poolSize: typeof config.poolSize === 'number' && Number.isFinite(config.poolSize) ? config.poolSize : defaults.poolSize,
    autoRotate: typeof config.autoRotate === 'boolean' ? config.autoRotate : defaults.autoRotate,
    notes: normalizeString(config.notes),
  };
}

function normalizeSenderConfigs(value: unknown): Record<SenderKey, SenderConfig> {
  const defaults = createDefaultSenderConfigs();
  if (!value || typeof value !== 'object') return defaults;
  const parsed = value as Partial<Record<SenderKey, unknown>>;

  return {
    wetransfer: normalizeSenderConfig(parsed.wetransfer),
    adobe: normalizeSenderConfig(parsed.adobe),
    inquiry: normalizeSenderConfig(parsed.inquiry),
    gmail: normalizeSenderConfig(parsed.gmail),
    smtp: normalizeSenderConfig(parsed.smtp),
    microsoft: normalizeSenderConfig(parsed.microsoft),
    quickbooks: normalizeSenderConfig(parsed.quickbooks),
    docusign: normalizeSenderConfig(parsed.docusign),
  };
}

function normalizeBrowserProxyPanelState(value: unknown): BrowserProxyPanelState {
  const defaults: BrowserProxyPanelState = {
    enabled: false,
    protocol: 'http',
    host: '',
    port: '8080',
    username: '',
    password: '',
  };
  if (!value || typeof value !== 'object') return defaults;
  const config = value as Partial<BrowserProxyPanelState>;
  return {
    ...defaults,
    enabled: Boolean(config.enabled),
    protocol: config.protocol === 'socks5' ? 'socks5' : 'http',
    host: normalizeString(config.host),
    port: normalizeString(config.port, defaults.port),
    username: normalizeString(config.username),
    password: '',
  };
}

const LOCAL_STORAGE_KEY = 'crm-console-session-v2';


const TEMP_MAIL_SESSION_KEYS = {
  mailslurp: '3d-suite-temp-mail-key-mailslurp',
  tempmailio: '3d-suite-temp-mail-key-tempmailio',
} as const;

function getSelectedTempMailApiKey(
  credentials: CredentialsState['wetransfer']
): string {
  return credentials.provider === 'tempmailio'
    ? credentials.tempMailIoApiKey
    : credentials.mailSlurpApiKey;
}

function getTempMailProviderLabel(
  provider: CredentialsState['wetransfer']['provider']
): string {
  return provider === 'tempmailio' ? 'Temp-Mail.io' : 'MailSlurp';
}


const CLOUDFLARE_REDIRECT_SESSION_KEY = '3d-suite-cloudflare-redirect-config';

function normalizeCloudflarePublicBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function createRandomRedirectAlias(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < 8; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [campaignName, setCampaignName] = React.useState('Q3 Operations Campaign');
  const [activeSender, setActiveSender] = React.useState<SenderKey>('wetransfer');
  const [runState, setRunState] = React.useState<RunState>('idle');
  const [activeModal, setActiveModal] = React.useState<ModalKey | null>(null);
  const [showStopConfirm, setShowStopConfirm] = React.useState(false);
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [isPreparing, setIsPreparing] = React.useState(false);
  const [wetransferUploadFile, setWetransferUploadFile] = React.useState<File | null>(null);
  const [newDolphinProfileId, setNewDolphinProfileId] = React.useState('');

  const [cloudflareRedirectConfig, setCloudflareRedirectConfig] =
    React.useState<CloudflareRedirectConfig>({
      accountId: '',
      apiToken: '',
      namespaceId: '',
      publicBaseUrl: '',
    });
  const [redirectDestination, setRedirectDestination] = React.useState('');
  const [redirectAlias, setRedirectAlias] = React.useState('');
  const [redirectStatusCode, setRedirectStatusCode] =
    React.useState<301 | 302 | 307 | 308>(302);
  const [redirectItems, setRedirectItems] = React.useState<CloudflareRedirectItem[]>([]);
  const [redirectBusy, setRedirectBusy] = React.useState(false);
  const [redirectEditingAlias, setRedirectEditingAlias] = React.useState<string | null>(null);
  const [redirectError, setRedirectError] = React.useState<string | null>(null);

  const [leads, setLeads] = React.useState<Lead[]>([]);
  const [logs, setLogs] = React.useState<RuntimeLog[]>([]);
  const [leadsInput, setLeadsInput] = React.useState('');
  const [dedupeEnabled, setDedupeEnabled] = React.useState(true);
  const [moduleNotes, setModuleNotes] = React.useState<Record<string, string>>({});

  const [settingsState, setSettingsState] = React.useState<DashboardSettings>({
    proxy: '',
    defaultDelay: 2,
    defaultFileType: 'PDF',
    defaultOrientation: 'landscape',
    defaultCta: 'button',
    defaultTempProvider: 'TempMail',
  });

  const [browserProxy, setBrowserProxy] = React.useState<BrowserProxyPanelState>({
    enabled: false,
    protocol: 'http',
    host: '',
    port: '8080',
    username: '',
    password: '',
  });
  const [browserProxyError, setBrowserProxyError] = React.useState<string | null>(null);
  const [browserProxySaving, setBrowserProxySaving] = React.useState(false);
  const [browserProxyTesting, setBrowserProxyTesting] = React.useState(false);
  const [browserProxyHasPassword, setBrowserProxyHasPassword] = React.useState(false);
  const [browserProxyTestResult, setBrowserProxyTestResult] = React.useState<BrowserProxyTestResult | null>(null);

  const [credentials, setCredentials] = React.useState<CredentialsState>({
    wetransfer: {
      provider: 'mailslurp',
      account: '',
      proxy: '',
      mailSlurpApiKey: '',
      tempMailIoApiKey: '',
    },
    adobe: { tenant: '' },
    quickbooks: { companyId: '', environment: 'sandbox' },
    docusign: { accountId: '', integrationKey: '' },
  });

  const [senderConfigs, setSenderConfigs] = React.useState<Record<SenderKey, SenderConfig>>(
    createDefaultSenderConfigs
  );

  React.useEffect(() => {
    const interceptorId = axios.interceptors.request.use((config) => {
      try {
        const userId = window.localStorage
          .getItem('3d-suite-active-license-id')
          ?.trim();
        if (userId) {
          const headers = config.headers ?? {};
          headers['x-user-id'] = userId;
          config.headers = headers;
        }
      } catch {
        // Ignore storage access issues in restrictive browser modes.
      }

      return config;
    });

    return () => {
      axios.interceptors.request.eject(interceptorId);
    };
  }, []);


  React.useEffect(() => {
    try {
      const mailSlurpApiKey =
        window.sessionStorage.getItem(TEMP_MAIL_SESSION_KEYS.mailslurp) || '';
      const tempMailIoApiKey =
        window.sessionStorage.getItem(TEMP_MAIL_SESSION_KEYS.tempmailio) || '';

      setCredentials((prev) => ({
        ...prev,
        wetransfer: {
          ...prev.wetransfer,
          mailSlurpApiKey,
          tempMailIoApiKey,
        },
      }));
    } catch {
      // Ignore sessionStorage errors.
    }
  }, []);


  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(CLOUDFLARE_REDIRECT_SESSION_KEY);
      if (!saved) return;

      const parsed = JSON.parse(saved) as Partial<CloudflareRedirectConfig>;
      setCloudflareRedirectConfig({
        accountId: String(parsed.accountId || ''),
        apiToken: String(parsed.apiToken || ''),
        namespaceId: String(parsed.namespaceId || ''),
        publicBaseUrl: String(parsed.publicBaseUrl || ''),
      });
    } catch {
      // Ignore malformed/unavailable session storage.
    }
  }, []);

  const stopRequestedRef = React.useRef(false);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);
  const leadsRef = React.useRef<Lead[]>([]);
  const senderConfigsRef = React.useRef(senderConfigs);
  const wtCampaignId = React.useRef<string>(`dashboard_${Date.now()}`);

  const [weTransferSession, setWeTransferSession] = React.useState<WeTransferSessionState>({
    sessionId: null,
    status: 'idle',
    mailbox: null,
    mailboxMessageCount: null,
    latestError: null,
    attachment: null,
    steps: [],
  });

  const [adobeConnection, setAdobeConnection] =
    React.useState<AdobeConnectionStatus>({ connected: false });
  const [adobeConnecting, setAdobeConnecting] = React.useState(false);

  const wetransferAttachment = React.useMemo(
    () => getWeTransferAttachmentDebug(senderConfigs.wetransfer, wetransferUploadFile),
    [senderConfigs.wetransfer, wetransferUploadFile]
  );

  const updateLeads = React.useCallback(
    (updater: Lead[] | ((prev: Lead[]) => Lead[])) => {
      setLeads((prev) => {
        const next = typeof updater === 'function' ? (updater as (prev: Lead[]) => Lead[])(prev) : updater;
        leadsRef.current = next;
        return next;
      });
    },
    []
  );

  const addToast = React.useCallback((message: string, level: LogLevel = 'info') => {
    const id = makeId('toast');
    setToasts((prev) => [...prev, { id, message, level }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 2200);
  }, []);

  const appendLog = React.useCallback(
    (level: LogLevel, message: string, sender: SenderKey | 'system' = 'system') => {
      setLogs((prev) => [
        ...prev,
        {
          id: makeId('log'),
          timestamp: nowIso(),
          sender,
          level,
          message,
        },
      ]);
    },
    []
  );

  React.useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (parsed.campaignName) setCampaignName(parsed.campaignName);
      if (isSenderKey(parsed.activeSender)) setActiveSender(parsed.activeSender);
      if (Array.isArray(parsed.leads)) {
        leadsRef.current = parsed.leads;
        setLeads(parsed.leads);
      }
      if (Array.isArray(parsed.logs)) setLogs(parsed.logs);
      if (parsed.settingsState) setSettingsState(parsed.settingsState);
      setSenderConfigs(normalizeSenderConfigs(parsed.senderConfigs));
      if (parsed.browserProxy) setBrowserProxy(normalizeBrowserProxyPanelState(parsed.browserProxy));
      if (parsed.credentials) setCredentials(parsed.credentials);
      if (parsed.moduleNotes) setModuleNotes(parsed.moduleNotes);
      appendLog('system', 'Restored local session cache', 'system');
    } catch {
      appendLog('warning', 'Could not restore local session cache', 'system');
    }
  }, [appendLog]);

  // Load browser proxy settings from server on mount
  React.useEffect(() => {
    fetch('/api/browser-proxy')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && typeof data === 'object') {
          setBrowserProxy((prev) => ({
            ...prev,
            enabled: Boolean(data.enabled),
            protocol: data.protocol === 'socks5' ? 'socks5' : 'http',
            host: String(data.host ?? ''),
            port: String(data.port ?? '8080'),
            username: String(data.username ?? ''),
            // password is never loaded back from server
            password: '',
          }));
          setBrowserProxyHasPassword(Boolean(data.hasPassword));

          const loadedProtocol =
            data.protocol === 'socks5' ? 'socks5' : 'http';
          const loadedHost = String(data.host ?? '');
          const loadedPort = String(data.port ?? '8080');
          const loadedUsername = String(data.username ?? '');

          setCredentials((prev) => ({
            ...prev,
            wetransfer: {
              ...prev.wetransfer,
              proxy:
                Boolean(data.enabled) && loadedHost
                  ? `${loadedProtocol}://${
                      loadedUsername
                        ? `${encodeURIComponent(loadedUsername)}@`
                        : ''
                    }${loadedHost}:${loadedPort}`
                  : '',
            },
          }));
        }
      })
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  React.useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);

  React.useEffect(() => {
    senderConfigsRef.current = senderConfigs;
  }, [senderConfigs]);

  const totalUploaded = leads.length;
  const totalSent = leads.filter((lead) => lead.status === 'sent').length;
  const totalFailed = leads.filter((lead) => lead.status === 'failed').length;
  const totalRemaining = leads.filter((lead) => lead.status === 'pending' || lead.status === 'sending').length;
  const successRate = totalUploaded ? Math.round((totalSent / totalUploaded) * 100) : 0;

  const saveSession = React.useCallback(() => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        campaignName,
        activeSender,
        leads,
        logs,
        settingsState,
        senderConfigs,
        browserProxy: { ...browserProxy, password: '' },
        credentials,
        moduleNotes,
      })
    );
    appendLog('success', 'Campaign saved to local session storage', 'system');
    addToast('Session saved', 'success');
  }, [campaignName, activeSender, leads, logs, settingsState, senderConfigs, browserProxy, credentials, moduleNotes, appendLog, addToast]);

  function openModule(item: 'crm-sender' | ModalKey) {
    if (item === 'crm-sender') {
      setActiveModal(null);
      return;
    }
    setActiveModal(item);
  }

  function syncStoredLogs(nextLogs: RuntimeLog[]) {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({
          ...parsed,
          logs: nextLogs,
        })
      );
    } catch {
      // Ignore local cache write failures while clearing logs.
    }
  }

  function clearVisibleLogs() {
    setLogs([]);
    syncStoredLogs([]);
    addToast('Logs cleared', 'success');
  }

  function clearSenderLogs(sender: SenderKey) {
    setLogs((current) => {
      const next = current.filter((log) => log.sender !== sender);
      syncStoredLogs(next);
      return next;
    });
    addToast(`${sender === 'microsoft' ? 'Microsoft' : sender.toUpperCase()} logs cleared`, 'success');
  }



  function applyGlobalProxyText(value: string) {
    const raw = value.trim();

    if (!raw) {
      setBrowserProxy((prev) => ({
        ...prev,
        enabled: false,
        host: '',
        username: '',
        password: '',
      }));

      setCredentials((prev) => ({
        ...prev,
        wetransfer: {
          ...prev.wetransfer,
          proxy: '',
        },
      }));
      return;
    }

    let candidate = raw;

    if (!/^[a-z]+:\/\//i.test(candidate)) {
      candidate = `http://${candidate}`;
    }

    try {
      const parsed = new URL(candidate);

      const protocol =
        parsed.protocol.toLowerCase() === 'socks5:'
          ? 'socks5'
          : 'http';

      const host = parsed.hostname;
      const port =
        parsed.port ||
        (protocol === 'socks5' ? '1080' : '8080');

      if (!host) {
        throw new Error('Proxy host is missing');
      }

      setBrowserProxy({
        enabled: true,
        protocol,
        host,
        port,
        username: decodeURIComponent(parsed.username || ''),
        password: decodeURIComponent(parsed.password || ''),
      });

      setCredentials((prev) => ({
        ...prev,
        wetransfer: {
          ...prev.wetransfer,
          proxy: raw,
        },
      }));

      setBrowserProxyError(null);
      setBrowserProxyTestResult(null);
    } catch {
      setBrowserProxyError(
        'Invalid proxy. Use http://host:port, socks5://host:port, or include username/password in the URL.'
      );
    }
  }

  async function saveBrowserProxySettings() {
    setBrowserProxyError(null);
    setBrowserProxyTestResult(null);
    const portNum = parseInt(browserProxy.port, 10);
    if (browserProxy.enabled) {
      if (!browserProxy.host.trim()) {
        setBrowserProxyError('Host is required when proxy is enabled.');
        return;
      }
      if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
        setBrowserProxyError('Port must be a number between 1 and 65535.');
        return;
      }
    }
    setBrowserProxySaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled: browserProxy.enabled,
        protocol: browserProxy.protocol,
        host: browserProxy.host.trim(),
        port: portNum || 8080,
        username: browserProxy.username.trim(),
      };
      if (browserProxy.password !== '' || !browserProxyHasPassword) {
        body.password = browserProxy.password;
      }
      const res = await fetch('/api/browser-proxy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        setBrowserProxyError(String(data.error ?? 'Failed to save proxy settings'));
      } else {
        setBrowserProxyHasPassword(Boolean(data.hasPassword));
        setBrowserProxy((p) => ({ ...p, password: '' }));
        appendLog(
          'success',
          browserProxy.enabled
            ? `Browser proxy enabled: ${browserProxy.protocol}://${browserProxy.host.trim()}:${portNum}`
            : 'Browser proxy disabled',
          'system'
        );
        addToast('Proxy settings saved', 'success');
      }
    } catch {
      setBrowserProxyError('Network error — could not save proxy settings');
    } finally {
      setBrowserProxySaving(false);
    }
  }

  async function testBrowserProxy() {
    setBrowserProxyError(null);
    setBrowserProxyTestResult(null);

    if (!browserProxy.enabled) {
      const message = 'Enable the browser proxy before testing it.';
      setBrowserProxyTestResult({ level: 'warning', message });
      addToast(message, 'warning');
      return;
    }

    const portNum = parseInt(browserProxy.port, 10);
    if (!browserProxy.host.trim()) {
      setBrowserProxyError('Host is required when proxy is enabled.');
      return;
    }
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      setBrowserProxyError('Port must be a number between 1 and 65535.');
      return;
    }

    setBrowserProxyTesting(true);
    try {
      const body: Record<string, unknown> = {
        enabled: browserProxy.enabled,
        protocol: browserProxy.protocol,
        host: browserProxy.host.trim(),
        port: portNum,
        username: browserProxy.username.trim(),
      };
      if (browserProxy.password !== '' || !browserProxyHasPassword) {
        body.password = browserProxy.password;
      }

      const res = await fetch('/api/browser-proxy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await parseApiJson<BrowserProxyTestApiResponse>(res);
      const success = Boolean(res.ok && data.success);
      const message =
        data.message ||
        data.error ||
        (success ? 'Proxy test succeeded.' : 'Proxy test failed.');

      setBrowserProxyTestResult({
        level: success ? 'success' : 'error',
        message,
        diagnostics: data.diagnostics,
      });
      addToast(message, success ? 'success' : 'error');
      appendLog(
        success ? 'success' : 'error',
        success
          ? `Proxy test passed: ${browserProxy.protocol}://${browserProxy.host.trim()}:${portNum}`
          : `Proxy test failed: ${message}`,
        'system'
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Proxy test failed unexpectedly';
      setBrowserProxyTestResult({ level: 'error', message });
      addToast(message, 'error');
      appendLog('error', `Proxy test failed: ${message}`, 'system');
    } finally {
      setBrowserProxyTesting(false);
    }
  }

  function importLeadLines(lines: string[]) {
    const toImport = dedupeEnabled ? dedupeLeads(leads, lines) : lines.map((raw) => {
      const identity = parseLeadIdentity(raw);
      return {
        id: makeId('lead'),
        rawInput: raw,
        normalized: normalizeLead(identity.email || raw),
        email: identity.email,
        name: identity.name,
        status: 'pending' as LeadStatus,
        senderStatus: {},
        addedAt: nowIso(),
      };
    }).filter((lead) => Boolean(lead.normalized));

    if (!toImport.length) {
      addToast('No new leads imported', 'warning');
      appendLog('warning', 'Leads import skipped (no unique lines)', 'system');
      return;
    }

    updateLeads((prev) => [...prev, ...toImport]);
    const withEmail = toImport.filter((lead) => Boolean(lead.email)).length;
    const withName = toImport.filter((lead) => Boolean(lead.name)).length;
    appendLog(
      'success',
      `Leads imported: ${toImport.length} (autograb email: ${withEmail}, name: ${withName})`,
      'system'
    );
    addToast(`Imported ${toImport.length} lead(s)`, 'success');
  }

  async function handleLeadFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    importLeadLines(parseLeadLines(text));
    appendLog('info', `File uploaded: ${file.name}`, 'system');
    event.target.value = '';
  }

  function clearAllLeads() {
    updateLeads([]);
    appendLog('warning', 'Lead pool cleared', 'system');
    addToast('Lead pool cleared', 'warning');
  }

  function finalizeRun(sender: SenderKey) {
    const statuses = leadsRef.current
      .map((lead) => lead.senderStatus[sender])
      .filter(Boolean) as LeadStatus[];
    const sentCount = statuses.filter((status) => status === 'sent').length;
    const failedCount = statuses.filter((status) => status === 'failed').length;
    const skippedCount = statuses.filter((status) => status === 'skipped').length;

    let nextState: RunState = 'completed';
    let level: LogLevel = 'success';
    let message = `Send completed for ${sender} (${sentCount} confirmed)`;

    if (failedCount > 0 && sentCount === 0 && skippedCount === 0) {
      nextState = 'failed';
      level = 'error';
      message = `Send failed for ${sender} (${failedCount} failed, 0 confirmed)`;
    } else if (failedCount > 0 || skippedCount > 0) {
      nextState = 'completed_with_errors';
      level = failedCount > 0 ? 'error' : 'warning';
      message =
        `Send completed with issues for ${sender} ` +
        `(confirmed: ${sentCount}, failed: ${failedCount}, unconfirmed: ${skippedCount})`;
    }

    setRunState(nextState);
    if (sender === 'wetransfer') {
      setWeTransferSession((prev) => ({ ...prev, status: nextState }));
    }
    appendLog(level, message, sender);
    addToast(nextState === 'completed' ? 'Run completed' : message, level);
  }

  function processNextLead(sender: SenderKey) {
    if (stopRequestedRef.current) {
      updateLeads((prev) => prev.map((lead) => (lead.status === 'sending' ? { ...lead, status: 'pending' } : lead)));
      setRunState('stopped');
      if (sender === 'wetransfer') {
        setWeTransferSession((prev) => ({ ...prev, status: 'stopped' }));
      }
      appendLog('stopped', `Send stopped for ${sender}`, sender);
      addToast('Send stopped', 'stopped');
      return;
    }

    const pendingLeadsForSender = leadsRef.current.filter(
      (lead) => lead.status === 'pending' && lead.senderStatus[sender] !== 'sent'
    );

    if (!pendingLeadsForSender.length) {
      finalizeRun(sender);
      return;
    }

    const nextLead = pendingLeadsForSender[0];

    if (sender === 'wetransfer') {
      const campaignId = wtCampaignId.current;
      const wtConfig = normalizeSenderConfig(senderConfigsRef.current.wetransfer);

      // Batch up to 10 recipients into a single WeTransfer transfer.
      // HTML-to-PDF personalization remains one lead per transfer because one
      // shared PDF cannot contain different per-recipient placeholder values.
      const batchLimit = wtConfig.convertHtmlToPdf ? 1 : 10;
      const batchLeads = pendingLeadsForSender.slice(0, batchLimit);
      const leadEmails = batchLeads.map((lead) => lead.email || lead.normalized);
      const leadNames = batchLeads.map((lead) => lead.name || '');
      const leadEmail = leadEmails[0];
      const leadName = leadNames[0] || '';

      updateLeads((prev) =>
        prev.map((lead) =>
          batchLeads.some((batchLead) => batchLead.id === lead.id)
            ? {
                ...lead,
                status: 'sending',
                senderStatus: { ...lead.senderStatus, [sender]: 'sending' },
              }
            : lead
        )
      );

      appendLog(
        'info',
        `Preparing WeTransfer recipient batch (${leadEmails.length}/10): ${leadEmails.join(', ')}`,
        'wetransfer'
      );
      const attachment = getWeTransferAttachmentDebug(wtConfig, wetransferUploadFile);

      const configuredDolphinProfileIds = wtConfig.dolphinProfileIds.filter(Boolean);
      const selectedDolphinProfileId =
        configuredDolphinProfileIds.length === 0
          ? ''
          : wtConfig.randomizeDolphinProfiles && configuredDolphinProfileIds.length > 1
            ? configuredDolphinProfileIds[
                Math.floor(Math.random() * configuredDolphinProfileIds.length)
              ]
            : configuredDolphinProfileIds[0];

      if (selectedDolphinProfileId) {
        appendLog(
          'info',
          `Dolphin profile selected for ${leadEmail}: ${selectedDolphinProfileId}${
            wtConfig.randomizeDolphinProfiles ? ' (randomized)' : ''
          }`,
          'wetransfer'
        );
      }

      setWeTransferSession((prev) => ({
        ...prev,
        status: 'sending',
        latestError: null,
        attachment,
      }));

      // Every recipient batch gets its own fresh temp-mail mailbox and
      // therefore its own fresh WeTransfer signup/account session.
      const tempMailProvider = credentials.wetransfer.provider || 'mailslurp';
      const tempMailApiKey =
        getSelectedTempMailApiKey(credentials.wetransfer) || '';

      const prepareFreshBatchSession = fetch('/api/wetransfer/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          tempMailProvider,
          tempMailApiKey,
          forceNewMailbox: true,
        }),
      })
        .then((res) => parseApiJson<WeTransferSessionApiResponse>(res))
        .then((sessionData) => {
          if (sessionData.error || sessionData.status === 'failed') {
            throw new Error(
              sessionData.error ||
                'Failed to create fresh WeTransfer mailbox for this batch.'
            );
          }

          if (Array.isArray(sessionData.logs)) {
            sessionData.logs.forEach((line: string) =>
              appendLog('info', line, 'wetransfer')
            );
          }

          setWeTransferSession((prev) => ({
            ...prev,
            sessionId: sessionData.sessionId ?? prev.sessionId,
            status: 'sending',
            mailbox: sessionData.mailbox?.email ?? null,
            mailboxMessageCount:
              sessionData.mailboxMessageCount ?? null,
            latestError: null,
            steps:
              (sessionData.steps as WeTransferStep[]) ??
              prev.steps,
          }));

          appendLog(
            'info',
            `Fresh WeTransfer account prepared for this batch | mailbox: ${
              sessionData.mailbox?.email ?? 'unknown'
            } | recipients: ${leadEmails.length}`,
            'wetransfer'
          );

          return sessionData;
        });

      const sendPayloadPromise = prepareFreshBatchSession.then(async () => {
        if (wtConfig.fileSource === 'upload') {
          const uploadFile = wetransferUploadFile;
          if (!uploadFile) {
            throw new Error('Upload file source is selected but no file is attached.');
          }
          const formData = new FormData();
          formData.append('campaignId', campaignId);
          formData.append('leadEmail', leadEmail);
          formData.append('leadName', leadName);
          formData.append('leadEmails', JSON.stringify(leadEmails));
          formData.append('leadNames', JSON.stringify(leadNames));
          formData.append('fileSource', 'upload');
          formData.append('ctaLink', wtConfig.ctaLink);
          formData.append('tempMailApiKey', getSelectedTempMailApiKey(credentials.wetransfer) || '');
          formData.append('uploadedFileName', uploadFile.name);
          formData.append('attachmentNameTemplate', wtConfig.attachmentNameTemplate || '{OriginalFile}');
          formData.append('convertHtmlToPdf', wtConfig.convertHtmlToPdf ? 'true' : 'false');
          formData.append(
            'replaceBatchPlaceholdersInPdf',
            wtConfig.replaceBatchPlaceholdersInPdf ? 'true' : 'false'
          );
          if (selectedDolphinProfileId) {
            formData.append('dolphinProfileId', selectedDolphinProfileId);
          }
          formData.append('uploadedFileMimeType', uploadFile.type || 'application/octet-stream');
          formData.append('uploadedFile', uploadFile);
          return { body: formData };
        }

        return {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            leadEmail,
            leadName,
            leadEmails,
            leadNames,
            fileSource: 'generated' as const,
            ctaLink: wtConfig.ctaLink,
            tempMailApiKey: getSelectedTempMailApiKey(credentials.wetransfer) || '',
            generatedTitle: wtConfig.generatedTitle,
            generatedSubtitle: wtConfig.generatedSubtitle,
            generatedBodyText: wtConfig.generatedBodyText,
            generatedLayout: wtConfig.generatedLayout,
            replaceBatchPlaceholdersInPdf: wtConfig.replaceBatchPlaceholdersInPdf,
            dolphinProfileId: selectedDolphinProfileId || undefined,
          }),
        };
      });

      sendPayloadPromise
        .then((requestInit) =>
          fetch('/api/wetransfer/send-lead', {
            method: 'POST',
            ...requestInit,
          })
        )
        .then((res) => parseApiJson<WeTransferSendLeadApiResponse>(res))
        .then((data) => {
          if (stopRequestedRef.current) {
            updateLeads((prev) =>
              prev.map((lead) => (lead.status === 'sending' ? { ...lead, status: 'pending' } : lead))
            );
            setRunState('stopped');
            setWeTransferSession((prev) => ({ ...prev, status: 'stopped' }));
            appendLog('stopped', `Send stopped for ${sender}`, sender);
            addToast('Send stopped', 'stopped');
            return;
          }
          // Log backend step lines
          if (Array.isArray(data.logs)) {
            data.logs.forEach((line: string) => appendLog('info', line, 'wetransfer'));
          }
          if (Array.isArray(data.steps)) {
            setWeTransferSession((prev) => ({ ...prev, steps: data.steps ?? prev.steps }));
          }
          const failureDetail = data.detail || data.error || 'WeTransfer send failed';
          const confirmationStatus = data.confirmationStatus || (data.success ? 'confirmed' : 'failed');
          setWeTransferSession((prev) => ({
            ...prev,
            mailbox: data.mailboxUsed ?? prev.mailbox,
            mailboxMessageCount: data.mailboxMessageCount ?? prev.mailboxMessageCount,
            latestError: confirmationStatus === 'failed' ? failureDetail : data.latestError ?? null,
            attachment: data.attachment
              ? {
                  name: data.attachment.name,
                  source: data.attachment.source,
                  mimeType: data.attachment.mimeType,
                  sizeBytes: data.attachment.sizeBytes,
                  readiness: data.attachment.ready ? 'ready' : 'missing',
                  detail: data.attachment.ready
                    ? 'Attachment is ready for the WeTransfer send flow.'
                    : 'Attachment is not ready for the WeTransfer send flow.',
                }
              : prev.attachment,
          }));
          updateLeads((prev) =>
            prev.map((lead) => {
              if (!batchLeads.some((batchLead) => batchLead.id === lead.id)) return lead;
              if (confirmationStatus === 'failed') {
                return {
                  ...lead,
                  status: 'failed',
                  failedAt: nowIso(),
                  senderStatus: { ...lead.senderStatus, [sender]: 'failed' },
                };
              }
              return {
                ...lead,
                status: 'sent',
                sentAt: nowIso(),
                senderStatus: { ...lead.senderStatus, [sender]: 'sent' },
              };
            })
          );
          appendLog(
            confirmationStatus === 'confirmed' ? 'success' : 'error',
            confirmationStatus === 'confirmed'
              ? `WeTransfer confirmed batch send (${leadEmails.length} recipients): ${leadEmails.join(', ')}${data.transferUrl ? ` | ${data.transferUrl}` : ''}`
              : `WeTransfer batch failed (${leadEmails.length} recipients): ${leadEmails.join(', ')}${failureDetail ? ` — ${failureDetail}` : ''}`,
            sender
          );
          // Dolphin may return HTTP 200 from /stop slightly before the profile is
          // fully released by the local synchronizer. Give it a settling window
          // before creating the next account/batch.
          const configuredDelayMs =
            senderConfigsRef.current[sender].rateLimitDelay * 1000;
          const delayMs = Math.max(3500, configuredDelayMs);

          appendLog(
            'info',
            `Batch complete. Waiting ${Math.round(
              delayMs / 1000
            )}s for Dolphin to fully stop before preparing the next WeTransfer account.`,
            'wetransfer'
          );

          timerRef.current = setTimeout(
            () => processNextLead(sender),
            delayMs
          );
        })
        .catch((err: Error) => {
          appendLog('error', `WeTransfer browser send error: ${err.message}`, 'wetransfer');
          setWeTransferSession((prev) => ({ ...prev, latestError: err.message }));
          updateLeads((prev) =>
            prev.map((lead) =>
              batchLeads.some((batchLead) => batchLead.id === lead.id)
                ? {
                    ...lead,
                    status: 'failed',
                    failedAt: nowIso(),
                    senderStatus: { ...lead.senderStatus, [sender]: 'failed' },
                  }
                : lead
            )
          );
          const delayMs = Math.max(300, senderConfigsRef.current[sender].rateLimitDelay * 1000);
          timerRef.current = setTimeout(() => processNextLead(sender), delayMs);
        });
      return;
    }

    // Non-WeTransfer senders: local simulation
    updateLeads((prev) =>
      prev.map((lead) =>
        lead.id === nextLead.id
          ? {
              ...lead,
              status: 'sending',
              senderStatus: { ...lead.senderStatus, [sender]: 'sending' },
            }
          : lead
      )
    );

    const delayMs = Math.max(300, senderConfigsRef.current[sender].rateLimitDelay * 1000);
    timerRef.current = setTimeout(() => {
      const shouldFail = nextLead.normalized.includes('fail') || Math.random() < 0.08;
      updateLeads((prev) =>
        prev.map((lead) => {
          if (lead.id !== nextLead.id) return lead;
          if (shouldFail) {
            return {
              ...lead,
              status: 'failed',
              failedAt: nowIso(),
              senderStatus: { ...lead.senderStatus, [sender]: 'failed' },
            };
          }
          return {
            ...lead,
            status: 'sent',
            sentAt: nowIso(),
            senderStatus: { ...lead.senderStatus, [sender]: 'sent' },
          };
        })
      );

      appendLog(
        shouldFail ? 'error' : 'success',
        shouldFail
          ? `Lead failed: ${nextLead.normalized}`
          : `Lead sent: ${nextLead.normalized}`,
        sender
      );

      processNextLead(sender);
    }, delayMs);
  }


  const refreshAdobeConnection = React.useCallback(async () => {
    try {
      const response = await fetch('/api/adobe/browser/status', {
        method: 'GET',
        cache: 'no-store',
      });
      const data = await parseApiJson<AdobeConnectionStatus>(response);
      setAdobeConnection(data);
      setSenderConfigs((prev) => ({
        ...prev,
        adobe: { ...prev.adobe, connected: Boolean(data.connected && data.loggedIn) },
      }));
    } catch (error) {
      setAdobeConnection((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  React.useEffect(() => {
    void refreshAdobeConnection();
    const timer = window.setInterval(() => void refreshAdobeConnection(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshAdobeConnection]);

  async function connectAdobeInBrowser() {
    setAdobeConnecting(true);

    try {
      const response = await fetch('/api/adobe/browser/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await parseApiJson<AdobeConnectionStatus & {
        success?: boolean;
      }>(response);

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error || `Adobe browser connect failed (HTTP ${response.status})`
        );
      }

      setAdobeConnection(data);
      appendLog(
        'info',
        'Adobe opened in the embedded screenshot browser. Log in manually in the Adobe panel.',
        'adobe'
      );
      addToast('Adobe browser connected — log in in the panel', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAdobeConnection((prev) => ({ ...prev, error: message }));
      appendLog('error', `Adobe browser connection failed: ${message}`, 'adobe');
      addToast(message, 'error');
    } finally {
      setAdobeConnecting(false);
    }
  }

  async function disconnectAdobe() {
    try {
      const response = await fetch('/api/adobe/browser/status', {
        method: 'DELETE',
      });
      const data = await parseApiJson<{ success?: boolean; error?: string }>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Adobe disconnect failed');
      }

      setAdobeConnection({ connected: false, loggedIn: false });
      setSenderConfigs((prev) => ({
        ...prev,
        adobe: { ...prev.adobe, connected: false },
      }));
      appendLog('info', 'Adobe browser session disconnected and closed', 'adobe');
      addToast('Adobe disconnected', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog('error', `Adobe disconnect failed: ${message}`, 'adobe');
      addToast(message, 'error');
    }
  }

  function startSend() {
    if (runState === 'running') return;
    const pendingForSender = leads.filter(
      (lead) => lead.status === 'pending' && lead.senderStatus[activeSender] !== 'sent'
    );

    if (!pendingForSender.length) {
      appendLog('warning', 'No pending leads to send. Resume skipped.', activeSender);
      addToast('No pending leads', 'warning');
      return;
    }

    if (activeSender === 'wetransfer') {
      const tempMailProvider = credentials.wetransfer.provider;
      const apiKey = safeTrim(getSelectedTempMailApiKey(credentials.wetransfer));
      const attachment = getWeTransferAttachmentDebug(
        senderConfigsRef.current.wetransfer,
        wetransferUploadFile
      );
      if (!apiKey) {
        const providerLabel = getTempMailProviderLabel(tempMailProvider);
        appendLog('error', `${providerLabel} API key is required for WeTransfer mode.`, 'wetransfer');
        addToast(`Set ${providerLabel} API key`, 'error');
        return;
      }
      if (attachment.readiness !== 'ready') {
        appendLog('error', attachment.detail, 'wetransfer');
        addToast('Attachment is not ready', 'error');
        return;
      }
      if (!safeTrim(senderConfigsRef.current.wetransfer.ctaLink)) {
        appendLog('warning', 'CTA link is empty. Generated PDFs will render a missing-link warning block.', 'wetransfer');
      }

      setIsPreparing(true);
      setWeTransferSession({
        sessionId: null,
        status: 'initializing',
        mailbox: null,
        mailboxMessageCount: null,
        latestError: null,
        attachment,
        steps: [],
      });
      appendLog('info', `Initialising WeTransfer session — creating ${getTempMailProviderLabel(tempMailProvider)} mailbox…`, 'wetransfer');
      appendLog(
        'info',
        senderConfigsRef.current.wetransfer.fileSource === 'generate'
          ? `Attachment strategy: generate a per-lead PDF in-app using parsed lead fields (${attachment.name}, ${attachment.mimeType ?? 'application/pdf'}, ${attachment.detail}).`
          : `Attachment strategy: reuse uploaded file "${attachment.name ?? 'missing'}" (${formatBytes(attachment.sizeBytes)}, ${attachment.mimeType ?? 'unknown'}) for each lead.`,
        'wetransfer'
      );
      appendLog(
        'info',
        `Attachment readiness: ${attachment.readiness} | source: ${attachment.source} | detail: ${attachment.detail}`,
        'wetransfer'
      );

      // Do not create one mailbox for the entire campaign.
      // processNextLead('wetransfer') creates a fresh mailbox/session for every
      // recipient batch (maximum 10 recipients per WeTransfer account).
      setIsPreparing(false);
      setRunState('running');
      stopRequestedRef.current = false;
      setWeTransferSession((prev) => ({
        ...prev,
        status: 'sending',
        latestError: null,
      }));

      appendLog(
        'info',
        `WeTransfer run started (${pendingForSender.length} pending). Each batch of up to 10 recipients will use a fresh temp-mail account and a fresh WeTransfer signup.`,
        'wetransfer'
      );

      processNextLead('wetransfer');
      return;
    }

    setIsPreparing(true);
    setTimeout(() => {
      setIsPreparing(false);
      setRunState('running');
      stopRequestedRef.current = false;
      appendLog('info', `Send started (${pendingForSender.length} pending)`, activeSender);
      addToast(`Started ${activeSender} run`, 'info');
      processNextLead(activeSender);
    }, 280);
  }

  function requestStop() {
    setShowStopConfirm(true);
  }

  function confirmStop() {
    stopRequestedRef.current = true;
    setShowStopConfirm(false);
  }

  const activeConfig = senderConfigs[activeSender];


  const cloudflareRedirectHeaders = React.useCallback(() => {
    return {
      'Content-Type': 'application/json',
      'x-cf-account-id': cloudflareRedirectConfig.accountId.trim(),
      'x-cf-api-token': cloudflareRedirectConfig.apiToken.trim(),
      'x-cf-kv-namespace-id': cloudflareRedirectConfig.namespaceId.trim(),
      'x-cf-public-base-url': normalizeCloudflarePublicBaseUrl(
        cloudflareRedirectConfig.publicBaseUrl
      ),
    };
  }, [cloudflareRedirectConfig]);

  const refreshCloudflareRedirects = React.useCallback(async () => {
    const { accountId, apiToken, namespaceId, publicBaseUrl } =
      cloudflareRedirectConfig;

    if (!accountId.trim() || !apiToken.trim() || !namespaceId.trim() || !publicBaseUrl.trim()) {
      setRedirectItems([]);
      return;
    }

    setRedirectBusy(true);
    setRedirectError(null);

    try {
      const response = await fetch('/api/cloudflare-redirects', {
        method: 'GET',
        headers: cloudflareRedirectHeaders(),
      });

      const data = await parseApiJson<{
        success?: boolean;
        redirects?: CloudflareRedirectItem[];
        error?: string;
      }>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Could not load redirects (HTTP ${response.status})`);
      }

      setRedirectItems(Array.isArray(data.redirects) ? data.redirects : []);
    } catch (error) {
      setRedirectError(error instanceof Error ? error.message : String(error));
    } finally {
      setRedirectBusy(false);
    }
  }, [cloudflareRedirectConfig, cloudflareRedirectHeaders]);

  const saveCloudflareRedirectConfigToSession = React.useCallback(() => {
    const normalized = {
      ...cloudflareRedirectConfig,
      publicBaseUrl: normalizeCloudflarePublicBaseUrl(
        cloudflareRedirectConfig.publicBaseUrl
      ),
    };

    window.sessionStorage.setItem(
      CLOUDFLARE_REDIRECT_SESSION_KEY,
      JSON.stringify(normalized)
    );
    setCloudflareRedirectConfig(normalized);
    addToast('Cloudflare redirect configuration saved to session', 'success');
  }, [cloudflareRedirectConfig, addToast]);

  const clearCloudflareRedirectConfig = React.useCallback(() => {
    window.sessionStorage.removeItem(CLOUDFLARE_REDIRECT_SESSION_KEY);
    setCloudflareRedirectConfig({
      accountId: '',
      apiToken: '',
      namespaceId: '',
      publicBaseUrl: '',
    });
    setRedirectItems([]);
    setRedirectError(null);
    addToast('Cloudflare redirect configuration cleared', 'success');
  }, [addToast]);

  const createOrUpdateCloudflareRedirect = React.useCallback(async () => {
    const destination = redirectDestination.trim();

    if (!destination) {
      setRedirectError('Destination URL is required.');
      return;
    }

    try {
      const parsed = new URL(destination);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Destination URL must use http or https.');
      }
    } catch {
      setRedirectError('Enter a valid http:// or https:// destination URL.');
      return;
    }

    const alias = (redirectAlias.trim() || createRandomRedirectAlias())
      .replace(/^\/+|\/+$/g, '');

    if (!/^[A-Za-z0-9_-]{1,80}$/.test(alias)) {
      setRedirectError(
        'Alias may contain only letters, numbers, hyphens, and underscores.'
      );
      return;
    }

    setRedirectBusy(true);
    setRedirectError(null);

    try {
      const method = redirectEditingAlias ? 'PUT' : 'POST';
      const response = await fetch('/api/cloudflare-redirects', {
        method,
        headers: cloudflareRedirectHeaders(),
        body: JSON.stringify({
          alias: redirectEditingAlias || alias,
          newAlias: redirectEditingAlias ? alias : undefined,
          destination,
          statusCode: redirectStatusCode,
        }),
      });

      const data = await parseApiJson<{
        success?: boolean;
        redirect?: CloudflareRedirectItem;
        error?: string;
      }>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Redirect operation failed (HTTP ${response.status})`);
      }

      setRedirectDestination('');
      setRedirectAlias('');
      setRedirectStatusCode(302);
      setRedirectEditingAlias(null);

      addToast(
        redirectEditingAlias ? 'Redirect updated' : 'Redirect created',
        'success'
      );

      await refreshCloudflareRedirects();
    } catch (error) {
      setRedirectError(error instanceof Error ? error.message : String(error));
    } finally {
      setRedirectBusy(false);
    }
  }, [
    redirectDestination,
    redirectAlias,
    redirectStatusCode,
    redirectEditingAlias,
    cloudflareRedirectHeaders,
    refreshCloudflareRedirects,
    addToast,
  ]);

  const deleteCloudflareRedirect = React.useCallback(
    async (alias: string) => {
      setRedirectBusy(true);
      setRedirectError(null);

      try {
        const response = await fetch(
          `/api/cloudflare-redirects?alias=${encodeURIComponent(alias)}`,
          {
            method: 'DELETE',
            headers: cloudflareRedirectHeaders(),
          }
        );

        const data = await parseApiJson<{ success?: boolean; error?: string }>(
          response
        );

        if (!response.ok || !data.success) {
          throw new Error(
            data.error || `Could not delete redirect (HTTP ${response.status})`
          );
        }

        addToast(`Redirect /${alias} deleted`, 'success');
        await refreshCloudflareRedirects();
      } catch (error) {
        setRedirectError(error instanceof Error ? error.message : String(error));
      } finally {
        setRedirectBusy(false);
      }
    },
    [cloudflareRedirectHeaders, refreshCloudflareRedirects, addToast]
  );


  React.useEffect(() => {
    if (activeModal === 'redirect-generator') {
      void refreshCloudflareRedirects();
    }
  }, [activeModal, refreshCloudflareRedirects]);

  return (
    <div className="min-h-screen flex bg-[#F8F9FC] text-slate-900">
      <aside
        className={`bg-[#1E1E2E] text-[#E0E0E0] ${sidebarOpen ? 'w-[260px]' : 'w-16'} transition-all duration-200 border-r border-[#2D2D44] flex flex-col`}
      >
        <div className="h-14 px-3 flex items-center justify-between border-b border-[#2D2D44]">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 rounded bg-[#6C63FF] text-white text-xs font-bold flex items-center justify-center">3D</div>
            {sidebarOpen && <span className="font-semibold">Campaign Console</span>}
          </div>
          <button onClick={() => setSidebarOpen((prev) => !prev)} title="Toggle sidebar">
            <Menu className="w-4 h-4 text-[#9F9FF8]" />
          </button>
        </div>

        <nav className="p-2 space-y-1 overflow-y-auto">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === 'crm-sender' && activeModal === null;
            return (
              <button
                key={item.id}
                onClick={() => openModule(item.id)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded transition-colors text-sm"
                style={
                  isActive
                    ? { background: '#2D2D44', borderLeft: '3px solid #6C63FF', color: '#FFFFFF' }
                    : { color: '#E0E0E0' }
                }
                title={item.label}
              >
                <Icon className="w-4 h-4 text-[#6C63FF]" />
                {sidebarOpen && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center gap-3 sticky top-0 z-20">
          <button className="p-2 rounded hover:bg-slate-100" title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>

          <input
            value={campaignName}
            onChange={(event) => setCampaignName(event.target.value)}
            className="h-9 px-3 rounded border border-slate-300 text-sm min-w-0 w-[280px]"
            placeholder="Campaign name"
          />

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={saveSession}
              className="h-9 px-3 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-2"
              title="Save session"
            >
              <Save className="w-4 h-4" /> Save
            </button>
            <button
              onClick={startSend}
              disabled={runState === 'running' || isPreparing}
              className="h-9 px-3 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm flex items-center gap-2"
              title="Start send"
            >
              <Send className="w-4 h-4" /> {isPreparing ? 'Preparing...' : 'Send'}
            </button>
            <button
              onClick={requestStop}
              disabled={runState !== 'running'}
              className="h-9 px-3 rounded bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm flex items-center gap-2"
              title="Stop send"
            >
              <Square className="w-4 h-4" /> Stop
            </button>
          </div>
        </header>

        <section className="px-4 py-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap gap-2">
            {SENDERS.map((sender) => (
              <button
                key={sender.key}
                onClick={() => {
                  setActiveSender(sender.key);
                  appendLog('info', `Provider changed to ${sender.label}`, 'system');
                }}
                className="px-3 py-1.5 rounded text-sm border"
                style={
                  activeSender === sender.key
                    ? { background: '#6C63FF', color: '#fff', borderColor: '#6C63FF' }
                    : { background: '#fff', color: '#4B5563', borderColor: '#D1D5DB' }
                }
              >
                {sender.label}
              </button>
            ))}
            <button className="px-3 py-1.5 rounded text-sm border border-dashed border-[#6C63FF] text-[#6C63FF]">
              + Add Sender
            </button>
          </div>
        </section>

        <section className="p-4 grid md:grid-cols-6 gap-3">
          <StatCard label="Uploaded" value={totalUploaded} />
          <StatCard label="Sent" value={totalSent} tone="success" />
          <StatCard label="Remaining" value={totalRemaining} tone="warning" />
          <StatCard label="Failed" value={totalFailed} tone="danger" />
          <StatCard label="Run" value={runState} />
          <StatCard label="Success" value={`${successRate}%`} />
        </section>

        <section className="px-4 pb-4 flex-1 overflow-auto space-y-4">
          {activeSender === 'wetransfer' ? (
            <div className="space-y-4">
              <div className="grid lg:grid-cols-2 gap-4">
                <Panel title="Connection & Account">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <Field label="Status">
                      <span className={`px-2 py-1 rounded ${activeConfig.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {activeConfig.connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </Field>
                    <Field label="Temp Provider">
                      <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-mono">temp-mail.io</span>
                    </Field>
                    <Field label="Pool Size">
                      <input
                        type="number"
                        className="input"
                        value={activeConfig.poolSize}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, poolSize: Number(event.target.value || 0) },
                          }))
                        }
                      />
                    </Field>
                    <Field label="Rate Delay (sec)">
                      <input
                        type="number"
                        className="input"
                        value={activeConfig.rateLimitDelay}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, rateLimitDelay: Number(event.target.value || 1) },
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                    <div className="text-sm font-semibold text-slate-800">Temporary email provider</div>

                    <div className="flex flex-wrap gap-2">
                      {(['mailslurp', 'tempmailio'] as const).map((provider) => (
                        <button
                          key={provider}
                          type="button"
                          className={`px-3 py-2 rounded text-xs font-semibold border ${
                            credentials.wetransfer.provider === provider
                              ? 'bg-[#6C63FF] text-white border-[#6C63FF]'
                              : 'bg-white text-slate-700 border-slate-300'
                          }`}
                          onClick={() =>
                            setCredentials((prev) => ({
                              ...prev,
                              wetransfer: { ...prev.wetransfer, provider },
                            }))
                          }
                        >
                          {getTempMailProviderLabel(provider)}
                        </button>
                      ))}
                    </div>

                    <Field label={`${getTempMailProviderLabel(credentials.wetransfer.provider)} API Key`}>
                      <div className="space-y-2">
                        <input
                          type="password"
                          className="input w-full"
                          value={getSelectedTempMailApiKey(credentials.wetransfer)}
                          onChange={(event) =>
                            setCredentials((prev) => ({
                              ...prev,
                              wetransfer: {
                                ...prev.wetransfer,
                                ...(prev.wetransfer.provider === 'tempmailio'
                                  ? { tempMailIoApiKey: event.target.value }
                                  : { mailSlurpApiKey: event.target.value }),
                              },
                            }))
                          }
                          placeholder={`Paste ${getTempMailProviderLabel(credentials.wetransfer.provider)} API key`}
                        />

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold"
                            onClick={() => {
                              const provider = credentials.wetransfer.provider;
                              const apiKey = getSelectedTempMailApiKey(credentials.wetransfer).trim();

                              if (!apiKey) {
                                addToast('Enter an API key first', 'warning');
                                return;
                              }

                              window.sessionStorage.setItem(
                                TEMP_MAIL_SESSION_KEYS[provider],
                                apiKey
                              );
                              addToast(
                                `${getTempMailProviderLabel(provider)} API key saved for this browser session`,
                                'success'
                              );
                            }}
                          >
                            Save to session
                          </button>

                          <button
                            type="button"
                            className="px-3 py-2 rounded border border-red-300 bg-white text-red-600 text-xs font-semibold"
                            onClick={() => {
                              const provider = credentials.wetransfer.provider;
                              window.sessionStorage.removeItem(
                                TEMP_MAIL_SESSION_KEYS[provider]
                              );

                              setCredentials((prev) => ({
                                ...prev,
                                wetransfer: {
                                  ...prev.wetransfer,
                                  ...(provider === 'tempmailio'
                                    ? { tempMailIoApiKey: '' }
                                    : { mailSlurpApiKey: '' }),
                                },
                              }));

                              addToast(
                                `${getTempMailProviderLabel(provider)} API key cleared`,
                                'success'
                              );
                            }}
                          >
                            Clear
                          </button>

                          <span
                            className={`px-2 py-1 rounded text-xs flex items-center ${
                              getSelectedTempMailApiKey(credentials.wetransfer)
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {getSelectedTempMailApiKey(credentials.wetransfer)
                              ? '✓ Set'
                              : '! Required'}
                          </span>
                        </div>
                      </div>
                    </Field>
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Dolphin profile IDs</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Add one or more existing Dolphin browser profile IDs. The selected profile is used for the WeTransfer run.
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        className="input flex-1"
                        value={newDolphinProfileId}
                        onChange={(event) => setNewDolphinProfileId(event.target.value)}
                        placeholder="Example: 826665603"
                      />
                      <button
                        type="button"
                        className="px-3 py-2 rounded bg-[#6C63FF] text-white text-xs font-semibold"
                        onClick={() => {
                          const profileId = newDolphinProfileId.trim();
                          if (!profileId) return;

                          setSenderConfigs((prev) => {
                            const existing = prev.wetransfer.dolphinProfileIds || [];
                            if (existing.includes(profileId)) return prev;

                            return {
                              ...prev,
                              wetransfer: {
                                ...prev.wetransfer,
                                dolphinProfileIds: [...existing, profileId],
                              },
                            };
                          });

                          setNewDolphinProfileId('');
                        }}
                      >
                        Add
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {activeConfig.dolphinProfileIds.length > 0 ? (
                        activeConfig.dolphinProfileIds.map((profileId) => (
                          <span
                            key={profileId}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                          >
                            {profileId}
                            <button
                              type="button"
                              className="text-red-500 font-bold"
                              onClick={() =>
                                setSenderConfigs((prev) => ({
                                  ...prev,
                                  wetransfer: {
                                    ...prev.wetransfer,
                                    dolphinProfileIds: prev.wetransfer.dolphinProfileIds.filter(
                                      (id) => id !== profileId
                                    ),
                                  },
                                }))
                              }
                              aria-label={`Delete Dolphin profile ${profileId}`}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      ) : (
                        <div className="text-xs text-amber-700">No Dolphin profile ID added yet.</div>
                      )}
                    </div>

                    {activeConfig.dolphinProfileIds.length > 1 && (
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={activeConfig.randomizeDolphinProfiles}
                          onChange={(event) =>
                            setSenderConfigs((prev) => ({
                              ...prev,
                              wetransfer: {
                                ...prev.wetransfer,
                                randomizeDolphinProfiles: event.target.checked,
                              },
                            }))
                          }
                        />
                        Randomize Dolphin profile for each lead
                      </label>
                    )}

                    {!activeConfig.randomizeDolphinProfiles &&
                      activeConfig.dolphinProfileIds.length > 0 && (
                        <div className="text-[11px] text-slate-500">
                          Using first profile: <code>{activeConfig.dolphinProfileIds[0]}</code>
                        </div>
                      )}
                  </div>

                  <div className="mt-3 flex items-center gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={activeConfig.autoRotate}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, autoRotate: event.target.checked },
                          }))
                        }
                      />
                      Auto-rotate
                    </label>
                  </div>
                </Panel>

                <Panel title="File / Message / CTA">
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <Field label="File Source">
                      <select
                        className="input"
                        value={activeConfig.fileSource}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, fileSource: event.target.value as 'upload' | 'generate' },
                          }))
                        }
                      >
                        <option value="upload">Upload attachment</option>
                        <option value="generate">Generate PDF in app</option>
                      </select>
                    </Field>
                    <Field label="CTA Link (used in generated PDF)">
                      <input
                        className="input"
                        placeholder="https://example.com/secure-link"
                        value={activeConfig.ctaLink}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, ctaLink: event.target.value },
                          }))
                        }
                      />
                    </Field>
                    <Field label="PDF Orientation">
                      <select
                        className="input"
                        value={activeConfig.orientation}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, orientation: event.target.value as 'landscape' | 'portrait' },
                          }))
                        }
                      >
                        <option value="landscape">Horizontal / Landscape</option>
                        <option value="portrait">Vertical / Portrait</option>
                      </select>
                    </Field>
                    <Field label="Design">
                      <input
                        className="input"
                        value={activeConfig.design}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, design: event.target.value },
                          }))
                        }
                      />
                    </Field>
                    <Field label="CTA Style">
                      <select
                        className="input"
                        value={activeConfig.cta}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, cta: event.target.value as 'button' | 'qr' },
                          }))
                        }
                      >
                        <option value="button">Button</option>
                        <option value="qr">QR code</option>
                      </select>
                    </Field>
                    <Field label="File Type">
                      <select
                        className="input"
                        value={activeConfig.fileType}
                        onChange={(event) =>
                          setSenderConfigs((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, fileType: event.target.value },
                          }))
                        }
                      >
                        {['PDF', 'PPTX', 'DOCX', 'ZIP'].map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {activeConfig.fileSource === 'upload' && (
                    <div className="mt-3 space-y-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-800">WeTransfer attachment</div>
                        <div className="text-xs text-slate-500 mt-1">
                          Select the exact file to upload to WeTransfer. The same selected attachment is reused for each lead in this run.
                          PDF, HTML, ZIP, SVG, Office documents, images, text files, and other file types are supported.
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-2 px-3 py-2 rounded bg-[#6C63FF] text-white text-xs font-semibold cursor-pointer">
                          <Upload className="w-4 h-4" />
                          Choose attachment
                          <input
                            type="file"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              setWetransferUploadFile(file);

                              if (file) {
                                setSenderConfigs((prev) => ({
                                  ...prev,
                                  wetransfer: {
                                    ...prev.wetransfer,
                                    fileSource: 'upload',
                                    fileType:
                                      file.name.includes('.')
                                        ? file.name.split('.').pop()?.toUpperCase() || prev.wetransfer.fileType
                                        : prev.wetransfer.fileType,
                                  },
                                }));

                                appendLog(
                                  'success',
                                  `WeTransfer attachment selected: ${file.name} (${formatBytes(file.size)})`,
                                  'wetransfer'
                                );
                              }
                            }}
                          />
                        </label>

                        {wetransferUploadFile && (
                          <button
                            type="button"
                            className="px-3 py-2 rounded border border-slate-300 bg-white text-xs text-slate-700"
                            onClick={() => {
                              setWetransferUploadFile(null);
                              appendLog('warning', 'WeTransfer attachment cleared', 'wetransfer');
                            }}
                          >
                            Clear attachment
                          </button>
                        )}
                      </div>

                      <div className="text-xs">
                        {wetransferUploadFile ? (
                          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                            <div className="font-semibold">Ready to upload</div>
                            <div className="mt-1 break-all">{wetransferUploadFile.name}</div>
                            <div className="mt-1 text-emerald-700">
                              {formatBytes(wetransferUploadFile.size)} · {wetransferUploadFile.type || 'application/octet-stream'}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                            No attachment selected. Choose a file before starting the WeTransfer run.
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-700">
                          Attachment name template
                        </label>
                        <input
                          className="input"
                          value={activeConfig.attachmentNameTemplate}
                          onChange={(event) =>
                            setSenderConfigs((prev) => ({
                              ...prev,
                              wetransfer: {
                                ...prev.wetransfer,
                                attachmentNameTemplate: event.target.value,
                              },
                            }))
                          }
                          placeholder="{Email}-{OriginalName}.{Ext}"
                        />
                        <div className="text-[11px] leading-5 text-slate-500">
                          Auto-grab placeholders:
                          {' '}
                          <code>{'{Email}'}</code> = full lead email,
                          {' '}
                          <code>{'{LocalPart}'}</code> = text before @,
                          {' '}
                          <code>{'{Domain}'}</code> = example.com,
                          {' '}
                          <code>{'{DomainName}'}</code> = example,
                          {' '}
                          <code>{'{TLD}'}</code> = com,
                          {' '}
                          <code>{'{Name}'}</code> = lead name,
                          {' '}
                          <code>{'{OriginalName}'}</code> = original filename without extension,
                          {' '}
                          <code>{'{OriginalFile}'}</code> = original full filename,
                          {' '}
                          <code>{'{Ext}'}</code> = original extension.
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Example:
                          {' '}
                          <code>{'{DomainName}-Tender-{Email}.{Ext}'}</code>
                          {' '}
                          → example-Tender-user@example.com.pdf
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={activeConfig.convertHtmlToPdf}
                            onChange={(event) =>
                              setSenderConfigs((prev) => ({
                                ...prev,
                                wetransfer: {
                                  ...prev.wetransfer,
                                  convertHtmlToPdf: event.target.checked,
                                },
                              }))
                            }
                          />
                          Convert uploaded HTML to PDF per lead
                        </label>
                        <div className="text-[11px] leading-5 text-slate-500">
                          When enabled, an uploaded .html/.htm file is personalized for each lead, rendered as PDF,
                          and the generated PDF is sent through WeTransfer.
                        </div>
                        <div className="text-[11px] leading-5 text-slate-500">
                          Placeholders supported inside the HTML:
                          {' '}<code>{'{Email}'}</code>,
                          {' '}<code>{'{LocalPart}'}</code>,
                          {' '}<code>{'{Domain}'}</code>,
                          {' '}<code>{'{DomainName}'}</code>,
                          {' '}<code>{'{TLD}'}</code>,
                          {' '}<code>{'{Name}'}</code>.
                          Double braces such as <code>{'{{Email}}'}</code> also work.
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={activeConfig.replaceBatchPlaceholdersInPdf}
                            onChange={(event) =>
                              setSenderConfigs((prev) => ({
                                ...prev,
                                wetransfer: {
                                  ...prev.wetransfer,
                                  replaceBatchPlaceholdersInPdf: event.target.checked,
                                },
                              }))
                            }
                          />
                          Replace batch placeholders in uploaded PDF form fields
                        </label>

                        <div className="text-[11px] leading-5 text-slate-500">
                          Generates one shared set of values for the whole recipient batch (up to 10 recipients).
                          Supported placeholders:
                          {' '}<code>{'{Date}'}</code>,
                          {' '}<code>{'{Time}'}</code>,
                          {' '}<code>{'{DateTime}'}</code>,
                          {' '}<code>{'{Reference}'}</code>,
                          {' '}<code>{'{Random6}'}</code>,
                          {' '}<code>{'{Random8}'}</code>,
                          {' '}<code>{'{UUID}'}</code>,
                          {' '}<code>{'{BatchId}'}</code>.
                        </div>

                        <div className="text-[11px] leading-5 text-amber-700">
                          For uploaded PDFs, reliable replacement works with PDF text/form fields whose field name
                          or current value is one of these placeholders. Ordinary text already baked into a PDF page
                          is left unchanged. HTML-to-PDF and attachment filenames support direct placeholder replacement.
                        </div>
                      </div>

                    </div>
                  )}
                  {activeConfig.fileSource === 'generate' && (
                    <div className="mt-3 grid sm:grid-cols-2 gap-3 text-sm">
                      <Field label="Generated PDF Title">
                        <input
                          className="input"
                          value={activeConfig.generatedTitle}
                          onChange={(event) =>
                            setSenderConfigs((prev) => ({
                              ...prev,
                              wetransfer: { ...prev.wetransfer, generatedTitle: event.target.value },
                            }))
                          }
                        />
                      </Field>
                      <Field label="Layout Mode">
                        <select
                          className="input"
                          value={activeConfig.generatedLayout}
                          onChange={(event) =>
                            setSenderConfigs((prev) => ({
                              ...prev,
                              wetransfer: {
                                ...prev.wetransfer,
                                generatedLayout: event.target.value as 'classic' | 'highlight',
                              },
                            }))
                          }
                        >
                          <option value="classic">Classic</option>
                          <option value="highlight">Highlight</option>
                        </select>
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Generated Subtitle">
                          <input
                            className="input"
                            value={activeConfig.generatedSubtitle}
                            onChange={(event) =>
                              setSenderConfigs((prev) => ({
                                ...prev,
                                wetransfer: { ...prev.wetransfer, generatedSubtitle: event.target.value },
                              }))
                            }
                          />
                        </Field>
                      </div>
                      <div className="sm:col-span-2">
                        <Field label="Generated Body Text">
                          <textarea
                            rows={3}
                            className="input"
                            value={activeConfig.generatedBodyText}
                            onChange={(event) =>
                              setSenderConfigs((prev) => ({
                                ...prev,
                                wetransfer: { ...prev.wetransfer, generatedBodyText: event.target.value },
                              }))
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                    <div className="font-semibold text-slate-800">WeTransfer attachment debug</div>
                    <div>
                      Readiness:{' '}
                      <span
                        className={
                          wetransferAttachment.readiness === 'ready'
                            ? 'text-emerald-600 font-semibold'
                            : 'text-red-600 font-semibold'
                        }
                      >
                        {wetransferAttachment.readiness}
                      </span>
                    </div>
                    <div>Name: {wetransferAttachment.name ?? 'none selected'}</div>
                    <div>Source: {wetransferAttachment.source}</div>
                    <div>MIME: {wetransferAttachment.mimeType ?? 'unknown'}</div>
                    <div>Size: {formatBytes(wetransferAttachment.sizeBytes)}</div>
                    <div className="text-slate-500">{wetransferAttachment.detail}</div>
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={activeConfig.useCustomMessage}
                      onChange={(event) =>
                        setSenderConfigs((prev) => ({
                          ...prev,
                          wetransfer: { ...prev.wetransfer, useCustomMessage: event.target.checked },
                        }))
                      }
                    />
                    Custom transfer message
                  </label>
                    <p className="mt-2 text-xs text-slate-500">
                      Lead autograb supports plain emails and <span className="font-mono">Name &lt;email&gt;</span>. In Generate mode, PDFs are created per lead before each send attempt.
                    </p>
                </Panel>

                <Panel title="Chromium / Browser Proxy Settings">
                  <div className="space-y-4 text-sm">
                    <p className="text-slate-500 text-xs">
                      Dedicated proxy configuration for Chromium/Playwright browser automation.
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer font-medium">
                        <input
                          type="checkbox"
                          checked={browserProxy.enabled}
                          onChange={(e) => setBrowserProxy((p) => ({ ...p, enabled: e.target.checked }))}
                        />
                        Enable browser proxy
                      </label>
                      <span className={`px-2 py-0.5 rounded text-xs font-mono ${browserProxy.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {browserProxy.enabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <fieldset
                      disabled={!browserProxy.enabled}
                      className={`grid sm:grid-cols-2 gap-3 rounded border border-slate-200 p-3 transition-opacity ${browserProxy.enabled ? 'bg-white opacity-100' : 'bg-slate-50 opacity-60'}`}
                    >
                      <Field label="Protocol">
                        <select
                          className="input"
                          value={browserProxy.protocol}
                          onChange={(e) => setBrowserProxy((p) => ({ ...p, protocol: e.target.value as 'http' | 'socks5' }))}
                          disabled={!browserProxy.enabled}
                        >
                          <option value="http">http</option>
                          <option value="socks5">socks5</option>
                        </select>
                      </Field>
                      <Field label="Host">
                        <input
                          className="input"
                          value={browserProxy.host}
                          onChange={(e) => setBrowserProxy((p) => ({ ...p, host: e.target.value }))}
                          placeholder="e.g. gate.nodemaven.com"
                          disabled={!browserProxy.enabled}
                        />
                      </Field>
                      <Field label="Port">
                        <input
                          type="number"
                          className="input"
                          value={browserProxy.port}
                          onChange={(e) => setBrowserProxy((p) => ({ ...p, port: e.target.value }))}
                          placeholder="8080"
                          min={1}
                          max={65535}
                          disabled={!browserProxy.enabled}
                        />
                      </Field>
                      <Field label="Username">
                        <input
                          className="input"
                          value={browserProxy.username}
                          onChange={(e) => setBrowserProxy((p) => ({ ...p, username: e.target.value }))}
                          placeholder="Proxy username"
                          autoComplete="off"
                          disabled={!browserProxy.enabled}
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Password">
                          <div className="flex gap-2 items-center">
                            <input
                              type="password"
                              className="input flex-1"
                              value={browserProxy.password}
                              onChange={(e) => setBrowserProxy((p) => ({ ...p, password: e.target.value }))}
                              placeholder={browserProxyHasPassword ? '••••••• (set — re-enter to change)' : 'Leave blank if no auth'}
                              autoComplete="new-password"
                              disabled={!browserProxy.enabled}
                            />
                            {browserProxyHasPassword && (
                              <button
                                className="px-2 py-1 rounded border text-xs text-red-600 border-red-300 hover:bg-red-50 disabled:opacity-50"
                                onClick={() => { setBrowserProxy((p) => ({ ...p, password: '' })); setBrowserProxyHasPassword(false); }}
                                title="Clear stored password"
                                type="button"
                                disabled={!browserProxy.enabled}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </Field>
                      </div>
                    </fieldset>
                    {browserProxyError && (
                      <p className="text-red-600 text-xs mt-1">{browserProxyError}</p>
                    )}
                    {browserProxyTestResult && (
                      <div className={`rounded border px-3 py-2 text-xs ${
                        browserProxyTestResult.level === 'success'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : browserProxyTestResult.level === 'warning'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                      }`}>
                        <div>{browserProxyTestResult.message}</div>
                        {browserProxyTestResult.diagnostics && (
                          <div className="mt-1 font-mono text-[11px] opacity-80">
                            {browserProxyTestResult.diagnostics}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button
                        className="px-3 py-2 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                        disabled={!browserProxy.enabled || browserProxySaving || browserProxyTesting}
                        onClick={testBrowserProxy}
                        type="button"
                        title={browserProxy.enabled ? 'Validate the configured proxy using the browser automation path' : 'Enable proxy to test it'}
                      >
                        {browserProxyTesting ? 'Testing…' : 'Test Proxy'}
                      </button>
                      <button
                        className="px-3 py-2 rounded bg-[#6C63FF] text-white disabled:opacity-50"
                        disabled={browserProxySaving || browserProxyTesting}
                        onClick={saveBrowserProxySettings}
                        type="button"
                      >
                        {browserProxySaving ? 'Saving…' : 'Save Proxy Settings'}
                      </button>
                    </div>
                  </div>
                </Panel>
              </div>

              {/* WeTransfer execution steps panel */}
              <WeTransferStepsPanel session={weTransferSession} />
            </div>
          ) : activeSender === 'adobe' ? (
            <AdobeSenderPanel
              connection={adobeConnection}
              connecting={adobeConnecting}
              leadEmails={leads
                .map((lead) => lead.email || lead.normalized)
                .filter((email): email is string => Boolean(email))}
              onConnect={() => void connectAdobeInBrowser()}
              onDisconnect={() => void disconnectAdobe()}
              onRefresh={() => void refreshAdobeConnection()}
              onLog={(level, message) => appendLog(level, message, 'adobe')}
              onToast={addToast}
            />
          ) : activeSender === 'inquiry' ? (
            <InquirySenderPanel
              leadEmails={leads
                .map((lead) => lead.email || lead.normalized)
                .filter((email): email is string => Boolean(email))}
              onLog={(level, message) => appendLog(level, message, 'inquiry')}
              onToast={addToast}
            />
          ) : activeSender === 'gmail' ? (
            <GmailSenderPanel
              leadEmails={leads
                .map((lead) => lead.email || lead.normalized)
                .filter((email): email is string => Boolean(email))}
              onLog={(level, message) => appendLog(level, message, 'gmail')}
              onToast={addToast}
            />
          ) : activeSender === 'smtp' || activeSender === 'microsoft' ? (
            <div>
              {/* Keep both SMTP workspaces mounted at the same time. This is intentional:
                  switching between SMTP and Microsoft must never unmount, pause, or reset
                  the other sender's active job, form state, proxy pool, or live log reader. */}
              <div className={activeSender === 'smtp' ? 'block' : 'hidden'}>
                <SmtpSenderPanel
                  senderMode="smtp"
                  leadEmails={leads
                    .map((lead) => lead.email || lead.normalized)
                    .filter((email): email is string => Boolean(email))}
                  senderLogs={logs.filter((log) => log.sender === 'smtp')}
                  onClearSenderLogs={() => clearSenderLogs('smtp')}
                  onLog={(level, message) => appendLog(level, message, 'smtp')}
                  onToast={addToast}
                />
              </div>

              <div className={activeSender === 'microsoft' ? 'block' : 'hidden'}>
                <SmtpSenderPanel
                  senderMode="microsoft"
                  leadEmails={leads
                    .map((lead) => lead.email || lead.normalized)
                    .filter((email): email is string => Boolean(email))}
                  senderLogs={logs.filter((log) => log.sender === 'microsoft')}
                  onClearSenderLogs={() => clearSenderLogs('microsoft')}
                  onLog={(level, message) => appendLog(level, message, 'microsoft')}
                  onToast={addToast}
                />
              </div>
            </div>
          ) : (
            <MockSenderPanel
              sender={activeSender}
              config={activeConfig}
              onConfigChange={(next) =>
                setSenderConfigs((prev) => ({ ...prev, [activeSender]: { ...prev[activeSender], ...next } }))
              }
              onLog={(msg) => appendLog('info', msg, activeSender)}
            />
          )}
        </section>

        <section className="bg-[#1A1A2E] text-white px-4 py-3 border-t border-[#2D2D44] h-56 overflow-auto font-mono text-xs">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-slate-300 uppercase tracking-wide">Runtime Logs</span>
            <button
              type="button"
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
              onClick={clearVisibleLogs}
            >
              Clear Logs
            </button>
          </div>
          <div className="space-y-1">
            {logs.length === 0 && <div className="text-slate-400">No runtime actions yet.</div>}
            {logs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className="text-[#A78BFA]">{formatTime(log.timestamp)}</span>
                <span className="uppercase min-w-[88px]" style={{ color: senderColor(log.sender) }}>
                  [{log.sender}]
                </span>
                <span style={{ color: levelColor(log.level) }}>{log.level}</span>
                <span style={{ color: '#E2E8F0' }}>{log.message}</span>
              </div>
            ))}
            <div className="text-slate-500">— end of log —</div>
          </div>
        </section>
      </main>

      <div className="fixed right-4 bottom-4 bg-white shadow-lg rounded-lg border border-slate-200 p-3 w-64">
        <p className="text-xs text-slate-500">Quick URL</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="text-xs truncate flex-1">https://local.3d-suite/session/current</code>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText('https://local.3d-suite/session/current');
              addToast('Quick URL copied', 'success');
            }}
            title="Copy URL"
          >
            <Copy className="w-4 h-4 text-[#6C63FF]" />
          </button>
        </div>
      </div>

      {activeModal && (
        <ModalShell title={modalTitle(activeModal)} onClose={() => setActiveModal(null)}>
          {activeModal === 'leads' && (
            <div className="space-y-3 text-sm">
              <textarea
                rows={7}
                value={leadsInput}
                onChange={(event) => setLeadsInput(event.target.value)}
                placeholder={`Paste one lead per line\nalice@example.com\nAlice Smith <alice@example.com>`}
                className="w-full border rounded px-3 py-2 font-mono"
              />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={dedupeEnabled} onChange={(event) => setDedupeEnabled(event.target.checked)} />
                  Dedupe exact duplicates
                </label>
                <label className="text-xs cursor-pointer text-[#6C63FF] inline-flex items-center gap-1">
                  <Upload className="w-3 h-3" /> Upload text file
                  <input type="file" className="hidden" accept=".txt,.csv,.log,.text" onChange={handleLeadFileUpload} />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="Uploaded" value={totalUploaded} />
                <MiniStat label="Sent" value={totalSent} />
                <MiniStat label="Remaining" value={totalRemaining} />
              </div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-2 rounded bg-[#6C63FF] text-white"
                  onClick={() => {
                    importLeadLines(parseLeadLines(leadsInput));
                    setLeadsInput('');
                  }}
                >
                  Parse & Add Leads
                </button>
                <button className="px-3 py-2 rounded border" onClick={clearAllLeads}>Clear All</button>
              </div>
            </div>
          )}

          {activeModal === 'credentials' && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  WeTransfer / Temporary Email
                </p>

                <div className="space-y-3">
                  <div className="flex gap-2">
                    {(['mailslurp', 'tempmailio'] as const).map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        className={`px-3 py-2 rounded text-xs font-semibold border ${
                          credentials.wetransfer.provider === provider
                            ? 'bg-[#6C63FF] text-white border-[#6C63FF]'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                        onClick={() =>
                          setCredentials((prev) => ({
                            ...prev,
                            wetransfer: { ...prev.wetransfer, provider },
                          }))
                        }
                      >
                        {getTempMailProviderLabel(provider)}
                      </button>
                    ))}
                  </div>

                  <Field label={`${getTempMailProviderLabel(credentials.wetransfer.provider)} API Key`}>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="password"
                        className="input flex-1 min-w-[240px]"
                        value={getSelectedTempMailApiKey(credentials.wetransfer)}
                        onChange={(event) =>
                          setCredentials((prev) => ({
                            ...prev,
                            wetransfer: {
                              ...prev.wetransfer,
                              ...(prev.wetransfer.provider === 'tempmailio'
                                ? { tempMailIoApiKey: event.target.value }
                                : { mailSlurpApiKey: event.target.value }),
                            },
                          }))
                        }
                      />

                      <button
                        type="button"
                        className="px-3 py-2 rounded bg-emerald-600 text-white text-xs"
                        onClick={() => {
                          const provider = credentials.wetransfer.provider;
                          const key = getSelectedTempMailApiKey(credentials.wetransfer).trim();

                          if (!key) {
                            addToast('Enter an API key first', 'warning');
                            return;
                          }

                          window.sessionStorage.setItem(
                            TEMP_MAIL_SESSION_KEYS[provider],
                            key
                          );
                          addToast(
                            `${getTempMailProviderLabel(provider)} API key saved to session`,
                            'success'
                          );
                        }}
                      >
                        Save to session
                      </button>

                      <button
                        type="button"
                        className="px-3 py-2 rounded border border-red-300 text-red-600 text-xs"
                        onClick={() => {
                          const provider = credentials.wetransfer.provider;
                          window.sessionStorage.removeItem(
                            TEMP_MAIL_SESSION_KEYS[provider]
                          );

                          setCredentials((prev) => ({
                            ...prev,
                            wetransfer: {
                              ...prev.wetransfer,
                              ...(provider === 'tempmailio'
                                ? { tempMailIoApiKey: '' }
                                : { mailSlurpApiKey: '' }),
                            },
                          }));
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </Field>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="WeTransfer Account (optional)">
                      <input
                        className="input"
                        value={credentials.wetransfer.account}
                        onChange={(e) =>
                          setCredentials((p) => ({
                            ...p,
                            wetransfer: {
                              ...p.wetransfer,
                              account: e.target.value,
                            },
                          }))
                        }
                      />
                    </Field>

                    <Field label="Global Browser Proxy (optional)">
                      <div className="space-y-2">
                        <input
                          className="input"
                          value={credentials.wetransfer.proxy}
                          onChange={(event) => {
                            const value = event.target.value;

                            setCredentials((prev) => ({
                              ...prev,
                              wetransfer: {
                                ...prev.wetransfer,
                                proxy: value,
                              },
                            }));
                          }}
                          onBlur={(event) =>
                            applyGlobalProxyText(event.target.value)
                          }
                          placeholder="http://host:port or socks5://user:pass@host:port"
                        />

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded bg-[#6C63FF] px-3 py-2 text-xs text-white disabled:opacity-50"
                            disabled={browserProxySaving}
                            onClick={() => {
                              applyGlobalProxyText(
                                credentials.wetransfer.proxy
                              );

                              window.setTimeout(() => {
                                void saveBrowserProxySettings();
                              }, 0);
                            }}
                          >
                            {browserProxySaving
                              ? 'Saving…'
                              : 'Apply Globally'}
                          </button>

                          <button
                            type="button"
                            className="rounded border border-slate-300 px-3 py-2 text-xs disabled:opacity-50"
                            disabled={
                              browserProxyTesting ||
                              !browserProxy.enabled
                            }
                            onClick={() =>
                              void testBrowserProxy()
                            }
                          >
                            {browserProxyTesting
                              ? 'Testing…'
                              : 'Test Proxy'}
                          </button>
                        </div>

                        <div className="text-[11px] leading-5 text-slate-500">
                          This is the shared 3D Suite browser proxy. WeTransfer,
                          Adobe browser automation, and browser-based connection
                          flows reuse this setting. Direct API transports keep
                          their normal provider connection.
                        </div>

                        {browserProxyError && (
                          <div className="text-xs text-red-600">
                            {browserProxyError}
                          </div>
                        )}

                        {browserProxyTestResult && (
                          <div
                            className={`text-xs ${
                              browserProxyTestResult.level ===
                              'success'
                                ? 'text-emerald-600'
                                : browserProxyTestResult.level ===
                                    'warning'
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                            }`}
                          >
                            {browserProxyTestResult.message}
                          </div>
                        )}
                      </div>
                    </Field>
                  </div>
                </div>
              </div>
              <hr className="border-slate-200" />
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Other Senders</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Adobe browser mode does not require a Client ID, Client Secret, or OAuth Redirect URI.
                    Click Open Adobe & Connect and log in manually in the normal Chrome browser window.
                  </div>
                  <Field label="QuickBooks Company ID"><input className="input" value={credentials.quickbooks.companyId} onChange={(e) => setCredentials((p) => ({ ...p, quickbooks: { ...p.quickbooks, companyId: e.target.value } }))} /></Field>
                  <Field label="DocuSign Account ID"><input className="input" value={credentials.docusign.accountId} onChange={(e) => setCredentials((p) => ({ ...p, docusign: { ...p.docusign, accountId: e.target.value } }))} /></Field>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'settings' && (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Global Browser Proxy">
                  <input
                    className="input"
                    value={credentials.wetransfer.proxy}
                    onChange={(event) =>
                      setCredentials((prev) => ({
                        ...prev,
                        wetransfer: {
                          ...prev.wetransfer,
                          proxy: event.target.value,
                        },
                      }))
                    }
                    onBlur={(event) =>
                      applyGlobalProxyText(event.target.value)
                    }
                    placeholder="Configured from WeTransfer / Credentials"
                  />
                </Field>
                <Field label="Default Rate Limit (sec)"><input type="number" className="input" value={settingsState.defaultDelay} onChange={(e) => setSettingsState((p) => ({ ...p, defaultDelay: Number(e.target.value || 1) }))} /></Field>
                <Field label="Default File Type"><input className="input" value={settingsState.defaultFileType} onChange={(e) => setSettingsState((p) => ({ ...p, defaultFileType: e.target.value }))} /></Field>
                <Field label="Default Temp Provider"><input className="input" value={settingsState.defaultTempProvider} onChange={(e) => setSettingsState((p) => ({ ...p, defaultTempProvider: e.target.value }))} /></Field>
              </div>
              <div className="rounded border border-slate-200 p-3 space-y-3">
                <div>
                  <h3 className="font-semibold text-slate-800">Chromium Proxy</h3>
                  <p className="text-xs text-slate-500">Controls outbound browser traffic for Chromium / Playwright automation.</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={browserProxy.enabled}
                      onChange={(e) => setBrowserProxy((p) => ({ ...p, enabled: e.target.checked }))}
                    />
                    Enable proxy
                  </label>
                  <span className={`px-2 py-0.5 rounded text-xs font-mono ${browserProxy.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {browserProxy.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                <fieldset
                  disabled={!browserProxy.enabled}
                  className={`grid sm:grid-cols-2 gap-3 rounded border border-slate-200 p-3 transition-opacity ${browserProxy.enabled ? 'bg-white opacity-100' : 'bg-slate-50 opacity-60'}`}
                >
                  <Field label="Protocol">
                    <select
                      className="input"
                      value={browserProxy.protocol}
                      onChange={(e) => setBrowserProxy((p) => ({ ...p, protocol: e.target.value as 'http' | 'socks5' }))}
                      disabled={!browserProxy.enabled}
                    >
                      <option value="http">http</option>
                      <option value="socks5">socks5</option>
                    </select>
                  </Field>
                  <Field label="Host">
                    <input
                      className="input"
                      value={browserProxy.host}
                      onChange={(e) => setBrowserProxy((p) => ({ ...p, host: e.target.value }))}
                      placeholder="e.g. gate.nodemaven.com"
                      disabled={!browserProxy.enabled}
                    />
                  </Field>
                  <Field label="Port">
                    <input
                      type="number"
                      className="input"
                      value={browserProxy.port}
                      onChange={(e) => setBrowserProxy((p) => ({ ...p, port: e.target.value }))}
                      placeholder="8080"
                      min={1}
                      max={65535}
                      disabled={!browserProxy.enabled}
                    />
                  </Field>
                  <Field label="Username">
                    <input
                      className="input"
                      value={browserProxy.username}
                      onChange={(e) => setBrowserProxy((p) => ({ ...p, username: e.target.value }))}
                      placeholder="Proxy username"
                      autoComplete="off"
                      disabled={!browserProxy.enabled}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Password">
                      <div className="flex gap-2 items-center">
                        <input
                          type="password"
                          className="input flex-1"
                          value={browserProxy.password}
                          onChange={(e) => setBrowserProxy((p) => ({ ...p, password: e.target.value }))}
                          placeholder={browserProxyHasPassword ? '••••••• (set — re-enter to change)' : 'Leave blank if no auth'}
                          autoComplete="new-password"
                          disabled={!browserProxy.enabled}
                        />
                        {browserProxyHasPassword && (
                          <button
                            className="px-2 py-1 rounded border text-xs text-red-600 border-red-300 hover:bg-red-50 disabled:opacity-50"
                            onClick={() => { setBrowserProxy((p) => ({ ...p, password: '' })); setBrowserProxyHasPassword(false); }}
                            title="Clear stored password"
                            type="button"
                            disabled={!browserProxy.enabled}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </Field>
                  </div>
                </fieldset>
                {browserProxyError && (
                  <p className="text-red-600 text-xs mt-1">{browserProxyError}</p>
                )}
                {browserProxyTestResult && (
                  <div className={`rounded border px-3 py-2 text-xs ${
                    browserProxyTestResult.level === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : browserProxyTestResult.level === 'warning'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                  }`}>
                    <div>{browserProxyTestResult.message}</div>
                    {browserProxyTestResult.diagnostics && (
                      <div className="mt-1 font-mono text-[11px] opacity-80">
                        {browserProxyTestResult.diagnostics}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    className="px-3 py-2 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                    disabled={!browserProxy.enabled || browserProxySaving || browserProxyTesting}
                    onClick={testBrowserProxy}
                    type="button"
                    title={browserProxy.enabled ? 'Validate the configured proxy using the browser automation path' : 'Enable proxy to test it'}
                  >
                    {browserProxyTesting ? 'Testing…' : 'Test Proxy'}
                  </button>
                  <button
                    className="px-3 py-2 rounded bg-[#6C63FF] text-white disabled:opacity-50"
                    disabled={browserProxySaving || browserProxyTesting}
                    onClick={saveBrowserProxySettings}
                    type="button"
                  >
                    {browserProxySaving ? 'Saving…' : 'Save Proxy Settings'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'logs' && <LogsModal logs={logs} onClear={clearVisibleLogs} />}

          {activeModal === 'browser-proxy' && (
            <div className="space-y-4 text-sm">
              <p className="text-slate-500 text-xs">
                Configure outbound proxy for Chromium/Playwright browser automation. Applied to all browser launches when enabled.
              </p>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={browserProxy.enabled}
                    onChange={(e) => setBrowserProxy((p) => ({ ...p, enabled: e.target.checked }))}
                  />
                  Enable proxy
                </label>
                <span className={`px-2 py-0.5 rounded text-xs font-mono ${browserProxy.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {browserProxy.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Protocol">
                  <select
                    className="input"
                    value={browserProxy.protocol}
                    onChange={(e) => setBrowserProxy((p) => ({ ...p, protocol: e.target.value as 'http' | 'socks5' }))}
                    disabled={!browserProxy.enabled}
                  >
                    <option value="http">http</option>
                    <option value="socks5">socks5</option>
                  </select>
                </Field>
                <Field label="Host">
                  <input
                    className="input"
                    value={browserProxy.host}
                    onChange={(e) => setBrowserProxy((p) => ({ ...p, host: e.target.value }))}
                    placeholder="e.g. 127.0.0.1 or proxy.example.com"
                    disabled={!browserProxy.enabled}
                  />
                </Field>
                <Field label="Port">
                  <input
                    type="number"
                    className="input"
                    value={browserProxy.port}
                    onChange={(e) => setBrowserProxy((p) => ({ ...p, port: e.target.value }))}
                    placeholder="8080"
                    min={1}
                    max={65535}
                    disabled={!browserProxy.enabled}
                  />
                </Field>
                <Field label="Username (optional)">
                  <input
                    className="input"
                    value={browserProxy.username}
                    onChange={(e) => setBrowserProxy((p) => ({ ...p, username: e.target.value }))}
                    placeholder="Leave blank if no auth"
                    autoComplete="off"
                    disabled={!browserProxy.enabled}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Password (optional)">
                    <div className="flex gap-2 items-center">
                      <input
                        type="password"
                        className="input flex-1"
                        value={browserProxy.password}
                        onChange={(e) => setBrowserProxy((p) => ({ ...p, password: e.target.value }))}
                        placeholder={browserProxyHasPassword ? '••••••• (set — re-enter to change)' : 'Leave blank if no auth'}
                        autoComplete="new-password"
                        disabled={!browserProxy.enabled}
                      />
                      {browserProxyHasPassword && (
                        <button
                          className="px-2 py-1 rounded border text-xs text-red-600 border-red-300 hover:bg-red-50"
                          onClick={() => { setBrowserProxy((p) => ({ ...p, password: '' })); setBrowserProxyHasPassword(false); }}
                          title="Clear stored password"
                          type="button"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </Field>
                </div>
              </div>
              {browserProxyError && (
                <p className="text-red-600 text-xs mt-1">{browserProxyError}</p>
              )}
              {browserProxyTestResult && (
                <div className={`rounded border px-3 py-2 text-xs ${
                  browserProxyTestResult.level === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : browserProxyTestResult.level === 'warning'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-red-200 bg-red-50 text-red-700'
                }`}>
                  <div>{browserProxyTestResult.message}</div>
                  {browserProxyTestResult.diagnostics && (
                    <div className="mt-1 font-mono text-[11px] opacity-80">
                      {browserProxyTestResult.diagnostics}
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  className="px-3 py-2 rounded border border-slate-300 text-slate-700 disabled:opacity-50"
                  disabled={!browserProxy.enabled || browserProxySaving || browserProxyTesting}
                  onClick={testBrowserProxy}
                  type="button"
                  title={browserProxy.enabled ? 'Validate the configured proxy using the browser automation path' : 'Enable proxy to test it'}
                >
                  {browserProxyTesting ? 'Testing…' : 'Test Proxy'}
                </button>
                <button
                  className="px-3 py-2 rounded bg-[#6C63FF] text-white disabled:opacity-50"
                  disabled={browserProxySaving || browserProxyTesting}
                  onClick={saveBrowserProxySettings}
                  type="button"
                >
                  {browserProxySaving ? 'Saving…' : 'Save Proxy Settings'}
                </button>
              </div>
            </div>
          )}


          {activeModal === 'redirect-generator' && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div>
                  <h4 className="font-semibold text-slate-800">Cloudflare Configuration</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    These values are stored only in this browser session when you click Save to session.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Account ID">
                    <input
                      className="input"
                      value={cloudflareRedirectConfig.accountId}
                      onChange={(event) =>
                        setCloudflareRedirectConfig((prev) => ({
                          ...prev,
                          accountId: event.target.value,
                        }))
                      }
                      placeholder="Cloudflare Account ID"
                    />
                  </Field>

                  <Field label="KV Namespace ID">
                    <input
                      className="input"
                      value={cloudflareRedirectConfig.namespaceId}
                      onChange={(event) =>
                        setCloudflareRedirectConfig((prev) => ({
                          ...prev,
                          namespaceId: event.target.value,
                        }))
                      }
                      placeholder="Workers KV Namespace ID"
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field label="Cloudflare API Token">
                      <input
                        type="password"
                        className="input"
                        value={cloudflareRedirectConfig.apiToken}
                        onChange={(event) =>
                          setCloudflareRedirectConfig((prev) => ({
                            ...prev,
                            apiToken: event.target.value,
                          }))
                        }
                        placeholder="API token with Workers KV read/write permission"
                      />
                    </Field>
                  </div>

                  <div className="sm:col-span-2">
                    <Field label="Public Worker URL">
                      <input
                        className="input"
                        value={cloudflareRedirectConfig.publicBaseUrl}
                        onChange={(event) =>
                          setCloudflareRedirectConfig((prev) => ({
                            ...prev,
                            publicBaseUrl: event.target.value,
                          }))
                        }
                        placeholder="https://redirector.your-subdomain.workers.dev"
                      />
                    </Field>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded bg-[#6C63FF] text-white text-xs font-semibold"
                    onClick={saveCloudflareRedirectConfigToSession}
                  >
                    Save to session
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded border border-red-300 text-red-600 text-xs font-semibold"
                    onClick={clearCloudflareRedirectConfig}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded border border-slate-300 text-slate-700 text-xs font-semibold disabled:opacity-50"
                    disabled={redirectBusy}
                    onClick={() => void refreshCloudflareRedirects()}
                  >
                    {redirectBusy ? 'Loading…' : 'Refresh redirects'}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                <h4 className="font-semibold text-slate-800">
                  {redirectEditingAlias ? 'Edit Redirect' : 'Generate Redirect'}
                </h4>

                <Field label="Destination URL">
                  <input
                    className="input"
                    value={redirectDestination}
                    onChange={(event) => setRedirectDestination(event.target.value)}
                    placeholder="https://example.com/document"
                  />
                </Field>

                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Custom alias (optional)">
                    <input
                      className="input"
                      value={redirectAlias}
                      onChange={(event) => setRedirectAlias(event.target.value)}
                      placeholder="tender-2026"
                    />
                  </Field>

                  <Field label="Redirect type">
                    <select
                      className="input"
                      value={redirectStatusCode}
                      onChange={(event) =>
                        setRedirectStatusCode(
                          Number(event.target.value) as 301 | 302 | 307 | 308
                        )
                      }
                    >
                      <option value={302}>302 Temporary</option>
                      <option value={301}>301 Permanent</option>
                      <option value={307}>307 Temporary (preserve method)</option>
                      <option value={308}>308 Permanent (preserve method)</option>
                    </select>
                  </Field>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
                    disabled={redirectBusy}
                    onClick={() => void createOrUpdateCloudflareRedirect()}
                  >
                    {redirectEditingAlias ? 'Save changes' : 'Generate Redirect'}
                  </button>

                  {redirectEditingAlias && (
                    <button
                      type="button"
                      className="px-3 py-2 rounded border border-slate-300 text-xs"
                      onClick={() => {
                        setRedirectEditingAlias(null);
                        setRedirectDestination('');
                        setRedirectAlias('');
                        setRedirectStatusCode(302);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {redirectError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {redirectError}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-slate-800">Redirect History</h4>
                  <span className="text-xs text-slate-500">{redirectItems.length} redirect(s)</span>
                </div>

                <div className="max-h-72 overflow-auto space-y-2">
                  {redirectItems.length === 0 && (
                    <div className="text-xs text-slate-400 py-4 text-center">
                      No redirects loaded yet.
                    </div>
                  )}

                  {redirectItems.map((item) => (
                    <div
                      key={item.alias}
                      className="rounded border border-slate-200 p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-mono text-xs text-[#6C63FF] break-all">
                            {item.redirectUrl}
                          </div>
                          <div className="text-xs text-slate-500 mt-1 break-all">
                            → {item.destination}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1">
                            HTTP {item.statusCode}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1 shrink-0">
                          <button
                            type="button"
                            className="px-2 py-1 rounded border text-[11px]"
                            onClick={() => {
                              void navigator.clipboard.writeText(item.redirectUrl);
                              addToast('Redirect URL copied', 'success');
                            }}
                          >
                            Copy
                          </button>

                          <button
                            type="button"
                            className="px-2 py-1 rounded border text-[11px]"
                            onClick={() =>
                              window.open(item.redirectUrl, '_blank', 'noopener,noreferrer')
                            }
                          >
                            Test
                          </button>

                          <button
                            type="button"
                            className="px-2 py-1 rounded border text-[11px]"
                            onClick={() => {
                              setRedirectEditingAlias(item.alias);
                              setRedirectAlias(item.alias);
                              setRedirectDestination(item.destination);
                              setRedirectStatusCode(item.statusCode);
                            }}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="px-2 py-1 rounded border border-red-300 text-red-600 text-[11px]"
                            onClick={() => void deleteCloudflareRedirect(item.alias)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!['leads', 'credentials', 'settings', 'logs', 'browser-proxy', 'redirect-generator'].includes(activeModal as string) && (
            <div className="space-y-2 text-sm">
              <p className="text-slate-600">Local editable workspace for {modalTitle(activeModal)}.</p>
              <textarea
                value={moduleNotes[activeModal] || ''}
                onChange={(event) =>
                  setModuleNotes((prev) => ({
                    ...prev,
                    [activeModal]: event.target.value,
                  }))
                }
                rows={6}
                placeholder="Store local notes and config for this module..."
                className="w-full border rounded px-3 py-2"
              />
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              className="px-3 py-2 rounded border"
              onClick={() => {
                setActiveModal(null);
                appendLog('info', `${modalTitle(activeModal)} settings updated`, 'system');
              }}
            >
              Close
            </button>
            <button className="px-3 py-2 rounded bg-[#6C63FF] text-white" onClick={saveSession}>Save in Session</button>
          </div>
        </ModalShell>
      )}

      {showStopConfirm && (
        <ModalShell title="Stop campaign?" onClose={() => setShowStopConfirm(false)}>
          <p className="text-sm text-slate-600">This will stop the current run. Sent leads stay sent, unsent leads remain pending for resume.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="px-3 py-2 rounded border" onClick={() => setShowStopConfirm(false)}>Cancel</button>
            <button className="px-3 py-2 rounded bg-red-600 text-white" onClick={confirmStop}>Confirm Stop</button>
          </div>
        </ModalShell>
      )}

      <div className="fixed top-3 right-3 space-y-2 z-50">
        {toasts.map((toast) => (
          <div key={toast.id} className="px-3 py-2 rounded shadow text-xs text-white" style={{ background: levelColor(toast.level) }}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = 'default' }: { label: string; value: React.ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass =
    tone === 'success' ? 'text-emerald-600' : tone === 'warning' ? 'text-amber-600' : tone === 'danger' ? 'text-red-600' : 'text-slate-900';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-slate-200 px-2 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-xl border border-slate-200">
        <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function LogsModal({ logs, onClear }: { logs: RuntimeLog[]; onClear: () => void }) {
  const [senderFilter, setSenderFilter] = React.useState<'all' | SenderKey | 'system'>('all');
  const [levelFilter, setLevelFilter] = React.useState<'all' | LogLevel>('all');

  const filtered = logs.filter((log) => {
    const senderOk = senderFilter === 'all' || log.sender === senderFilter;
    const levelOk = levelFilter === 'all' || log.level === levelFilter;
    return senderOk && levelOk;
  });

  return (
    <div className="space-y-3 text-sm">
      <div className="grid sm:grid-cols-2 gap-2">
        <select className="input" value={senderFilter} onChange={(e) => setSenderFilter(e.target.value as 'all' | SenderKey | 'system')}>
          {['all', 'system', 'wetransfer', 'adobe', 'inquiry', 'quickbooks', 'docusign'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select className="input" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as 'all' | LogLevel)}>
          {['all', 'info', 'success', 'warning', 'error', 'stopped', 'system'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button
          className="px-2 py-1 rounded border text-xs"
          onClick={() => navigator.clipboard.writeText(JSON.stringify(filtered, null, 2))}
          type="button"
        >
          Copy filtered logs
        </button>
        <button
          className="px-2 py-1 rounded border text-xs"
          onClick={onClear}
          type="button"
        >
          Clear Logs
        </button>
      </div>
      <div className="max-h-72 overflow-auto rounded border border-slate-200 p-2 font-mono text-xs space-y-1 bg-slate-50">
        {filtered.length === 0 && <div className="text-slate-400">No logs for the current filters.</div>}
        {filtered.map((log) => (
          <div key={log.id}>[{formatTime(log.timestamp)}] [{log.sender}] {log.level}: {log.message}</div>
        ))}
      </div>
    </div>
  );
}


type InquiryResultRow = {
  id: string;
  runId: string;
  sessionId: string;
  status: 'submitted' | 'failed' | 'captcha' | 'review';
  target: string;
  contactUrl?: string;
  reason?: string;
  captchaProvider?: string;
  values?: Record<string, unknown>;
  createdAt: string;
};

function InquirySenderPanel({
  leadEmails,
  onLog,
  onToast,
}: {
  leadEmails: string[];
  onLog: (level: LogLevel, message: string) => void;
  onToast: (message: string, level?: LogLevel) => void;
}) {
  const [sessionId, setSessionId] = React.useState(() => `inq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const [targetsText, setTargetsText] = React.useState('');
  const [targetSource, setTargetSource] = React.useState<'leads' | 'manual'>('leads');
  const targetsEditedRef = React.useRef(false);
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [country, setCountry] = React.useState('United States');
  const [address, setAddress] = React.useState('');
  const [city, setCity] = React.useState('');
  const [stateRegion, setStateRegion] = React.useState('');
  const [postalCode, setPostalCode] = React.useState('');
  const [jobTitle, setJobTitle] = React.useState('');
  const [referralSource, setReferralSource] = React.useState('');
  const [locationPreset, setLocationPreset] = React.useState('');
  const [desiredDate, setDesiredDate] = React.useState('');
  const [additionalFieldsText, setAdditionalFieldsText] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [prepared, setPrepared] = React.useState(false);
  const [contactUrl, setContactUrl] = React.useState('');
  const [detected, setDetected] = React.useState<Array<{ label: string; kind: string; filled: boolean; required: boolean }>>([]);
  const [extras, setExtras] = React.useState<string[]>([]);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [frameNonce, setFrameNonce] = React.useState(Date.now());
  const [activeRunTarget, setActiveRunTarget] = React.useState('');
  const [activeRunIndex, setActiveRunIndex] = React.useState(-1);
  const [showScreenshots, setShowScreenshots] = React.useState(true);
  const [autoSubmit, setAutoSubmit] = React.useState(true);
  const [manualText, setManualText] = React.useState('');
  const [runState, setRunState] = React.useState<'idle' | 'running' | 'paused' | 'stopped' | 'complete'>('idle');
  const runStateRef = React.useRef<'idle' | 'running' | 'paused' | 'stopped' | 'complete'>('idle');
  const runIdRef = React.useRef('');
  const [runResults, setRunResults] = React.useState<InquiryResultRow[]>([]);
  const [savedCaptcha, setSavedCaptcha] = React.useState<InquiryResultRow[]>([]);
  const [savedReview, setSavedReview] = React.useState<InquiryResultRow[]>([]);
  const [runTotalSnapshot, setRunTotalSnapshot] = React.useState(0);
  const inquiryDraftLoadedRef = React.useRef(false);
  const seenBackendInquiryLogsRef = React.useRef(new Set<string>());

  function isRunStopped() {
    return runStateRef.current === 'stopped';
  }

  const leadDomains = React.useMemo(() => {
    const set = new Set<string>();
    for (const value of leadEmails) {
      const raw = String(value || '').trim();
      if (!raw) continue;
      if (raw.includes('@')) {
        const domain = raw.split('@').pop()?.trim();
        if (domain) set.add(domain);
      } else {
        set.add(raw.replace(/^https?:\/\//i, '').split('/')[0]);
      }
    }
    return Array.from(set);
  }, [leadEmails]);

  const customTargets = React.useMemo(
    () => targetsText.split(/[\r\n,;]+/).map((x) => x.trim()).filter(Boolean),
    [targetsText]
  );
  const targets = targetSource === 'manual' ? customTargets : leadDomains;
  const currentTarget = targets[index] || '';
  const runTotal = targets.length;
  const displayRunTotal = runTotalSnapshot > 0 ? runTotalSnapshot : runTotal;
  const latestResultByTarget = React.useMemo(() => {
    const map = new Map<string, InquiryResultRow>();
    for (const item of runResults) {
      const key = String(item.target || '').trim().toLowerCase();
      if (key) map.set(key, item);
    }
    return Array.from(map.values());
  }, [runResults]);
  const submittedCount = latestResultByTarget.filter((item) => item.status === 'submitted').length;
  const failedCount = latestResultByTarget.filter((item) => item.status === 'failed').length;
  const captchaCount = latestResultByTarget.filter((item) => item.status === 'captcha').length;
  const reviewCount = latestResultByTarget.filter((item) => item.status === 'review').length;
  const processedCount = Math.min(displayRunTotal, latestResultByTarget.length);

  const additionalFields = React.useMemo(() => {
    const result: Record<string, string> = {};
    for (const line of additionalFieldsText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const splitAt = trimmed.search(/[=:]/);
      if (splitAt <= 0) continue;
      const key = trimmed.slice(0, splitAt).trim();
      const value = trimmed.slice(splitAt + 1).trim();
      if (key && value) result[key] = value;
    }
    return result;
  }, [additionalFieldsText]);

  React.useEffect(() => {
    try {
      const licenseId = window.localStorage.getItem('3d-suite-active-license-id') || 'default';
      const raw = window.localStorage.getItem(`3d-suite-inquiry-draft:${licenseId}`);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, unknown>;
        if (typeof saved.firstName === 'string') setFirstName(saved.firstName);
        if (typeof saved.lastName === 'string') setLastName(saved.lastName);
        if (typeof saved.email === 'string') setEmail(saved.email);
        if (typeof saved.phone === 'string') setPhone(saved.phone);
        if (typeof saved.company === 'string') setCompany(saved.company);
        if (typeof saved.country === 'string') setCountry(saved.country);
        if (typeof saved.address === 'string') setAddress(saved.address);
        if (typeof saved.city === 'string') setCity(saved.city);
        if (typeof saved.stateRegion === 'string') setStateRegion(saved.stateRegion);
        if (typeof saved.postalCode === 'string') setPostalCode(saved.postalCode);
        if (typeof saved.jobTitle === 'string') setJobTitle(saved.jobTitle);
        if (typeof saved.referralSource === 'string') setReferralSource(saved.referralSource);
        if (typeof saved.locationPreset === 'string') setLocationPreset(saved.locationPreset);
        if (typeof saved.desiredDate === 'string') setDesiredDate(saved.desiredDate);
        if (typeof saved.subject === 'string') setSubject(saved.subject);
        if (typeof saved.message === 'string') setMessage(saved.message);
        if (typeof saved.additionalFieldsText === 'string') setAdditionalFieldsText(saved.additionalFieldsText);
        if (typeof saved.targetsText === 'string') setTargetsText(saved.targetsText);
        if (saved.targetSource === 'manual' || saved.targetSource === 'leads') setTargetSource(saved.targetSource);
        if (typeof saved.autoSubmit === 'boolean') setAutoSubmit(saved.autoSubmit);
        if (typeof saved.showScreenshots === 'boolean') setShowScreenshots(saved.showScreenshots);
        if (typeof saved.manualText === 'string') setManualText(saved.manualText);
      }
    } catch {}
    inquiryDraftLoadedRef.current = true;
  }, []);

  React.useEffect(() => {
    if (!inquiryDraftLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        const licenseId = window.localStorage.getItem('3d-suite-active-license-id') || 'default';
        window.localStorage.setItem(`3d-suite-inquiry-draft:${licenseId}`, JSON.stringify({
          firstName, lastName, email, phone, company, country, address, city, stateRegion,
          postalCode, jobTitle, referralSource, locationPreset, desiredDate, subject, message,
          additionalFieldsText, targetsText, targetSource, autoSubmit, showScreenshots, manualText,
        }));
      } catch {}
    }, 200);
    return () => window.clearTimeout(timer);
  }, [firstName, lastName, email, phone, company, country, address, city, stateRegion, postalCode, jobTitle, referralSource, locationPreset, desiredDate, subject, message, additionalFieldsText, targetsText, targetSource, autoSubmit, showScreenshots, manualText]);

  React.useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  async function refreshInquiryResults(runId = runIdRef.current) {
    try {
      const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
      const response = await fetch(`/api/inquiry/results${query}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) return;
      setRunResults(Array.isArray(data.runResults) ? data.runResults : []);
      setSavedCaptcha(Array.isArray(data.savedCaptcha) ? data.savedCaptcha : []);
      setSavedReview(Array.isArray(data.savedReview) ? data.savedReview : []);
      if (Array.isArray(data.runLogs)) {
        for (const item of data.runLogs) {
          const id = String(item?.id || '');
          if (!id || seenBackendInquiryLogsRef.current.has(id)) continue;
          seenBackendInquiryLogsRef.current.add(id);
          const level = ['info', 'success', 'warning', 'error'].includes(String(item?.level)) ? item.level as LogLevel : 'info';
          onLog(level, String(item?.message || 'Inquiry backend event'));
        }
      }
      return data;
    } catch {}
    return undefined;
  }

  async function hydrateInquiryRun() {
    try {
      const response = await fetch('/api/inquiry/control', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.state) {
        await refreshInquiryResults('');
        return;
      }
      const state = data.state as { mode?: 'idle' | 'running' | 'paused' | 'stopped' | 'complete'; sessionId?: string; runId?: string; targets?: string[]; totalTargets?: number; index?: number; currentTarget?: string };
      const restoredRunId = String(state.runId || '');
      if (restoredRunId) runIdRef.current = restoredRunId;
      if (state.sessionId) setSessionId(String(state.sessionId));
      setActiveRunTarget(String(state.currentTarget || ''));
      setActiveRunIndex(Number.isFinite(Number(state.index)) ? Number(state.index) : -1);
      if (Number.isFinite(Number(state.totalTargets)) && Number(state.totalTargets) > 0) setRunTotalSnapshot(Number(state.totalTargets));
      if (!targetsEditedRef.current && Array.isArray(state.targets) && state.targets.length) {
        setTargetsText(state.targets.join('\n'));
        setTargetSource('manual');
      }
      if (Number.isFinite(Number(state.index))) setIndex(Math.max(0, Number(state.index)));
      if (state.mode) {
        const restoredMode = state.mode;
        runStateRef.current = restoredMode;
        setRunState(restoredMode);
      }
      const resultData = await refreshInquiryResults(restoredRunId);
      const restoredTargets = Array.isArray(state.targets) ? state.targets : [];
      const restoredResults = Array.isArray(resultData?.runResults) ? resultData.runResults : [];
      const completedTargets = new Set(restoredResults.map((item: any) => String(item?.target || '').trim().toLowerCase()).filter(Boolean)).size;
      if (state.mode === 'running' && restoredTargets.length > 0 && completedTargets >= restoredTargets.length) {
        runStateRef.current = 'complete';
        setRunState('complete');
      }
    } catch {
      await refreshInquiryResults('');
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (cancelled) return;
      await hydrateInquiryRun();
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 1200);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  async function setBackendRunControl(action: 'start' | 'pause' | 'resume' | 'stop' | 'progress', runId = runIdRef.current, progress?: { index?: number; currentTarget?: string; targets?: string[]; totalTargets?: number; autoSubmit?: boolean; profile?: Record<string, unknown> }) {
    const response = await fetch('/api/inquiry/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sessionId, runId, ...progress }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || `Inquiry ${action} failed (HTTP ${response.status})`);
    return data;
  }

  async function startInquiryRun() {
    if (!currentTarget) {
      onToast('Add domains or load leads first.', 'warning');
      return;
    }
    const restartFromBeginning = runStateRef.current === 'complete' || runStateRef.current === 'stopped';
    const startIndex = restartFromBeginning ? 0 : index;
    const startTarget = targets[startIndex] || currentTarget;
    if (restartFromBeginning) setIndex(0);
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    runIdRef.current = runId;
    runStateRef.current = 'running';
    setRunState('running');
    setRunResults([]);
    setRunTotalSnapshot(targets.length);
    try {
      await setBackendRunControl('start', runId, {
        index: startIndex,
        currentTarget: startTarget,
        targets,
        totalTargets: targets.length,
        autoSubmit,
        profile: { firstName, lastName, email, phone, company, country, address, city, state: stateRegion, postalCode, jobTitle, referralSource, location: locationPreset, desiredDate, subject, message, additionalFields },
      });
      onLog('info', `Inquiry run started — ${targets.length} target(s)${autoSubmit ? ' — backend worker owns this run' : ''}`);
      if (autoSubmit) {
        setBrowserOpen(true);
        return;
      }
      await prepareTarget(startTarget, startIndex, runId);
    } catch (error) {
      runStateRef.current = 'stopped';
      setRunState('stopped');
      onLog('error', `Inquiry run could not start — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function pauseInquiryRun() {
    if (runStateRef.current !== 'running') return;
    runStateRef.current = 'paused';
    setRunState('paused');
    try {
      await setBackendRunControl('pause');
      onLog('warning', 'Inquiry run paused — backend processing is suspended.');
    } catch (error) {
      runStateRef.current = 'running';
      setRunState('running');
      onToast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function resumeInquiryRun() {
    if (runStateRef.current !== 'paused') return;
    try {
      await setBackendRunControl('resume');
      runStateRef.current = 'running';
      setRunState('running');
      onLog('info', 'Inquiry run resumed — backend processing continued.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function stopInquiryRun() {
    if (!['running', 'paused'].includes(runStateRef.current)) return;
    runStateRef.current = 'stopped';
    setRunState('stopped');
    setPrepared(false);
    setBusy(false);
    try {
      await setBackendRunControl('stop');
      setBrowserOpen(false);
      onLog('warning', 'Inquiry run stopped — backend processing and browser session terminated.');
      onToast('Inquiry run stopped.', 'warning');
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      await refreshInquiryResults();
    }
  }

  async function copyCaptchaLeads() {
    const text = savedCaptcha.map((item) => item.target).filter(Boolean).join('\n');
    if (!text) return onToast('No saved CAPTCHA leads to copy.', 'info');
    try {
      await navigator.clipboard.writeText(text);
      onToast(`Copied ${savedCaptcha.length} CAPTCHA lead(s).`, 'success');
    } catch {
      onToast('Could not access the clipboard. Select and copy the list manually.', 'warning');
    }
  }

  async function clearCaptchaLeads() {
    try {
      const response = await fetch('/api/inquiry/results', { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || `Clear failed (HTTP ${response.status})`);
      await refreshInquiryResults();
      onToast(`Cleared ${Number(data.cleared || 0)} saved CAPTCHA lead(s) for this license.`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function copyReviewLeads() {
    const text = savedReview.map((item) => item.target).filter(Boolean).join('\n');
    if (!text) return onToast('No saved review leads to copy.', 'info');
    try {
      await navigator.clipboard.writeText(text);
      onToast(`Copied ${savedReview.length} review lead(s).`, 'success');
    } catch {
      onToast('Could not access the clipboard. Select and copy the list manually.', 'warning');
    }
  }

  async function clearReviewLeads() {
    try {
      const response = await fetch('/api/inquiry/results?type=review', { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || `Clear failed (HTTP ${response.status})`);
      await refreshInquiryResults();
      onToast(`Cleared ${Number(data.cleared || 0)} saved review lead(s) for this license.`, 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  React.useEffect(() => {
    // Screenshot visibility is a live UI-only switch. Turning it off must not
    // pause/stop the Playwright inquiry session; it only stops screenshot polling.
    if (!browserOpen || !showScreenshots) return;
    setFrameNonce(Date.now());
    // Keep screenshot capture frequent enough to feel live without saturating
    // Playwright with overlapping screenshot work. The older stable behavior used
    // a direct session screenshot and felt more responsive than 250ms polling.
    const timer = window.setInterval(() => setFrameNonce(Date.now()), 800);
    return () => window.clearInterval(timer);
  }, [browserOpen, showScreenshots]);

  async function inquiryFetchWithLicenseRetry(input: RequestInfo | URL, init?: RequestInit) {
    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(input, { ...init, credentials: 'same-origin', cache: 'no-store' });
      lastResponse = response;
      if (response.status !== 401) return response;
      const probe = await response.clone().json().catch(() => ({}));
      if (probe?.code !== 'LICENSE_REQUIRED' && !/license required/i.test(String(probe?.error || ''))) return response;
      if (attempt < 2) {
        onLog('warning', `License context was not available; retrying request (${attempt + 1}/2)…`);
        await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    return lastResponse!;
  }

  async function prepareTarget(target = currentTarget, targetIndex = index, activeRunId = runIdRef.current) {
    if (!target) {
      onToast('Add domains or load leads first.', 'warning');
      return false;
    }
    // Persist current run position on the backend so switching dashboard tabs
    // can remount this panel without losing the live run/session context.
    try {
      await setBackendRunControl('progress', activeRunId, { index: targetIndex, currentTarget: target, targets });
    } catch {}
    setBusy(true);
    setPrepared(false);
    onLog('info', `${targetIndex + 1}/${targets.length} — checking ${target} for a contact form`);
    try {
      const response = await inquiryFetchWithLicenseRetry('/api/inquiry/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          runId: activeRunId,
          target,
          profile: { firstName, lastName, email, phone, company, country, address, city, state: stateRegion, postalCode, jobTitle, referralSource, location: locationPreset, desiredDate, subject, message, additionalFields },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || `Inquiry prepare failed (HTTP ${response.status})`);
      setBrowserOpen(true);
      setContactUrl(String(data.contactUrl || data.currentUrl || ''));
      setDetected(Array.isArray(data.detected) ? data.detected : []);
      setExtras(Array.isArray(data.extras) ? data.extras : []);
      setFrameNonce(Date.now());

      const classification = String(data.classification || (data.captchaDetected ? 'captcha' : 'form_found'));
      if (classification === 'captcha' || data.captchaDetected) {
        const provider = String(data.captchaProvider || 'CAPTCHA');
        await refreshInquiryResults(activeRunId);
        onLog('warning', `${targetIndex + 1}/${targets.length} — CAPTCHA detected (${provider}) on ${data.contactUrl || target}; skipped automatically`);
        setPrepared(false);
        const next = targetIndex + 1;
        if (next < targets.length && runStateRef.current !== 'stopped') {
          setIndex(next);
          window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 100);
        } else {
          runStateRef.current = 'complete'; setRunState('complete');
          await refreshInquiryResults(activeRunId);
          onLog('success', `Inquiry review complete — ${targets.length}/${targets.length} processed`);
          onToast('Reached the end of the Inquiry list.', 'info');
        }
        return false;
      }

      if (classification === 'review_required' || data.reviewRequired) {
        const reason = String(data.reviewReason || (Array.isArray(data.extras) && data.extras.length ? `Required/unsupported fields: ${data.extras.join(', ')}` : 'Manual review required'));
        await refreshInquiryResults(activeRunId);
        onLog('warning', `${targetIndex + 1}/${targets.length} — REVIEW REQUIRED on ${data.contactUrl || target} — ${reason}; saved and skipped automatically`);
        setPrepared(false);
        const next = targetIndex + 1;
        if (next < targets.length && runStateRef.current !== 'stopped') {
          setIndex(next);
          window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 100);
        } else {
          runStateRef.current = 'complete'; setRunState('complete');
          await refreshInquiryResults(activeRunId);
          onLog('success', `Inquiry review complete — ${targets.length}/${targets.length} processed`);
          onToast('Reached the end of the Inquiry list.', 'info');
        }
        return false;
      }

      if (classification === 'site_unavailable') {
        const reason = String(data.unavailableReason || 'SITE_UNAVAILABLE');
        await refreshInquiryResults(activeRunId);
        onLog('warning', `${targetIndex + 1}/${targets.length} — ${target} — website unavailable (${reason}); skipped automatically`);
        setPrepared(false);
        setBrowserOpen(false);
        const next = targetIndex + 1;
        if (next < targets.length && runStateRef.current !== 'stopped') {
          setIndex(next);
          window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 100);
        } else {
          runStateRef.current = 'complete'; setRunState('complete');
          await refreshInquiryResults(activeRunId);
          onLog('success', `Inquiry review complete — ${targets.length}/${targets.length} processed`);
          onToast('Reached the end of the Inquiry list.', 'info');
        }
        return false;
      }

      if (classification === 'no_form') {
        await refreshInquiryResults(activeRunId);
        onLog('warning', `${targetIndex + 1}/${targets.length} — ${target} — no usable contact/quote/inquiry form found; skipped automatically`);
        setPrepared(false);
        setBrowserOpen(false);
        const next = targetIndex + 1;
        if (next < targets.length && runStateRef.current !== 'stopped') {
          setIndex(next);
          window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 100);
        } else {
          runStateRef.current = 'complete'; setRunState('complete');
          await refreshInquiryResults(activeRunId);
          onLog('success', `Inquiry review complete — ${targets.length}/${targets.length} processed`);
          onToast('Reached the end of the Inquiry list.', 'info');
        }
        return false;
      }

      setPrepared(true);
      onLog('success', `${targetIndex + 1}/${targets.length} — form found and prepared on ${data.contactUrl || target}${data.discovery ? ` — via ${data.discovery}` : ''}`);
      if (Array.isArray(data.extras) && data.extras.length) {
        onLog('warning', `${targetIndex + 1}/${targets.length} — ${data.extras.length} required field(s) detected; automatic mode will continue through review/next steps when possible`);
      }

      if (autoSubmit) {
        onLog('info', `${targetIndex + 1}/${targets.length} — auto-submit — completing review/next steps and submitting ${target}`);
        const submitResponse = await inquiryFetchWithLicenseRetry('/api/inquiry/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, runId: activeRunId }),
        });
        const submitData = await submitResponse.json().catch(() => ({}));
        if (!submitResponse.ok || !submitData.success) {
          await refreshInquiryResults(activeRunId);
          if (submitData.code === 'RUN_STOPPED' || isRunStopped()) return false;
          if (submitData.reviewRequired) {
            await refreshInquiryResults(activeRunId);
            onLog('warning', `${targetIndex + 1}/${targets.length} — REVIEW REQUIRED on ${target} — ${submitData.reason || submitData.error || 'manual interaction needed'}; saved and skipped automatically`);
            setPrepared(false);
            const next = targetIndex + 1;
            if (next < targets.length && !isRunStopped()) {
              setIndex(next);
              window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 100);
            } else if (next >= targets.length) {
              runStateRef.current = 'complete'; setRunState('complete');
              onLog('success', `Inquiry automatic run complete — ${targets.length}/${targets.length} processed`);
              onToast('Inquiry automatic run complete.', 'success');
            }
            return false;
          }
          if (submitData.captchaDetected) {
            onLog('warning', `${targetIndex + 1}/${targets.length} — CAPTCHA detected (${submitData.captchaProvider || 'CAPTCHA'}) during review/submit on ${target}; saved and skipped automatically`);
            setPrepared(false);
            const next = targetIndex + 1;
            if (next < targets.length && !isRunStopped()) {
              setIndex(next);
              window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 100);
            } else if (next >= targets.length) {
              runStateRef.current = 'complete'; setRunState('complete');
              onLog('success', `Inquiry automatic run complete — ${targets.length}/${targets.length} processed`);
              onToast('Inquiry automatic run complete.', 'success');
            }
            return false;
          }
          throw new Error(submitData.error || `Auto-submit failed (HTTP ${submitResponse.status})`);
        }
        await refreshInquiryResults(activeRunId);
        onLog('success', `${targetIndex + 1}/${targets.length} ✅ auto-submitted — ${target}${submitData.steps?.length ? ` — ${submitData.steps.join(' → ')}` : submitData.submitLabel ? ` — ${submitData.submitLabel}` : ''}`);
        setPrepared(false);
        setFrameNonce(Date.now());
        const next = targetIndex + 1;
        if (next < targets.length && runStateRef.current !== 'stopped') {
          setIndex(next);
          window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 100);
        } else {
          runStateRef.current = 'complete'; setRunState('complete');
          await refreshInquiryResults(activeRunId);
          onLog('success', `Inquiry automatic run complete — ${targets.length}/${targets.length} processed`);
          onToast('Inquiry automatic run complete.', 'success');
        }
        return true;
      }
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await refreshInquiryResults(activeRunId);
      if (runStateRef.current === 'stopped' || /stopped by user/i.test(text)) {
        setPrepared(false); setBrowserOpen(false); return false;
      }
      if (/license required/i.test(text)) {
        runStateRef.current = 'paused';
        setRunState('paused');
        try { await setBackendRunControl('pause', activeRunId); } catch {}
        onLog('error', `${targetIndex + 1}/${targets.length} — ${target} — license session could not be verified after retry; run paused without consuming this target`);
        onToast('License session needs attention. The Inquiry run was paused and this target was not skipped.', 'error');
        setPrepared(false);
        return false;
      }
      onLog('error', `${targetIndex + 1}/${targets.length} — ${target} — ${text}`);
      setPrepared(false);
      setBrowserOpen(false);
      const next = targetIndex + 1;
      if (next < targets.length) {
        setIndex(next);
        window.setTimeout(() => void prepareTarget(targets[next], next, activeRunId), 150);
      } else {
        onLog('success', `Inquiry review complete — ${targets.length}/${targets.length} processed`);
        onToast('Reached the end of the Inquiry list.', 'info');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitAndNext() {
    if (!prepared) return;
    setBusy(true);
    try {
      const response = await fetch('/api/inquiry/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, runId: runIdRef.current }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || `Submit failed (HTTP ${response.status})`);
      await refreshInquiryResults();
      onLog('success', `${index + 1}/${targets.length} ✅ submitted — ${currentTarget}${data.submitLabel ? ` — ${data.submitLabel}` : ''}`);
      const next = index + 1;
      setPrepared(false);
      if (next < targets.length) {
        setIndex(next);
        setBusy(false);
        await prepareTarget(targets[next], next);
      } else {
        onLog('success', `Inquiry review complete — ${targets.length}/${targets.length} processed`);
        onToast('Inquiry review complete.', 'success');
      }
    } catch (error) {
      onLog('error', `${index + 1}/${targets.length} ❌ submit failed — ${currentTarget} — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      setFrameNonce(Date.now());
    }
  }

  async function skipAndNext() {
    onLog('warning', `${index + 1}/${targets.length} — skipped ${currentTarget}`);
    const next = index + 1;
    setPrepared(false);
    if (next < targets.length) {
      setIndex(next);
      await prepareTarget(targets[next], next);
    } else {
      onToast('Reached the end of the Inquiry list.', 'info');
    }
  }

  async function sendInput(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch('/api/inquiry/input', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...payload }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        const message = data.error || `Browser input failed (HTTP ${response.status}).`;
        onLog('warning', `Inquiry browser input ignored — ${message}`);
        onToast(message, 'warning');
        return false;
      }
      setFrameNonce(Date.now());
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('warning', `Inquiry browser input ignored — ${message}`);
      onToast(message, 'warning');
      return false;
    }
  }

  async function typeManualText() {
    if (!manualText) return;
    try {
      await sendInput({ type: 'text', text: manualText });
      setManualText('');
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function closeBrowser() {
    try {
      await fetch('/api/inquiry/disconnect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }),
      });
    } finally {
      setBrowserOpen(false); setPrepared(false); setContactUrl(''); setDetected([]); setExtras([]);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Inquiry — Contact Form Assistant">
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Finds Contact, Connect With Us, Get in Touch, Inquiry, Request Quote, Free Quote, Estimate, Assessment, Consultation, Talk to an Expert, Get Started, project and similar forms; fills recognized fields with your preset details; scrolls the detected form into the screenshot view; and, when Auto-submit is enabled, automatically continues through Next / Continue / Review steps to the final Submit/Send action before moving to the next target. CAPTCHA, unavailable sites, and sites with no usable form are classified and skipped automatically.
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="First name"><input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
            <Field label="Last name"><input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
            <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Phone number"><input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" /></Field>
            <Field label="Company / Name"><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
            <Field label="Country"><input className="input" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United States" /></Field>
            <Field label="Address"><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" /></Field>
            <Field label="City / Town"><input className="input" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
            <Field label="State / Province / Region"><input className="input" value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} /></Field>
            <Field label="ZIP / Postal code"><input className="input" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} /></Field>
            <Field label="Job title / Position"><input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></Field>
            <Field label="How did you hear about us / Referral"><input className="input" value={referralSource} onChange={(e) => setReferralSource(e.target.value)} placeholder="Set your preferred truthful answer" /></Field>
            <Field label="Location"><input className="input" value={locationPreset} onChange={(e) => setLocationPreset(e.target.value)} /></Field>
            <Field label="Desired / Preferred date"><input className="input" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} placeholder="e.g. 2026-08-20" /></Field>
            <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <div className="md:col-span-2">
              <Field label="Message"><textarea className="input min-h-32" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Additional required-field presets — optional">
                <textarea
                  className="input min-h-24 font-mono text-xs"
                  value={additionalFieldsText}
                  onChange={(e) => setAdditionalFieldsText(e.target.value)}
                  placeholder={'Machinery Type = General Inquiry\nDepartment = Sales\nState = Texas'}
                />
              </Field>
              <p className="mt-1 text-xs text-slate-500">
                Common address/location/job/referral/date fields above are matched automatically. Use one Field = Value preset per line for site-specific required fields. Arithmetic/security challenges stay in Review Required.
              </p>
            </div>
            <div className="md:col-span-2">
              <Field label="Domains / URLs — optional override">
                <textarea
                  className="input min-h-24 font-mono text-xs"
                  value={targetsText}
                  onChange={(e) => {
                    const value = e.target.value;
                    targetsEditedRef.current = true;
                    setTargetSource('manual');
                    setTargetsText(value);
                    setIndex(0);
                    setPrepared(false);
                    if (!value.trim()) {
                      void setBackendRunControl('progress', runIdRef.current, { index: 0, currentTarget: '', targets: [] }).catch(() => undefined);
                    }
                  }}
                  placeholder={'example.com\nhttps://another.example/contact'}
                />
              </Field>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="px-2.5 py-1.5 rounded border border-slate-300 text-xs disabled:opacity-50"
                  disabled={runState === 'running' || runState === 'paused'}
                  onClick={() => {
                    targetsEditedRef.current = true;
                    setTargetSource('manual');
                    setTargetsText('');
                    setIndex(0);
                    setPrepared(false);
                    void setBackendRunControl('progress', runIdRef.current, { index: 0, currentTarget: '', targets: [] }).catch(() => undefined);
                  }}
                >
                  Clear targets
                </button>
                <button
                  type="button"
                  className="px-2.5 py-1.5 rounded border border-indigo-300 text-indigo-700 text-xs disabled:opacity-50"
                  disabled={runState === 'running' || runState === 'paused' || leadDomains.length === 0}
                  onClick={() => {
                    targetsEditedRef.current = true;
                    setTargetSource('leads');
                    setTargetsText('');
                    setIndex(0);
                    setPrepared(false);
                  }}
                >
                  Use Leads Management ({leadDomains.length})
                </button>
                <span className="text-xs text-slate-500">Source: {targetSource === 'manual' ? 'Manual override' : 'Leads Management'}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Clearing the override now stays empty. Leads Management domains are used only when you explicitly choose “Use Leads Management”.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-3 py-2 rounded bg-[#6C63FF] text-white disabled:opacity-50" type="button" disabled={busy || !currentTarget || runState === 'paused' || runState === 'running'} onClick={() => void startInquiryRun()}>
              {busy ? 'Working…' : runState === 'complete' || runState === 'stopped' ? 'Start New Run' : prepared ? 'Re-scan Current' : 'Start Inquiry Run'}
            </button>
            {runState === 'running' && <button className="px-3 py-2 rounded border border-amber-300 text-amber-700" type="button" onClick={() => void pauseInquiryRun()}>Pause</button>}
            {runState === 'paused' && <button className="px-3 py-2 rounded border border-emerald-300 text-emerald-700" type="button" onClick={() => void resumeInquiryRun()}>Resume</button>}
            {(runState === 'running' || runState === 'paused') && <button className="px-3 py-2 rounded border border-red-300 text-red-700" type="button" onClick={() => void stopInquiryRun()}>Stop</button>}
            <button className="px-3 py-2 rounded border border-emerald-300 text-emerald-700 disabled:opacity-50" type="button" disabled={busy || !prepared || autoSubmit} onClick={() => void submitAndNext()}>
              Submit & Next
            </button>
            <button className="px-3 py-2 rounded border border-slate-300 disabled:opacity-50" type="button" disabled={busy || !currentTarget || autoSubmit} onClick={() => void skipAndNext()}>
              Skip & Next
            </button>
            {browserOpen && <button className="px-3 py-2 rounded border border-red-300 text-red-700" type="button" onClick={() => void closeBrowser()}>Close Browser</button>}
            <label className="inline-flex items-center gap-2 rounded border border-emerald-300 px-3 py-2 text-xs text-emerald-700">
              <input
                type="checkbox"
                checked={autoSubmit}
                disabled={busy}
                onChange={(e) => setAutoSubmit(e.target.checked)}
              />
              Auto-submit reviewed forms
            </label>
            <label className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={showScreenshots}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setShowScreenshots(enabled);
                  // If re-enabled mid-run, force an immediate fresh frame instead
                  // of waiting for the next polling interval.
                  if (enabled) setFrameNonce(Date.now());
                }}
              />
              Show screenshots
            </label>
            {showScreenshots && <span className="text-xs font-medium text-emerald-700">Live view: every target</span>}
            <span className={`text-xs font-medium ${runState === 'running' ? 'text-emerald-700' : runState === 'paused' ? 'text-amber-700' : runState === 'stopped' ? 'text-red-700' : 'text-slate-500'}`}>Backend: {runState}</span>
            <span className="text-xs text-slate-500">{displayRunTotal ? `${Math.min(index + 1, displayRunTotal)}/${displayRunTotal}` : '0/0'} {currentTarget ? `— ${currentTarget}` : ''}</span>
          </div>
          {contactUrl && <div className="text-xs break-all"><span className="font-medium">Contact page:</span> {contactUrl}</div>}
          {detected.length > 0 && (
            <div className="rounded border border-slate-200 p-3">
              <div className="font-medium mb-2">Detected fields</div>
              <div className="flex flex-wrap gap-2">
                {detected.map((item, i) => <span key={`${item.kind}-${i}`} className={`px-2 py-1 rounded text-xs border ${item.filled ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>{item.kind} {item.filled ? '✓' : item.required ? 'required' : ''}</span>)}
              </div>
              {extras.length > 0 && <p className="mt-2 text-xs text-amber-700">Review required fields manually: {extras.join(', ')}</p>}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Inquiry CAPTCHA Settings">
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            Configure 2Captcha for automatic Inquiry CAPTCHA solving and
            review the per-license queue below.
          </p>
          <CaptchaSettings />
          <CaptchaQueue />
        </div>
      </Panel>

      <Panel title="Inquiry Run Results">
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="rounded border border-slate-200 bg-slate-50 p-3"><div className="text-xs text-slate-600">Processed</div><div className="text-2xl font-semibold text-slate-800">{processedCount}/{displayRunTotal}</div></div>
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Successfully Submitted</div><div className="text-2xl font-semibold text-emerald-800">{submittedCount}/{displayRunTotal}</div></div>
            <div className="rounded border border-red-200 bg-red-50 p-3"><div className="text-xs text-red-700">Failed</div><div className="text-2xl font-semibold text-red-800">{failedCount}/{displayRunTotal}</div></div>
            <div className="rounded border border-amber-200 bg-amber-50 p-3"><div className="text-xs text-amber-700">CAPTCHA</div><div className="text-2xl font-semibold text-amber-800">{captchaCount}/{displayRunTotal}</div></div>
            <div className="rounded border border-violet-200 bg-violet-50 p-3"><div className="text-xs text-violet-700">Review Required</div><div className="text-2xl font-semibold text-violet-800">{reviewCount}/{displayRunTotal}</div></div>
          </div>

          {runResults.filter((item) => item.status === 'failed').length > 0 && (
            <div className="rounded border border-red-200 p-3">
              <div className="font-medium text-red-800 mb-2">Failed</div>
              <div className="space-y-1 max-h-52 overflow-auto text-xs">
                {runResults.filter((item) => item.status === 'failed').map((item) => <div key={item.id} className="rounded bg-red-50 p-2"><span className="font-medium break-all">{item.target}</span>{item.reason ? ` — ${item.reason}` : ''}</div>)}
              </div>
            </div>
          )}

          <div className="rounded border border-violet-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div>
                <div className="font-medium text-violet-800">Saved Review Required leads — this license only</div>
                <div className="text-xs text-slate-500">Forms needing a manual click, missing required value, unsupported selection, or another human decision stay here until copied and cleared.</div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded border border-violet-300 text-violet-800 disabled:opacity-50" type="button" disabled={!savedReview.length} onClick={() => void copyReviewLeads()}>Copy Review Leads</button>
                <button className="px-3 py-1.5 rounded border border-red-300 text-red-700 disabled:opacity-50" type="button" disabled={!savedReview.length} onClick={() => void clearReviewLeads()}>Clear Saved</button>
              </div>
            </div>
            <textarea className="input min-h-28 font-mono text-xs" readOnly value={savedReview.map((item) => item.target).join('\n')} placeholder="Review-required domains/URLs will appear here after a run." />
            {savedReview.length > 0 && <div className="mt-2 space-y-1 text-xs text-violet-800">{savedReview.slice(-30).reverse().map((item) => <div key={item.id} className="break-all">{item.target}{item.reason ? ` — ${item.reason}` : ''}</div>)}</div>}
          </div>

          <div className="rounded border border-amber-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div>
                <div className="font-medium text-amber-800">Saved CAPTCHA failed leads — this license only</div>
                <div className="text-xs text-slate-500">Kept across runs until this licensed user copies and clears them.</div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded border border-amber-300 text-amber-800 disabled:opacity-50" type="button" disabled={!savedCaptcha.length} onClick={() => void copyCaptchaLeads()}>Copy CAPTCHA Leads</button>
                <button className="px-3 py-1.5 rounded border border-red-300 text-red-700 disabled:opacity-50" type="button" disabled={!savedCaptcha.length} onClick={() => void clearCaptchaLeads()}>Clear Saved</button>
              </div>
            </div>
            <textarea className="input min-h-28 font-mono text-xs" readOnly value={savedCaptcha.map((item) => item.target).join('\n')} placeholder="CAPTCHA-failed domains/URLs will appear here after a run." />
            {savedCaptcha.length > 0 && <div className="mt-2 space-y-1 text-xs text-amber-800">{savedCaptcha.slice(-30).reverse().map((item) => <div key={item.id} className="break-all">{item.target} — {item.captchaProvider || 'CAPTCHA'}</div>)}</div>}
          </div>
        </div>
      </Panel>

      {browserOpen && showScreenshots && (
        <Panel title="Inquiry Browser Review">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button className="px-2 py-1 rounded border text-xs" type="button" onClick={() => void sendInput({ type: 'back' })}>Back</button>
              <button className="px-2 py-1 rounded border text-xs" type="button" onClick={() => void sendInput({ type: 'forward' })}>Forward</button>
              <button className="px-2 py-1 rounded border text-xs" type="button" onClick={() => void sendInput({ type: 'reload' })}>Reload</button>
              <input className="input flex-1 min-w-52" value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="Click a field below, type text here, then press Type" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void typeManualText(); } }} />
              <button className="px-3 py-2 rounded border" type="button" onClick={() => void typeManualText()}>Type</button>
            </div>
            <div className="rounded border border-slate-300 overflow-hidden bg-slate-100">
              <img
                src={`/api/inquiry/screenshot?sessionId=${encodeURIComponent(sessionId)}&t=${frameNonce}`}
                alt="Inquiry browser"
                className="block w-full h-auto cursor-crosshair select-none"
                draggable={false}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 1440;
                  const y = ((e.clientY - rect.top) / rect.height) * 960;
                  void sendInput({ type: 'click', x, y });
                }}
                onDoubleClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 1440;
                  const y = ((e.clientY - rect.top) / rect.height) * 960;
                  void sendInput({ type: 'dblclick', x, y });
                }}
                onWheel={(e) => { e.preventDefault(); void sendInput({ type: 'scroll', deltaY: e.deltaY, deltaX: e.deltaX }); }}
              />
            </div>
            {(activeRunTarget || activeRunIndex >= 0) && (
              <div className="px-3 py-2 text-xs border-t bg-white text-slate-600">
                Live browser target: <span className="font-medium text-slate-900">{activeRunIndex >= 0 ? `${activeRunIndex + 1}${displayRunTotal ? `/${displayRunTotal}` : ''} — ` : ''}{activeRunTarget || 'final state'}</span>
              </div>
            )}
            <p className="text-xs text-slate-500">Click directly inside the screenshot to focus or adjust a field. Use the text box above for any extra field the automatic mapper could not fill.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}

function AdobeSenderPanel({
  connection,
  connecting,
  leadEmails,
  onConnect,
  onDisconnect,
  onRefresh,
  onLog,
  onToast,
}: {
  connection: AdobeConnectionStatus;
  connecting: boolean;
  leadEmails: string[];
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onLog: (level: LogLevel, message: string) => void;
  onToast: (message: string, level?: LogLevel) => void;
}) {
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [attachmentMode, setAttachmentMode] = React.useState<
    'upload' | 'html-pdf' | 'html-docx' | 'html-pptx'
  >('upload');
  const [attachmentHtml, setAttachmentHtml] = React.useState('');
  const [attachmentNameTemplate, setAttachmentNameTemplate] = React.useState(
    '{OriginalName}-{EmailUser}-{Random6}.{Ext}'
  );
  const [recipientsText, setRecipientsText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!recipientsText.trim() && leadEmails.length) {
      setRecipientsText(leadEmails.join('\n'));
    }
  }, [leadEmails, recipientsText]);

  const parsedRecipients = React.useMemo(
    () =>
      Array.from(
        new Set(
          recipientsText
            .split(/[\n,;\s]+/)
            .map((value) => value.trim().toLowerCase())
            .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        )
      ),
    [recipientsText]
  );

  async function sendAdobeShare() {
    if (!connection.connected || !connection.loggedIn) {
      onToast('Log into Adobe in the connected Dolphin browser first', 'error');
      return;
    }

    if (attachmentMode === 'upload' && !uploadFile) {
      onToast('Choose a PDF to upload to Adobe', 'error');
      return;
    }

    if (attachmentMode !== 'upload' && !attachmentHtml.trim()) {
      onToast('Enter the HTML attachment content', 'error');
      return;
    }

    if (!parsedRecipients.length) {
      onToast('Add at least one valid recipient email', 'error');
      return;
    }

    setSending(true);
    setLastResult(null);

    try {
      const formData = new FormData();
      if (attachmentMode === 'upload' && uploadFile) {
        formData.append('file', uploadFile);
      }
      formData.append('attachmentMode', attachmentMode);
      formData.append('attachmentHtml', attachmentHtml);
      formData.append('recipients', JSON.stringify(parsedRecipients));
      formData.append('attachmentNameTemplate', attachmentNameTemplate);

      const sourceLabel =
        attachmentMode === 'upload'
          ? uploadFile?.name || 'PDF upload'
          : attachmentMode.replace('html-', 'HTML → ').toUpperCase();
      onLog(
        'info',
        `Starting Adobe share: ${sourceLabel} → ${parsedRecipients.length} recipient(s)`
      );

      const response = await fetch('/api/adobe/browser/send', {
        method: 'POST',
        body: formData,
      });

      const data = await parseApiJson<{
        success?: boolean;
        partial?: boolean;
        message?: string;
        totalCount?: number;
        processedCount?: number;
        sentCount?: number;
        failedCount?: number;
        currentUrl?: string;
        error?: string;
        results?: Array<{
          index: number;
          total: number;
          recipient: string;
          filename: string;
          success: boolean;
          message: string;
          errorCode?: string;
          error?: string;
        }>;
      }>(response);

      if (!response.ok) {
        throw new Error(
          data.error || `Adobe share failed (HTTP ${response.status})`
        );
      }

      const results = data.results || [];

      for (const result of results) {
        if (result.success) {
          onLog(
            'success',
            `${result.index}/${result.total} ✅ SENT — ${result.recipient} — ${result.filename}`
          );
        } else {
          onLog(
            'error',
            `${result.index}/${result.total} ❌ FAILED — ${result.recipient} — ${result.errorCode || 'ADOBE_SHARE_FAILED'} — ${result.error || result.message}`
          );
        }
      }

      const total = data.totalCount ?? parsedRecipients.length;
      const sent = data.sentCount ?? results.filter((item) => item.success).length;
      const failed =
        data.failedCount ?? results.filter((item) => !item.success).length;
      const processed = data.processedCount ?? results.length;

      const summary =
        `Adobe complete — ${sent} sent, ${failed} failed, ${processed}/${total} processed`;

      setLastResult(summary);
      onLog(failed > 0 ? 'warning' : 'success', summary);

      if (failed > 0) {
        onToast(summary, 'warning');
      } else {
        onToast('Adobe sharing completed successfully', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastResult(message);
      onLog('error', `Adobe share failed: ${message}`);
      onToast(message, 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="lg:col-span-2">
        <Panel title="Adobe Login Browser">
          <AdobeRemoteBrowser connected={connection.connected} />
        </Panel>
      </div>

      <Panel title="Adobe Document Cloud">
        <div className="space-y-3 text-sm">
          <div
            className={`rounded border px-3 py-2 ${
              connection.connected && connection.loggedIn
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : connection.connected
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            <div className="font-semibold">
              {connection.connected && connection.loggedIn
                ? '● Connected — Adobe login detected'
                : connection.connected
                  ? '◐ Adobe browser open — waiting for login'
                  : '○ Not connected'}
            </div>

            {connection.profileId && (
              <div className="mt-1 text-xs">Browser session: {connection.profileId}</div>
            )}
            {connection.currentUrl && (
              <div className="mt-1 text-xs break-all">URL: {connection.currentUrl}</div>
            )}
          </div>

          {!connection.connected ? (
            <button
              type="button"
              disabled={connecting}
              className="px-3 py-2 rounded bg-[#6C63FF] text-white disabled:opacity-50"
              onClick={onConnect}
            >
              {connecting ? 'Opening Adobe…' : 'Open Adobe & Connect'}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="px-3 py-2 rounded border" onClick={onRefresh}>
                Check login
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded border border-red-300 text-red-600"
                onClick={onDisconnect}
              >
                Disconnect & Close Browser
              </button>
            </div>
          )}

          {connection.error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {connection.error}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Create, Upload & Share">
        <div className="space-y-3 text-sm">
          <Field label="Attachment source">
            <select
              className="input"
              value={attachmentMode}
              onChange={(event) =>
                setAttachmentMode(
                  event.target.value as 'upload' | 'html-pdf' | 'html-docx' | 'html-pptx'
                )
              }
            >
              <option value="upload">Upload PDF</option>
              <option value="html-pdf">HTML → PDF</option>
              <option value="html-docx">HTML → DOCX</option>
              <option value="html-pptx">HTML → PPTX</option>
            </select>
          </Field>

          {attachmentMode === 'upload' ? (
            <Field label="PDF attachment">
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="input"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
            </Field>
          ) : (
            <Field label="Attachment HTML">
              <textarea
                className="input min-h-56 font-mono text-xs"
                value={attachmentHtml}
                onChange={(event) => setAttachmentHtml(event.target.value)}
                placeholder="<!doctype html><html><body><h1>{DomainName}</h1><p>Prepared for {Email}</p></body></html>"
              />
            </Field>
          )}

          <Field label="Attachment name template">
            <input
              className="input"
              value={attachmentNameTemplate}
              onChange={(event) => setAttachmentNameTemplate(event.target.value)}
              placeholder="{OriginalName}-{EmailUser}-{Random6}.{Ext}"
            />
          </Field>

          <div className="text-xs text-slate-500 leading-5">
            Each recipient gets a separate Adobe upload with a unique filename.
            Supported placeholders:
            {' '}<code>{'{Email}'}</code>,
            {' '}<code>{'{EmailUser}'}</code>,
            {' '}<code>{'{Domain}'}</code>,
            {' '}<code>{'{DomainName}'}</code>,
            {' '}<code>{'{OriginalName}'}</code>,
            {' '}<code>{'{Ext}'}</code>,
            {' '}<code>{'{Date}'}</code>,
            {' '}<code>{'{Time}'}</code>,
            {' '}<code>{'{Random6}'}</code>,
            {' '}<code>{'{Random8}'}</code>,
            {' '}<code>{'{UUID}'}</code>.
          </div>

          <Field label={`Recipients (${parsedRecipients.length})`}>
            <textarea
              className="input min-h-40"
              value={recipientsText}
              onChange={(event) => setRecipientsText(event.target.value)}
              placeholder="employee1@company.com&#10;employee2@company.com"
            />
          </Field>

          <div className="text-xs text-slate-500">
            Imported lead emails are prefilled automatically. Adobe remains open in the same normal browser session.
            The selected file is generated or uploaded separately for each recipient using resolved HTML and filename placeholders, then shared to that recipient through Adobe.
          </div>

          <button
            type="button"
            disabled={
              sending ||
              !connection.connected ||
              !connection.loggedIn ||
              !uploadFile ||
              parsedRecipients.length === 0
            }
            className="px-3 py-2 rounded bg-[#6C63FF] text-white disabled:opacity-50"
            onClick={() => void sendAdobeShare()}
          >
            {sending ? 'Uploading & Sharing…' : 'Upload PDF & Share'}
          </button>

          {lastResult && (
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              {lastResult}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}


type GmailChromiumProfile = {
  directory: string;
  name: string;
  userDataDir: string;
};

type GmailConnectedAccount = {
  email: string;
  connectedAt: string;
  profileDirectory?: string | null;
};


type MicrosoftProxyEntry = {
  id: string;
  url: string;
  enabled: boolean;
  testStatus?: 'untested' | 'testing' | 'working' | 'failed';
  latencyMs?: number;
  ip?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  testError?: string;
  webOk?: boolean;
  smtpOk?: boolean;
  smtpLatencyMs?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpReason?: string;
};

type SmtpAuthMethod = 'auto' | 'LOGIN' | 'PLAIN' | 'CRAM-MD5';

type SmtpAccount = {
  id: string;
  label: string;
  host: string;
  port: number;
  security: 'starttls' | 'ssl' | 'none';
  authMethod: SmtpAuthMethod;
  username: string;
  password: string;
  fromEmail: string;
  enabled: boolean;
  maxSends: number;
};

type SendJobEventPayload = {
  type?: string;
  index?: number;
  total?: number;
  recipient?: string;
  accountEmail?: string;
  success?: boolean;
  messageId?: string;
  response?: string;
  error?: string;
  reason?: string;
  sentCount?: number;
  failedCount?: number;
  current?: number;
  attempt?: number;
  retryCount?: number;
  status?: 'invalid' | 'timeout' | string;
  account?: SmtpAccount;
  action?: 'pause' | 'resume' | 'stop';
  projectName?: string;
  senderMode?: 'smtp' | 'microsoft';
  eventSeq?: number;
  eventAt?: number;
};

type StoredSendJobEvent = {
  seq: number;
  at: number;
  payload: SendJobEventPayload;
};

function SmtpSenderPanel({
  senderMode = 'smtp',
  leadEmails,
  senderLogs,
  onClearSenderLogs,
  onLog,
  onToast,
}: {
  senderMode?: 'smtp' | 'microsoft';
  leadEmails: string[];
  senderLogs: RuntimeLog[];
  onClearSenderLogs: () => void;
  onLog: (level: LogLevel, message: string) => void;
  onToast: (message: string, level?: LogLevel) => void;
}) {
  const [projectName, setProjectName] = React.useState(
    senderMode === 'microsoft' ? 'Microsoft Project' : 'SMTP Project'
  );

  const [accounts, setAccounts] = React.useState<SmtpAccount[]>([
    {
      id: makeId('smtp'),
      label: 'SMTP Account 1',
      host: '',
      port: 587,
      security: 'starttls',
      authMethod: 'auto',
      username: '',
      password: '',
      fromEmail: '',
      enabled: true,
      maxSends: 350,
    },
  ]);

  const [smtpBulkInput, setSmtpBulkInput] = React.useState('');
  const [smtpInvalid, setSmtpInvalid] = React.useState<
    Array<SmtpAccount & { reason: string }>
  >([]);
  const [smtpTemporaryTimeouts, setSmtpTemporaryTimeouts] = React.useState<
    Array<SmtpAccount & { reason: string }>
  >([]);
  const [testingSmtp, setTestingSmtp] = React.useState(false);
  const [smtpTestValidCount, setSmtpTestValidCount] = React.useState(0);
  const [smtpTestProgress, setSmtpTestProgress] = React.useState({ current: 0, total: 0 });

  const [smtpConnectionTimeoutMs, setSmtpConnectionTimeoutMs] =
    React.useState(30000);
  const [smtpRetryCount, setSmtpRetryCount] = React.useState(2);
  const [smtpRetryDelayMs, setSmtpRetryDelayMs] = React.useState(5000);
  const [smtpPerAccountDelayMs, setSmtpPerAccountDelayMs] =
    React.useState(1000);
  const [smtpThreads, setSmtpThreads] = React.useState(2);
  const [smtpAutoRetestTimeouts, setSmtpAutoRetestTimeouts] =
    React.useState(true);
  const [smtpTimeoutRetestDelayMs, setSmtpTimeoutRetestDelayMs] =
    React.useState(60000);

  const [rotateAccounts, setRotateAccounts] = React.useState(false);
  const [selectedAccountId, setSelectedAccountId] = React.useState('');
  const [fromName, setFromName] = React.useState('{DomainName}');
  const [replyTo, setReplyTo] = React.useState('');

  const [smtpProxyEnabled, setSmtpProxyEnabled] =
    React.useState(false);
  const [smtpProxyRotate, setSmtpProxyRotate] =
    React.useState(false);
  const [smtpProxyInput, setSmtpProxyInput] =
    React.useState('');
  const [smtpProxyProtocol, setSmtpProxyProtocol] =
    React.useState<'http' | 'https' | 'socks5'>('http');
  const [smtpProxyHost, setSmtpProxyHost] = React.useState('');
  const [smtpProxyPort, setSmtpProxyPort] = React.useState('');
  const [smtpProxyUsername, setSmtpProxyUsername] =
    React.useState('');
  const [smtpProxyPassword, setSmtpProxyPassword] =
    React.useState('');
  const [smtpProxies, setSmtpProxies] = React.useState<
    MicrosoftProxyEntry[]
  >([]);
  const [testingSmtpProxies, setTestingSmtpProxies] =
    React.useState(false);

  const [microsoftProxyEnabled, setMicrosoftProxyEnabled] =
    React.useState(false);
  const [microsoftProxyRotate, setMicrosoftProxyRotate] =
    React.useState(false);
  const [microsoftProxyInput, setMicrosoftProxyInput] =
    React.useState('');
  const [microsoftProxyProtocol, setMicrosoftProxyProtocol] =
    React.useState<'http' | 'https' | 'socks5'>('http');
  const [microsoftProxyHost, setMicrosoftProxyHost] = React.useState('');
  const [microsoftProxyPort, setMicrosoftProxyPort] = React.useState('');
  const [microsoftProxyUsername, setMicrosoftProxyUsername] =
    React.useState('');
  const [microsoftProxyPassword, setMicrosoftProxyPassword] =
    React.useState('');
  const [microsoftProxies, setMicrosoftProxies] = React.useState<
    MicrosoftProxyEntry[]
  >([]);
  const [testingMicrosoftProxies, setTestingMicrosoftProxies] =
    React.useState(false);

  const smtpPanelSessionKey = `3d-suite-${senderMode}-smtp-proxy-session`;

  const saveSmtpPanelSession = React.useCallback(() => {
    try {
      const activeProxies =
        senderMode === 'microsoft' ? microsoftProxies : smtpProxies;

      window.sessionStorage.setItem(
        smtpPanelSessionKey,
        JSON.stringify({
          projectName,
          accounts,
          rotateAccounts,
          selectedAccountId,
          smtpConnectionTimeoutMs,
          smtpRetryCount,
          smtpRetryDelayMs,
          smtpPerAccountDelayMs,
          smtpThreads,
          smtpAutoRetestTimeouts,
          smtpTimeoutRetestDelayMs,
          proxyEnabled:
            senderMode === 'microsoft'
              ? microsoftProxyEnabled
              : smtpProxyEnabled,
          proxyRotate:
            senderMode === 'microsoft'
              ? microsoftProxyRotate
              : smtpProxyRotate,
          proxies: activeProxies.map((proxy) => ({
            id: proxy.id,
            url: proxy.url,
            enabled: proxy.enabled,
          })),
        })
      );

      onLog(
        'success',
        `${senderMode === 'microsoft' ? 'Microsoft' : 'SMTP'} SMTP accounts and proxies saved to this browser session`
      );
      onToast('SMTPs and proxies saved to session', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('error', `Could not save SMTP/proxy session: ${message}`);
      onToast('Could not save SMTP/proxy session', 'error');
    }
  }, [
    accounts,
    microsoftProxies,
    microsoftProxyEnabled,
    microsoftProxyRotate,
    onLog,
    onToast,
    projectName,
    rotateAccounts,
    selectedAccountId,
    senderMode,
    smtpAutoRetestTimeouts,
    smtpConnectionTimeoutMs,
    smtpPanelSessionKey,
    smtpPerAccountDelayMs,
    smtpProxies,
    smtpProxyEnabled,
    smtpProxyRotate,
    smtpRetryCount,
    smtpRetryDelayMs,
    smtpThreads,
    smtpTimeoutRetestDelayMs,
  ]);

  const clearSmtpPanelSession = React.useCallback(() => {
    try {
      window.sessionStorage.removeItem(smtpPanelSessionKey);
      onLog(
        'info',
        `${senderMode === 'microsoft' ? 'Microsoft' : 'SMTP'} saved SMTP/proxy session cleared`
      );
      onToast('Saved SMTP/proxy session cleared', 'success');
    } catch {
      onToast('Could not clear SMTP/proxy session', 'error');
    }
  }, [onLog, onToast, senderMode, smtpPanelSessionKey]);

  React.useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(smtpPanelSessionKey);
      if (!raw) return;

      const saved = JSON.parse(raw) as Record<string, unknown>;

      if (typeof saved.projectName === 'string' && saved.projectName.trim()) {
        setProjectName(saved.projectName);
      }

      if (Array.isArray(saved.accounts) && saved.accounts.length > 0) {
        setAccounts(saved.accounts as SmtpAccount[]);
      }

      if (typeof saved.rotateAccounts === 'boolean') {
        setRotateAccounts(saved.rotateAccounts);
      }

      if (typeof saved.selectedAccountId === 'string') {
        setSelectedAccountId(saved.selectedAccountId);
      }

      if (typeof saved.smtpConnectionTimeoutMs === 'number') {
        setSmtpConnectionTimeoutMs(saved.smtpConnectionTimeoutMs);
      }
      if (typeof saved.smtpRetryCount === 'number') {
        setSmtpRetryCount(saved.smtpRetryCount);
      }
      if (typeof saved.smtpRetryDelayMs === 'number') {
        setSmtpRetryDelayMs(saved.smtpRetryDelayMs);
      }
      if (typeof saved.smtpPerAccountDelayMs === 'number') {
        setSmtpPerAccountDelayMs(saved.smtpPerAccountDelayMs);
      }
      if (typeof saved.smtpThreads === 'number') {
        setSmtpThreads(saved.smtpThreads);
      }
      if (typeof saved.smtpAutoRetestTimeouts === 'boolean') {
        setSmtpAutoRetestTimeouts(saved.smtpAutoRetestTimeouts);
      }
      if (typeof saved.smtpTimeoutRetestDelayMs === 'number') {
        setSmtpTimeoutRetestDelayMs(saved.smtpTimeoutRetestDelayMs);
      }

      const restoredProxies = Array.isArray(saved.proxies)
        ? (saved.proxies as Array<Record<string, unknown>>)
            .map((proxy, index) => ({
              id: String(proxy.id || makeId(`proxy-${index + 1}`)),
              url: String(proxy.url || '').trim(),
              enabled: proxy.enabled !== false,
              testStatus: 'untested' as const,
            }))
            .filter((proxy) => proxy.url.length > 0)
        : [];

      if (senderMode === 'microsoft') {
        if (typeof saved.proxyEnabled === 'boolean') {
          setMicrosoftProxyEnabled(saved.proxyEnabled);
        }
        if (typeof saved.proxyRotate === 'boolean') {
          setMicrosoftProxyRotate(saved.proxyRotate);
        }
        setMicrosoftProxies(restoredProxies);
      } else {
        if (typeof saved.proxyEnabled === 'boolean') {
          setSmtpProxyEnabled(saved.proxyEnabled);
        }
        if (typeof saved.proxyRotate === 'boolean') {
          setSmtpProxyRotate(saved.proxyRotate);
        }
        setSmtpProxies(restoredProxies);
      }

      onLog(
        'success',
        `Restored ${senderMode === 'microsoft' ? 'Microsoft' : 'SMTP'} SMTP accounts and proxies from session`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('warning', `Could not restore SMTP/proxy session: ${message}`);
    }
    // Restore only once for this sender panel instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderMode, smtpPanelSessionKey]);

  const [microsoftMeetingEnabled, setMicrosoftMeetingEnabled] =
    React.useState(true);
  const [meetingTitleTemplate, setMeetingTitleTemplate] =
    React.useState('{DomainName} Meeting Invitation');
  const [meetingDescriptionTemplate, setMeetingDescriptionTemplate] =
    React.useState(
      'You are invited to join our meeting. Please RSVP to confirm your attendance.'
    );
  const [meetingLocationTemplate, setMeetingLocationTemplate] =
    React.useState('{DomainName} Conference Room');
  const [meetingOrganizerNameTemplate, setMeetingOrganizerNameTemplate] =
    React.useState('{DomainName} Meetings');
  const [meetingDurationMinutes, setMeetingDurationMinutes] =
    React.useState(60);
  const [meetingReminderMinutes, setMeetingReminderMinutes] =
    React.useState(15);

  const [onBehalfEnabled, setOnBehalfEnabled] =
    React.useState(false);
  const [onBehalfDisplayNamesText, setOnBehalfDisplayNamesText] =
    React.useState('Teams Meeting Organizer');
  const [onBehalfPrefixesText, setOnBehalfPrefixesText] =
    React.useState('scheduler');
  const [onBehalfRandomize, setOnBehalfRandomize] =
    React.useState(false);

  const onBehalfDisplayNames = React.useMemo(
    () =>
      Array.from(
        new Set(
          onBehalfDisplayNamesText
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ),
    [onBehalfDisplayNamesText]
  );

  const onBehalfPrefixes = React.useMemo(
    () =>
      Array.from(
        new Set(
          onBehalfPrefixesText
            .split(/\r?\n/)
            .map((value) => value.trim().replace(/^@+/, ''))
            .filter((value) => /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(value))
        )
      ),
    [onBehalfPrefixesText]
  );

  const selectedOnBehalfAccount =
    accounts.find((account) => account.id === selectedAccountId) ||
    accounts.find((account) => account.enabled) ||
    null;

  const selectedOnBehalfDomain =
    selectedOnBehalfAccount?.fromEmail.split('@')[1]?.trim().toLowerCase() || '';

  const [recipientsText, setRecipientsText] = React.useState('');
  const [subjectTemplate, setSubjectTemplate] = React.useState(
    'Document for {DomainName}'
  );
  const [smtpRandomizeSubjects, setSmtpRandomizeSubjects] =
    React.useState(false);
  const [smtpSubjectPoolText, setSmtpSubjectPoolText] =
    React.useState('');
  const [messageMode, setMessageMode] = React.useState<'text' | 'html'>('html');
  const [bodyTemplate, setBodyTemplate] = React.useState(
    '<html><body style="font-family:Arial,sans-serif;"><p>Hello,</p><p>Please review the attached document.</p></body></html>'
  );

  const [attachmentLink, setAttachmentLink] = React.useState('');
  const [ctaLink, setCtaLink] = React.useState('');

  const [smtpRandomizeAttachmentLinks, setSmtpRandomizeAttachmentLinks] =
    React.useState(false);
  const [smtpAttachmentLinkPoolText, setSmtpAttachmentLinkPoolText] =
    React.useState('');

  const [smtpRandomizeCtaLinks, setSmtpRandomizeCtaLinks] =
    React.useState(false);
  const [smtpCtaLinkPoolText, setSmtpCtaLinkPoolText] =
    React.useState('');

  const [logoDevEnabled, setLogoDevEnabled] = React.useState(false);
  const [logoDevKey, setLogoDevKey] = React.useState('');
  const [logoDevSize, setLogoDevSize] = React.useState(128);
  const [logoDevFormat, setLogoDevFormat] = React.useState<'png' | 'webp'>('png');
  const [logoDevTheme, setLogoDevTheme] = React.useState<
    'light' | 'dark' | 'auto'
  >('auto');

  const [qrEnabled, setQrEnabled] = React.useState(false);
  const [qrSource, setQrSource] = React.useState<
    'attachment-link' | 'cta-link' | 'custom'
  >('attachment-link');
  const [qrCustomData, setQrCustomData] = React.useState('');
  const [qrSize, setQrSize] = React.useState(512);
  const [qrErrorCorrection, setQrErrorCorrection] = React.useState<
    'L' | 'M' | 'Q' | 'H'
  >('M');
  const [qrPreviewDataUri, setQrPreviewDataUri] = React.useState('');
  const [qrPreviewValue, setQrPreviewValue] = React.useState('');
  const [qrPreviewing, setQrPreviewing] = React.useState(false);

  const [attachmentEnabled, setAttachmentEnabled] = React.useState(false);
  const [attachmentMode, setAttachmentMode] = React.useState<
    'upload' | 'html-pdf' | 'html-pptx' | 'html-docx' | 'html-svg' | 'html-eml'
  >('upload');
  const [attachmentHtml, setAttachmentHtml] = React.useState(
    '<html><body style="font-family:Arial,sans-serif;padding:32px;"><img src="{CompanyLogo}" style="max-width:160px;height:auto;"><h2>Document for {DomainName}</h2><p>Reference: {Random8}</p><img src="{QRCode}" style="width:140px;height:140px;"></body></html>'
  );
  const [attachmentNameTemplate, setAttachmentNameTemplate] = React.useState(
    '{DomainName}_Document_{Date}.{Ext}'
  );
  const [attachment, setAttachment] = React.useState<File | null>(null);
  const [sending, setSending] = React.useState(false);
  const [sendJobId, setSendJobId] = React.useState('');
  const [sendJobStatus, setSendJobStatus] = React.useState<
    'idle' | 'running' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'failed'
  >('idle');
  const [smtpSendProgress, setSmtpSendProgress] = React.useState({
    current: 0,
    total: 0,
    sent: 0,
    failed: 0,
  });
  const sendJobLogCursorRef = React.useRef(0);
  const processedSendJobEventSeqsRef = React.useRef<Set<number>>(new Set());

  const replayStoredSendEvent = React.useCallback(
    (event: SendJobEventPayload) => {
      if (event.type === 'job_started') {
        onLog(
          'info',
          `${event.projectName || (senderMode === 'microsoft' ? 'Microsoft Project' : 'SMTP Project')} — ${
            senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'
          } run started — ${event.total || 0} recipient(s)`
        );
        return;
      }

      if (event.type === 'job_control') {
        if (event.action === 'pause') {
          onLog('warning', `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} sending paused — in-flight SMTP delivery may finish first`);
        } else if (event.action === 'resume') {
          onLog('info', `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} sending resumed`);
        } else if (event.action === 'stop') {
          onLog('warning', `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} stop requested — no new recipients will be started`);
        }
        return;
      }

      if (event.type === 'result') {
        if (event.success) {
          onLog(
            'success',
            `${event.index}/${event.total} ✅ ${senderMode === 'microsoft' ? 'Microsoft meeting email' : 'Email'} sent successfully to ${event.recipient || ''}${
              event.accountEmail ? ` — via ${event.accountEmail}` : ''
            }`
          );
        } else {
          onLog(
            'error',
            `${event.index}/${event.total} ❌ ${senderMode === 'microsoft' ? 'Microsoft meeting email' : 'Email'} failed to ${event.recipient || ''}${
              event.accountEmail ? ` — via ${event.accountEmail}` : ''
            } — ${event.error || 'unknown SMTP error'}`
          );
        }
        return;
      }

      if (event.type === 'retry') {
        onLog(
          'warning',
          `${event.index}/${event.total} SMTP retry ${event.attempt}/${event.retryCount} — ${event.recipient || ''} — ${event.error || 'temporary SMTP error'}`
        );
        return;
      }

      if (event.type === 'pool_recovered' && event.account) {
        setSmtpTemporaryTimeouts((current) =>
          current.filter((item) => item.id !== event.account?.id)
        );
        setAccounts((current) =>
          current.some((item) => item.id === event.account?.id)
            ? current
            : [...current, event.account as SmtpAccount]
        );
        onLog('success', `SMTP RECOVERED — ${event.account.fromEmail}`);
        return;
      }

      if (event.type === 'pool_update' && event.account) {
        if (event.status === 'invalid') {
          setAccounts((current) =>
            current.filter((account) => account.id !== event.account?.id)
          );
          setSmtpInvalid((current) => [
            ...current.filter((item) => item.id !== event.account?.id),
            {
              ...event.account!,
              reason: event.reason || 'SMTP account became invalid during sending',
            },
          ]);
          onLog('error', `SMTP REMOVED — ${event.account.fromEmail} — ${event.reason || 'invalid SMTP'}`);
        } else if (event.status === 'timeout') {
          setAccounts((current) =>
            current.filter((account) => account.id !== event.account?.id)
          );
          setSmtpTemporaryTimeouts((current) => [
            ...current.filter((item) => item.id !== event.account?.id),
            {
              ...event.account!,
              reason: event.reason || 'Temporary SMTP timeout',
            },
          ]);
          onLog('warning', `SMTP TEMP TIMEOUT — ${event.account.fromEmail} — ${event.reason || 'timeout'}`);
        }
        return;
      }

      if (event.type === 'stopped') {
        onLog(
          'warning',
          `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} stopped — ${(event.sentCount || 0) + (event.failedCount || 0)}/${event.total || 0} processed`
        );
        return;
      }

      if (event.type === 'complete') {
        onLog(
          event.failedCount ? 'warning' : 'success',
          `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} complete — ${event.sentCount || 0} sent, ${event.failedCount || 0} failed, ${event.total || 0} total`
        );
        return;
      }

      if (event.type === 'fatal') {
        onLog('error', `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} send failed: ${event.error || 'unknown server error'}`);
      }
    },
    [onLog, senderMode]
  );

  React.useEffect(() => {
    const key = `3d-suite:${senderMode}:active-send-job`;
    const savedJobId = window.sessionStorage.getItem(key) || '';
    if (savedJobId) {
      setSendJobId(savedJobId);
    }
  }, [senderMode]);

  React.useEffect(() => {
    if (!sendJobId) return;

    const key = `3d-suite:${senderMode}:active-send-job`;
    window.sessionStorage.setItem(key, sendJobId);

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/send-jobs/${encodeURIComponent(sendJobId)}?after=${sendJobLogCursorRef.current}`,
          { cache: 'no-store' }
        );

        if (!response.ok) {
          // A just-created job can briefly return 404 before the send route has
          // registered it. Never interpret that transient race as a stopped job.
          if (response.status === 404 && !sending) {
            window.sessionStorage.removeItem(key);
            if (!cancelled) {
              setSendJobId('');
              setSendJobStatus('idle');
            }
          }
          return;
        }

        const data = (await response.json()) as {
          job?: {
            status?: 'running' | 'paused' | 'stopping' | 'stopped' | 'completed' | 'failed';
            total?: number;
            current?: number;
            sent?: number;
            failed?: number;
          };
          events?: StoredSendJobEvent[];
          logCursor?: number;
          clearedThroughSeq?: number;
        };

        if (cancelled || !data.job) return;

        const clearedThrough = Number(data.clearedThroughSeq || 0);
        if (clearedThrough > sendJobLogCursorRef.current) {
          sendJobLogCursorRef.current = clearedThrough;
        }

        for (const storedEvent of data.events || []) {
          const seq = Number(storedEvent.seq || 0);
          if (seq > 0 && processedSendJobEventSeqsRef.current.has(seq)) {
            sendJobLogCursorRef.current = Math.max(sendJobLogCursorRef.current, seq);
            continue;
          }

          if (seq > 0) {
            processedSendJobEventSeqsRef.current.add(seq);
            sendJobLogCursorRef.current = Math.max(sendJobLogCursorRef.current, seq);
          }

          replayStoredSendEvent(storedEvent.payload || {});
        }

        if (typeof data.logCursor === 'number') {
          sendJobLogCursorRef.current = Math.max(
            sendJobLogCursorRef.current,
            data.logCursor
          );
        }

        const status = data.job.status || 'running';
        setSendJobStatus(status);
        setSending(
          status === 'running' ||
            status === 'paused' ||
            status === 'stopping'
        );
        setSmtpSendProgress({
          current: data.job.current || 0,
          total: data.job.total || 0,
          sent: data.job.sent || 0,
          failed: data.job.failed || 0,
        });

        if (
          status === 'completed' ||
          status === 'stopped' ||
          status === 'failed'
        ) {
          window.sessionStorage.removeItem(key);
        }
      } catch {
        // A transient dashboard/API connection failure must not stop the server-side job.
        // The next successful poll requests only events after the stored cursor.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sendJobId, senderMode, sending, replayStoredSendEvent]);

  React.useEffect(() => {
    if (!recipientsText.trim() && leadEmails.length) {
      setRecipientsText(leadEmails.join('\n'));
    }
  }, [leadEmails, recipientsText]);

  React.useEffect(() => {
    if (!selectedAccountId && accounts.length) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const recipients = React.useMemo(
    () =>
      Array.from(
        new Set(
          recipientsText
            .split(/[\n,;\s]+/)
            .map((value) => value.trim().toLowerCase())
            .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        )
      ),
    [recipientsText]
  );

  function parseBulkSmtpInput(): SmtpAccount[] {
    const parsed: SmtpAccount[] = [];

    const lines = smtpBulkInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const parts = line.split(':');

      if (parts.length < 5) {
        onLog(
          'warning',
          `SMTP import skipped line ${index + 1}: expected host:port:user:pass:fromemail`
        );
        continue;
      }

      const host = parts.shift()?.trim() || '';
      const portRaw = parts.shift()?.trim() || '';
      const username = parts.shift()?.trim() || '';
      const fromEmail = parts.pop()?.trim() || '';
      const password = parts.join(':');

      const port = Number(portRaw);

      if (
        !host ||
        !Number.isFinite(port) ||
        port <= 0 ||
        !username ||
        !password ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)
      ) {
        onLog(
          'warning',
          `SMTP import skipped line ${index + 1}: invalid field(s)`
        );
        continue;
      }

      parsed.push({
        id: makeId('smtp'),
        label: fromEmail || `${host}:${port}`,
        host,
        port,
        security:
          port === 465 ? 'ssl' : 'starttls',
        authMethod: 'auto',
        username,
        password,
        fromEmail,
        enabled: true,
        maxSends: 350,
      });
    }

    return parsed;
  }

  function importBulkSmtp() {
    const parsed = parseBulkSmtpInput();

    if (!parsed.length) {
      onToast('No valid SMTP lines were found', 'warning');
      return;
    }

    setAccounts(parsed);
    setSelectedAccountId(parsed[0].id);
    setSmtpInvalid([]);
    setSmtpTemporaryTimeouts([]);

    onLog(
      'success',
      `Imported ${parsed.length} SMTP account(s)`
    );
    onToast(`Imported ${parsed.length} SMTP account(s)`, 'success');
  }

  async function testSmtpAccounts() {
    const candidates = accounts.filter(
      (account) =>
        account.enabled &&
        account.host.trim() &&
        account.port > 0 &&
        account.username.trim() &&
        account.password &&
        account.fromEmail.trim()
    );

    if (!candidates.length) {
      onToast('No configured SMTP accounts to test', 'warning');
      return;
    }

    setTestingSmtp(true);
    setSmtpTestValidCount(0);
    setSmtpTestProgress({ current: 0, total: candidates.length });
    setSmtpInvalid([]);
    setSmtpTemporaryTimeouts([]);

    const candidateById = new Map(
      candidates.map((account) => [account.id, account])
    );

    const validResults: SmtpAccount[] = [];
    const invalidResults: Array<SmtpAccount & { reason: string }> = [];
    const timeoutResults: Array<SmtpAccount & { reason: string }> = [];

    try {
      onLog(
        'info',
        `Testing ${candidates.length} SMTP account(s) one by one…`
      );

      const response = await fetch('/api/smtp/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accounts: candidates,
          proxyUrl:
            senderMode === 'microsoft' && microsoftProxyEnabled
              ? microsoftProxies.find((proxy) => proxy.enabled)?.url || null
              : senderMode === 'smtp' && smtpProxyEnabled
                ? smtpProxies.find((proxy) => proxy.enabled)?.url || null
                : null,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let message = errorBody || `SMTP test failed (HTTP ${response.status})`;

        try {
          const parsed = JSON.parse(errorBody) as { error?: string };
          message = parsed.error || message;
        } catch {
          // Keep plain-text response.
        }

        throw new Error(message);
      }

      if (!response.body) {
        throw new Error('SMTP test stream was not available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleEvent = (event: {
        type?: string;
        status?: 'valid' | 'invalid' | 'timeout';
        index?: number;
        total?: number;
        accountId?: string;
        label?: string;
        fromEmail?: string;
        host?: string;
        port?: number;
        authMethod?: SmtpAuthMethod;
        reason?: string;
        validCount?: number;
        invalidCount?: number;
        timeoutCount?: number;
        error?: string;
      }) => {
        const normalizedType =
          event.type === 'result' && event.status ? event.status : event.type;

        const account = event.accountId
          ? candidateById.get(event.accountId)
          : undefined;

        const displayName =
          event.fromEmail || account?.fromEmail || event.label || account?.label || 'SMTP account';

        if (normalizedType === 'testing') {
          setSmtpTestProgress({
            current: event.index || 0,
            total: event.total || candidates.length,
          });
          onLog(
            'info',
            `Testing SMTP ${event.index || '?'}/${event.total || candidates.length} — ${displayName} — ${event.host || account?.host || ''}:${event.port || account?.port || ''}`
          );
          return;
        }

        if (normalizedType === 'valid' && account) {
          const validAccount = event.authMethod && event.authMethod !== 'auto'
            ? { ...account, authMethod: event.authMethod }
            : account;
          validResults.push(validAccount);
          if (validAccount.authMethod !== account.authMethod) {
            candidateById.set(account.id, validAccount);
            setAccounts((current) =>
              current.map((item) => item.id === account.id ? validAccount : item)
            );
          }
          setSmtpTestValidCount(validResults.length);
          onLog(
            'success',
            `VALID SMTP ${event.index || validResults.length}/${event.total || candidates.length} — ${displayName} — ${account.host}:${account.port}`
          );
          return;
        }

        if (normalizedType === 'invalid' && account) {
          const item = {
            ...account,
            reason: event.reason || 'SMTP verification failed',
          };
          invalidResults.push(item);
          setSmtpInvalid([...invalidResults]);
          onLog(
            'error',
            `INVALID SMTP ${event.index || '?'}/${event.total || candidates.length} — ${displayName} — ${item.reason}`
          );
          return;
        }

        if (normalizedType === 'timeout' && account) {
          const item = {
            ...account,
            reason: event.reason || 'SMTP connection timed out',
          };
          timeoutResults.push(item);
          setSmtpTemporaryTimeouts([...timeoutResults]);
          onLog(
            'warning',
            `TEMP SMTP TIMEOUT ${event.index || '?'}/${event.total || candidates.length} — ${displayName} — ${item.reason}`
          );
          return;
        }

        if (normalizedType === 'complete') {
          onLog(
            'success',
            `SMTP test complete — ${event.validCount ?? validResults.length} valid, ${event.invalidCount ?? invalidResults.length} invalid, ${event.timeoutCount ?? timeoutResults.length} temporary timeout(s)`
          );
          return;
        }

        if (normalizedType === 'fatal') {
          throw new Error(event.error || 'SMTP test stream failed');
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), {
          stream: !done,
        });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          handleEvent(JSON.parse(trimmed));
        }

        if (done) break;
      }

      if (buffer.trim()) {
        handleEvent(JSON.parse(buffer.trim()));
      }

      setSmtpTestProgress({ current: candidates.length, total: candidates.length });

      // Remove only SMTPs that were confirmed invalid. Temporary timeouts stay
      // in the active list so they can be re-tested/recovered later.
      const invalidIds = new Set(invalidResults.map((item) => item.id));
      setAccounts((current) =>
        current.filter((account) => !invalidIds.has(account.id))
      );
      setSmtpInvalid(invalidResults);
      setSmtpTemporaryTimeouts(timeoutResults);

      if (invalidIds.has(selectedAccountId)) {
        const nextAccount = accounts.find(
          (account) => !invalidIds.has(account.id)
        );
        setSelectedAccountId(nextAccount?.id || '');
      }

      onToast(
        `SMTP test complete: ${validResults.length} valid, ${invalidResults.length} invalid, ${timeoutResults.length} timeout(s)`,
        validResults.length ? 'success' : 'warning'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      onLog('error', `SMTP test failed: ${message}`);
      onToast(`SMTP test failed: ${message}`, 'error');
    } finally {
      setTestingSmtp(false);
    }
  }

  async function loadSubjectFile(file: File | null) {
    if (!file) return;

    try {
      const text = await file.text();
      setSmtpSubjectPoolText(text);

      const count = text
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean).length;

      onLog(
        'success',
        `Loaded ${count} SMTP subject line(s) from ${file.name}`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      onLog('error', `Could not read subject file: ${message}`);
      onToast('Could not read subject file', 'error');
    }
  }

  const smtpSubjectPool = React.useMemo(
    () =>
      Array.from(
        new Set(
          smtpSubjectPoolText
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ),
    [smtpSubjectPoolText]
  );

  const smtpAttachmentLinkPool = React.useMemo(
    () =>
      Array.from(
        new Set(
          smtpAttachmentLinkPoolText
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ),
    [smtpAttachmentLinkPoolText]
  );

  const smtpCtaLinkPool = React.useMemo(
    () =>
      Array.from(
        new Set(
          smtpCtaLinkPoolText
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
        )
      ),
    [smtpCtaLinkPoolText]
  );

  async function loadAttachmentLinksFile(file: File | null) {
    if (!file) return;

    try {
      const text = await file.text();
      setSmtpAttachmentLinkPoolText(text);

      const count = text
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean).length;

      onLog(
        'success',
        `Loaded ${count} Attachment Link line(s) from ${file.name}`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      onLog(
        'error',
        `Could not read Attachment Link file: ${message}`
      );
      onToast('Could not read Attachment Link file', 'error');
    }
  }

  async function loadCtaLinksFile(file: File | null) {
    if (!file) return;

    try {
      const text = await file.text();
      setSmtpCtaLinkPoolText(text);

      const count = text
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean).length;

      onLog(
        'success',
        `Loaded ${count} CTA Link line(s) from ${file.name}`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      onLog(
        'error',
        `Could not read CTA Link file: ${message}`
      );
      onToast('Could not read CTA Link file', 'error');
    }
  }

  function updateAccount(
    id: string,
    patch: Partial<SmtpAccount>
  ) {
    setAccounts((current) =>
      current.map((account) =>
        account.id === id ? { ...account, ...patch } : account
      )
    );
  }

  function addAccount() {
    setAccounts((current) => [
      ...current,
      {
        id: makeId('smtp'),
        label: `SMTP Account ${current.length + 1}`,
        host: '',
        port: 587,
        security: 'starttls',
        authMethod: 'auto',
        username: '',
        password: '',
        fromEmail: '',
        enabled: true,
        maxSends: 350,
      },
    ]);
  }

  function removeAccount(id: string) {
    setAccounts((current) => {
      if (current.length <= 1) return current;
      return current.filter((account) => account.id !== id);
    });

    if (selectedAccountId === id) {
      setSelectedAccountId('');
    }
  }

  function buildLogoPreviewUrl(domain: string): string {
    if (!logoDevEnabled || !logoDevKey.trim()) return '';

    const params = new URLSearchParams({
      token: logoDevKey.trim(),
      size: String(Math.min(800, Math.max(16, logoDevSize || 128))),
      format: logoDevFormat,
      theme: logoDevTheme,
    });

    return `https://img.logo.dev/${encodeURIComponent(
      domain
    )}?${params.toString()}`;
  }

  function previewHtml(source: string): string {
    let html = source || '';

    html = html.replace(/\{CompanyLogo\}/gi, buildLogoPreviewUrl('example.com'));

    html = html
      .replace(/\{Email\}/gi, 'alex@example.com')
      .replace(/\{LocalPart\}/gi, 'alex')
      .replace(/\{Domain\}/gi, 'example.com')
      .replace(/\{DomainName\}/gi, 'example')
      .replace(/\{Date\}/gi, new Date().toISOString().slice(0, 10))
      .replace(/\{Random6\}/gi, '492817')
      .replace(/\{Random8\}/gi, '57284019')
      .replace(/\{AttachmentLink\}/gi, attachmentLink || '#')
      .replace(/\{CTA\}/gi, ctaLink || '#');

    return html;
  }

  function addSmtpProxyLines(raw: string) {
    const values = raw
      .split(/\r?\n|;/)
      .map((value) => normalizeMicrosoftProxyUrl(value))
      .filter((value): value is string => Boolean(value));

    if (!values.length) {
      onToast('No valid HTTP/HTTPS/SOCKS5 proxy URLs were found', 'warning');
      return;
    }

    setSmtpProxies((current) => {
      const existing = new Set(current.map((item) => item.url));
      const added = values
        .filter((url) => !existing.has(url))
        .map((url) => ({
          id: makeId('proxy'),
          url,
          enabled: true,
          testStatus: 'untested' as const,
        }));

      return [...current, ...added];
    });

    setSmtpProxyInput('');
    onLog('success', `Loaded ${values.length} SMTP proxy URL(s)`);
  }

  function addManualSmtpProxy() {
    const host = smtpProxyHost.trim();
    const port = Number(smtpProxyPort);

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      onToast('Enter a valid proxy host and port', 'warning');
      return;
    }

    const auth = smtpProxyUsername.trim()
      ? `${encodeURIComponent(smtpProxyUsername.trim())}:${encodeURIComponent(smtpProxyPassword)}@`
      : '';

    const url = `${smtpProxyProtocol}://${auth}${host}:${port}`;
    addSmtpProxyLines(url);

    setSmtpProxyHost('');
    setSmtpProxyPort('');
    setSmtpProxyUsername('');
    setSmtpProxyPassword('');
  }

  async function loadSmtpProxyFile(file: File | null) {
    if (!file) return;

    try {
      const text = await file.text();
      addSmtpProxyLines(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('error', `Could not read SMTP proxy file: ${message}`);
      onToast('Could not read proxy file', 'error');
    }
  }

  async function testSmtpProxies() {
    const candidates = smtpProxies.filter((proxy) => proxy.enabled);

    if (!candidates.length) {
      onToast('No enabled SMTP proxies to test', 'warning');
      return;
    }

    setTestingSmtpProxies(true);
    setSmtpProxies((current) =>
      current.map((proxy) =>
        proxy.enabled
          ? {
              ...proxy,
              testStatus: 'testing',
              testError: undefined,
            }
          : proxy
      )
    );

    try {
      const response = await fetch('/api/smtp/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'testProxies',
          proxies: candidates.map((proxy) => ({
            id: proxy.id,
            url: proxy.url,
          })),
          smtpHost: accounts.find((account) => account.enabled)?.host || '',
          smtpPort: accounts.find((account) => account.enabled)?.port || 0,
        }),
      });

      const data = (await response.json()) as {
        results?: Array<{
          id: string;
          url: string;
          ok: boolean;
          latencyMs: number;
          ip?: string;
          country?: string;
          countryCode?: string;
          region?: string;
          city?: string;
          reason?: string;
          webOk?: boolean;
          smtpOk?: boolean;
          smtpLatencyMs?: number;
          smtpHost?: string;
          smtpPort?: number;
          smtpReason?: string;
        }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Proxy test failed (HTTP ${response.status})`);
      }

      const byId = new Map((data.results || []).map((result) => [result.id, result]));

      setSmtpProxies((current) =>
        current.map((proxy) => {
          const result = byId.get(proxy.id);
          if (!result) return proxy;

          return {
            ...proxy,
            testStatus: result.ok ? 'working' : 'failed',
            latencyMs: result.latencyMs,
            ip: result.ip,
            country: result.country,
            countryCode: result.countryCode,
            region: result.region,
            city: result.city,
            testError: result.reason,
            webOk: result.webOk,
            smtpOk: result.smtpOk,
            smtpLatencyMs: result.smtpLatencyMs,
            smtpHost: result.smtpHost,
            smtpPort: result.smtpPort,
            smtpReason: result.smtpReason,
          };
        })
      );

      const working = (data.results || []).filter((item) => item.ok).length;
      const failed = (data.results || []).length - working;

      onLog('success', `SMTP proxy test complete: ${working} working, ${failed} failed`);
      onToast(`Proxy test complete: ${working} working, ${failed} failed`, failed ? 'warning' : 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSmtpProxies((current) =>
        current.map((proxy) =>
          proxy.enabled && proxy.testStatus === 'testing'
            ? { ...proxy, testStatus: 'failed', testError: message }
            : proxy
        )
      );
      onLog('error', `SMTP proxy test failed: ${message}`);
      onToast('SMTP proxy test failed', 'error');
    } finally {
      setTestingSmtpProxies(false);
    }
  }

  function normalizeMicrosoftProxyUrl(raw: string): string | null {
    const value = raw.trim();
    if (!value) return null;

    const csv = value.split(',').map((part) => part.trim());
    if (
      csv.length >= 3 &&
      ['http', 'https', 'socks5', 'socks5h'].includes(csv[0].toLowerCase()) &&
      /^\d+$/.test(csv[2])
    ) {
      const [protocol, host, port, username = '', password = ''] = csv;
      const auth = username
        ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
        : '';
      return `${protocol.toLowerCase()}://${auth}${host}:${port}`;
    }

    const hostPortUserPass = value.match(
      /^([^:\s]+):(\d+):([^:\s]+):(.+)$/
    );
    if (hostPortUserPass) {
      const [, host, port, username, password] = hostPortUserPass;
      return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    }

    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `http://${value}`;

    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) return null;
      if (!parsed.hostname || !parsed.port) return null;
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  function addMicrosoftProxyLines(raw: string) {
    const values = raw
      .split(/\r?\n|;/)
      .map((value) => normalizeMicrosoftProxyUrl(value))
      .filter((value): value is string => Boolean(value));

    if (!values.length) {
      onToast('No valid HTTP/HTTPS/SOCKS5 proxy URLs were found', 'warning');
      return;
    }

    let addedCount = 0;
    setMicrosoftProxies((current) => {
      const existing = new Set(current.map((item) => item.url));
      const added = values
        .filter((url) => !existing.has(url))
        .map((url) => {
          addedCount += 1;
          return { id: makeId('proxy'), url, enabled: true };
        });
      return [...current, ...added];
    });
    setMicrosoftProxyInput('');
    onLog('success', `Loaded ${values.length} Microsoft proxy URL(s)`);
  }

  function addManualMicrosoftProxy() {
    const host = microsoftProxyHost.trim();
    const port = Number(microsoftProxyPort);

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      onToast('Enter a valid proxy host and port', 'warning');
      return;
    }

    const auth = microsoftProxyUsername.trim()
      ? `${encodeURIComponent(microsoftProxyUsername.trim())}:${encodeURIComponent(microsoftProxyPassword)}@`
      : '';
    const url = `${microsoftProxyProtocol}://${auth}${host}:${port}`;
    addMicrosoftProxyLines(url);
    setMicrosoftProxyHost('');
    setMicrosoftProxyPort('');
    setMicrosoftProxyUsername('');
    setMicrosoftProxyPassword('');
  }

  async function loadMicrosoftProxyFile(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      addMicrosoftProxyLines(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('error', `Could not read proxy file: ${message}`);
      onToast('Could not read proxy file', 'error');
    }
  }

  function countryFlagEmoji(countryCode?: string): string {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '🌐';
    return String.fromCodePoint(
      ...code.split('').map((character) => 127397 + character.charCodeAt(0))
    );
  }

  async function testMicrosoftProxies() {
    const candidates = microsoftProxies.filter((proxy) => proxy.enabled);
    if (!candidates.length) {
      onToast('Add at least one enabled proxy to test', 'warning');
      return;
    }

    setTestingMicrosoftProxies(true);
    setMicrosoftProxies((current) =>
      current.map((proxy) =>
        proxy.enabled
          ? {
              ...proxy,
              testStatus: 'testing',
              latencyMs: undefined,
              ip: undefined,
              country: undefined,
              countryCode: undefined,
              region: undefined,
              city: undefined,
              testError: undefined,
            }
          : proxy
      )
    );

    try {
      onLog('info', `Testing ${candidates.length} Microsoft proxy/proxies…`);

      const response = await fetch('/api/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'testProxies',
          proxies: candidates.map((proxy) => ({ id: proxy.id, url: proxy.url })),
          smtpHost: accounts.find((account) => account.enabled)?.host || '',
          smtpPort: accounts.find((account) => account.enabled)?.port || 0,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        working?: number;
        failed?: number;
        error?: string;
        results?: Array<{
          id: string;
          url: string;
          ok: boolean;
          latencyMs: number;
          ip?: string;
          country?: string;
          countryCode?: string;
          region?: string;
          city?: string;
          reason?: string;
          webOk?: boolean;
          smtpOk?: boolean;
          smtpLatencyMs?: number;
          smtpHost?: string;
          smtpPort?: number;
          smtpReason?: string;
        }>;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Proxy test failed (HTTP ${response.status})`);
      }

      const byId = new Map((data.results || []).map((result) => [result.id, result]));
      setMicrosoftProxies((current) =>
        current.map((proxy) => {
          const result = byId.get(proxy.id);
          if (!result) return proxy;
          return {
            ...proxy,
            testStatus: result.ok ? 'working' : 'failed',
            latencyMs: result.latencyMs,
            ip: result.ip,
            country: result.country,
            countryCode: result.countryCode,
            region: result.region,
            city: result.city,
            testError: result.reason,
            webOk: result.webOk,
            smtpOk: result.smtpOk,
            smtpLatencyMs: result.smtpLatencyMs,
            smtpHost: result.smtpHost,
            smtpPort: result.smtpPort,
            smtpReason: result.smtpReason,
          };
        })
      );

      const working = data.working || 0;
      const failed = data.failed || 0;
      onLog('success', `Proxy test complete — ${working} working, ${failed} failed`);
      onToast(`Proxy test complete: ${working} working, ${failed} failed`, failed ? 'warning' : 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMicrosoftProxies((current) =>
        current.map((proxy) =>
          proxy.testStatus === 'testing'
            ? { ...proxy, testStatus: 'failed', testError: message }
            : proxy
        )
      );
      onLog('error', `Proxy test failed: ${message}`);
      onToast(`Proxy test failed: ${message}`, 'error');
    } finally {
      setTestingMicrosoftProxies(false);
    }
  }

  function resolveQrPreviewTemplate(template: string): string {
    const email = recipients[0] || 'preview@example.com';
    const at = email.lastIndexOf('@');
    const localPart = at > 0 ? email.slice(0, at) : email;
    const domain = at > 0 ? email.slice(at + 1) : 'example.com';
    const domainName = domain.split('.')[0] || domain;
    const emailBase64 = typeof window !== 'undefined' ? window.btoa(email) : email;
    const emailHex = Array.from(new TextEncoder().encode(email))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    return String(template || '')
      .replace(/\{Email\}/g, email)
      .replace(/\{EmailBase64\}/g, emailBase64)
      .replace(/\{EmailHex\}/g, emailHex)
      .replace(/\{LocalPart\}/g, localPart)
      .replace(/\{Domain\}/g, domain)
      .replace(/\{DomainName\}/g, domainName)
      .replace(/#emailinbase64\b/gi, `#${emailBase64}`)
      .replace(/#emailinhex\b/gi, `#${emailHex}`)
      .replace(/#email\b/gi, `#${email}`);
  }

  async function previewQrCode() {
    const rawValue =
      qrSource === 'cta-link'
        ? ctaLink
        : qrSource === 'custom'
          ? qrCustomData
          : attachmentLink;

    const value = resolveQrPreviewTemplate(rawValue).trim();

    if (!value) {
      onToast('Enter a link or custom QR value first', 'warning');
      return;
    }

    setQrPreviewing(true);

    try {
      const response = await fetch('/api/qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          value,
          size: qrSize,
          errorCorrectionLevel: qrErrorCorrection,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        dataUri?: string;
        error?: string;
      };

      if (!response.ok || !data.dataUri) {
        throw new Error(data.error || 'QR generation failed');
      }

      setQrPreviewDataUri(data.dataUri);
      setQrPreviewValue(value);
      onLog('success', 'Native QR preview generated');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onToast(`QR preview failed: ${message}`, 'error');
      onLog('error', `QR preview failed: ${message}`);
    } finally {
      setQrPreviewing(false);
    }
  }

  async function controlSendJob(action: 'pause' | 'resume' | 'stop') {
    if (!sendJobId) return;

    try {
      const response = await fetch(`/api/send-jobs/${encodeURIComponent(sendJobId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        job?: { status?: typeof sendJobStatus };
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Could not ${action} send job`);
      }

      if (data.job?.status) {
        setSendJobStatus(data.job.status);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onToast(message, 'error');
      onLog('error', message);
    }
  }

  async function clearRuntimeLogs() {
    if (sendJobId) {
      try {
        const response = await fetch(
          `/api/send-jobs/${encodeURIComponent(sendJobId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clear-logs' }),
          }
        );

        const data = (await response.json().catch(() => ({}))) as {
          logCursor?: number;
          error?: string;
        };

        if (!response.ok && response.status !== 404) {
          throw new Error(data.error || 'Could not clear server-side logs');
        }

        if (typeof data.logCursor === 'number') {
          sendJobLogCursorRef.current = data.logCursor;
        }
        processedSendJobEventSeqsRef.current.clear();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onToast(`Server log clear failed: ${message}`, 'error');
        return;
      }
    }

    onClearSenderLogs();
  }

  async function sendSmtp() {
    const usableAccounts = accounts.filter((account) => {
      if (!account.enabled) return false;
      if (!account.host.trim()) return false;
      if (!account.port) return false;
      if (!account.username.trim()) return false;
      if (!account.password) return false;
      if (!account.fromEmail.trim()) return false;
      if (account.maxSends <= 0) return false;
      return true;
    });

    if (!recipients.length) {
      onToast('Add at least one valid recipient', 'warning');
      return;
    }

    if (rotateAccounts) {
      if (!usableAccounts.length) {
        onToast('Configure at least one enabled SMTP account', 'warning');
        return;
      }
    } else {
      const selected = accounts.find(
        (account) => account.id === selectedAccountId
      );

      if (
        !selected ||
        !selected.host.trim() ||
        !selected.username.trim() ||
        !selected.password ||
        !selected.fromEmail.trim()
      ) {
        onToast('Complete the selected SMTP account first', 'warning');
        return;
      }
    }

    if (senderMode === 'smtp' && smtpProxyEnabled) {
      const activeProxies = smtpProxies.filter((proxy) => proxy.enabled);
      if (!activeProxies.length) {
        onToast('Add at least one enabled SMTP proxy or disable proxy mode', 'warning');
        return;
      }
    }

    if (senderMode === 'microsoft' && microsoftProxyEnabled) {
      const activeProxies = microsoftProxies.filter((proxy) => proxy.enabled);
      if (!activeProxies.length) {
        onToast('Add at least one enabled proxy or disable proxy mode', 'warning');
        return;
      }
    }

    const currentJobId = makeId(`${senderMode}-send`);
    sendJobLogCursorRef.current = 0;
    processedSendJobEventSeqsRef.current.clear();
    setSendJobId(currentJobId);
    setSendJobStatus('running');
    window.sessionStorage.setItem(
      `3d-suite:${senderMode}:active-send-job`,
      currentJobId
    );

    setSending(true);
    setSmtpSendProgress({
      current: 0,
      total: recipients.length,
      sent: 0,
      failed: 0,
    });

    try {
      const plan = rotateAccounts
        ? usableAccounts
        : accounts.filter(
            (account) => account.id === selectedAccountId
          );

      const formData = new FormData();
      formData.append('jobId', currentJobId);
      formData.append('projectName', projectName.trim() || (senderMode === 'microsoft' ? 'Microsoft Project' : 'SMTP Project'));
      formData.append('accounts', JSON.stringify(plan));
      formData.append('rotateAccounts', rotateAccounts ? 'true' : 'false');
      formData.append(
        'connectionTimeoutMs',
        String(smtpConnectionTimeoutMs)
      );
      formData.append('retryCount', String(smtpRetryCount));
      formData.append('retryDelayMs', String(smtpRetryDelayMs));
      formData.append(
        'perAccountDelayMs',
        String(smtpPerAccountDelayMs)
      );
      formData.append('threads', String(smtpThreads));
      formData.append(
        'autoRetestTimeouts',
        smtpAutoRetestTimeouts ? 'true' : 'false'
      );
      formData.append(
        'timeoutRetestDelayMs',
        String(smtpTimeoutRetestDelayMs)
      );
      formData.append('recipients', JSON.stringify(recipients));
      formData.append('fromName', fromName);
      formData.append('replyTo', replyTo.trim());

      formData.append(
        'smtpProxyEnabled',
        senderMode === 'smtp' && smtpProxyEnabled ? 'true' : 'false'
      );
      formData.append(
        'smtpProxyRotate',
        senderMode === 'smtp' &&
          smtpProxyEnabled &&
          smtpProxies.filter((proxy) => proxy.enabled).length > 1 &&
          smtpProxyRotate
          ? 'true'
          : 'false'
      );
      formData.append(
        'smtpProxies',
        JSON.stringify(
          senderMode === 'smtp'
            ? smtpProxies.filter((proxy) => proxy.enabled)
            : []
        )
      );

      formData.append(
        'microsoftProxyEnabled',
        senderMode === 'microsoft' && microsoftProxyEnabled ? 'true' : 'false'
      );
      formData.append(
        'microsoftProxyRotate',
        senderMode === 'microsoft' &&
          microsoftProxyEnabled &&
          microsoftProxies.filter((proxy) => proxy.enabled).length > 1 &&
          microsoftProxyRotate
          ? 'true'
          : 'false'
      );
      formData.append(
        'microsoftProxies',
        JSON.stringify(
          senderMode === 'microsoft'
            ? microsoftProxies.filter((proxy) => proxy.enabled)
            : []
        )
      );

      formData.append(
        'microsoftMeetingEnabled',
        senderMode === 'microsoft' && microsoftMeetingEnabled
          ? 'true'
          : 'false'
      );
      formData.append('meetingTitleTemplate', meetingTitleTemplate);
      formData.append(
        'meetingDescriptionTemplate',
        meetingDescriptionTemplate
      );
      formData.append(
        'meetingLocationTemplate',
        meetingLocationTemplate
      );
      formData.append(
        'meetingOrganizerNameTemplate',
        meetingOrganizerNameTemplate
      );
      formData.append(
        'meetingDurationMinutes',
        String(meetingDurationMinutes)
      );
      formData.append(
        'meetingReminderMinutes',
        String(meetingReminderMinutes)
      );
      formData.append(
        'onBehalfEnabled',
        senderMode === 'microsoft' && onBehalfEnabled
          ? 'true'
          : 'false'
      );
      formData.append(
        'onBehalfDisplayNames',
        JSON.stringify(onBehalfDisplayNames)
      );
      formData.append(
        'onBehalfPrefixes',
        JSON.stringify(onBehalfPrefixes)
      );
      formData.append(
        'onBehalfRandomize',
        senderMode === 'microsoft' && onBehalfEnabled && onBehalfRandomize
          ? 'true'
          : 'false'
      );

      formData.append('subjectTemplate', subjectTemplate);
      formData.append(
        'randomizeSubjects',
        smtpRandomizeSubjects ? 'true' : 'false'
      );
      formData.append(
        'subjectPool',
        JSON.stringify(smtpSubjectPool)
      );
      formData.append('messageMode', messageMode);
      formData.append('bodyTemplate', bodyTemplate);
      formData.append('attachmentLink', attachmentLink.trim());
      formData.append(
        'randomizeAttachmentLinks',
        smtpRandomizeAttachmentLinks ? 'true' : 'false'
      );
      formData.append(
        'attachmentLinkPool',
        JSON.stringify(smtpAttachmentLinkPool)
      );

      formData.append('ctaLink', ctaLink.trim());
      formData.append(
        'randomizeCtaLinks',
        smtpRandomizeCtaLinks ? 'true' : 'false'
      );
      formData.append(
        'ctaLinkPool',
        JSON.stringify(smtpCtaLinkPool)
      );

      formData.append('logoDevEnabled', logoDevEnabled ? 'true' : 'false');
      formData.append('logoDevKey', logoDevKey.trim());
      formData.append('logoDevSize', String(logoDevSize));
      formData.append('logoDevFormat', logoDevFormat);
      formData.append('logoDevTheme', logoDevTheme);

      formData.append('qrEnabled', qrEnabled ? 'true' : 'false');
      formData.append('qrSource', qrSource);
      formData.append('qrCustomData', qrCustomData.trim());
      formData.append('qrSize', String(qrSize));
      formData.append('qrErrorCorrection', qrErrorCorrection);

      formData.append(
        'attachmentEnabled',
        attachmentEnabled ? 'true' : 'false'
      );
      formData.append('attachmentMode', attachmentMode);
      formData.append('attachmentHtml', attachmentHtml);
      formData.append(
        'attachmentNameTemplate',
        attachmentNameTemplate
      );

      if (
        attachmentEnabled &&
        attachmentMode === 'upload' &&
        attachment
      ) {
        formData.append('attachment', attachment);
      }

      const response = await fetch(
        senderMode === 'microsoft'
          ? '/api/microsoft/send'
          : '/api/smtp/send',
        {
        method: 'POST',
        body: formData,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          errorText ||
            `SMTP send failed (HTTP ${response.status})`
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: !done });

          let newlineIndex = buffer.indexOf('\n');

          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (line) {
              try {
                const event = JSON.parse(line) as {
                  type?: string;
                  index?: number;
                  total?: number;
                  recipient?: string;
                  accountEmail?: string;
                  success?: boolean;
                  messageId?: string;
                  response?: string;
                  error?: string;
                  sentCount?: number;
                  failedCount?: number;
                  attempt?: number;
                  retryCount?: number;
                  status?: 'invalid' | 'timeout';
                  account?: SmtpAccount;
                  eventSeq?: number;
                  eventAt?: number;
                };

                const streamedSeq = Number(event.eventSeq || 0);
                if (streamedSeq > 0) {
                  if (processedSendJobEventSeqsRef.current.has(streamedSeq)) {
                    newlineIndex = buffer.indexOf('\n');
                    continue;
                  }
                  processedSendJobEventSeqsRef.current.add(streamedSeq);
                  sendJobLogCursorRef.current = Math.max(
                    sendJobLogCursorRef.current,
                    streamedSeq
                  );
                }

                if (event.type === 'result') {
                  setSmtpSendProgress((current) => ({
                    current: Math.min(current.total, current.current + 1),
                    total: event.total || current.total || recipients.length,
                    sent: current.sent + (event.success ? 1 : 0),
                    failed: current.failed + (event.success ? 0 : 1),
                  }));

                  if (event.success) {
                    onLog(
                      'success',
                      `${event.index}/${event.total} ✅ ${senderMode === 'microsoft' ? 'Microsoft meeting email' : 'Email'} sent successfully to ${event.recipient}${
                        event.accountEmail
                          ? ` — via ${event.accountEmail}`
                          : ''
                      }`
                    );
                  } else {
                    onLog(
                      'error',
                      `${event.index}/${event.total} ❌ ${senderMode === 'microsoft' ? 'Microsoft meeting email' : 'Email'} failed to ${event.recipient}${
                        event.accountEmail
                          ? ` — via ${event.accountEmail}`
                          : ''
                      } — ${event.error || 'unknown SMTP error'}`
                    );
                  }
                } else if (event.type === 'retry') {
                  onLog(
                    'warning',
                    `${event.index}/${event.total} SMTP retry ${event.attempt}/${event.retryCount} — ${event.recipient} — ${event.error || 'temporary SMTP error'}`
                  );
                } else if (event.type === 'pool_recovered') {
                  if (event.account) {
                    setSmtpTemporaryTimeouts((current) =>
                      current.filter(
                        (item) =>
                          item.id !== event.account?.id
                      )
                    );

                    setAccounts((current) => {
                      if (
                        current.some(
                          (item) =>
                            item.id === event.account?.id
                        )
                      ) {
                        return current;
                      }

                      return [
                        ...current,
                        event.account as SmtpAccount,
                      ];
                    });

                    onLog(
                      'success',
                      `SMTP RECOVERED — ${event.account.fromEmail}`
                    );
                  }
                } else if (event.type === 'pool_update') {
                  const eventAny = event as typeof event & {
                    status?: 'invalid' | 'timeout';
                    account?: SmtpAccount;
                    reason?: string;
                  };

                  if (eventAny.account && eventAny.status === 'invalid') {
                    const invalidAccount = eventAny.account;
                    setAccounts((current) =>
                      current.filter(
                        (account) =>
                          account.id !== invalidAccount.id
                      )
                    );

                    setSmtpInvalid((current) => [
                      ...current.filter(
                        (item) => item.id !== invalidAccount.id
                      ),
                      {
                        ...invalidAccount,
                        reason:
                          eventAny.reason ||
                          'SMTP account became invalid during sending',
                      },
                    ]);

                    onLog(
                      'error',
                      `SMTP REMOVED — ${invalidAccount.fromEmail} — ${
                        eventAny.reason || 'invalid SMTP'
                      }`
                    );
                  }

                  if (eventAny.account && eventAny.status === 'timeout') {
                    const timeoutAccount = eventAny.account;
                    setAccounts((current) =>
                      current.filter(
                        (account) =>
                          account.id !== timeoutAccount.id
                      )
                    );

                    setSmtpTemporaryTimeouts((current) => [
                      ...current.filter(
                        (item) => item.id !== timeoutAccount.id
                      ),
                      {
                        ...timeoutAccount,
                        reason:
                          eventAny.reason ||
                          'Temporary SMTP timeout',
                      },
                    ]);

                    onLog(
                      'warning',
                      `SMTP TEMP TIMEOUT — ${timeoutAccount.fromEmail} — ${
                        eventAny.reason || 'timeout'
                      }`
                    );
                  }
                } else if (event.type === 'stopped') {
                  setSending(false);
                  setSendJobStatus('stopped');
                  window.sessionStorage.removeItem(
                    `3d-suite:${senderMode}:active-send-job`
                  );
                  setSmtpSendProgress((current) => ({
                    current: (event.sentCount || 0) + (event.failedCount || 0),
                    total: event.total || current.total || recipients.length,
                    sent: event.sentCount || 0,
                    failed: event.failedCount || 0,
                  }));
                  onLog(
                    'warning',
                    `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} stopped — ${(event.sentCount || 0) + (event.failedCount || 0)}/${event.total || recipients.length} processed`
                  );
                } else if (event.type === 'complete') {
                  setSending(false);
                  setSendJobStatus('completed');
                  window.sessionStorage.removeItem(
                    `3d-suite:${senderMode}:active-send-job`
                  );
                  setSmtpSendProgress({
                    current: recipients.length,
                    total: recipients.length,
                    sent: event.sentCount || 0,
                    failed: event.failedCount || 0,
                  });

                  onLog(
                    event.failedCount ? 'warning' : 'success',
                    `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} complete — ${event.sentCount || 0} sent, ${
                      event.failedCount || 0
                    } failed, ${recipients.length} total`
                  );
                }
              } catch {
                // Ignore malformed partial stream records.
              }
            }

            newlineIndex = buffer.indexOf('\n');
          }
        }

        if (done) break;
      }

      onToast(senderMode === 'microsoft' ? 'Microsoft SMTP run completed' : 'SMTP run completed', 'success');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      onLog('error', `${senderMode === 'microsoft' ? 'Microsoft SMTP' : 'SMTP'} send failed: ${message}`);
      onToast(message, 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <Panel title={senderMode === 'microsoft' ? "Microsoft Sender — SMTP Accounts" : "Authenticated SMTP Accounts"}>
        <div className="space-y-3">
          <Field label="Project name">
            <input
              className="input"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder={senderMode === 'microsoft' ? 'Microsoft Project' : 'SMTP Project'}
            />
          </Field>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Add the SMTP credentials supplied by your mail provider. Use "Save SMTPs + proxies to session" to keep SMTP credentials and proxy URLs for this browser session. They are restored when this sender panel reloads and are sent only to the local 3D Suite API for SMTP operations.
          </div>

          <div className="space-y-2 rounded border border-slate-200 p-3">
            <div className="font-medium">Bulk SMTP import</div>
            <div className="text-xs text-slate-500">
              One SMTP per line:
              {' '}<code>host:port:user:pass:fromemail</code>.
              Passwords containing <code>:</code> are supported because the final field is treated as the From email.
            </div>

            <textarea
              className="input min-h-32 font-mono text-xs"
              value={smtpBulkInput}
              onChange={(event) =>
                setSmtpBulkInput(event.target.value)
              }
              placeholder={'smtp.example.com:587:user@example.com:password:user@example.com\\nsmtp2.example.com:465:user2@example.com:password:user2@example.com'}
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                onClick={importBulkSmtp}
              >
                Import SMTPs
              </button>

              <button
                type="button"
                className="rounded bg-[#6C63FF] px-3 py-2 text-sm text-white disabled:opacity-50"
                disabled={testingSmtp}
                onClick={() => void testSmtpAccounts()}
              >
                {testingSmtp
                  ? 'Testing SMTPs…'
                  : `Test SMTPs (${accounts.length})`}
              </button>


              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
                onClick={saveSmtpPanelSession}
              >
                Save SMTPs + proxies to session
              </button>

              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600"
                onClick={clearSmtpPanelSession}
              >
                Clear saved SMTP/proxy session
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold uppercase text-emerald-700">
                Valid SMTPs
              </div>
              <div className="mt-1 text-2xl font-bold text-emerald-800">
                {testingSmtp ? smtpTestValidCount : accounts.length}
              </div>
            </div>

            <div className="rounded border border-sky-200 bg-sky-50 p-3">
              <div className="text-xs font-semibold uppercase text-sky-700">
                Test progress
              </div>
              <div className="mt-1 text-2xl font-bold text-sky-800">
                {testingSmtp ? `${smtpTestProgress.current}/${smtpTestProgress.total}` : '—'}
              </div>
            </div>

            <div className="rounded border border-red-200 bg-red-50 p-3">
              <div className="text-xs font-semibold uppercase text-red-700">
                Invalid SMTPs
              </div>
              <div className="mt-1 text-2xl font-bold text-red-800">
                {smtpInvalid.length}
              </div>
            </div>

            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold uppercase text-amber-700">
                Temporary timeouts
              </div>
              <div className="mt-1 text-2xl font-bold text-amber-800">
                {smtpTemporaryTimeouts.length}
              </div>
            </div>
          </div>

          {(smtpInvalid.length > 0 || smtpTemporaryTimeouts.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="max-h-44 overflow-auto rounded border border-red-200 p-2 text-xs">
                <div className="mb-1 font-semibold text-red-700">
                  Invalid SMTPs
                </div>
                {smtpInvalid.length === 0 ? (
                  <div className="text-slate-500">None</div>
                ) : (
                  smtpInvalid.map((item) => (
                    <div key={`${item.id}-${item.reason}`} className="mb-1">
                      {item.fromEmail || item.label} — {item.reason}
                    </div>
                  ))
                )}
              </div>

              <div className="max-h-44 overflow-auto rounded border border-amber-200 p-2 text-xs">
                <div className="mb-1 font-semibold text-amber-700">
                  Temporary timeouts
                </div>
                {smtpTemporaryTimeouts.length === 0 ? (
                  <div className="text-slate-500">None</div>
                ) : (
                  smtpTemporaryTimeouts.map((item) => (
                    <div key={`${item.id}-${item.reason}`} className="mb-1">
                      {item.fromEmail || item.label} — {item.reason}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {accounts.map((account, index) => (
            <div
              key={account.id}
              className="space-y-3 rounded border border-slate-200 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={account.enabled}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        enabled: event.target.checked,
                      })
                    }
                  />
                  <span className="font-semibold">
                    {account.label || `SMTP Account ${index + 1}`}
                  </span>
                </label>

                {accounts.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() => removeAccount(account.id)}
                  >
                    Remove
                  </button>
                )}
              </div>

              <Field label="Account label">
                <input
                  className="input"
                  value={account.label}
                  onChange={(event) =>
                    updateAccount(account.id, {
                      label: event.target.value,
                    })
                  }
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-[1fr_120px_160px]">
                <Field label="SMTP host">
                  <input
                    className="input"
                    value={account.host}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        host: event.target.value,
                      })
                    }
                    placeholder="smtp.example.com"
                  />
                </Field>

                <Field label="Port">
                  <input
                    type="number"
                    className="input"
                    value={account.port}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        port: Number(event.target.value || 587),
                      })
                    }
                  />
                </Field>

                <Field label="Security">
                  <select
                    className="input"
                    value={account.security}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        security: event.target.value as
                          | 'starttls'
                          | 'ssl'
                          | 'none',
                      })
                    }
                  >
                    <option value="starttls">STARTTLS</option>
                    <option value="ssl">SSL/TLS</option>
                    <option value="none">None</option>
                  </select>
                </Field>

                <Field label="Authentication method">
                  <select
                    className="input"
                    value={account.authMethod || 'auto'}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        authMethod: event.target.value as SmtpAuthMethod,
                      })
                    }
                  >
                    <option value="auto">Auto detect</option>
                    <option value="LOGIN">LOGIN</option>
                    <option value="PLAIN">PLAIN</option>
                    <option value="CRAM-MD5">CRAM-MD5</option>
                  </select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username">
                  <input
                    className="input"
                    value={account.username}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        username: event.target.value,
                      })
                    }
                    autoComplete="off"
                  />
                </Field>

                <Field label="Password / app password">
                  <input
                    type="password"
                    className="input"
                    value={account.password}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        password: event.target.value,
                      })
                    }
                    autoComplete="new-password"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From email">
                  <input
                    type="email"
                    className="input"
                    value={account.fromEmail}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        fromEmail: event.target.value,
                      })
                    }
                    placeholder="sender@example.com"
                  />
                </Field>

                <Field label="Max sends for this run">
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={account.maxSends}
                    onChange={(event) =>
                      updateAccount(account.id, {
                        maxSends: Math.max(
                          1,
                          Number(event.target.value || 1)
                        ),
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            onClick={addAccount}
          >
            + Add SMTP account
          </button>

          <div className="space-y-3 rounded border border-slate-200 p-3">
            <div>
              <div className="font-medium">SMTP Runtime Controls</div>
              <div className="text-xs text-slate-500">
                Tune connection behaviour, retry timing, per-account pacing,
                and concurrent workers for the current run.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Connection timeout (ms)">
                <input
                  type="number"
                  min={5000}
                  max={120000}
                  step={1000}
                  className="input"
                  value={smtpConnectionTimeoutMs}
                  onChange={(event) =>
                    setSmtpConnectionTimeoutMs(
                      Math.min(
                        120000,
                        Math.max(
                          5000,
                          Number(event.target.value || 30000)
                        )
                      )
                    )
                  }
                />
              </Field>

              <Field label="Retry count">
                <input
                  type="number"
                  min={0}
                  max={5}
                  className="input"
                  value={smtpRetryCount}
                  onChange={(event) =>
                    setSmtpRetryCount(
                      Math.min(
                        5,
                        Math.max(
                          0,
                          Number(event.target.value || 0)
                        )
                      )
                    )
                  }
                />
              </Field>

              <Field label="Retry delay (ms)">
                <input
                  type="number"
                  min={0}
                  max={120000}
                  step={500}
                  className="input"
                  value={smtpRetryDelayMs}
                  onChange={(event) =>
                    setSmtpRetryDelayMs(
                      Math.min(
                        120000,
                        Math.max(
                          0,
                          Number(event.target.value || 0)
                        )
                      )
                    )
                  }
                />
              </Field>

              <Field label="Per-SMTP delay (ms)">
                <input
                  type="number"
                  min={0}
                  max={120000}
                  step={250}
                  className="input"
                  value={smtpPerAccountDelayMs}
                  onChange={(event) =>
                    setSmtpPerAccountDelayMs(
                      Math.min(
                        120000,
                        Math.max(
                          0,
                          Number(event.target.value || 0)
                        )
                      )
                    )
                  }
                />
              </Field>

              <Field label="Threads / concurrent sends">
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="input"
                  value={smtpThreads}
                  onChange={(event) =>
                    setSmtpThreads(
                      Math.min(
                        10,
                        Math.max(
                          1,
                          Number(event.target.value || 1)
                        )
                      )
                    )
                  }
                />
              </Field>

              <Field label="Timeout re-test delay (ms)">
                <input
                  type="number"
                  min={10000}
                  max={600000}
                  step={1000}
                  className="input"
                  value={smtpTimeoutRetestDelayMs}
                  onChange={(event) =>
                    setSmtpTimeoutRetestDelayMs(
                      Math.min(
                        600000,
                        Math.max(
                          10000,
                          Number(event.target.value || 60000)
                        )
                      )
                    )
                  }
                />
              </Field>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={smtpAutoRetestTimeouts}
                onChange={(event) =>
                  setSmtpAutoRetestTimeouts(event.target.checked)
                }
              />
              <span>
                <span className="font-medium">
                  Auto re-test Temporary Timeouts
                </span>
                <span className="block text-xs text-slate-500">
                  Timed-out SMTPs are re-tested after the configured delay and
                  returned to the active pool if verification succeeds.
                </span>
              </span>
            </label>
          </div>

          <label className="flex items-center gap-2 rounded border border-slate-200 p-3">
            <input
              type="checkbox"
              checked={rotateAccounts}
              onChange={(event) =>
                setRotateAccounts(event.target.checked)
              }
            />
            <span>
              <span className="font-medium">Rotate SMTP accounts</span>
              <span className="block text-xs text-slate-500">
                Round-robin across enabled accounts until each configured
                Max sends value is reached.
              </span>
            </span>
          </label>

          {!rotateAccounts && (
            <Field label="SMTP account to use">
              <select
                className="input"
                value={selectedAccountId}
                onChange={(event) =>
                  setSelectedAccountId(event.target.value)
                }
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label || account.fromEmail || account.id}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {senderMode === 'smtp' && (
            <div className="space-y-3 rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={smtpProxyEnabled}
                  onChange={(event) => setSmtpProxyEnabled(event.target.checked)}
                />
                <span>
                  <span className="font-medium">Enable proxy</span>
                  <span className="block text-xs text-slate-500">
                    Route SMTP connections through the configured proxy pool.
                  </span>
                </span>
              </label>

              {smtpProxyEnabled && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Field label="Protocol">
                      <select
                        className="input"
                        value={smtpProxyProtocol}
                        onChange={(event) =>
                          setSmtpProxyProtocol(
                            event.target.value === 'https'
                              ? 'https'
                              : event.target.value === 'socks5'
                                ? 'socks5'
                                : 'http'
                          )
                        }
                      >
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </Field>
                    <Field label="Host">
                      <input
                        className="input"
                        value={smtpProxyHost}
                        onChange={(event) => setSmtpProxyHost(event.target.value)}
                        placeholder="1.2.3.4"
                      />
                    </Field>
                    <Field label="Port">
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={65535}
                        value={smtpProxyPort}
                        onChange={(event) => setSmtpProxyPort(event.target.value)}
                        placeholder="8080"
                      />
                    </Field>
                    <Field label="Username — optional">
                      <input
                        className="input"
                        value={smtpProxyUsername}
                        onChange={(event) => setSmtpProxyUsername(event.target.value)}
                      />
                    </Field>
                    <Field label="Password — optional">
                      <input
                        className="input"
                        type="password"
                        value={smtpProxyPassword}
                        onChange={(event) => setSmtpProxyPassword(event.target.value)}
                      />
                    </Field>
                  </div>

                  <button
                    type="button"
                    className="px-3 py-2 rounded border border-slate-300"
                    onClick={addManualSmtpProxy}
                  >
                    Add manual proxy
                  </button>

                  <Field label="Proxy URL(s)">
                    <textarea
                      className="input min-h-24"
                      value={smtpProxyInput}
                      onChange={(event) => setSmtpProxyInput(event.target.value)}
                      placeholder={'http://user:pass@1.2.3.4:8080\nsocks5://user:pass@5.6.7.8:1080'}
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      Paste one or many HTTP/HTTPS/SOCKS5 proxy URLs. Supports URL, host:port, host:port:user:pass, and CSV rows: protocol,host,port,username,password.
                    </div>
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded border border-slate-300"
                      onClick={() => addSmtpProxyLines(smtpProxyInput)}
                    >
                      Add proxy URL(s)
                    </button>
                    <label className="px-3 py-2 rounded border border-slate-300 cursor-pointer">
                      Import proxy file
                      <input
                        type="file"
                        accept=".txt,.csv,text/plain,text/csv"
                        className="hidden"
                        onChange={(event) => {
                          void loadSmtpProxyFile(event.target.files?.[0] || null);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="px-3 py-2 rounded border border-slate-300 disabled:opacity-50"
                      disabled={
                        testingSmtpProxies ||
                        smtpProxies.filter((proxy) => proxy.enabled).length === 0
                      }
                      onClick={() => void testSmtpProxies()}
                    >
                      {testingSmtpProxies ? 'Testing proxies…' : 'Test Proxies'}
                    </button>
                  </div>

                  {smtpProxies.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">
                        Loaded proxies ({smtpProxies.filter((proxy) => proxy.enabled).length} enabled)
                      </div>
                      <div className="space-y-2">
                        {smtpProxies.map((proxy) => (
                          <div key={proxy.id} className="flex items-center gap-2 rounded border border-slate-200 p-2">
                            <input
                              type="checkbox"
                              checked={proxy.enabled}
                              onChange={(event) =>
                                setSmtpProxies((current) =>
                                  current.map((item) =>
                                    item.id === proxy.id
                                      ? { ...item, enabled: event.target.checked }
                                      : item
                                  )
                                )
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <code className="block break-all text-xs">{proxy.url}</code>
                              <div className="mt-1 text-xs text-slate-500">
                                {proxy.testStatus === 'testing' && 'Testing…'}
                                {proxy.testStatus === 'working' && (
                                  <span>
                                    ✅ {countryFlagEmoji(proxy.countryCode)} {proxy.country || 'Unknown country'}
                                    {proxy.city ? ` · ${proxy.city}` : ''}
                                    {proxy.region ? `, ${proxy.region}` : ''}
                                    {proxy.ip ? ` · ${proxy.ip}` : ''}
                                    {proxy.smtpHost && proxy.smtpPort ? ` · SMTP ${proxy.smtpHost}:${proxy.smtpPort} ✅` : ''}
                                    {typeof proxy.smtpLatencyMs === 'number' ? ` · ${proxy.smtpLatencyMs} ms tunnel` : ''}
                                  </span>
                                )}
                                {proxy.testStatus === 'failed' && (
                                  <span className="text-red-600">
                                    ❌ {proxy.webOk === false ? 'Web proxy failed' : proxy.smtpOk === false ? 'SMTP tunnel blocked' : 'Failed'}
                                    {proxy.webOk !== false && proxy.country ? ` · ${countryFlagEmoji(proxy.countryCode)} ${proxy.country}` : ''}
                                    {proxy.ip ? ` · ${proxy.ip}` : ''}
                                    {proxy.smtpHost && proxy.smtpPort ? ` · ${proxy.smtpHost}:${proxy.smtpPort}` : ''}
                                    {proxy.smtpReason ? ` · ${proxy.smtpReason}` : proxy.testError ? ` · ${proxy.testError}` : ''}
                                  </span>
                                )}
                                {!proxy.testStatus || proxy.testStatus === 'untested' ? 'Not tested' : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="text-xs text-red-600"
                              onClick={() =>
                                setSmtpProxies((current) =>
                                  current.filter((item) => item.id !== proxy.id)
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={smtpProxies.filter((proxy) => proxy.enabled).length <= 1}
                      checked={
                        smtpProxies.filter((proxy) => proxy.enabled).length > 1 &&
                        smtpProxyRotate
                      }
                      onChange={(event) => setSmtpProxyRotate(event.target.checked)}
                    />
                    <span>
                      <span className="font-medium">Rotate proxies</span>
                      <span className="block text-xs text-slate-500">
                        {smtpProxies.filter((proxy) => proxy.enabled).length <= 1
                          ? 'Add at least two enabled proxies to rotate. A single proxy is used for every SMTP connection.'
                          : 'Round-robin across enabled proxies for SMTP connections.'}
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {senderMode === 'microsoft' && (
            <div className="space-y-3 rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={microsoftProxyEnabled}
                  onChange={(event) =>
                    setMicrosoftProxyEnabled(event.target.checked)
                  }
                />
                <span>
                  <span className="font-medium">Enable proxy</span>
                  <span className="block text-xs text-slate-500">
                    Route Microsoft SMTP connections through the configured proxy pool.
                  </span>
                </span>
              </label>

              {microsoftProxyEnabled && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Field label="Protocol">
                      <select
                        className="input"
                        value={microsoftProxyProtocol}
                        onChange={(event) =>
                          setMicrosoftProxyProtocol(
                            event.target.value === 'https'
                              ? 'https'
                              : event.target.value === 'socks5'
                                ? 'socks5'
                                : 'http'
                          )
                        }
                      >
                        <option value="http">HTTP</option>
                        <option value="https">HTTPS</option>
                        <option value="socks5">SOCKS5</option>
                      </select>
                    </Field>
                    <Field label="Host">
                      <input
                        className="input"
                        value={microsoftProxyHost}
                        onChange={(event) => setMicrosoftProxyHost(event.target.value)}
                        placeholder="1.2.3.4"
                      />
                    </Field>
                    <Field label="Port">
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={65535}
                        value={microsoftProxyPort}
                        onChange={(event) => setMicrosoftProxyPort(event.target.value)}
                        placeholder="8080"
                      />
                    </Field>
                    <Field label="Username — optional">
                      <input
                        className="input"
                        value={microsoftProxyUsername}
                        onChange={(event) => setMicrosoftProxyUsername(event.target.value)}
                      />
                    </Field>
                    <Field label="Password — optional">
                      <input
                        className="input"
                        type="password"
                        value={microsoftProxyPassword}
                        onChange={(event) => setMicrosoftProxyPassword(event.target.value)}
                      />
                    </Field>
                  </div>

                  <button
                    type="button"
                    className="px-3 py-2 rounded border border-slate-300"
                    onClick={addManualMicrosoftProxy}
                  >
                    Add manual proxy
                  </button>

                  <Field label="Proxy URL(s)">
                    <textarea
                      className="input min-h-24"
                      value={microsoftProxyInput}
                      onChange={(event) =>
                        setMicrosoftProxyInput(event.target.value)
                      }
                      placeholder={'http://user:pass@1.2.3.4:8080\nsocks5://user:pass@5.6.7.8:1080'}
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      Paste one or many HTTP/HTTPS/SOCKS5 proxy URLs. Supports URL, host:port, host:port:user:pass, and CSV rows: protocol,host,port,username,password.
                    </div>
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="px-3 py-2 rounded border border-slate-300"
                      onClick={() => addMicrosoftProxyLines(microsoftProxyInput)}
                    >
                      Add proxy URL(s)
                    </button>
                    <label className="px-3 py-2 rounded border border-slate-300 cursor-pointer">
                      Import proxy file
                      <input
                        type="file"
                        accept=".txt,.csv,text/plain,text/csv"
                        className="hidden"
                        onChange={(event) => {
                          void loadMicrosoftProxyFile(event.target.files?.[0] || null);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="px-3 py-2 rounded border border-slate-300 disabled:opacity-50"
                      disabled={
                        testingMicrosoftProxies ||
                        microsoftProxies.filter((proxy) => proxy.enabled).length === 0
                      }
                      onClick={() => void testMicrosoftProxies()}
                    >
                      {testingMicrosoftProxies ? 'Testing proxies…' : 'Test Proxies'}
                    </button>
                  </div>

                  {microsoftProxies.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">
                        Loaded proxies ({microsoftProxies.filter((proxy) => proxy.enabled).length} enabled)
                      </div>
                      <div className="space-y-2">
                        {microsoftProxies.map((proxy) => (
                          <div key={proxy.id} className="flex items-center gap-2 rounded border border-slate-200 p-2">
                            <input
                              type="checkbox"
                              checked={proxy.enabled}
                              onChange={(event) =>
                                setMicrosoftProxies((current) =>
                                  current.map((item) =>
                                    item.id === proxy.id
                                      ? { ...item, enabled: event.target.checked }
                                      : item
                                  )
                                )
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <code className="block break-all text-xs">{proxy.url}</code>
                              <div className="mt-1 text-xs text-slate-500">
                                {proxy.testStatus === 'testing' && 'Testing…'}
                                {proxy.testStatus === 'working' && (
                                  <span>
                                    ✅ {countryFlagEmoji(proxy.countryCode)} {proxy.country || 'Unknown country'}
                                    {proxy.city ? ` · ${proxy.city}` : ''}
                                    {proxy.region ? `, ${proxy.region}` : ''}
                                    {proxy.ip ? ` · ${proxy.ip}` : ''}
                                    {proxy.smtpHost && proxy.smtpPort ? ` · SMTP ${proxy.smtpHost}:${proxy.smtpPort} ✅` : ''}
                                    {typeof proxy.smtpLatencyMs === 'number' ? ` · ${proxy.smtpLatencyMs} ms tunnel` : ''}
                                  </span>
                                )}
                                {proxy.testStatus === 'failed' && (
                                  <span className="text-red-600">
                                    ❌ {proxy.webOk === false ? 'Web proxy failed' : proxy.smtpOk === false ? 'SMTP tunnel blocked' : 'Failed'}
                                    {proxy.webOk !== false && proxy.country ? ` · ${countryFlagEmoji(proxy.countryCode)} ${proxy.country}` : ''}
                                    {proxy.ip ? ` · ${proxy.ip}` : ''}
                                    {proxy.smtpHost && proxy.smtpPort ? ` · ${proxy.smtpHost}:${proxy.smtpPort}` : ''}
                                    {proxy.smtpReason ? ` · ${proxy.smtpReason}` : proxy.testError ? ` · ${proxy.testError}` : ''}
                                  </span>
                                )}
                                {!proxy.testStatus || proxy.testStatus === 'untested' ? 'Not tested' : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="text-xs text-red-600"
                              onClick={() =>
                                setMicrosoftProxies((current) =>
                                  current.filter((item) => item.id !== proxy.id)
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={microsoftProxies.filter((proxy) => proxy.enabled).length <= 1}
                      checked={
                        microsoftProxies.filter((proxy) => proxy.enabled).length > 1 &&
                        microsoftProxyRotate
                      }
                      onChange={(event) =>
                        setMicrosoftProxyRotate(event.target.checked)
                      }
                    />
                    <span>
                      <span className="font-medium">Rotate proxies</span>
                      <span className="block text-xs text-slate-500">
                        {microsoftProxies.filter((proxy) => proxy.enabled).length <= 1
                          ? 'Add at least two enabled proxies to rotate. A single proxy is used for every Microsoft SMTP connection.'
                          : 'Round-robin across enabled proxies for Microsoft SMTP connections.'}
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel title={senderMode === 'microsoft' ? "Microsoft Meeting Message & Documents" : "SMTP Message & Documents"}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From name">
              <input
                className="input"
                value={fromName}
                onChange={(event) =>
                  setFromName(event.target.value)
                }
                placeholder="{DomainName} Team"
              />
              <div className="mt-1 text-xs text-slate-500">
                Supports recipient autograb placeholders.
              </div>
            </Field>

            <Field label="Reply-To — optional">
              <input
                type="email"
                className="input"
                value={replyTo}
                onChange={(event) =>
                  setReplyTo(event.target.value)
                }
                placeholder="replies@example.com"
              />
            </Field>
          </div>

          {senderMode === 'microsoft' && (
            <div className="space-y-3 rounded border border-blue-200 bg-blue-50/40 p-3">
              <div>
                <div className="font-semibold text-blue-900">
                  Outlook-compatible Meeting / RSVP
                </div>
                <div className="mt-1 text-xs leading-5 text-blue-800">
                  Uses the same authenticated SMTP account, but adds a
                  standards-based calendar invitation (METHOD:REQUEST) with
                  RSVP, organiser, location, duration and reminder.
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={microsoftMeetingEnabled}
                  onChange={(event) =>
                    setMicrosoftMeetingEnabled(event.target.checked)
                  }
                />
                <span className="font-medium">
                  Enable meeting / RSVP invitation
                </span>
              </label>

              {microsoftMeetingEnabled && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Meeting title">
                      <input
                        className="input"
                        value={meetingTitleTemplate}
                        onChange={(event) =>
                          setMeetingTitleTemplate(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Organiser display name">
                      <input
                        className="input"
                        value={meetingOrganizerNameTemplate}
                        onChange={(event) =>
                          setMeetingOrganizerNameTemplate(
                            event.target.value
                          )
                        }
                        placeholder="{DomainName} Meetings"
                      />
                    </Field>
                  </div>

                  <Field label="Meeting description">
                    <textarea
                      className="input min-h-24"
                      value={meetingDescriptionTemplate}
                      onChange={(event) =>
                        setMeetingDescriptionTemplate(
                          event.target.value
                        )
                      }
                    />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Location">
                      <input
                        className="input"
                        value={meetingLocationTemplate}
                        onChange={(event) =>
                          setMeetingLocationTemplate(
                            event.target.value
                          )
                        }
                      />
                    </Field>

                    <Field label="Duration (minutes)">
                      <input
                        type="number"
                        min={5}
                        max={1440}
                        className="input"
                        value={meetingDurationMinutes}
                        onChange={(event) =>
                          setMeetingDurationMinutes(
                            Math.min(
                              1440,
                              Math.max(
                                5,
                                Number(event.target.value || 60)
                              )
                            )
                          )
                        }
                      />
                    </Field>

                    <Field label="Reminder (minutes)">
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        className="input"
                        value={meetingReminderMinutes}
                        onChange={(event) =>
                          setMeetingReminderMinutes(
                            Math.min(
                              1440,
                              Math.max(
                                0,
                                Number(event.target.value || 15)
                              )
                            )
                          )
                        }
                      />
                    </Field>
                  </div>
                </>
              )}

              <div className="space-y-3 rounded border border-blue-200 bg-white p-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={onBehalfEnabled}
                    onChange={(event) =>
                      setOnBehalfEnabled(event.target.checked)
                    }
                  />
                  <span>
                    <span className="font-medium">Send on behalf</span>
                    <span className="block text-xs text-slate-500">
                      Keep the authenticated SMTP account as the Sender header
                      while using a provider-authorised same-domain From identity.
                    </span>
                  </span>
                </label>

                {onBehalfEnabled && (
                  <div className="space-y-3">
                    <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="font-medium">Original sender</div>
                      <div className="mt-1 break-all font-mono text-xs">
                        {selectedOnBehalfAccount?.fromEmail ||
                          'Select/configure an SMTP account'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Automatically taken from the SMTP account used for the send.
                        {rotateAccounts
                          ? ' With SMTP rotation enabled, the domain follows each active account.'
                          : ''}
                      </div>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-2">
                      <Field label="On-behalf display names">
                        <textarea
                          className="input min-h-28"
                          value={onBehalfDisplayNamesText}
                          onChange={(event) =>
                            setOnBehalfDisplayNamesText(event.target.value)
                          }
                          placeholder={'Teams Meeting Organizer\nMeeting Scheduler\nConference Organizer'}
                        />
                        <div className="mt-1 text-xs text-slate-500">
                          One display name per line. Add as many as you need.
                        </div>
                      </Field>

                      <Field label="On-behalf prefixes">
                        <textarea
                          className="input min-h-28"
                          value={onBehalfPrefixesText}
                          onChange={(event) =>
                            setOnBehalfPrefixesText(event.target.value)
                          }
                          placeholder={'scheduler\nmeetings\nteams'}
                        />
                        <div className="mt-1 text-xs text-slate-500">
                          One local-part prefix per line. The sending domain is
                          appended automatically.
                        </div>
                      </Field>
                    </div>

                    <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="font-medium">Generated identity preview</div>
                      <div className="mt-1 break-all font-mono text-xs">
                        {(onBehalfDisplayNames[0] || 'Teams Meeting Organizer')}{' '}
                        &lt;{(onBehalfPrefixes[0] || 'scheduler')}@
                        {selectedOnBehalfDomain || 'sending-domain.com'}&gt;
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Sender: {selectedOnBehalfAccount?.fromEmail || 'authenticated SMTP account'}
                      </div>
                    </div>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={onBehalfRandomize}
                        disabled={
                          onBehalfDisplayNames.length <= 1 &&
                          onBehalfPrefixes.length <= 1
                        }
                        onChange={(event) =>
                          setOnBehalfRandomize(event.target.checked)
                        }
                      />
                      <span>
                        <span className="font-medium">
                          Randomize on-behalf identity
                        </span>
                        <span className="block text-xs text-slate-500">
                          Choose a configured display name and prefix for each
                          message. With this off, the first display name and first
                          prefix are used.
                        </span>
                      </span>
                    </label>

                    <div className="text-xs text-slate-500">
                      The generated From address remains a real message header.
                      Your SMTP provider must permit that same-domain identity;
                      the app does not bypass provider alias or sender-policy checks.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <Field label={`Recipients (${recipients.length})`}>
            <textarea
              className="input min-h-36"
              value={recipientsText}
              onChange={(event) =>
                setRecipientsText(event.target.value)
              }
              placeholder="user1@example.com&#10;user2@example.com"
            />
          </Field>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="space-y-3 rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={smtpRandomizeAttachmentLinks}
                  onChange={(event) =>
                    setSmtpRandomizeAttachmentLinks(
                      event.target.checked
                    )
                  }
                />
                <span>
                  <span className="font-medium">
                    Randomize Attachment Links
                  </span>
                  <span className="block text-xs text-slate-500">
                    Select one random Attachment Link per recipient.
                  </span>
                </span>
              </label>

              {!smtpRandomizeAttachmentLinks ? (
                <Field label="Attachment Link">
                  <input
                    className="input"
                    value={attachmentLink}
                    onChange={(event) =>
                      setAttachmentLink(event.target.value)
                    }
                    placeholder="https://example.com/document#{EmailHex}"
                  />
                </Field>
              ) : (
                <>
                  <Field
                    label={`Attachment Link pool (${smtpAttachmentLinkPool.length})`}
                  >
                    <textarea
                      className="input min-h-36 font-mono text-xs"
                      value={smtpAttachmentLinkPoolText}
                      onChange={(event) =>
                        setSmtpAttachmentLinkPoolText(
                          event.target.value
                        )
                      }
                      placeholder={'https://site1.example/doc#email\nhttps://site2.example/doc#emailinhex\nhttps://site3.example/{EmailBase64}'}
                    />
                  </Field>

                  <Field label="Upload Attachment Links (.txt)">
                    <input
                      type="file"
                      accept=".txt,text/plain"
                      className="input"
                      onChange={(event) =>
                        void loadAttachmentLinksFile(
                          event.target.files?.[0] || null
                        )
                      }
                    />
                  </Field>
                </>
              )}
            </div>

            <div className="space-y-3 rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={smtpRandomizeCtaLinks}
                  onChange={(event) =>
                    setSmtpRandomizeCtaLinks(
                      event.target.checked
                    )
                  }
                />
                <span>
                  <span className="font-medium">
                    Randomize CTA Links
                  </span>
                  <span className="block text-xs text-slate-500">
                    Select one random CTA Link per recipient.
                  </span>
                </span>
              </label>

              {!smtpRandomizeCtaLinks ? (
                <Field label="CTA Link">
                  <input
                    className="input"
                    value={ctaLink}
                    onChange={(event) =>
                      setCtaLink(event.target.value)
                    }
                    placeholder="https://example.com/action#{Email}"
                  />
                </Field>
              ) : (
                <>
                  <Field
                    label={`CTA Link pool (${smtpCtaLinkPool.length})`}
                  >
                    <textarea
                      className="input min-h-36 font-mono text-xs"
                      value={smtpCtaLinkPoolText}
                      onChange={(event) =>
                        setSmtpCtaLinkPoolText(
                          event.target.value
                        )
                      }
                      placeholder={'https://cta1.example/#email\nhttps://cta2.example/#emailinbase64\nhttps://cta3.example/{EmailHex}'}
                    />
                  </Field>

                  <Field label="Upload CTA Links (.txt)">
                    <input
                      type="file"
                      accept=".txt,text/plain"
                      className="input"
                      onChange={(event) =>
                        void loadCtaLinksFile(
                          event.target.files?.[0] || null
                        )
                      }
                    />
                  </Field>
                </>
              )}
            </div>
          </div>

          <div className="text-xs leading-5 text-slate-500">
            All link entries support recipient autograbs including
            {' '}<code>{'{Email}'}</code>,
            {' '}<code>{'{EmailBase64}'}</code>,
            {' '}<code>{'{EmailHex}'}</code>,
            {' '}<code>{'{LocalPart}'}</code>,
            {' '}<code>{'{Domain}'}</code>, and
            {' '}<code>{'{DomainName}'}</code>.
            Fragment shortcuts:
            {' '}<code>#email</code>,
            {' '}<code>#emailinbase64</code>,
            {' '}<code>#emailinhex</code>.
          </div>

          <div className="space-y-3 rounded border border-slate-200 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={smtpRandomizeSubjects}
                onChange={(event) =>
                  setSmtpRandomizeSubjects(event.target.checked)
                }
              />
              <span>
                <span className="font-medium">Randomize subjects</span>
                <span className="block text-xs text-slate-500">
                  Pick one subject randomly for each recipient.
                  Every line supports autograb placeholders.
                </span>
              </span>
            </label>

            {!smtpRandomizeSubjects ? (
              <Field label="Subject">
                <input
                  className="input"
                  value={subjectTemplate}
                  onChange={(event) =>
                    setSubjectTemplate(event.target.value)
                  }
                  placeholder="Document for {DomainName}"
                />
              </Field>
            ) : (
              <>
                <Field label={`Subject pool (${smtpSubjectPool.length})`}>
                  <textarea
                    className="input min-h-36 font-mono text-sm"
                    value={smtpSubjectPoolText}
                    onChange={(event) =>
                      setSmtpSubjectPoolText(event.target.value)
                    }
                    placeholder={'Document for {DomainName}\n{DomainName} — Please review\nReference {Random8} for {Email}'}
                  />
                </Field>

                <Field label="Upload subjects (.txt)">
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    className="input"
                    onChange={(event) =>
                      void loadSubjectFile(
                        event.target.files?.[0] || null
                      )
                    }
                  />
                </Field>

                <div className="text-xs text-slate-500">
                  One subject per line. Blank lines are ignored and duplicate
                  subject lines are removed automatically.
                </div>
              </>
            )}
          </div>

          <Field label="Message format">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded border px-3 py-2 ${
                  messageMode === 'text'
                    ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                    : 'border-slate-300'
                }`}
                onClick={() => setMessageMode('text')}
              >
                Plain Text
              </button>
              <button
                type="button"
                className={`rounded border px-3 py-2 ${
                  messageMode === 'html'
                    ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                    : 'border-slate-300'
                }`}
                onClick={() => setMessageMode('html')}
              >
                HTML
              </button>
            </div>
          </Field>

          <div
            className={`grid gap-3 ${
              messageMode === 'html'
                ? 'xl:grid-cols-2'
                : 'grid-cols-1'
            }`}
          >
            <Field label={messageMode === 'html' ? 'HTML message' : 'Message'}>
              <textarea
                className="input min-h-[320px] font-mono text-sm"
                value={bodyTemplate}
                onChange={(event) =>
                  setBodyTemplate(event.target.value)
                }
              />
            </Field>

            {messageMode === 'html' && (
              <Field label="Live HTML preview">
                <div className="overflow-hidden rounded border border-slate-300 bg-white">
                  <iframe
                    title={senderMode === 'microsoft' ? "Microsoft HTML preview" : "SMTP HTML preview"}
                    sandbox=""
                    className="h-[320px] w-full bg-white"
                    srcDoc={previewHtml(bodyTemplate)}
                  />
                </div>
              </Field>
            )}
          </div>

          <div className="space-y-3 rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={logoDevEnabled}
                  onChange={(event) =>
                    setLogoDevEnabled(event.target.checked)
                  }
                />
                <span>
                  <span className="font-medium">
                    Enable Logo.dev {`{CompanyLogo}`}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Available for HTML messages and generated PDF/PPTX/DOCX/SVG attachments.
                  </span>
                </span>
              </label>

              {logoDevEnabled && (
                <>
                  <Field label="Logo.dev Publishable Key">
                    <input
                      className="input"
                      value={logoDevKey}
                      onChange={(event) =>
                        setLogoDevKey(event.target.value)
                      }
                      placeholder="pk_..."
                    />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Logo size">
                      <input
                        type="number"
                        min={16}
                        max={800}
                        className="input"
                        value={logoDevSize}
                        onChange={(event) =>
                          setLogoDevSize(
                            Math.min(
                              800,
                              Math.max(
                                16,
                                Number(event.target.value || 128)
                              )
                            )
                          )
                        }
                      />
                    </Field>

                    <Field label="Format">
                      <select
                        className="input"
                        value={logoDevFormat}
                        onChange={(event) =>
                          setLogoDevFormat(
                            event.target.value as 'png' | 'webp'
                          )
                        }
                      >
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                      </select>
                    </Field>

                    <Field label="Theme">
                      <select
                        className="input"
                        value={logoDevTheme}
                        onChange={(event) =>
                          setLogoDevTheme(
                            event.target.value as
                              | 'light'
                              | 'dark'
                              | 'auto'
                          )
                        }
                      >
                        <option value="auto">Auto</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </Field>
                  </div>
                </>
              )}
            </div>

          <div className="space-y-3 rounded border border-slate-200 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={qrEnabled}
                onChange={(event) =>
                  setQrEnabled(event.target.checked)
                }
              />
              <span className="font-medium">
                Enable QR code {`{QRCode}`}
              </span>
            </label>

            {qrEnabled && (
              <>
                <Field label="QR data source">
                  <select
                    className="input"
                    value={qrSource}
                    onChange={(event) =>
                      setQrSource(
                        event.target.value as
                          | 'attachment-link'
                          | 'cta-link'
                          | 'custom'
                      )
                    }
                  >
                    <option value="attachment-link">
                      Attachment Link
                    </option>
                    <option value="cta-link">CTA Link</option>
                    <option value="custom">Custom data / URL</option>
                  </select>
                </Field>

                {qrSource === 'custom' && (
                  <Field label="Custom QR data / URL">
                    <textarea
                      className="input min-h-24"
                      value={qrCustomData}
                      onChange={(event) =>
                        setQrCustomData(event.target.value)
                      }
                    />
                  </Field>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="QR size">
                    <select
                      className="input"
                      value={qrSize}
                      onChange={(event) => setQrSize(Number(event.target.value))}
                    >
                      <option value={192}>192 px</option>
                      <option value={256}>256 px</option>
                      <option value={384}>384 px</option>
                      <option value={512}>512 px</option>
                      <option value={768}>768 px</option>
                      <option value={1024}>1024 px</option>
                    </select>
                  </Field>

                  <Field label="Error correction">
                    <select
                      className="input"
                      value={qrErrorCorrection}
                      onChange={(event) =>
                        setQrErrorCorrection(
                          event.target.value as 'L' | 'M' | 'Q' | 'H'
                        )
                      }
                    >
                      <option value="L">Low</option>
                      <option value="M">Medium</option>
                      <option value="Q">Quartile</option>
                      <option value="H">High</option>
                    </select>
                  </Field>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded border border-slate-300"
                    disabled={qrPreviewing}
                    onClick={() => void previewQrCode()}
                  >
                    {qrPreviewing ? 'Generating QR…' : 'Preview QR'}
                  </button>
                  <span className="text-xs text-slate-500">
                    Generated natively by 3D Suite. No external QR service.
                  </span>
                </div>

                {qrPreviewDataUri && (
                  <div className="grid gap-3 rounded border border-slate-200 p-3 sm:grid-cols-[auto_1fr] sm:items-center">
                    <img
                      src={qrPreviewDataUri}
                      alt="QR code preview"
                      className="h-40 w-40 rounded border border-slate-200 bg-white p-2"
                    />
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium">Resolved preview value</div>
                      <code className="block break-all text-xs text-slate-600">
                        {qrPreviewValue}
                      </code>
                      <div className="text-xs text-slate-500">
                        Preview uses the first recipient when placeholders are present.
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-3 rounded border border-slate-200 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={attachmentEnabled}
                onChange={(event) =>
                  setAttachmentEnabled(event.target.checked)
                }
              />
              <span className="font-medium">Enable attachment</span>
            </label>

            {attachmentEnabled && (
              <>
                <Field label="Attachment mode">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                    {[
                      ['upload', 'Upload'],
                      ['html-pdf', 'HTML → PDF'],
                      ['html-pptx', 'HTML → PPTX'],
                      ['html-docx', 'HTML → DOCX'],
                      ['html-svg', 'HTML → SVG'],
                      ['html-eml', 'HTML → EML'],
                    ].map(([value, label]) => (
                      <label
                        key={value}
                        className={`flex items-center gap-2 rounded border px-2 py-2 ${
                          attachmentMode === value
                            ? 'border-[#6C63FF] bg-violet-50'
                            : 'border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name={senderMode === 'microsoft' ? "microsoftAttachmentMode" : "smtpAttachmentMode"}
                          checked={attachmentMode === value}
                          onChange={() =>
                            setAttachmentMode(
                              value as
                                | 'upload'
                                | 'html-pdf'
                                | 'html-pptx'
                                | 'html-docx'
                                | 'html-svg'
                                | 'html-eml'
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </Field>

                {attachmentMode === 'upload' ? (
                  <Field label="Upload file">
                    <input
                      type="file"
                      className="input"
                      onChange={(event) =>
                        setAttachment(
                          event.target.files?.[0] || null
                        )
                      }
                    />
                  </Field>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <Field label="Attachment HTML">
                      <textarea
                        className="input min-h-[320px] font-mono text-sm"
                        value={attachmentHtml}
                        onChange={(event) =>
                          setAttachmentHtml(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Attachment preview">
                      <div className="overflow-hidden rounded border border-slate-300 bg-white">
                        <iframe
                          title={senderMode === 'microsoft' ? "Microsoft attachment preview" : "SMTP attachment preview"}
                          sandbox=""
                          className="h-[320px] w-full bg-white"
                          srcDoc={previewHtml(attachmentHtml)}
                        />
                      </div>
                    </Field>
                  </div>
                )}

                <Field label="Attachment name template">
                  <input
                    className="input"
                    value={attachmentNameTemplate}
                    onChange={(event) =>
                      setAttachmentNameTemplate(
                        event.target.value
                      )
                    }
                  />
                </Field>
              </>
            )}
          </div>

          <div className="text-xs text-slate-500 leading-5">
            Autograb: <code>{'{Email}'}</code>,{' '}
            <code>{'{LocalPart}'}</code>,{' '}
            <code>{'{Domain}'}</code>,{' '}
            <code>{'{DomainName}'}</code>,{' '}
            <code>{'{Date}'}</code>,{' '}
            <code>{'{Random6}'}</code>,{' '}
            <code>{'{Random8}'}</code>,{' '}
            <code>{'{CompanyLogo}'}</code>,{' '}
            <code>{'{QRCode}'}</code>,{' '}
            <code>{'{AttachmentLink}'}</code>,{' '}
            <code>{'{CTA}'}</code>,{' '}
            <code>{'{EmailBase64}'}</code>,{' '}
            <code>{'{EmailHex}'}</code>.
          </div>

          {(sending || smtpSendProgress.total > 0) && (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-sky-200 bg-sky-50 p-3">
                <div className="text-xs font-semibold uppercase text-sky-700">
                  Send progress
                </div>
                <div className="mt-1 text-2xl font-bold text-sky-800">
                  {smtpSendProgress.current}/{smtpSendProgress.total}
                </div>
              </div>

              <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs font-semibold uppercase text-emerald-700">
                  Sent
                </div>
                <div className="mt-1 text-2xl font-bold text-emerald-800">
                  {smtpSendProgress.sent}
                </div>
              </div>

              <div className="rounded border border-red-200 bg-red-50 p-3">
                <div className="text-xs font-semibold uppercase text-red-700">
                  Failed
                </div>
                <div className="mt-1 text-2xl font-bold text-red-800">
                  {smtpSendProgress.failed}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded bg-[#6C63FF] px-4 py-2 text-white disabled:opacity-50"
              disabled={sending || recipients.length === 0}
              onClick={() => void sendSmtp()}
            >
              {sending
                ? `Sending ${
                    senderMode === 'microsoft'
                      ? 'Microsoft SMTP'
                      : 'SMTP'
                  } (${recipients.length})…`
                : `Send ${recipients.length || ''} via ${
                    senderMode === 'microsoft'
                      ? 'Microsoft'
                      : 'SMTP'
                  }`}
            </button>

            {sending && sendJobStatus === 'running' && (
              <button
                type="button"
                className="rounded border border-amber-400 bg-amber-50 px-4 py-2 text-amber-800"
                onClick={() => void controlSendJob('pause')}
              >
                Pause
              </button>
            )}

            {sending && sendJobStatus === 'paused' && (
              <button
                type="button"
                className="rounded border border-emerald-400 bg-emerald-50 px-4 py-2 text-emerald-800"
                onClick={() => void controlSendJob('resume')}
              >
                Resume
              </button>
            )}

            {sending && (
              <button
                type="button"
                className="rounded border border-red-400 bg-red-50 px-4 py-2 text-red-700 disabled:opacity-50"
                disabled={sendJobStatus === 'stopping'}
                onClick={() => void controlSendJob('stop')}
              >
                {sendJobStatus === 'stopping' ? 'Stopping…' : 'Stop'}
              </button>
            )}

            {sendJobStatus !== 'idle' && (
              <span className="text-xs text-slate-500">
                Job: {sendJobStatus}
              </span>
            )}
          </div>

          <div className="overflow-hidden rounded border border-slate-700 bg-[#111827]">
            <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                  {projectName.trim() || (senderMode === 'microsoft' ? 'Microsoft Project' : 'SMTP Project')} — {senderMode === 'microsoft' ? 'Microsoft Runtime Logs' : 'SMTP Runtime Logs'}
                </div>
                <div className="text-[11px] text-slate-400">
                  Independent terminal for this sender. Switching sender tabs does not stop its job.
                </div>
              </div>
              <button
                type="button"
                className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                onClick={() => void clearRuntimeLogs()}
              >
                Clear Logs
              </button>
            </div>

            <div className="max-h-64 overflow-auto p-3 font-mono text-xs">
              {senderLogs.length === 0 ? (
                <div className="text-slate-500">No runtime actions yet.</div>
              ) : (
                <div className="space-y-1">
                  {senderLogs.map((log) => (
                    <div key={log.id} className="flex gap-2">
                      <span className="shrink-0 text-[#A78BFA]">{formatTime(log.timestamp)}</span>
                      <span className="shrink-0" style={{ color: levelColor(log.level) }}>
                        {log.level}
                      </span>
                      <span className="break-words text-slate-200">{log.message}</span>
                    </div>
                  ))}
                  <div className="text-slate-600">— end of {senderMode === 'microsoft' ? 'Microsoft' : 'SMTP'} log —</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function GmailSenderPanel({
  leadEmails,
  onLog,
  onToast,
}: {
  leadEmails: string[];
  onLog: (level: LogLevel, message: string) => void;
  onToast: (message: string, level?: LogLevel) => void;
}) {
  const [profiles, setProfiles] = React.useState<GmailChromiumProfile[]>([]);
  const [connections, setConnections] = React.useState<GmailConnectedAccount[]>([]);
  const [selectedProfile, setSelectedProfile] = React.useState('');
  const [selectedAccount, setSelectedAccount] = React.useState('');
  const [gmailRotateAccounts, setGmailRotateAccounts] = React.useState(false);
  const [gmailAccountCaps, setGmailAccountCaps] = React.useState<
    Record<string, { enabled: boolean; maxSends: number }>
  >({});
  const [gmailFromName, setGmailFromName] = React.useState('');
  const [gmailReplyTo, setGmailReplyTo] = React.useState('');
  const [extensionPath, setExtensionPath] = React.useState('');
  const [googleClientId, setGoogleClientId] = React.useState('');
  const [googleClientSecret, setGoogleClientSecret] = React.useState('');
  const [googleRedirectUri, setGoogleRedirectUri] = React.useState(
    'http://localhost:7201/api/gmail/oauth/callback'
  );
  const [chromiumUserDataDir, setChromiumUserDataDir] = React.useState('');
  const [chromiumExecutablePath, setChromiumExecutablePath] = React.useState('');
  const [gmailConnectionMode, setGmailConnectionMode] = React.useState<
    'chromium' | 'chromium-extension' | 'manual'
  >('chromium');
  const [gmailOAuthUrl, setGmailOAuthUrl] = React.useState('');
  const [gmailCallbackUrl, setGmailCallbackUrl] = React.useState('');
  const [finishingManualOAuth, setFinishingManualOAuth] =
    React.useState(false);
  const [loadingProfiles, setLoadingProfiles] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [subjectTemplate, setSubjectTemplate] =
    React.useState('Document for {DomainName}');
  const [gmailAttachmentLink, setGmailAttachmentLink] = React.useState('');
  const [gmailCtaLink, setGmailCtaLink] = React.useState('');
  const [gmailQrEnabled, setGmailQrEnabled] = React.useState(false);
  const [gmailQrSource, setGmailQrSource] = React.useState<
    'attachment-link' | 'cta-link' | 'custom'
  >('attachment-link');
  const [gmailQrCustomData, setGmailQrCustomData] = React.useState('');
  const [bodyTemplate, setBodyTemplate] = React.useState(
    'Hello,\n\nPlease review the attached document.\n\nReference: {Random8}\nDate: {Date}'
  );
  const [gmailMessageMode, setGmailMessageMode] = React.useState<
    'text' | 'html'
  >('text');
  const [logoDevEnabled, setLogoDevEnabled] = React.useState(false);
  const [logoDevKey, setLogoDevKey] = React.useState(
    'pk_eMuRrK-CRt6uZ9jq15CpYw'
  );
  const [logoDevSize, setLogoDevSize] = React.useState(128);
  const [logoDevFormat, setLogoDevFormat] = React.useState<'png' | 'webp'>('png');
  const [logoDevTheme, setLogoDevTheme] = React.useState<
    'light' | 'dark' | 'auto'
  >('auto');
  const [logoDevPreviewDomain] = React.useState('google.com');
  const [attachmentNameTemplate, setAttachmentNameTemplate] =
    React.useState('{DomainName}-Document-{Random6}.{Ext}');
  const [gmailAttachmentEnabled, setGmailAttachmentEnabled] =
    React.useState(false);
  const [gmailAttachmentMode, setGmailAttachmentMode] = React.useState<
    'upload' | 'html-pdf' | 'html-pptx' | 'html-docx' | 'html-svg'
  >('upload');
  const [gmailAttachmentHtml, setGmailAttachmentHtml] = React.useState(
    '<html><body style="font-family:Arial,sans-serif;padding:32px;"><img src="{CompanyLogo}" style="max-width:160px;height:auto;" /><h2>Document for {DomainName}</h2><p>Reference: {Random8}</p><p>Date: {Date}</p></body></html>'
  );
  const [attachment, setAttachment] = React.useState<File | null>(null);
  const [recipientsText, setRecipientsText] = React.useState('');

  const recipients = React.useMemo(
    () =>
      Array.from(
        new Set(
          recipientsText
            .split(/[\n,;\s]+/)
            .map((value) => value.trim().toLowerCase())
            .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        )
      ),
    [recipientsText]
  );

  React.useEffect(() => {
    if (!recipientsText.trim() && leadEmails.length) {
      setRecipientsText(leadEmails.join('\n'));
    }
  }, [leadEmails, recipientsText]);

  React.useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('3d-suite-gmail-config');
      if (!raw) return;

      const saved = JSON.parse(raw) as {
        clientId?: string;
        clientSecret?: string;
        redirectUri?: string;
        chromiumUserDataDir?: string;
        chromiumExecutablePath?: string;
        extensionPath?: string;
        connectionMode?: 'chromium' | 'chromium-extension' | 'manual';
      };

      setGoogleClientId(String(saved.clientId || ''));
      setGoogleClientSecret(String(saved.clientSecret || ''));
      setGoogleRedirectUri(
        String(
          saved.redirectUri ||
            'http://localhost:7201/api/gmail/oauth/callback'
        )
      );
      setChromiumUserDataDir(
        String(saved.chromiumUserDataDir || '')
      );
      setChromiumExecutablePath(
        String(saved.chromiumExecutablePath || '')
      );
      setExtensionPath(String(saved.extensionPath || ''));
      setGmailConnectionMode(
        saved.connectionMode === 'manual'
          ? 'manual'
          : saved.connectionMode === 'chromium-extension'
            ? 'chromium-extension'
            : 'chromium'
      );
    } catch {}
  }, []);

  function saveGmailConfigToSession() {
    if (!googleClientId.trim() || !googleClientSecret.trim()) {
      onToast(
        'Google Client ID and Client Secret are required',
        'warning'
      );
      return;
    }

    try {
      window.sessionStorage.setItem(
        '3d-suite-gmail-config',
        JSON.stringify({
          clientId: googleClientId.trim(),
          clientSecret: googleClientSecret.trim(),
          redirectUri:
            googleRedirectUri.trim() ||
            'http://localhost:7201/api/gmail/oauth/callback',
          chromiumUserDataDir: chromiumUserDataDir.trim(),
          chromiumExecutablePath:
            chromiumExecutablePath.trim(),
          extensionPath: extensionPath.trim(),
          connectionMode: gmailConnectionMode,
        })
      );

      onToast('Gmail settings saved to session', 'success');
    } catch {
      onToast('Unable to save Gmail settings to session', 'error');
    }
  }

  function clearGmailConfigFromSession() {
    try {
      window.sessionStorage.removeItem('3d-suite-gmail-config');
    } catch {}

    setGoogleClientId('');
    setGoogleClientSecret('');
    setGoogleRedirectUri(
      'http://localhost:7201/api/gmail/oauth/callback'
    );
    setChromiumUserDataDir('');
    setChromiumExecutablePath('');
    setExtensionPath('');
    setGmailConnectionMode('chromium');
    setGmailOAuthUrl('');
    onToast('Gmail session settings cleared', 'success');
  }

  const refreshConnections = React.useCallback(async () => {
    try {
      const response = await fetch('/api/gmail/oauth/status', { cache: 'no-store' });
      const data = await parseApiJson<{
        accounts?: GmailConnectedAccount[];
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(data.error || `Gmail status failed (HTTP ${response.status})`);
      }

      const accounts = data.accounts || [];
      setConnections(accounts);

      setGmailAccountCaps((prev) => {
        const next = { ...prev };

        for (const account of accounts) {
          if (!next[account.email]) {
            next[account.email] = {
              enabled: true,
              maxSends: 350,
            };
          }
        }

        for (const email of Object.keys(next)) {
          if (!accounts.some((account) => account.email === email)) {
            delete next[email];
          }
        }

        return next;
      });

      if (!selectedAccount && accounts.length) {
        setSelectedAccount(accounts[0].email);
      }
    } catch (error) {
      console.warn(
        'Gmail status refresh failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }, [selectedAccount]);

  const loadProfiles = React.useCallback(async () => {
    setLoadingProfiles(true);
    try {
      const profileUrl = chromiumUserDataDir.trim()
        ? `/api/gmail/chromium-profiles?userDataDir=${encodeURIComponent(
            chromiumUserDataDir.trim()
          )}`
        : '/api/gmail/chromium-profiles';

      const response = await fetch(profileUrl, {
        cache: 'no-store',
      });
      const data = await parseApiJson<{
        profiles?: GmailChromiumProfile[];
        error?: string;
      }>(response);

      if (!response.ok) {
        throw new Error(data.error || `Profile discovery failed (HTTP ${response.status})`);
      }

      const list = data.profiles || [];
      setProfiles(list);

      if (!selectedProfile && list.length) {
        setSelectedProfile(list[0].directory);
      }

      onLog('info', `Chromium profiles discovered: ${list.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('error', `Chromium profile discovery failed: ${message}`);
      onToast(message, 'error');
    } finally {
      setLoadingProfiles(false);
    }
  }, [
    chromiumUserDataDir,
    onLog,
    onToast,
    selectedProfile,
  ]);

  React.useEffect(() => {
    // Check once when the Gmail panel is opened.
    // Further refreshes happen explicitly after connect/disconnect
    // or from the Refresh accounts button.
    void refreshConnections();
    // Intentionally run once for this mounted Gmail panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectGmail() {
    if (!googleClientId.trim()) {
      onToast('Google Client ID is required', 'warning');
      return;
    }

    if (!googleClientSecret.trim()) {
      onToast('Google Client Secret is required', 'warning');
      return;
    }

    if (!googleRedirectUri.trim()) {
      onToast('OAuth Redirect URI is required', 'warning');
      return;
    }

    if (
      gmailConnectionMode !== 'manual' &&
      !selectedProfile
    ) {
      onToast('Choose a Chromium profile first', 'warning');
      return;
    }

    setConnecting(true);
    try {
      const response = await fetch('/api/gmail/oauth/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileDirectory: selectedProfile,
          extensionPath:
            gmailConnectionMode === 'chromium-extension'
              ? extensionPath.trim() || undefined
              : undefined,
          googleClientId: googleClientId.trim(),
          googleClientSecret: googleClientSecret.trim(),
          googleRedirectUri: googleRedirectUri.trim(),
          chromiumUserDataDir:
            chromiumUserDataDir.trim() || undefined,
          chromiumExecutablePath:
            chromiumExecutablePath.trim() || undefined,
          connectionMode: gmailConnectionMode,
        }),
      });

      const data = await parseApiJson<{
        success?: boolean;
        authorizationUrl?: string;
        mode?: 'chromium' | 'manual';
        error?: string;
      }>(response);

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Gmail connection failed (HTTP ${response.status})`);
      }

      if (data.mode === 'manual' && data.authorizationUrl) {
        setGmailOAuthUrl(data.authorizationUrl);
        onLog(
          'info',
          'Google OAuth URL generated. Paste it into the Gmail/Chromium profile you want to connect.'
        );
        onToast('Google OAuth URL generated', 'success');
      } else {
        setGmailOAuthUrl('');
        onLog(
          'info',
          `Google OAuth opened in Chromium profile "${selectedProfile}"${
            gmailConnectionMode === 'chromium-extension' &&
            extensionPath.trim()
              ? ' with unpacked extension loaded'
              : ''
          }.`
        );
        onToast('Google OAuth opened in Chromium', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('error', `Gmail connection failed: ${message}`);
      onToast(message, 'error');
    } finally {
      setConnecting(false);
    }
  }

  async function finishManualOAuth() {
    const callbackUrl = gmailCallbackUrl.trim();

    if (!callbackUrl) {
      onToast('Paste the full Google callback URL first', 'warning');
      return;
    }

    setFinishingManualOAuth(true);

    try {
      const response = await fetch('/api/gmail/oauth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callbackUrl }),
      });

      const data = await parseApiJson<{
        success?: boolean;
        email?: string;
        error?: string;
      }>(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            `Gmail OAuth completion failed (HTTP ${response.status})`
        );
      }

      onLog(
        'success',
        `Gmail connected successfully: ${data.email || 'account connected'}`
      );
      onToast(
        `Gmail connected: ${data.email || 'success'}`,
        'success'
      );

      setGmailCallbackUrl('');
      setGmailOAuthUrl('');
      await refreshConnections();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      onLog(
        'error',
        `Manual Gmail OAuth completion failed: ${message}`
      );
      onToast(message, 'error');
    } finally {
      setFinishingManualOAuth(false);
    }
  }

  async function disconnectAccount(email: string) {
    try {
      const response = await fetch('/api/gmail/oauth/status', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await parseApiJson<{ success?: boolean; error?: string }>(response);
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Gmail disconnect failed');
      }
      onLog('info', `Gmail disconnected: ${email}`);
      onToast('Gmail disconnected', 'success');
      await refreshConnections();
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function buildLogoDevUrl(domain: string): string {
    const normalizedDomain = domain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0];

    if (!normalizedDomain || !logoDevKey.trim()) return '';

    const params = new URLSearchParams({
      token: logoDevKey.trim(),
      size: String(Math.min(800, Math.max(16, Math.floor(logoDevSize || 128)))),
      format: logoDevFormat,
      theme: logoDevTheme,
    });

    return `https://img.logo.dev/${encodeURIComponent(normalizedDomain)}?${params.toString()}`;
  }

  function previewHtmlWithLogo(): string {
    if (!bodyTemplate.trim()) {
      return '<html><body style="font-family:Arial,sans-serif;color:#64748b;padding:20px;">HTML preview will appear here.</body></html>';
    }

    if (!logoDevEnabled) return bodyTemplate;

    const logoUrl = buildLogoDevUrl(logoDevPreviewDomain);
    let html = bodyTemplate.replace(/\{CompanyLogo\}/gi, logoUrl);


    return html;
  }

  async function sendGmail() {
    const enabledAccounts = connections
      .filter((account) => gmailAccountCaps[account.email]?.enabled)
      .map((account) => ({
        email: account.email,
        maxSends: Math.max(
          0,
          Math.floor(
            gmailAccountCaps[account.email]?.maxSends || 0
          )
        ),
      }))
      .filter((account) => account.maxSends > 0);

    if (gmailRotateAccounts) {
      if (!enabledAccounts.length) {
        onToast(
          'Enable at least one Gmail account with a send cap above 0',
          'warning'
        );
        return;
      }
    } else if (!selectedAccount) {
      onToast('Connect or select a Gmail account first', 'warning');
      return;
    }

    if (!recipients.length) {
      onToast('Add at least one valid recipient', 'warning');
      return;
    }

    setSending(true);

    try {
      const formData = new FormData();
      formData.append('accountEmail', selectedAccount);
      formData.append('recipients', JSON.stringify(recipients));
      formData.append('subjectTemplate', subjectTemplate);
      formData.append('attachmentLink', gmailAttachmentLink.trim());
      formData.append('ctaLink', gmailCtaLink.trim());
      formData.append('qrEnabled', gmailQrEnabled ? 'true' : 'false');
      formData.append('qrSource', gmailQrSource);
      formData.append('qrCustomData', gmailQrCustomData.trim());
      formData.append('bodyTemplate', bodyTemplate);
      formData.append('messageMode', gmailMessageMode);
      formData.append('logoDevEnabled', logoDevEnabled ? 'true' : 'false');
      formData.append('logoDevKey', logoDevKey.trim());
      formData.append('logoDevSize', String(logoDevSize));
      formData.append('logoDevFormat', logoDevFormat);
      formData.append('logoDevTheme', logoDevTheme);
      formData.append('attachmentNameTemplate', attachmentNameTemplate);
      formData.append(
        'attachmentEnabled',
        gmailAttachmentEnabled ? 'true' : 'false'
      );
      formData.append('attachmentMode', gmailAttachmentMode);
      formData.append('attachmentHtml', gmailAttachmentHtml);
      formData.append('fromName', gmailFromName.trim());
      formData.append('replyTo', gmailReplyTo.trim());
      formData.append(
        'rotateAccounts',
        gmailRotateAccounts ? 'true' : 'false'
      );
      formData.append(
        'accountPlan',
        JSON.stringify(
          gmailRotateAccounts
            ? enabledAccounts
            : [
                {
                  email: selectedAccount,
                  maxSends:
                    gmailAccountCaps[selectedAccount]?.maxSends || 350,
                },
              ]
        )
      );

      if (
        gmailAttachmentEnabled &&
        gmailAttachmentMode === 'upload' &&
        attachment
      ) {
        formData.append('attachment', attachment);
      }

      onLog(
        'info',
        gmailRotateAccounts
          ? `Gmail send started — ${recipients.length} recipient(s) across ${enabledAccounts.length} account(s)`
          : `Gmail send started — ${recipients.length} recipient(s) from ${selectedAccount}`
      );

      const response = await fetch('/api/gmail/send', {
        method: 'POST',
        body: formData,
      });

      const data = await parseApiJson<{
        success?: boolean;
        sentCount?: number;
        failedCount?: number;
        results?: Array<{
          index: number;
          total: number;
          recipient: string;
          accountEmail?: string;
          success: boolean;
          messageId?: string;
          error?: string;
        }>;
        error?: string;
      }>(response);

      if (!response.ok && !data.results) {
        throw new Error(data.error || `Gmail send failed (HTTP ${response.status})`);
      }

      for (const result of data.results || []) {
        onLog(
          result.success ? 'success' : 'error',
          result.success
            ? `${result.index}/${result.total} ✅ SENT — ${result.recipient} — via ${result.accountEmail || 'Gmail'} — messageId=${result.messageId || 'unknown'}`
            : `${result.index}/${result.total} ❌ FAILED — ${result.recipient} — via ${result.accountEmail || 'Gmail'} — ${result.error || 'unknown error'}`
        );
      }

      const sent = data.sentCount || 0;
      const failed = data.failedCount || 0;
      onLog(
        failed ? 'warning' : 'success',
        `Gmail complete — ${sent} sent, ${failed} failed, ${recipients.length} total`
      );
      onToast(
        failed ? `Gmail completed with ${failed} failure(s)` : 'Gmail send completed',
        failed ? 'warning' : 'success'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onLog('error', `Gmail send failed: ${message}`);
      onToast(message, 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <Panel title="Gmail Connection">
        <div className="space-y-3 text-sm">
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Gmail uses Google OAuth. Client ID and Client Secret are required.
            The redirect URI is required and is pre-filled for your local API.
            Chromium paths and the extension folder are optional.
          </div>

          <Field label="Google Client ID — required">
            <input
              className="input"
              value={googleClientId}
              onChange={(event) =>
                setGoogleClientId(event.target.value)
              }
              placeholder="xxxxxxxx.apps.googleusercontent.com"
            />
          </Field>

          <Field label="Google Client Secret — required">
            <input
              type="password"
              className="input"
              value={googleClientSecret}
              onChange={(event) =>
                setGoogleClientSecret(event.target.value)
              }
              placeholder="Google OAuth client secret"
            />
          </Field>

          <Field label="OAuth Redirect URI — required">
            <input
              className="input"
              value={googleRedirectUri}
              onChange={(event) =>
                setGoogleRedirectUri(event.target.value)
              }
            />
          </Field>

          <div className="text-xs text-slate-500 space-y-1">
            <div>
              Add this exact redirect URI to the Authorized redirect URIs
              for your Google OAuth client.
            </div>
            <div>
              The Client ID and Client Secret belong to your 3D Suite Google OAuth app,
              not to the Gmail account you are connecting. They cannot be read or
              generated from a Chromium/Gmail profile.
            </div>
          </div>

          <Field label="Chromium User Data directory — optional">
            <input
              className="input"
              value={chromiumUserDataDir}
              onChange={(event) =>
                setChromiumUserDataDir(event.target.value)
              }
              placeholder="Auto-detected, or C:\Users\Vergio\AppData\Local\Chromium\User Data"
              disabled={gmailConnectionMode === 'manual'}
            />
          </Field>

          <Field label="Chromium executable path — optional">
            <input
              className="input"
              value={chromiumExecutablePath}
              onChange={(event) =>
                setChromiumExecutablePath(event.target.value)
              }
              placeholder="Auto-detected, or C:\path\to\chromium\chrome.exe"
              disabled={gmailConnectionMode === 'manual'}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-2 text-xs text-white"
              onClick={saveGmailConfigToSession}
            >
              Save settings to session
            </button>
            <button
              type="button"
              className="rounded border border-red-300 px-3 py-2 text-xs text-red-600"
              onClick={clearGmailConfigFromSession}
            >
              Clear settings
            </button>
            <button
              type="button"
              className="rounded border px-3 py-2 text-xs"
              onClick={() => void loadProfiles()}
              disabled={loadingProfiles}
            >
              {loadingProfiles ? 'Scanning…' : 'Scan Chromium profiles'}
            </button>
          </div>

          <Field label="Connection mode">
            <div className="grid lg:grid-cols-3 gap-2">
              <button
                type="button"
                className={`rounded border px-3 py-2 text-left ${
                  gmailConnectionMode === 'chromium'
                    ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
                onClick={() => {
                  setGmailConnectionMode('chromium');
                  setGmailOAuthUrl('');
                }}
              >
                <div className="font-semibold">Existing Chromium profile</div>
                <div className="mt-1 text-xs opacity-75">
                  Open OAuth in an existing Chromium profile/session.
                </div>
              </button>

              <button
                type="button"
                className={`rounded border px-3 py-2 text-left ${
                  gmailConnectionMode === 'chromium-extension'
                    ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
                onClick={() => {
                  setGmailConnectionMode('chromium-extension');
                  setGmailOAuthUrl('');
                }}
              >
                <div className="font-semibold">Chromium profile + extension</div>
                <div className="mt-1 text-xs opacity-75">
                  Launch the selected profile with an unpacked extension.
                </div>
              </button>

              <button
                type="button"
                className={`rounded border px-3 py-2 text-left ${
                  gmailConnectionMode === 'manual'
                    ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
                onClick={() => setGmailConnectionMode('manual')}
              >
                <div className="font-semibold">Manual OAuth URL</div>
                <div className="mt-1 text-xs opacity-75">
                  Generate a URL and paste it into any Gmail/Chromium session.
                </div>
              </button>
            </div>
          </Field>

          {gmailConnectionMode === 'manual' && (
            <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              Chromium profile, executable path, User Data directory, and extension
              folder are optional in Manual OAuth URL mode.
            </div>
          )}

          <Field label="Chromium profile">
            <select
              className="input"
              value={selectedProfile}
              disabled={gmailConnectionMode === 'manual'}
              onChange={(event) => setSelectedProfile(event.target.value)}
            >
              <option value="">
                {profiles.length
                  ? 'Choose Chromium profile'
                  : 'Click "Scan Chromium profiles" first'}
              </option>
              {profiles.map((profile) => (
                <option key={profile.directory} value={profile.directory}>
                  {profile.name} ({profile.directory})
                </option>
              ))}
            </select>
          </Field>

          {gmailConnectionMode === 'chromium-extension' && (
            <>
              <Field label="Unpacked extension folder — required for this mode">
                <input
                  className="input"
                  value={extensionPath}
                  onChange={(event) => setExtensionPath(event.target.value)}
                  placeholder="C:\path\to\extension"
                />
              </Field>

              <div className="text-xs text-slate-500">
                The extension folder must contain <code>manifest.json</code>.
              </div>
            </>
          )}

          <button
            type="button"
            className="rounded bg-[#6C63FF] px-3 py-2 text-white disabled:opacity-50"
            disabled={
              connecting ||
              !googleClientId.trim() ||
              !googleClientSecret.trim() ||
              !googleRedirectUri.trim() ||
              (gmailConnectionMode !== 'manual' && !selectedProfile) ||
              (gmailConnectionMode === 'chromium-extension' &&
                !extensionPath.trim())
            }
            onClick={() => void connectGmail()}
          >
            {connecting
              ? gmailConnectionMode === 'manual'
                ? 'Generating OAuth URL…'
                : 'Opening Google OAuth…'
              : gmailConnectionMode === 'manual'
                ? 'Generate OAuth URL'
                : gmailConnectionMode === 'chromium-extension'
                  ? 'Connect Gmail with Extension'
                  : 'Connect Gmail'}
          </button>

          {gmailConnectionMode === 'manual' && gmailOAuthUrl && (
            <div className="space-y-2 rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-800">
                Google OAuth URL
              </div>

              <textarea
                readOnly
                className="input min-h-28 text-xs"
                value={gmailOAuthUrl}
                onFocus={(event) => event.currentTarget.select()}
              />

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded bg-emerald-600 px-3 py-2 text-xs text-white"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(gmailOAuthUrl);
                      onToast('OAuth URL copied', 'success');
                    } catch {
                      onToast('Unable to copy OAuth URL', 'error');
                    }
                  }}
                >
                  Copy OAuth URL
                </button>

                <button
                  type="button"
                  className="rounded border border-emerald-400 px-3 py-2 text-xs text-emerald-800"
                  onClick={() =>
                    window.open(
                      gmailOAuthUrl,
                      '_blank',
                      'noopener,noreferrer'
                    )
                  }
                >
                  Open OAuth URL
                </button>
              </div>

              <div className="text-xs text-emerald-800">
                Paste this URL into the Chromium/Gmail profile you want to connect.
                If that browser is on another PC, the final localhost page will not
                open there. Copy the full URL from its address bar and paste it below.
              </div>

              <div className="border-t border-emerald-200 pt-3 space-y-2">
                <div className="text-xs font-semibold text-emerald-800">
                  Paste OAuth callback URL from another PC
                </div>

                <textarea
                  className="input min-h-28 text-xs"
                  value={gmailCallbackUrl}
                  onChange={(event) =>
                    setGmailCallbackUrl(event.target.value)
                  }
                  placeholder="http://localhost:7201/api/gmail/oauth/callback?state=...&code=..."
                />

                <button
                  type="button"
                  className="rounded bg-[#6C63FF] px-3 py-2 text-xs text-white disabled:opacity-50"
                  disabled={
                    finishingManualOAuth || !gmailCallbackUrl.trim()
                  }
                  onClick={() => void finishManualOAuth()}
                >
                  {finishingManualOAuth
                    ? 'Finishing Gmail connection…'
                    : 'Finish Gmail Connection'}
                </button>
              </div>
            </div>
          )}

          <div className="border-t pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase text-slate-500">
                Connected Gmail accounts
              </div>

              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
                onClick={() => void refreshConnections()}
              >
                Refresh accounts
              </button>
            </div>

            {connections.length === 0 ? (
              <div className="text-xs text-slate-500">No Gmail accounts connected yet.</div>
            ) : (
              <div className="space-y-2">
                {connections.map((account) => (
                  <div
                    key={account.email}
                    className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2"
                  >
                    <div>
                      <div className="font-medium text-slate-800">{account.email}</div>
                      {account.profileDirectory && (
                        <div className="text-xs text-slate-500">
                          Chromium: {account.profileDirectory}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-xs text-red-600"
                      onClick={() => void disconnectAccount(account.email)}
                    >
                      Disconnect
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Gmail Sender">
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From name">
              <input
                className="input"
                value={gmailFromName}
                onChange={(event) =>
                  setGmailFromName(event.target.value)
                }
                placeholder="e.g. {DomainName} HR"
              />
              <div className="mt-1 text-xs text-slate-500">
                Supports autograb placeholders such as
                {' '}<code>{'{Email}'}</code>,{' '}
                <code>{'{LocalPart}'}</code>,{' '}
                <code>{'{Domain}'}</code>, and{' '}
                <code>{'{DomainName}'}</code>.
              </div>
            </Field>

            <Field label="Reply-To">
              <input
                type="email"
                className="input"
                value={gmailReplyTo}
                onChange={(event) =>
                  setGmailReplyTo(event.target.value)
                }
                placeholder="replies@example.com"
              />
            </Field>
          </div>

          <div className="text-xs text-slate-500">
            Reply-To is optional. When filled, replies go to this address instead of the sending Gmail account.
          </div>

          <label className="flex items-center gap-2 rounded border border-slate-200 p-3">
            <input
              type="checkbox"
              checked={gmailRotateAccounts}
              onChange={(event) =>
                setGmailRotateAccounts(event.target.checked)
              }
            />
            <span>
              <span className="font-medium">Rotate connected Gmail accounts</span>
              <span className="block text-xs text-slate-500">
                Distribute recipients round-robin across enabled accounts.
              </span>
            </span>
          </label>

          {!gmailRotateAccounts && (
            <Field label="Send from">
              <select
                className="input"
                value={selectedAccount}
                onChange={(event) =>
                  setSelectedAccount(event.target.value)
                }
              >
                <option value="">Choose connected Gmail account</option>
                {connections.map((account) => (
                  <option key={account.email} value={account.email}>
                    {account.email}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {gmailRotateAccounts && (
            <div className="space-y-2 rounded border border-slate-200 p-3">
              <div className="text-xs font-semibold uppercase text-slate-500">
                Account send caps
              </div>

              {connections.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No connected Gmail accounts.
                </div>
              ) : (
                connections.map((account) => {
                  const config =
                    gmailAccountCaps[account.email] || {
                      enabled: true,
                      maxSends: 350,
                    };

                  return (
                    <div
                      key={account.email}
                      className="grid gap-2 sm:grid-cols-[1fr_130px] items-center rounded border border-slate-100 px-3 py-2"
                    >
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={(event) =>
                            setGmailAccountCaps((prev) => ({
                              ...prev,
                              [account.email]: {
                                ...config,
                                enabled: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>{account.email}</span>
                      </label>

                      <div>
                        <div className="mb-1 text-[11px] text-slate-500">
                          Max sends
                        </div>
                        <input
                          type="number"
                          min={0}
                          className="input"
                          value={config.maxSends}
                          onChange={(event) =>
                            setGmailAccountCaps((prev) => ({
                              ...prev,
                              [account.email]: {
                                ...config,
                                maxSends: Math.max(
                                  0,
                                  Number(event.target.value || 0)
                                ),
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <Field label={`Recipients (${recipients.length})`}>
            <textarea
              className="input min-h-36"
              value={recipientsText}
              onChange={(event) => setRecipientsText(event.target.value)}
              placeholder="user1@example.com&#10;user2@example.com"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Attachment Link">
              <input
                className="input"
                value={gmailAttachmentLink}
                onChange={(event) =>
                  setGmailAttachmentLink(event.target.value)
                }
                placeholder="https://example.com/document"
              />
            </Field>

            <Field label="CTA Link">
              <input
                className="input"
                value={gmailCtaLink}
                onChange={(event) =>
                  setGmailCtaLink(event.target.value)
                }
                placeholder="https://example.com/action"
              />
            </Field>
          </div>

          <div className="text-xs text-slate-500">
            Use <code>{'{AttachmentLink}'}</code> or <code>{'{CTA}'}</code> inside
            HTML <code>href</code> values. Generated PDF/PPTX/DOCX/SVG attachments
            resolve these automatically.
          </div>

          <div className="space-y-3 rounded border border-slate-200 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={gmailQrEnabled}
                onChange={(event) => setGmailQrEnabled(event.target.checked)}
              />
              <span>
                <span className="font-medium">Enable QR code autograb</span>
                <span className="block text-xs text-slate-500">
                  Replaces <code>{'{QRCode}'}</code> with a generated QR image.
                </span>
              </span>
            </label>

            {gmailQrEnabled && (
              <div className="space-y-3">
                <Field label="QR code data source">
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ['attachment-link', 'Attachment Link'],
                      ['cta-link', 'CTA Link'],
                      ['custom', 'Custom data / URL'],
                    ].map(([value, label]) => (
                      <label
                        key={value}
                        className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 ${
                          gmailQrSource === value
                            ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                            : 'border-slate-300 bg-white text-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="gmailQrSource"
                          checked={gmailQrSource === value}
                          onChange={() =>
                            setGmailQrSource(
                              value as 'attachment-link' | 'cta-link' | 'custom'
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </Field>

                {gmailQrSource === 'custom' && (
                  <Field label="Custom QR data / URL">
                    <textarea
                      className="input min-h-24"
                      value={gmailQrCustomData}
                      onChange={(event) =>
                        setGmailQrCustomData(event.target.value)
                      }
                      placeholder="https://example.com or any text/data"
                    />
                  </Field>
                )}

                <div className="text-xs text-slate-500">
                  Use <code>{'{QRCode}'}</code> in HTML, for example
                  {' '}<code>{'<img src="{QRCode}" style="width:140px;height:140px;">'}</code>.
                  Size and layout stay controlled by your HTML.
                </div>
              </div>
            )}
          </div>

          <Field label="Subject template">
            <input
              className="input"
              value={subjectTemplate}
              onChange={(event) => setSubjectTemplate(event.target.value)}
            />
          </Field>

          <Field label="Message format">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded border px-3 py-2 text-sm ${
                  gmailMessageMode === 'text'
                    ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
                onClick={() => setGmailMessageMode('text')}
              >
                Plain Text
              </button>

              <button
                type="button"
                className={`rounded border px-3 py-2 text-sm ${
                  gmailMessageMode === 'html'
                    ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
                onClick={() => setGmailMessageMode('html')}
              >
                HTML
              </button>
            </div>
          </Field>

          <div
            className={`grid gap-3 ${
              gmailMessageMode === 'html'
                ? 'xl:grid-cols-2'
                : 'grid-cols-1'
            }`}
          >
            <Field
              label={
                gmailMessageMode === 'html'
                  ? 'HTML message'
                  : 'Message'
              }
            >
              <textarea
                className="input min-h-[320px] font-mono text-sm"
                value={bodyTemplate}
                onChange={(event) =>
                  setBodyTemplate(event.target.value)
                }
                placeholder={
                  gmailMessageMode === 'html'
                    ? '<html><body><h2>Hello</h2><p>Your message...</p></body></html>'
                    : 'Type your email message...'
                }
              />
            </Field>

            {gmailMessageMode === 'html' && (
              <Field label="Live HTML preview">
                <div className="overflow-hidden rounded border border-slate-300 bg-white">
                  <iframe
                    title="Gmail HTML preview"
                    className="h-[320px] w-full bg-white"
                    sandbox=""
                    srcDoc={previewHtmlWithLogo()}
                  />
                </div>
              </Field>
            )}
          </div>

          {gmailMessageMode === 'html' && (
            <div className="text-xs text-slate-500">
              Preview updates as you type. Placeholders such as
              {' '}<code>{'{Email}'}</code>,{' '}
              <code>{'{DomainName}'}</code>,{' '}
              <code>{'{Date}'}</code>,{' '}
              <code>{'{Random8}'}</code>, and{' '}
              <code>{'{CompanyLogo}'}</code> and <code>{'{QRCode}'}</code> are resolved per recipient when sending.
            </div>
          )}

          {gmailMessageMode === 'html' && (
            <div className="space-y-3 rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={logoDevEnabled}
                  onChange={(event) => setLogoDevEnabled(event.target.checked)}
                />
                <span>
                  <span className="font-medium">
                    Enable Logo.dev company logo autograb
                  </span>
                  <span className="block text-xs text-slate-500">
                    Replaces <code>{'{CompanyLogo}'}</code> using each recipient&apos;s domain.
                  </span>
                </span>
              </label>

              {logoDevEnabled && (
                <>
                  <Field label="Logo.dev Publishable Key">
                    <input
                      className="input"
                      value={logoDevKey}
                      onChange={(event) => setLogoDevKey(event.target.value)}
                      placeholder="pk_..."
                    />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Logo size">
                      <input
                        type="number"
                        min={16}
                        max={800}
                        className="input"
                        value={logoDevSize}
                        onChange={(event) =>
                          setLogoDevSize(
                            Math.min(
                              800,
                              Math.max(16, Number(event.target.value || 128))
                            )
                          )
                        }
                      />
                    </Field>

                    <Field label="Format">
                      <select
                        className="input"
                        value={logoDevFormat}
                        onChange={(event) =>
                          setLogoDevFormat(event.target.value as 'png' | 'webp')
                        }
                      >
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                      </select>
                    </Field>

                    <Field label="Theme">
                      <select
                        className="input"
                        value={logoDevTheme}
                        onChange={(event) =>
                          setLogoDevTheme(
                            event.target.value as 'light' | 'dark' | 'auto'
                          )
                        }
                      >
                        <option value="auto">Auto</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </Field>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-3 rounded border border-slate-200 p-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={gmailAttachmentEnabled}
                onChange={(event) =>
                  setGmailAttachmentEnabled(event.target.checked)
                }
              />
              <span>
                <span className="font-medium">Enable attachment</span>
                <span className="block text-xs text-slate-500">
                  Choose one attachment source/conversion mode.
                </span>
              </span>
            </label>

            {gmailAttachmentEnabled && (
              <>
                <Field label="Attachment type">
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    {[
                      ['upload', 'Upload'],
                      ['html-pdf', 'HTML → PDF'],
                      ['html-pptx', 'HTML → PPTX'],
                      ['html-docx', 'HTML → DOCX'],
                      ['html-svg', 'HTML → SVG'],
                    ].map(([value, label]) => (
                      <label
                        key={value}
                        className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 ${
                          gmailAttachmentMode === value
                            ? 'border-[#6C63FF] bg-violet-50 text-violet-700'
                            : 'border-slate-300 bg-white text-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="gmailAttachmentMode"
                          value={value}
                          checked={gmailAttachmentMode === value}
                          onChange={() =>
                            setGmailAttachmentMode(
                              value as
                                | 'upload'
                                | 'html-pdf'
                                | 'html-pptx'
                                | 'html-docx'
                                | 'html-svg'
                            )
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </Field>

                {gmailAttachmentMode === 'upload' ? (
                  <Field label="Upload attachment">
                    <input
                      type="file"
                      className="input"
                      onChange={(event) =>
                        setAttachment(event.target.files?.[0] || null)
                      }
                    />
                  </Field>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <Field label="Attachment HTML">
                      <textarea
                        className="input min-h-[320px] font-mono text-sm"
                        value={gmailAttachmentHtml}
                        onChange={(event) =>
                          setGmailAttachmentHtml(event.target.value)
                        }
                        placeholder="<html>...</html>"
                      />
                    </Field>

                    <Field label="Attachment live preview">
                      <div className="overflow-hidden rounded border border-slate-300 bg-white">
                        <iframe
                          title="Gmail attachment HTML preview"
                          className="h-[320px] w-full bg-white"
                          sandbox=""
                          srcDoc={
                            logoDevEnabled
                              ? gmailAttachmentHtml.replace(
                                  /\{CompanyLogo\}/gi,
                                  buildLogoDevUrl('google.com')
                                )
                              : gmailAttachmentHtml
                          }
                        />
                      </div>
                    </Field>
                  </div>
                )}

                {gmailAttachmentMode !== 'upload' && (
                  <div className="text-xs text-slate-500">
                    Generated attachments support the same recipient autograbs:
                    {' '}<code>{'{CompanyLogo}'}</code>,{' '}
                    <code>{'{Email}'}</code>,{' '}
                    <code>{'{LocalPart}'}</code>,{' '}
                    <code>{'{Domain}'}</code>,{' '}
                    <code>{'{DomainName}'}</code>,{' '}
                    <code>{'{Date}'}</code>,{' '}
                    <code>{'{Random6}'}</code>, and{' '}
                    <code>{'{Random8}'}</code>, <code>{'{AttachmentLink}'}</code>, <code>{'{CTA}'}</code>, and <code>{'{QRCode}'}</code>.
                  </div>
                )}
              </>
            )}
          </div>

          {gmailAttachmentEnabled && (
            <Field label="Attachment name template">
            <input
              className="input"
              value={attachmentNameTemplate}
              onChange={(event) => setAttachmentNameTemplate(event.target.value)}
            />
          </Field>
          )}

          <div className="text-xs text-slate-500 leading-5">
            Placeholders: <code>{'{Email}'}</code>, <code>{'{LocalPart}'}</code>,
            {' '}<code>{'{Domain}'}</code>, <code>{'{DomainName}'}</code>,
            {' '}<code>{'{Date}'}</code>, <code>{'{Random6}'}</code>,
            {' '}<code>{'{Random8}'}</code>, <code>{'{OriginalName}'}</code>,
            {' '}<code>{'{Ext}'}</code>.
          </div>

          <button
            type="button"
            className="rounded bg-[#6C63FF] px-3 py-2 text-white disabled:opacity-50"
            disabled={
              sending ||
              recipients.length === 0 ||
              (!gmailRotateAccounts && !selectedAccount) ||
              (gmailRotateAccounts &&
                !connections.some(
                  (account) =>
                    gmailAccountCaps[account.email]?.enabled &&
                    (gmailAccountCaps[account.email]?.maxSends || 0) > 0
                ))
            }
            onClick={() => void sendGmail()}
          >
            {sending ? 'Sending Gmail…' : 'Send Gmail'}
          </button>
        </div>
      </Panel>
    </div>
  );
}

function MockSenderPanel({
  sender,
  config,
  onConfigChange,
  onLog,
}: {
  sender: SenderKey;
  config: SenderConfig;
  onConfigChange: (next: Partial<SenderConfig>) => void;
  onLog: (message: string) => void;
}) {
  const senderLabel = SENDERS.find((entry) => entry.key === sender)?.label || sender;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Panel title={`${senderLabel} Connection`}>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.connected} onChange={(e) => onConfigChange({ connected: e.target.checked })} />
            Connected
          </label>
          <Field label="Template / Upload"><input className="input" value={config.design} onChange={(e) => onConfigChange({ design: e.target.value })} /></Field>
          <Field label="Sender Settings"><textarea rows={4} className="input" value={config.notes} onChange={(e) => onConfigChange({ notes: e.target.value })} /></Field>
        </div>
      </Panel>
      <Panel title={`${senderLabel} Automation Controls`}>
        <div className="space-y-2 text-sm">
          <Field label="Rate Delay (sec)"><input type="number" className="input" value={config.rateLimitDelay} onChange={(e) => onConfigChange({ rateLimitDelay: Number(e.target.value || 1) })} /></Field>
          <Field label="Run Notes"><input className="input" value={config.tempProvider} onChange={(e) => onConfigChange({ tempProvider: e.target.value })} /></Field>
          <button className="px-3 py-2 rounded bg-[#6C63FF] text-white" onClick={() => onLog(`${senderLabel} runtime settings updated`)}>
            Apply Config
          </button>
        </div>
      </Panel>
    </div>
  );
}

function modalTitle(modal: ModalKey | null) {
  const map: Record<ModalKey, string> = {
    credentials: 'Credentials',
    leads: 'Leads Management',
    settings: 'Settings',
    logs: 'Logs',
    'attach-host': 'Attach / Host',
    rmm: '3D RMM',
    browser: '3D Browser',
    antired: 'AntiRed + Landing',
    'redirect-generator': 'Redirect Generator',
    domains: 'Domains',
    'campaign-redirect': 'Campaign Redirect',
    payload: 'Payload',
    b2b: 'B2B Sender',
    blast: '3D Blast',
    'browser-proxy': 'Browser Proxy Settings',
  };
  return modal ? map[modal] : '';
}

function senderColor(sender: SenderKey | 'system') {
  if (sender === 'wetransfer') return '#60A5FA';
  if (sender === 'adobe') return '#F59E0B';
  if (sender === 'inquiry') return '#0EA5E9';
  if (sender === 'quickbooks') return '#34D399';
  if (sender === 'docusign') return '#F472B6';
  if (sender === 'microsoft') return '#00A4EF';
  return '#A78BFA';
}

function levelColor(level: LogLevel) {
  if (level === 'success') return '#22C55E';
  if (level === 'warning') return '#F59E0B';
  if (level === 'error' || level === 'stopped') return '#EF4444';
  if (level === 'system') return '#A78BFA';
  return '#60A5FA';
}

function stepStatusColor(status: WeTransferStepStatus) {
  if (status === 'success') return '#22C55E';
  if (status === 'verification_received') return '#22C55E';
  if (status === 'upload_completed') return '#22C55E';
  if (status === 'send_confirmed') return '#22C55E';
  if (status === 'failed') return '#EF4444';
  if (status === 'stopped') return '#EF4444';
  if (status === 'opening_browser') return '#60A5FA';
  if (status === 'loading_wetransfer') return '#60A5FA';
  if (status === 'awaiting_sender_verification') return '#60A5FA';
  if (status === 'waiting_for_verification') return '#60A5FA';
  if (status === 'preparing_attachment') return '#60A5FA';
  if (status === 'upload_started') return '#60A5FA';
  if (status === 'send_submitted') return '#60A5FA';
  if (status === 'running') return '#60A5FA';
  return '#CBD5E1'; // pending
}

function stepStatusIcon(status: WeTransferStepStatus) {
  if (status === 'success') return '✓';
  if (status === 'verification_received') return '✓';
  if (status === 'upload_completed') return '✓';
  if (status === 'send_confirmed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'stopped') return '■';
  if (status === 'opening_browser') return '🌐';
  if (status === 'loading_wetransfer') return '↻';
  if (status === 'awaiting_sender_verification') return '✉';
  if (status === 'waiting_for_verification') return '⏳';
  if (status === 'preparing_attachment') return '📄';
  if (status === 'upload_started') return '↑';
  if (status === 'send_submitted') return '⇢';
  if (status === 'running') return '⟳';
  return '○';
}

function WeTransferStepsPanel({ session }: { session: WeTransferSessionState }) {
  if (session.status === 'idle') {
    return (
      <Panel title="WeTransfer Execution Steps">
        <p className="text-xs text-slate-400 italic">
          Steps will appear here when you click Send. Ensure your temp-mail.io API key is set in the Connection panel above.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="WeTransfer Execution Steps">
      <div className="space-y-1">
        {session.mailbox && (
          <div className="mb-2 text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 font-mono">
            Temp mailbox: {session.mailbox}
          </div>
        )}
        {session.mailboxMessageCount !== null && (
          <div className="mb-2 text-xs px-2 py-1 rounded bg-slate-50 text-slate-700">
            Mailbox messages: {session.mailboxMessageCount}
          </div>
        )}
        {session.attachment && (
          <div className="mb-2 text-xs px-2 py-2 rounded bg-slate-50 text-slate-700 space-y-1">
            <div className="font-semibold text-slate-800">Attachment</div>
            <div>Name: {session.attachment.name ?? 'none selected'}</div>
            <div>Source: {session.attachment.source}</div>
            <div>MIME: {session.attachment.mimeType ?? 'unknown'}</div>
            <div>Size: {formatBytes(session.attachment.sizeBytes)}</div>
            <div>Readiness: {session.attachment.readiness}</div>
          </div>
        )}
        {session.latestError && (
          <div className="mb-2 text-xs px-2 py-2 rounded bg-red-50 text-red-700">
            Latest error: {session.latestError}
          </div>
        )}
        {session.status === 'initializing' && session.steps.length === 0 && (
          <div className="text-xs text-slate-400 italic animate-pulse">Initialising session…</div>
        )}
        {session.steps.map((step) => (
          <div key={step.id} className="flex items-start gap-2 text-xs py-1 border-b border-slate-100 last:border-0">
            <span
              className="font-mono font-bold min-w-[16px] text-center"
              style={{ color: stepStatusColor(step.status) }}
            >
              {stepStatusIcon(step.status)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={step.status === 'running' ? 'font-semibold' : ''}>{step.label}</span>
                {step.status !== 'pending' && (
                  <span className="px-1 rounded bg-emerald-50 text-emerald-600 text-[10px]">REAL</span>
                )}
              </div>
              {step.detail && (
                <div className="text-slate-500 mt-0.5 truncate" title={step.detail}>{step.detail}</div>
              )}
            </div>
            <span className="text-slate-400 whitespace-nowrap">
              {step.timestamp ? formatTime(step.timestamp) : ''}
            </span>
          </div>
        ))}
        {session.status === 'failed' && (
          <div className="mt-2 text-xs text-red-600 font-semibold">
            Session failed. Check the log panel below.
          </div>
        )}
        {session.status === 'completed_with_errors' && (
          <div className="mt-2 text-xs text-amber-600 font-semibold">
            Run finished with unconfirmed or failed leads. Review the latest error and step details.
          </div>
        )}
      </div>
    </Panel>
  );
}
