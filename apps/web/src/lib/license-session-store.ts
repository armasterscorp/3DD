import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type StoredLicenseSession = {
  licenseId: string;
  sessionId: string;
  customer?: string;
  activatedAt: number;
  lastSeenAt: number;
  expiresAt?: number | null;
};

type SessionStore = Record<string, StoredLicenseSession>;

const DATA_DIR = path.join(process.cwd(), '.3dsuite-data');
const STORE_FILE = path.join(DATA_DIR, 'license-sessions.json');

function ensureStoreDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function sleepSync(ms: number) {
  // Only used after a real filesystem error. A tiny retry prevents a transient
  // Windows read/rename collision from being interpreted as "License required".
  try {
    const waitBuffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(waitBuffer), 0, 0, ms);
  } catch {}
}

function readStore(): SessionStore {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      if (!fs.existsSync(STORE_FILE)) {
        if (attempt < 3) {
          sleepSync(4 * (attempt + 1));
          continue;
        }
        return {};
      }
      const raw = fs.readFileSync(STORE_FILE, 'utf8').trim();
      return raw ? (JSON.parse(raw) as SessionStore) : {};
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        sleepSync(5 * (attempt + 1));
        continue;
      }
    }
  }
  console.warn('[license-session-store] read failed after retries', lastError);
  return {};
}

function writeStore(store: SessionStore) {
  ensureStoreDir();
  const nonce = crypto.randomBytes(6).toString('hex');
  const temp = `${STORE_FILE}.${process.pid}.${Date.now()}.${nonce}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(temp, STORE_FILE);
}

function pruneExpired(store: SessionStore): boolean {
  const now = Math.floor(Date.now() / 1000);
  let changed = false;

  for (const [licenseId, session] of Object.entries(store)) {
    if (session.expiresAt && session.expiresAt <= now) {
      delete store[licenseId];
      changed = true;
    }
  }

  return changed;
}

export function getStoredLicenseSession(
  licenseId: string
): StoredLicenseSession | null {
  const store = readStore();
  if (pruneExpired(store)) writeStore(store);
  return store[licenseId] || null;
}

export function claimLicenseSession(args: {
  licenseId: string;
  customer?: string;
  expiresAt?: number | null;
  existingSessionId?: string | null;
}): StoredLicenseSession {
  const store = readStore();
  pruneExpired(store);

  const current = store[args.licenseId];

  // The same browser may re-activate/refresh its own licence.
  if (
    current &&
    args.existingSessionId &&
    current.sessionId === args.existingSessionId
  ) {
    current.lastSeenAt = Math.floor(Date.now() / 1000);
    current.customer = args.customer || current.customer;
    current.expiresAt = args.expiresAt ?? current.expiresAt ?? null;
    store[args.licenseId] = current;
    writeStore(store);
    return current;
  }

  if (current) {
    throw new Error(
      'This license is already active in another browser. Log out from that browser first, or ask the administrator to release the active session.'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const created: StoredLicenseSession = {
    licenseId: args.licenseId,
    sessionId: crypto.randomBytes(24).toString('hex'),
    customer: args.customer,
    activatedAt: now,
    lastSeenAt: now,
    expiresAt: args.expiresAt ?? null,
  };

  store[args.licenseId] = created;
  writeStore(store);
  return created;
}

export function touchStoredLicenseSession(
  licenseId: string,
  sessionId: string
): boolean {
  const store = readStore();
  if (pruneExpired(store)) writeStore(store);

  const current = store[licenseId];
  if (!current || current.sessionId !== sessionId) return false;

  current.lastSeenAt = Math.floor(Date.now() / 1000);
  store[licenseId] = current;
  writeStore(store);
  return true;
}

export function releaseLicenseSession(
  licenseId: string,
  sessionId: string
): boolean {
  const store = readStore();
  const current = store[licenseId];

  if (!current || current.sessionId !== sessionId) return false;

  delete store[licenseId];
  writeStore(store);
  return true;
}

export function forceReleaseLicenseSession(licenseId: string): boolean {
  const store = readStore();
  if (!store[licenseId]) return false;
  delete store[licenseId];
  writeStore(store);
  return true;
}

export function getLicenseSessionStorePath(): string {
  return STORE_FILE;
}
