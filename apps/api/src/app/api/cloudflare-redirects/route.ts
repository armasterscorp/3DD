import { NextRequest, NextResponse } from 'next/server';
import {
  buildRedirectUrl,
  CloudflareRedirectConfig,
  deleteRedirect,
  getRedirect,
  listRedirects,
  putRedirect,
  RedirectRecord,
  validateCloudflareRedirectConfig,
} from '@/lib/cloudflare-redirects';

export const dynamic = 'force-dynamic';

function getConfig(request: NextRequest): CloudflareRedirectConfig {
  return {
    accountId:
      request.headers.get('x-cf-account-id') ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      '',
    apiToken:
      request.headers.get('x-cf-api-token') ||
      process.env.CLOUDFLARE_API_TOKEN ||
      '',
    namespaceId:
      request.headers.get('x-cf-kv-namespace-id') ||
      process.env.CLOUDFLARE_KV_NAMESPACE_ID ||
      '',
    publicBaseUrl:
      request.headers.get('x-cf-public-base-url') ||
      process.env.CLOUDFLARE_REDIRECT_BASE_URL ||
      '',
  };
}

function normalizeAlias(value: unknown): string {
  const alias = String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!/^[A-Za-z0-9_-]{1,80}$/.test(alias)) {
    throw new Error(
      'Alias may contain only letters, numbers, hyphens, and underscores.'
    );
  }

  return alias;
}

function validateDestination(value: unknown): string {
  const destination = String(value || '').trim();
  const parsed = new URL(destination);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Destination URL must use http or https.');
  }

  return destination;
}

function normalizeStatusCode(value: unknown): 301 | 302 | 307 | 308 {
  const status = Number(value);
  if ([301, 302, 307, 308].includes(status)) {
    return status as 301 | 302 | 307 | 308;
  }
  return 302;
}

export async function GET(request: NextRequest) {
  try {
    const config = getConfig(request);
    validateCloudflareRedirectConfig(config);
    const redirects = await listRedirects(config);

    return NextResponse.json({
      success: true,
      redirects,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const config = getConfig(request);
    validateCloudflareRedirectConfig(config);

    const body = await request.json();
    const alias = normalizeAlias(body.alias);
    const destination = validateDestination(body.destination);
    const statusCode = normalizeStatusCode(body.statusCode);

    const existing = await getRedirect(config, alias);
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: `Alias "${alias}" already exists.`,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const record: RedirectRecord = {
      destination,
      statusCode,
      createdAt: now,
      updatedAt: now,
    };

    await putRedirect(config, alias, record);

    return NextResponse.json({
      success: true,
      redirect: {
        alias,
        ...record,
        redirectUrl: buildRedirectUrl(config, alias),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const config = getConfig(request);
    validateCloudflareRedirectConfig(config);

    const body = await request.json();
    const alias = normalizeAlias(body.alias);
    const newAlias = normalizeAlias(body.newAlias || alias);
    const destination = validateDestination(body.destination);
    const statusCode = normalizeStatusCode(body.statusCode);

    const existing = await getRedirect(config, alias);
    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: `Alias "${alias}" does not exist.`,
        },
        { status: 404 }
      );
    }

    if (newAlias !== alias) {
      const collision = await getRedirect(config, newAlias);
      if (collision) {
        return NextResponse.json(
          {
            success: false,
            error: `Alias "${newAlias}" already exists.`,
          },
          { status: 409 }
        );
      }
    }

    const record: RedirectRecord = {
      destination,
      statusCode,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await putRedirect(config, newAlias, record);

    if (newAlias !== alias) {
      await deleteRedirect(config, alias);
    }

    return NextResponse.json({
      success: true,
      redirect: {
        alias: newAlias,
        ...record,
        redirectUrl: buildRedirectUrl(config, newAlias),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const config = getConfig(request);
    validateCloudflareRedirectConfig(config);

    const alias = normalizeAlias(
      new URL(request.url).searchParams.get('alias')
    );

    await deleteRedirect(config, alias);

    return NextResponse.json({
      success: true,
      alias,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}