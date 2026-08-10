import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaInitError?: Error;
};

function createClient() {
  return new PrismaClient({
    log: ['query'],
  });
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPrismaClient() {
  if (!hasDatabaseUrl()) {
    throw new Error('DATABASE_URL is not configured');
  }

  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  if (globalForPrisma.prismaInitError) {
    throw globalForPrisma.prismaInitError;
  }

  try {
    const client = createClient();
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = client;
    }
    return client;
  } catch (error) {
    const initError = error instanceof Error ? error : new Error('Failed to initialize Prisma client');
    globalForPrisma.prismaInitError = initError;
    throw initError;
  }
}

export async function isDatabaseReachable() {
  if (!hasDatabaseUrl()) {
    return false;
  }

  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export const prisma = new Proxy(
  {},
  {
    get(_target, property) {
      const client = getPrismaClient() as unknown as Record<string, unknown>;
      return client[property as keyof typeof client];
    },
  }
) as PrismaClient;
