import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { TenantAuthorizationService } from '../../src/persistence/tenant-authorization-service.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';

function prismaForExpiredTenant(dataPurgeAt: Date | null): PrismaClient {
  return {
    application_users: {
      findUnique: async () => ({ id: 'user-1', is_active: true }),
    },
    tenant_memberships: {
      findUnique: async () => ({
        id: 'membership-1', role: 'ADMIN', is_active: true,
        tenants: {
          access_status: 'ACCESS_EXPIRED',
          trial_started_at: new Date('2026-01-01T00:00:00.000Z'),
          blocked_until: null, access_expires_at: new Date('2026-02-01T00:00:00.000Z'),
          data_purge_at: dataPurgeAt,
        },
      }),
    },
  } as unknown as PrismaClient;
}

test('permite al ADMIN renovar durante los 90 días de retención sin habilitar operatoria', async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const service = new TenantAuthorizationService(prismaForExpiredTenant(new Date('2026-12-30T12:00:00.000Z')));

  const actor = await service.authorizeSubscriptionRenewal('cognito-1', 'tenant-1', ['ADMIN'], now);

  assert.equal(actor.accessStatus, 'ACCESS_EXPIRED');
  assert.equal(actor.role, 'ADMIN');
});

test('rechaza renovar una vez finalizada la retención', async () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const service = new TenantAuthorizationService(prismaForExpiredTenant(new Date('2026-10-01T12:00:00.000Z')));

  await assert.rejects(
    () => service.authorizeSubscriptionRenewal('cognito-1', 'tenant-1', ['ADMIN'], now),
    (error: unknown) => error instanceof DomainRuleViolation && /retención/.test(error.message),
  );
});
