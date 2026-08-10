import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type GmailPendingOAuth = {
  state: string;
  profileDirectory: string;
  extensionPath?: string | null;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  chromiumUserDataDir?: string | null;
  chromiumExecutablePath?: string | null;
  createdAt: number;
};

export type GmailConnection = {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  connectedAt: string;
  profileDirectory?: string | null;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
};

type PersistedStore = {
  connections: GmailConnection[];
};

type RuntimeStore = {
  pending: Map<string, GmailPendingOAuth>;
};

declare global {
  var __threeDSuiteGmailRuntimeStore: RuntimeStore | undefined;
}

function runtimeStore(): RuntimeStore {
  if (!globalThis.__threeDSuiteGmailRuntimeStore) {
    globalThis.__threeDSuiteGmailRuntimeStore = {
      pending: new Map(),
    };
  }
  return globalThis.__threeDSuiteGmailRuntimeStore;
}

export function gmailPendingStore() {
  return runtimeStore().pending;
}

function storePath(): string {
  return (
    process.env.GMAIL_CONNECTION_STORE ||
    path.join(os.homedir(), '.3d-suite', 'gmail-connections.json')
  );
}

export async function readGmailConnections(): Promise<GmailConnection[]> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as PersistedStore;
    return Array.isArray(parsed.connections) ? parsed.connections : [];
  } catch {
    return [];
  }
}

export async function writeGmailConnections(
  connections: GmailConnection[]
): Promise<void> {
  const target = storePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    JSON.stringify({ connections } satisfies PersistedStore, null, 2),
    'utf8'
  );
}

export async function upsertGmailConnection(
  connection: GmailConnection
): Promise<void> {
  const connections = await readGmailConnections();
  const next = connections.filter(
    (item) => item.email.toLowerCase() !== connection.email.toLowerCase()
  );
  next.push(connection);
  await writeGmailConnections(next);
}

export async function removeGmailConnection(email: string): Promise<void> {
  const connections = await readGmailConnections();
  await writeGmailConnections(
    connections.filter(
      (item) => item.email.toLowerCase() !== email.toLowerCase()
    )
  );
}

export function cleanupExpiredGmailPending(): void {
  const cutoff = Date.now() - 15 * 60 * 1000;
  const pending = gmailPendingStore();
  for (const [state, item] of pending.entries()) {
    if (item.createdAt < cutoff) pending.delete(state);
  }
}
