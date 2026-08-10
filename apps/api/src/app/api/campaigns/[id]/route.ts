import { NextRequest, NextResponse } from 'next/server';
import {
  deleteCampaign,
  getCampaignById,
  updateCampaign,
} from '@/lib/campaign-service';

/**
 * GET /api/campaigns/[id] - Get campaign details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await getCampaignById(params.id);
    const campaign = result.data;

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(campaign, {
      headers: { 'x-3d-suite-mode': result.mode },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/campaigns/[id] - Update campaign
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { name, description, status } = body;

    const result = await updateCampaign(params.id, { name, description, status });
    const campaign = result.data;

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(campaign, {
      headers: { 'x-3d-suite-mode': result.mode },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/campaigns/[id] - Delete campaign
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await deleteCampaign(params.id);
    if (!result.data) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: true },
      { headers: { 'x-3d-suite-mode': result.mode } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
