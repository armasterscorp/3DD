import { NextRequest, NextResponse } from 'next/server';
import { stopCampaign } from '@/lib/campaign-service';

interface StopResponse {
  success: boolean;
  message: string;
  jobsStopped: number;
}

/**
 * POST /api/campaigns/[id]/stop - Stop sending campaign
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<StopResponse>> {
  try {
    const result = await stopCampaign(params.id);
    const payload = result.data;
    return NextResponse.json(
      {
        success: payload.ok,
        message: payload.message,
        jobsStopped: payload.jobsStopped,
      },
      {
        status: payload.status,
        headers: { 'x-3d-suite-mode': result.mode },
      }
    );
  } catch (error: any) {
    console.error(`[CAMPAIGN STOP ERROR] ${error.message}`);
    return NextResponse.json(
      {
        success: false,
        message: error.message,
        jobsStopped: 0,
      },
      { status: 500 }
    );
  }
}
