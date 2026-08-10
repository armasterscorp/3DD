import { NextRequest, NextResponse } from 'next/server';
import { startCampaign } from '@/lib/campaign-service';

/**
 * POST /api/campaigns/[id]/send - Start sending campaign
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await startCampaign(params.id);
    const payload = result.data;

    if (!payload.ok) {
      return NextResponse.json(
        { error: payload.message, errors: payload.errors },
        { status: payload.status, headers: { 'x-3d-suite-mode': result.mode } }
      );
    }

    return NextResponse.json(
      {
        message: payload.message,
        queuedLeads: payload.queued,
      },
      { headers: { 'x-3d-suite-mode': result.mode } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
