import { NextRequest, NextResponse } from 'next/server';
import { CaptchaStore } from '@/lib/captcha-store';

/**
 * GET /api/captcha/status?taskId=<taskId>
 * Get status of a specific captcha task
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

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // This would typically query for the captcha by taskId
    // For now, return a basic structure
    return NextResponse.json({
      taskId,
      message: 'Task status API endpoint ready for integration',
    });
  } catch (error: any) {
    console.error('[Captcha Status] GET error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
