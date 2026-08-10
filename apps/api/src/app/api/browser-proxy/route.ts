import { NextRequest, NextResponse } from 'next/server';
import {
  getBrowserProxyConfigLocal,
  setBrowserProxyConfigLocal,
} from '@/lib/local-store';
import type { BrowserProxyConfig } from '@/lib/browser-proxy-types';
import {
  getBrowserProxyDiagnostics,
  validateBrowserProxyConfig,
} from '@/lib/browser-proxy';

type BrowserProxyGetResponse = {
  enabled: boolean;
  protocol: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
};

type BrowserProxyPutResponse = {
  success: boolean;
  enabled: boolean;
  protocol: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  error?: string;
};

/**
 * GET /api/browser-proxy
 *
 * Returns the current browser proxy configuration.
 * The password is never returned; hasPassword indicates whether one is stored.
 */
export function GET(): NextResponse {
  const config = getBrowserProxyConfigLocal();

  if (!config) {
    const defaultResponse: BrowserProxyGetResponse = {
      enabled: false,
      protocol: 'http',
      host: '',
      port: 8080,
      username: '',
      hasPassword: false,
    };
    return NextResponse.json(defaultResponse);
  }

  const response: BrowserProxyGetResponse = {
    enabled: config.enabled,
    protocol: config.protocol,
    host: config.host,
    port: config.port,
    username: config.username,
    hasPassword: Boolean(config.password),
  };
  return NextResponse.json(response);
}

/**
 * PUT /api/browser-proxy
 *
 * Saves browser proxy configuration.
 * Validates required fields when proxy is enabled.
 * If `password` is omitted from the body and a previous password exists, it is preserved.
 *
 * Body: {
 *   enabled: boolean;
 *   protocol: 'http' | 'socks5';
 *   host: string;
 *   port: number;
 *   username?: string;
 *   password?: string;   // omit to preserve existing password
 * }
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const enabled = Boolean(body.enabled);
  const protocol = body.protocol === 'socks5' ? 'socks5' : 'http';
  const host = String(body.host ?? '').trim();
  const rawPort = Number(body.port);
  const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort <= 65535 ? Math.floor(rawPort) : 8080;
  const username = String(body.username ?? '').trim();

  // Only update the password if explicitly provided in the request body
  const existing = getBrowserProxyConfigLocal();
  const password =
    typeof body.password === 'string'
      ? body.password
      : (existing?.password ?? '');

  if (enabled) {
    if (!host) {
      return NextResponse.json(
        { error: 'Proxy host is required when proxy is enabled' },
        { status: 400 }
      );
    }
    if (port <= 0 || port > 65535) {
      return NextResponse.json(
        { error: 'Proxy port must be between 1 and 65535' },
        { status: 400 }
      );
    }
  }

  const config: BrowserProxyConfig = { enabled, protocol, host, port, username, password };
  const validationError = validateBrowserProxyConfig(config);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  setBrowserProxyConfigLocal(config);

  const response: BrowserProxyPutResponse = {
    success: true,
    enabled: config.enabled,
    protocol: config.protocol,
    host: config.host,
    port: config.port,
    username: config.username,
    hasPassword: Boolean(config.password),
  };

  console.log(
    `[browser-proxy] config updated: ${getBrowserProxyDiagnostics(
      config,
      'browser-proxy-config',
      'PUT /api/browser-proxy'
    )}`
  );

  return NextResponse.json(response);
}
