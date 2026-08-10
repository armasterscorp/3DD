import { NextRequest, NextResponse } from 'next/server';
import { cleanInquirySessionId, closeInquirySession } from '@/lib/inquiry-browser-store';
import { getInquiryLicenseId } from '@/lib/inquiry-run-store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const licenseId = getInquiryLicenseId(request);
    const body = await request.json();
    const sessionId = cleanInquirySessionId(body.sessionId);
    await closeInquirySession(sessionId, licenseId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
