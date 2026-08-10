import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      value?: string;
      size?: number;
      errorCorrectionLevel?: string;
    };

    const value = String(body.value || '').trim();
    if (!value) {
      return NextResponse.json(
        { success: false, error: 'QR value is required.' },
        { status: 400 }
      );
    }

    const size = Math.min(
      1024,
      Math.max(96, Math.floor(Number(body.size || 512)))
    );

    const rawLevel = String(body.errorCorrectionLevel || 'M').toUpperCase();
    const errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H' =
      rawLevel === 'L' || rawLevel === 'Q' || rawLevel === 'H'
        ? rawLevel
        : 'M';

    const dataUri = await QRCode.toDataURL(value, {
      type: 'image/png',
      errorCorrectionLevel,
      margin: 1,
      width: size,
    });

    return NextResponse.json({
      success: true,
      dataUri,
      size,
      errorCorrectionLevel,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
