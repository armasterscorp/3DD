import { NextRequest, NextResponse } from 'next/server';
import {
  LICENSE_COOKIE_NAME,
  createLicenseSession,
  verifyLicenseKey,
} from '@/lib/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { licenseKey?: string };
    const licenseKey = String(body.licenseKey || '').trim();

    if (!licenseKey) {
      return NextResponse.json(
        { error: 'Enter a license key.' },
        { status: 400 }
      );
    }

    const license = verifyLicenseKey(licenseKey);
    const currentToken = request.cookies.get(LICENSE_COOKIE_NAME)?.value;
    const created = createLicenseSession(
      license,
      licenseKey,
      currentToken
    );

    const response = NextResponse.json({
      success: true,
      licenseId: created.session.licenseId,
      name: created.session.name,
      customer: created.session.customer || null,
      expiresAt: created.session.expiresAt,
      daysRemaining: created.session.daysRemaining,
      permanent: created.session.permanent,
    });

    response.cookies.set({
      name: LICENSE_COOKIE_NAME,
      value: created.token,
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(created.cookieExpiresAt * 1000),
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'License activation failed',
      },
      { status: 401 }
    );
  }
}
