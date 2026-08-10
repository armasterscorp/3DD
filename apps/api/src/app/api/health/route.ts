import { NextResponse } from 'next/server';
import { getHealthSummary } from '@/lib/campaign-service';

/**
 * GET /api/health - Health check
 */
export async function GET() {
  const health = await getHealthSummary();
  const httpStatus = health.status === 'ok' ? 200 : 200;
  return NextResponse.json(
    {
      status: health.status,
      mode: health.mode,
      timestamp: new Date().toISOString(),
      database: health.database,
      message: health.message,
    },
    { status: httpStatus }
  );
}
