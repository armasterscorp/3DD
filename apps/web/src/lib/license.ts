import crypto from 'crypto';
import {
  claimLicenseSession,
  getStoredLicenseSession,
  releaseLicenseSession,
  touchStoredLicenseSession,
} from './license-session-store';

export const LICENSE_COOKIE_NAME = '3d_suite_license';
const LICENSE_PREFIX = '3DS1';
const SESSION_PREFIX = '3DSS1';

// PUBLIC verification key. It is intentionally safe to ship with the app.
// It cannot create valid licences without your private Ed25519 key.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7l1esHtIeBQ3Oxt3umrVbY0OZpW9JmyAt7y7eurUxIw=
-----END PUBLIC KEY-----`;

const REVOKED_LICENSE_IDS = new Set<string>([
  // 'example-license-id',
]);

// Browsers cap very long-lived cookies. We refresh this cookie whenever the
// licence status is checked, while the signed licence itself remains valid.
export const REMEMBER_COOKIE_DAYS = 400;

export type LicensePayload = {
  v: 1;
  id: string;
  name?: string;
  customer?: string;
  product?: string;
  issuedAt?: number;
  exp?: number | null;
};

export type LicenseSession = {
  licenseId: string;
  sessionId: string;
  name: string;
  customer?: string;
  issuedAt?: number;
  expiresAt: number | null;
  daysRemaining: number | null;
  permanent: boolean;
  licenseKey: string;
};

type BrowserSessionToken = {
  sid: string;
  key: string;
};

function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function encodeBrowserToken(value: BrowserSessionToken): string {
  return `${SESSION_PREFIX}.${Buffer.from(
    JSON.stringify(value),
    'utf8'
  ).toString('base64url')}`;
}

function decodeBrowserToken(token: string): BrowserSessionToken | null {
  try {
    const [prefix, encoded] = String(token || '').split('.');
    if (prefix !== SESSION_PREFIX || !encoded) return null;
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as BrowserSessionToken;
    if (!parsed.sid || !parsed.key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isRevoked(licenseId: string): boolean {
  return REVOKED_LICENSE_IDS.has(licenseId);
}

function calculateDaysRemaining(exp?: number | null): number | null {
  if (!exp) return null;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, Math.ceil((exp - now) / 86400));
}

export function verifyLicenseKey(key: string): LicensePayload {
  const normalized = String(key || '').trim();
  const parts = normalized.split('.');

  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    throw new Error('Invalid license format');
  }

  const [, encodedPayload, encodedSignature] = parts;
  const signedValue = Buffer.from(
    `${LICENSE_PREFIX}.${encodedPayload}`,
    'utf8'
  );

  let signature: Buffer;
  try {
    signature = fromB64url(encodedSignature);
  } catch {
    throw new Error('Invalid license signature');
  }

  let valid = false;
  try {
    valid = crypto.verify(
      null,
      signedValue,
      LICENSE_PUBLIC_KEY,
      signature
    );
  } catch {
    valid = false;
  }

  if (!valid) throw new Error('Invalid license signature');

  let payload: LicensePayload;
  try {
    payload = JSON.parse(
      fromB64url(encodedPayload).toString('utf8')
    ) as LicensePayload;
  } catch {
    throw new Error('Invalid license payload');
  }

  if (payload.v !== 1 || !payload.id) {
    throw new Error('Invalid license payload');
  }

  if (payload.product && payload.product !== '3D-SUITE') {
    throw new Error('License is not valid for 3D Suite');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp <= now) {
    throw new Error('License has expired');
  }

  if (isRevoked(payload.id)) {
    throw new Error('License has been revoked');
  }

  return payload;
}

export function createLicenseSession(
  payload: LicensePayload,
  originalLicenseKey: string,
  currentBrowserToken?: string | null
): { token: string; cookieExpiresAt: number; session: LicenseSession } {
  let existingSessionId: string | null = null;

  if (currentBrowserToken) {
    const current = decodeBrowserToken(currentBrowserToken);
    if (current) {
      try {
        const currentLicense = verifyLicenseKey(current.key);
        if (currentLicense.id === payload.id) {
          existingSessionId = current.sid;
        }
      } catch {
        existingSessionId = null;
      }
    }
  }

  const stored = claimLicenseSession({
    licenseId: payload.id,
    customer: payload.name || payload.customer,
    expiresAt: payload.exp ?? null,
    existingSessionId,
  });

  const now = Math.floor(Date.now() / 1000);
  const browserRememberUntil =
    now + REMEMBER_COOKIE_DAYS * 24 * 60 * 60;

  const cookieExpiresAt = payload.exp
    ? Math.min(payload.exp, browserRememberUntil)
    : browserRememberUntil;

  const name = payload.name || payload.customer || 'Licensed User';

  return {
    token: encodeBrowserToken({
      sid: stored.sessionId,
      key: originalLicenseKey.trim(),
    }),
    cookieExpiresAt,
    session: {
      licenseId: payload.id,
      sessionId: stored.sessionId,
      name,
      customer: payload.customer,
      issuedAt: payload.issuedAt,
      expiresAt: payload.exp ?? null,
      daysRemaining: calculateDaysRemaining(payload.exp),
      permanent: !payload.exp,
      licenseKey: originalLicenseKey.trim(),
    },
  };
}

export function verifyLicenseSession(
  token?: string | null,
  options: { touch?: boolean } = {}
): LicenseSession | null {
  if (!token) return null;

  const decoded = decodeBrowserToken(token);
  if (!decoded) return null;

  try {
    const payload = verifyLicenseKey(decoded.key);
    const stored = getStoredLicenseSession(payload.id);

    if (!stored || stored.sessionId !== decoded.sid) {
      return null;
    }

    if (options.touch) {
      touchStoredLicenseSession(payload.id, decoded.sid);
    }

    return {
      licenseId: payload.id,
      sessionId: decoded.sid,
      name: payload.name || payload.customer || 'Licensed User',
      customer: payload.customer,
      issuedAt: payload.issuedAt,
      expiresAt: payload.exp ?? null,
      daysRemaining: calculateDaysRemaining(payload.exp),
      permanent: !payload.exp,
      licenseKey: decoded.key,
    };
  } catch {
    return null;
  }
}

export function logoutLicenseSession(token?: string | null): void {
  if (!token) return;
  const decoded = decodeBrowserToken(token);
  if (!decoded) return;

  try {
    const payload = verifyLicenseKey(decoded.key);
    releaseLicenseSession(payload.id, decoded.sid);
  } catch {
    // Still clear the browser cookie in the route.
  }
}
