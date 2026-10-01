import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPrismaClientFromEnvironment } from '../../src/persistence/prisma-client.js';
import { TenantService } from '../../src/persistence/tenant-service.js';
import { NotificationDispatcher } from '../../src/notifications/notification-dispatcher.js';
import { parseTemplateBindings } from '../../src/notifications/subscription-template.js';

test('PostgreSQL: dos dispatchers concurrentes reservan una sola vez la misma intención', {
  skip: !process.env.DATABASE_URL && 'Requiere DATABASE_URL temporal y migraciones 001–008 aplicadas.',
}, async () => {
  const prisma = createPrismaClientFromEnvironment();
  const suffix = randomUUID();
  const now = new Date();
  let tenantId: string | undefined;
  let userId: string | undefined;
  try {
    const tenant = await new TenantService(prisma).registerWebTenant({ businessName: `Dispatch ${suffix}`,
      planCode: 'PROFESSIONAL', administrator: { cognitoSub: suffix, email: `${suffix}@example.invalid` } });
    tenantId = tenant.tenantId; userId = tenant.adminUserId;
    const admin = await prisma.tenant_memberships.findFirstOrThrow({ where: { tenant_id: tenantId, user_id: userId } });
    await prisma.whatsapp_identities.create({ data: { tenant_id: tenantId, user_id: userId,
      phone_number: `+54911${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, verified_at: now } });
    const intent = await prisma.notification_intents.create({ data: { tenant_id: tenantId,
      recipient_membership_id: admin.id, intent_type: 'SUBSCRIPTION_RENEWAL_REMINDER', idempotency_key: suffix,
      scheduled_for: now, payload: { endsAt: new Date(now.getTime() + 5 * 86400_000).toISOString() } } });
    const bindings = parseTemplateBindings(JSON.stringify({
      SUBSCRIPTION_RENEWAL_REMINDER: { languageCode: 'es_AR', body: ['businessName'] },
      SUBSCRIPTION_PAYMENT_LINK: { languageCode: 'es_AR', body: [], button: { index: 0, prefix: '' } },
      SUBSCRIPTION_PAYMENT_CONFIRMED: { languageCode: 'es_AR', body: [] },
    }));
    const sent: string[] = [];
    const gateway = { enqueueTemplate: async (message: { externalId?: string }) => {
      sent.push(message.externalId!); return { messageId: `fixture-${message.externalId}` };
    } };
    const first = new NotificationDispatcher(prisma, gateway, '+5492646276709', bindings);
    const second = new NotificationDispatcher(prisma, gateway, '+5492646276709', bindings);
    await Promise.all([first.dispatch(now, 10, tenantId), second.dispatch(now, 10, tenantId)]);
    await first.dispatch(now, 10, tenantId);
    const outbound = await prisma.outbound_messages.findMany({ where: { notification_intent_id: intent.id } });
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0]?.dispatch_state, 'COMPLETE');
    assert.equal(outbound[0]?.attempt_count, 1);
    assert.equal(sent.filter((id) => id === outbound[0]?.id).length, 1);
  } finally {
    if (tenantId) {
      await prisma.outbound_messages.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.notification_intents.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.whatsapp_identities.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.audit_events.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.tenant_memberships.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.tenants.delete({ where: { id: tenantId } });
    }
    if (userId) await prisma.application_users.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
