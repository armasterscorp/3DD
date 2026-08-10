import { NextRequest, NextResponse } from 'next/server';
import { clearInquiryCaptchaResults, clearInquiryReviewResults, getInquiryLicenseId, getInquiryResults } from '@/lib/inquiry-run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const licenseId = getInquiryLicenseId(request);
    const runId = request.nextUrl.searchParams.get('runId') || undefined;
    return NextResponse.json({ success: true, ...getInquiryResults(licenseId, runId) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const licenseId = getInquiryLicenseId(request);
    const type = request.nextUrl.searchParams.get('type') || 'captcha';
    const cleared = type === 'review' ? clearInquiryReviewResults(licenseId) : clearInquiryCaptchaResults(licenseId);
    return NextResponse.json({ success: true, type, cleared });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
