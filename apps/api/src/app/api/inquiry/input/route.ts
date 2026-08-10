import { NextRequest, NextResponse } from 'next/server';
import { cleanInquirySessionId, getInquirySession } from '@/lib/inquiry-browser-store';
import { getInquiryLicenseId } from '@/lib/inquiry-run-store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const licenseId = getInquiryLicenseId(request);
    const body = await request.json();
    const sessionId = cleanInquirySessionId(body.sessionId);
    const session = await getInquirySession(sessionId, licenseId, false);
    if (!session) throw new Error('Inquiry browser is not open.');
    const page = session.page;
    if (body.type === 'click') await page.mouse.click(Number(body.x), Number(body.y));
    else if (body.type === 'dblclick') await page.mouse.dblclick(Number(body.x), Number(body.y));
    else if (body.type === 'scroll') await page.mouse.wheel(Number(body.deltaX || 0), Number(body.deltaY || 0));
    else if (body.type === 'key') await page.keyboard.press(String(body.key || ''));
    else if (body.type === 'text') await page.keyboard.insertText(String(body.text || ''));
    else if (body.type === 'back') await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    else if (body.type === 'forward') await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => null);
    else if (body.type === 'reload') await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
    else throw new Error('Unsupported input action.');
    return NextResponse.json({ success: true, currentUrl: page.url() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
