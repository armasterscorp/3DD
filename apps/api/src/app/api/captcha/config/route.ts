import { NextRequest, NextResponse } from 'next/server';
import {
  resolveUserApiKey,
  setUserApiKey,
  TwoCaptchaSolver,
} from '@/lib/captcha-solver';
import { CaptchaStore } from '@/lib/captcha-store';

/**
 * GET /api/captcha/config
 * Get current captcha configuration
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

    const config = await CaptchaStore.getCaptchaConfig(userId);
    const effectiveApiKey = await resolveUserApiKey(userId);
    if (!config && !effectiveApiKey) {
      return NextResponse.json(
        { configured: false, isActive: false },
        { status: 200 }
      );
    }

    return NextResponse.json({
      configured: true,
      isActive: config?.isActive ?? true,
      lastTestAt: config?.lastTestAt,
      lastTestStatus: config?.lastTestStatus || 'success',
      testError: config?.testError,
      source: config?.apiKey ? 'dashboard' : 'environment',
    });
  } catch (error: any) {
    console.error('[Captcha Config] GET error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/captcha/config
 * Set/update 2Captcha API key
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

    const { apiKey } = await request.json();
    if (!apiKey || apiKey.trim().length === 0) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 }
      );
    }

    // Test the API key
    const solver = new TwoCaptchaSolver(apiKey);
    const testResult = await solver.testConnection();

    if (!testResult.success) {
      await CaptchaStore.updateTestStatus(
        userId,
        'failed',
        testResult.error
      );
      return NextResponse.json(
        { error: `Connection test failed: ${testResult.error}` },
        { status: 400 }
      );
    }

    // Save config
    const config = await CaptchaStore.saveCaptchaConfig(userId, apiKey);
    setUserApiKey(userId, apiKey);
    await CaptchaStore.updateTestStatus(userId, 'success');

    return NextResponse.json({
      success: true,
      message: 'Captcha config saved and tested successfully',
      isActive: config.isActive,
    });
  } catch (error: any) {
    console.error('[Captcha Config] POST error:', error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
