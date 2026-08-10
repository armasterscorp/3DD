export type CloudflareRedirectConfig = {
  accountId: string;
  apiToken: string;
  namespaceId: string;
  publicBaseUrl: string;
};

export type RedirectRecord = {
  destination: string;
  statusCode: 301 | 302 | 307 | 308;
  createdAt: string;
  updatedAt: string;
};

const API_BASE = 'https://api.cloudflare.com/client/v4';

function encodeKey(key: string): string {
  return encodeURIComponent(key);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function validateCloudflareRedirectConfig(
  config: CloudflareRedirectConfig
): void {
  if (!config.accountId.trim()) throw new Error('Cloudflare Account ID is required');
  if (!config.apiToken.trim()) throw new Error('Cloudflare API Token is required');
  if (!config.namespaceId.trim()) throw new Error('Cloudflare KV Namespace ID is required');
  if (!config.publicBaseUrl.trim()) throw new Error('Public Worker URL is required');

  const parsed = new URL(config.publicBaseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Public Worker URL must use http or https');
  }
}

function headers(config: CloudflareRedirectConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.apiToken}`,
  };
}

async function cloudflareRequest(
  config: CloudflareRedirectConfig,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...headers(config),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });

  return response;
}

async function readCloudflareError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as {
      errors?: Array<{ message?: string }>;
      messages?: Array<{ message?: string }>;
    };
    return (
      parsed.errors?.map((item) => item.message).filter(Boolean).join('; ') ||
      parsed.messages?.map((item) => item.message).filter(Boolean).join('; ') ||
      text ||
      `HTTP ${response.status}`
    );
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

export async function putRedirect(
  config: CloudflareRedirectConfig,
  alias: string,
  record: RedirectRecord
): Promise<void> {
  validateCloudflareRedirectConfig(config);

  const response = await cloudflareRequest(
    config,
    `/accounts/${encodeURIComponent(config.accountId)}/storage/kv/namespaces/${encodeURIComponent(config.namespaceId)}/values/${encodeKey(alias)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: JSON.stringify(record),
    }
  );

  if (!response.ok) {
    throw new Error(`Cloudflare KV write failed: ${await readCloudflareError(response)}`);
  }
}

export async function getRedirect(
  config: CloudflareRedirectConfig,
  alias: string
): Promise<RedirectRecord | null> {
  validateCloudflareRedirectConfig(config);

  const response = await cloudflareRequest(
    config,
    `/accounts/${encodeURIComponent(config.accountId)}/storage/kv/namespaces/${encodeURIComponent(config.namespaceId)}/values/${encodeKey(alias)}`,
    { method: 'GET' }
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Cloudflare KV read failed: ${await readCloudflareError(response)}`);
  }

  const text = await response.text();

  try {
    const parsed = JSON.parse(text) as RedirectRecord;
    return parsed;
  } catch {
    return {
      destination: text,
      statusCode: 302,
      createdAt: '',
      updatedAt: '',
    };
  }
}

export async function deleteRedirect(
  config: CloudflareRedirectConfig,
  alias: string
): Promise<void> {
  validateCloudflareRedirectConfig(config);

  const response = await cloudflareRequest(
    config,
    `/accounts/${encodeURIComponent(config.accountId)}/storage/kv/namespaces/${encodeURIComponent(config.namespaceId)}/values/${encodeKey(alias)}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error(`Cloudflare KV delete failed: ${await readCloudflareError(response)}`);
  }
}

export async function listRedirects(
  config: CloudflareRedirectConfig
): Promise<Array<{
  alias: string;
  destination: string;
  statusCode: 301 | 302 | 307 | 308;
  createdAt?: string;
  updatedAt?: string;
  redirectUrl: string;
}>> {
  validateCloudflareRedirectConfig(config);

  const response = await cloudflareRequest(
    config,
    `/accounts/${encodeURIComponent(config.accountId)}/storage/kv/namespaces/${encodeURIComponent(config.namespaceId)}/keys?limit=1000`,
    { method: 'GET' }
  );

  if (!response.ok) {
    throw new Error(`Cloudflare KV list failed: ${await readCloudflareError(response)}`);
  }

  const payload = (await response.json()) as {
    result?: Array<{ name: string }>;
  };

  const keys = Array.isArray(payload.result) ? payload.result : [];
  const baseUrl = normalizeBaseUrl(config.publicBaseUrl);

  const records = await Promise.all(
    keys.slice(0, 200).map(async ({ name }) => {
      try {
        const record = await getRedirect(config, name);
        if (!record) return null;

        return {
          alias: name,
          destination: record.destination,
          statusCode: record.statusCode || 302,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          redirectUrl: `${baseUrl}/${encodeURIComponent(name)}`,
        };
      } catch {
        return null;
      }
    })
  );

  return records
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) =>
      String(b.updatedAt || b.createdAt || '').localeCompare(
        String(a.updatedAt || a.createdAt || '')
      )
    );
}

export function buildRedirectUrl(
  config: CloudflareRedirectConfig,
  alias: string
): string {
  return `${normalizeBaseUrl(config.publicBaseUrl)}/${encodeURIComponent(alias)}`;
}