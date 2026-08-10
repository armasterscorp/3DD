import { NextRequest, NextResponse } from 'next/server';
import type { BrowserProxyConfig } from '@/lib/browser-proxy-types';
import {
  getBrowserProxyDiagnostics,
  validateBrowserProxyConfig,
} from '@/lib/browser-proxy';
import { getBrowserProxyConfigLocal } from '@/lib/local-store';
import { probeWeTransferWebsite } from '@/lib/wetransfer';

type BrowserProxyTestResponse = {
  success?: boolean;
  message?: string;
  diagnostics?: string;
  error?: string;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const existing = getBrowserProxyConfigLocal();
  const config: BrowserProxyConfig = {
    enabled: Boolean(body.enabled),
    protocol: body.protocol === 'socks5' ? 'socks5' : 'http',
    host: String(body.host ?? '').trim(),
    port: Number.isFinite(Number(body.port)) ? Math.floor(Number(body.port)) : 8080,
    username: String(body.username ?? '').trim(),
    password: typeof body.password === 'string' ? body.password : (existing?.password ?? ''),
  };

  if (!config.enabled) {
    return NextResponse.json(
      {
        success: false,
        error: 'Enable the browser proxy before testing it.',
        diagnostics: getBrowserProxyDiagnostics(
          config,
          'launchWeTransferBrowser',
          'POST /api/browser-proxy/test'
        ),
      } satisfies BrowserProxyTestResponse,
      { status: 400 }
    );
  }

  const validationError = validateBrowserProxyConfig(config);
  if (validationError) {
    return NextResponse.json(
      { success: false, error: validationError } satisfies BrowserProxyTestResponse,
      { status: 400 }
    );
  }

  const diagnostics = getBrowserProxyDiagnostics(
    config,
    'launchWeTransferBrowser',
    'POST /api/browser-proxy/test'
  );
  console.log(`[browser-proxy/test] ${diagnostics}`);

  const result = await probeWeTransferWebsite(undefined, config, 'browser-proxy-test');
  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        error: result.error || 'Proxy test failed',
        diagnostics,
      } satisfies BrowserProxyTestResponse,
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Proxy test succeeded. WeTransfer login page is reachable through the configured proxy.',
    diagnostics,
  } satisfies BrowserProxyTestResponse);
}
