import { NextRequest, NextResponse } from 'next/server';
import { CaptchaStore } from '@/lib/captcha-store';

/**
 * POST /api/captcha/clear
 * Clear all captchas for current user
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const result = await CaptchaStore.clearUserCaptchaQueue(userId);

    return NextResponse.json({
      success: true,
      message: `Cleared ${result.count || 0} captchas from queue`,
    });
  } catch (error: any) {
    console.error('[Captcha Clear] POST error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
