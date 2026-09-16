import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL válida.');
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
}

export function createPrismaClientFromEnvironment(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL es obligatoria para acceder a la persistencia.');
  }

  return createPrismaClient(databaseUrl);
}
