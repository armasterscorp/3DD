import { NextRequest, NextResponse } from 'next/server';
import {
  LICENSE_COOKIE_NAME,
  REMEMBER_COOKIE_DAYS,
  verifyLicenseSession,
} from '@/lib/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(LICENSE_COOKIE_NAME)?.value;
  const session = verifyLicenseSession(token, { touch: true });

  if (!session || !token) {
    return NextResponse.json({ licensed: false }, { status: 401 });
  }

  const response = NextResponse.json({
    licensed: true,
    licenseId: session.licenseId,
    name: session.name,
    customer: session.customer || null,
    issuedAt: session.issuedAt || null,
    expiresAt: session.expiresAt,
    daysRemaining: session.daysRemaining,
    permanent: session.permanent,
  });

  const now = Math.floor(Date.now() / 1000);
  const rememberUntil = now + REMEMBER_COOKIE_DAYS * 86400;
  const cookieExpiresAt = session.expiresAt
    ? Math.min(session.expiresAt, rememberUntil)
    : rememberUntil;

  // Refresh the browser remember period. It still can never outlive a dated licence.
  response.cookies.set({
    name: LICENSE_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(cookieExpiresAt * 1000),
  });

  return response;
}
