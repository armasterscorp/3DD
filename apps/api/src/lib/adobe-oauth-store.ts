export type AdobePendingOAuth = {
  state: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  dolphinProfileId: number;
  createdAt: number;
};

export type AdobeConnection = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  apiAccessPoint: string;
  webAccessPoint: string;
  connectedAt: string;
  email?: string | null;
  userName?: string | null;
};

type AdobeOAuthStore = {
  pending: Map<string, AdobePendingOAuth>;
  connection: AdobeConnection | null;
};

declare global {
  var __threeDSuiteAdobeOAuthStore: AdobeOAuthStore | undefined;
}

export function getAdobeOAuthStore(): AdobeOAuthStore {
  if (!globalThis.__threeDSuiteAdobeOAuthStore) {
    globalThis.__threeDSuiteAdobeOAuthStore = {
      pending: new Map(),
      connection: null,
    };
  }
  return globalThis.__threeDSuiteAdobeOAuthStore;
}

export function cleanupExpiredAdobeOAuthStates(): void {
  const store = getAdobeOAuthStore();
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [state, pending] of store.pending.entries()) {
    if (pending.createdAt < cutoff) store.pending.delete(state);
  }
}
