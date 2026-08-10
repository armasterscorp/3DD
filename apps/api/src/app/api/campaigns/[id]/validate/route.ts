import { NextRequest, NextResponse } from 'next/server';
import { validateCampaign } from '@/lib/campaign-service';

/**
 * GET /api/campaigns/[id]/validate - Validate if campaign can be started
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await validateCampaign(params.id);
    const campaign = result.data;

    if (!campaign) {
      return NextResponse.json(
        {
          valid: false,
          errors: ['Campaign not found'],
          warnings: [],
        },
        { status: 404 }
      );
    }

    return NextResponse.json(campaign, {
      headers: { 'x-3d-suite-mode': result.mode },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        valid: false,
        errors: [error.message],
        warnings: [],
      },
      { status: 500 }
    );
  }
}
