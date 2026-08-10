import { NextRequest, NextResponse } from 'next/server';
import {
  LICENSE_COOKIE_NAME,
  logoutLicenseSession,
} from '@/lib/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(LICENSE_COOKIE_NAME)?.value;
  logoutLicenseSession(token);

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: LICENSE_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(0),
  });

  return response;
}
