import { NextRequest, NextResponse } from 'next/server';
import { startCampaign } from '@/lib/campaign-service';

interface StartResponse {
  success: boolean;
  message: string;
  queued: number;
  errors?: string[];
}

/**
 * POST /api/campaigns/[id]/start - Start sending campaign (with validation)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<StartResponse>> {
  try {
    const result = await startCampaign(params.id);
    const payload = result.data;

    return NextResponse.json(
      {
        success: payload.ok,
        message: payload.message,
        queued: payload.queued,
        errors: payload.errors,
      },
      {
        status: payload.status,
        headers: { 'x-3d-suite-mode': result.mode },
      }
    );
  } catch (error: any) {
    console.error(`[CAMPAIGN START ERROR] Unexpected error:`, error);
    return NextResponse.json(
      {
        success: false,
        message: `Error starting campaign: ${error.message}`,
        queued: 0,
        errors: [error.message],
      },
      { status: 500 }
    );
  }
}
