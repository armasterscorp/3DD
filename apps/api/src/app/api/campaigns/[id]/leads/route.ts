import { NextRequest, NextResponse } from 'next/server';
import { importLeads, listLeads } from '@/lib/campaign-service';

/**
 * GET /api/campaigns/[id]/leads - List leads for a campaign
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await listLeads(params.id);
    const leads = result.data;

    return NextResponse.json(leads, {
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
 * POST /api/campaigns/[id]/leads - Import leads
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { leads } = body;

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json(
        { error: 'Invalid leads data' },
        { status: 400 }
      );
    }

    const result = await importLeads(params.id, leads);
    const payload = result.data;

    if (!payload.ok) {
      return NextResponse.json(
        { error: payload.message },
        { status: payload.status, headers: { 'x-3d-suite-mode': result.mode } }
      );
    }

    return NextResponse.json(
      { message: payload.message, count: payload.count },
      { status: payload.status, headers: { 'x-3d-suite-mode': result.mode } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
