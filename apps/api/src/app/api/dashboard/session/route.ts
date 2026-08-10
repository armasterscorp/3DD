import { NextRequest, NextResponse } from 'next/server';
import { getDashboardSession, updateDashboardSession } from '@/lib/campaign-service';

export async function GET() {
  const result = await getDashboardSession();
  return NextResponse.json(
    {
      mode: result.mode,
      data: result.data,
      message: 'Dashboard session state is runtime-local and resets when API restarts.',
    },
    { headers: { 'x-3d-suite-mode': result.mode } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await updateDashboardSession({
      provider: body.provider || 'wetransfer',
      batchSize: body.batchSize || '10',
      delay: body.delay || '3',
      rotateIds: Boolean(body.rotateIds),
      subject: body.subject || '',
      message: body.message || '',
      recipientsCount: Number(body.recipientsCount || 0),
      files: Array.isArray(body.files) ? body.files : [],
    });

    return NextResponse.json(
      {
        mode: result.mode,
        data: result.data,
        message: 'Dashboard session state stored in local memory for this runtime.',
      },
      { status: 200, headers: { 'x-3d-suite-mode': result.mode } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Invalid payload' },
      { status: 400 }
    );
  }
}
