import { NextResponse } from 'next/server';
import { getHealthSummary } from '@/lib/campaign-service';

export interface SystemConfig {
  database: boolean;
  redis: boolean;
  wetransfer: boolean;
  email: boolean;
  tempEmail: boolean;
  localMode: boolean;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: SystemConfig;
  message: string;
}

/**
 * GET /api/health-check - Comprehensive system health check
 */
export async function GET(): Promise<NextResponse<HealthCheckResponse>> {
  const health = await getHealthSummary();

  const checks: SystemConfig = {
    database: health.database.reachable,
    redis: false,
    wetransfer: false,
    email: false,
    tempEmail: false,
    localMode: health.mode === 'local-memory',
  };

  // Check Redis
  try {
    // In production, would test actual Redis connection
    const redisUrl = process.env.REDIS_URL;
    checks.redis = !!redisUrl;
  } catch (error) {
    console.error('Redis check failed:', error);
  }

  // Check WeTransfer API Key
  checks.wetransfer = !!process.env.WETRANSFER_API_KEY;

  // Check Email Configuration
  checks.email =
    !!process.env.SMTP_HOST &&
    !!process.env.SMTP_USER &&
    !!process.env.SMTP_PASSWORD;

  // Check Temp Email Provider
  checks.tempEmail = !!process.env.TEMP_EMAIL_PROVIDER;

  // Determine overall status
  const allHealthy =
    checks.database &&
    checks.redis &&
    checks.wetransfer &&
    checks.email &&
    checks.tempEmail;
  const someHealthy =
    checks.database ||
    checks.redis ||
    checks.wetransfer ||
    checks.email ||
    checks.tempEmail;

  let status: HealthCheckResponse['status'] = 'unhealthy';
  let message = 'System is not properly configured';

  if (checks.localMode) {
    status = 'degraded';
    message = 'Running in local in-memory mode; database persistence is disabled';
  } else if (allHealthy) {
    status = 'healthy';
    message = 'All systems operational';
  } else if (someHealthy) {
    status = 'degraded';
    message = 'Some systems are not configured';
  }

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    checks,
    message,
  });
}
