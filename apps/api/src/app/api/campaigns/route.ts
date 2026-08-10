import { NextRequest, NextResponse } from 'next/server';
import { createCampaign, listCampaigns } from '@/lib/campaign-service';

/**
 * GET /api/campaigns - List all campaigns for a user
 */
export async function GET() {
  try {
    const result = await listCampaigns();
    return NextResponse.json(result.data, {
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
 * POST /api/campaigns - Create a new campaign
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, templatePdfUrl, placeholders, userId } = body;

    if (!name || !templatePdfUrl || !placeholders) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const result = await createCampaign({
      name,
      description,
      templatePdfUrl,
      placeholders: Array.isArray(placeholders) ? placeholders : [placeholders],
      userId,
    });

    return NextResponse.json(result.data, {
      status: 201,
      headers: { 'x-3d-suite-mode': result.mode },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
