import { NextRequest, NextResponse } from 'next/server';
import {
  LICENSE_COOKIE_NAME,
  verifyLicenseSession,
} from '@/lib/license';

const DEFAULT_API_URL = 'http://localhost:7201';

function getApiBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  return configuredUrl || DEFAULT_API_URL;
}

async function proxyRequest(
  request: NextRequest,
  context: { params: { path: string[] } }
) {
  const licenseKey = request.cookies.get(LICENSE_COOKIE_NAME)?.value;
  // High-frequency Inquiry screenshot/results polling must not rewrite the
  // license-session file on every request. Touching on every poll caused
  // unnecessary Windows filesystem contention and intermittent false 401s.
  const license = verifyLicenseSession(licenseKey, { touch: false });

  if (!license) {
    return NextResponse.json(
      { error: 'License required', code: 'LICENSE_REQUIRED' },
      { status: 401 }
    );
  }

  const apiBaseUrl = getApiBaseUrl();
  const joinedPath = context.params.path.join('/');
  const targetUrl = `${apiBaseUrl}/api/${joinedPath}${request.nextUrl.search}`;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('host');
  requestHeaders.delete('connection');
  requestHeaders.delete('content-length');
  requestHeaders.delete('cookie');

  // Useful for API logs/debugging. This is not a secret and is never trusted
  // as a replacement for the web-side Ed25519 verification.
  requestHeaders.set('x-3d-suite-license-id', license.licenseId);
  requestHeaders.set('x-user-id', license.licenseId);

  const shouldIncludeBody =
    request.method !== 'GET' && request.method !== 'HEAD';

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: requestHeaders,
      body: shouldIncludeBody ? request.body : undefined,
      // Required by Node fetch when streaming a request body.
      ...(shouldIncludeBody ? { duplex: 'half' as any } : {}),
      cache: 'no-store',
    } as RequestInit);

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');

    if (!responseHeaders.has('cache-control')) {
      responseHeaders.set(
        'cache-control',
        'no-cache, no-store, no-transform'
      );
    }

    // Forward the body directly so live SMTP/send progress is not buffered.
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'API service unavailable',
        details: error?.message || 'Failed to reach backend API',
        target: targetUrl,
      },
      { status: 503 }
    );
  }
}

export { proxyRequest as GET };
export { proxyRequest as POST };
export { proxyRequest as PATCH };
export { proxyRequest as PUT };
export { proxyRequest as DELETE };
