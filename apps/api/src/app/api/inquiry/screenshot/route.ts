import { NextRequest, NextResponse } from 'next/server';
import { cleanInquirySessionId, getInquirySession } from '@/lib/inquiry-browser-store';
import { getInquiryLicenseId, getInquiryRunState } from '@/lib/inquiry-run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const licenseId = getInquiryLicenseId(request);
    const state = getInquiryRunState(licenseId);
    const requested = String(request.nextUrl.searchParams.get('sessionId') || '').trim();
    const rawSessionId = requested || String(state.sessionId || '').trim();

    if (!rawSessionId) {
      return NextResponse.json(
        { success: false, error: 'Inquiry browser is not open for this license.' },
        { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const sessionId = cleanInquirySessionId(rawSessionId);
    const session = await getInquirySession(sessionId, licenseId, false);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Inquiry browser is not open for this license.' },
        { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const image = await session.page.screenshot({
      type: 'jpeg',
      quality: 72,
      fullPage: false,
      animations: 'allow',
      caret: 'hide',
    });

    return new NextResponse(image, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'X-Inquiry-Session-Id': sessionId,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
