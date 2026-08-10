import { NextRequest, NextResponse } from 'next/server';
import { CaptchaStore } from '@/lib/captcha-store';

/**
 * GET /api/captcha/queue
 * Get captcha queue for current user
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const queue = await CaptchaStore.getUserCaptchaQueue(userId);
    const stats = {
      total: queue.length,
      pending: queue.filter((c) => c.status === 'pending').length,
      solving: queue.filter((c) => c.status === 'solving').length,
      solved: queue.filter((c) => c.status === 'solved').length,
      failed: queue.filter((c) => c.status === 'failed').length,
    };

    return NextResponse.json({
      items: queue,
      stats,
    });
  } catch (error: any) {
    console.error('[Captcha Queue] GET error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/captcha/queue?id=<id>
 * Remove specific captcha from queue
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Captcha ID is required' },
        { status: 400 }
      );
    }

    await CaptchaStore.deleteCaptcha(id);

    return NextResponse.json({
      success: true,
      message: 'Captcha removed from queue',
    });
  } catch (error: any) {
    console.error('[Captcha Queue] DELETE error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
