import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClientFromEnvironment } from './prisma-client.js';

let client: Promise<PrismaClient> | undefined;
/** Sólo el runtime Lambda lee credenciales; CDK recibe únicamente ARN y endpoint. */
export async function getRuntimePrismaClient(): Promise<PrismaClient> {
  if (!client) client = load().catch(() => {
    client = undefined;
    throw new Error('DATABASE_RUNTIME_UNAVAILABLE');
  });
  return client;
}

async function load(): Promise<PrismaClient> {
  if (!process.env.DATABASE_CREDENTIALS_SECRET_ARN) return createPrismaClientFromEnvironment();
  const host = process.env.DATABASE_HOST;
  if (!host) throw new Error('DATABASE_HOST_REQUIRED');
  const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({
    SecretId: process.env.DATABASE_CREDENTIALS_SECRET_ARN,
  }));
  const parsed: unknown = JSON.parse(response.SecretString ?? '{}');
  if (typeof parsed !== 'object' || parsed === null) throw new Error('DATABASE_CONFIG_INVALID');
  const config = parsed as Record<string, unknown>;
  if (typeof config.username !== 'string' || !config.username || typeof config.password !== 'string' || !config.password) {
    throw new Error('DATABASE_CONFIG_INVALID');
  }
  return new PrismaClient({ adapter: new PrismaPg({
    host, port: 5432, user: config.username, password: config.password,
    database: process.env.DATABASE_NAME ?? 'cuentas_pagar',
    ssl: { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 5000,
  }) });
}
