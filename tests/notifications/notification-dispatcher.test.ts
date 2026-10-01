import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { NotificationDispatcher } from '../../src/notifications/notification-dispatcher.js';
import { parseTemplateBindings, buildSubscriptionTemplate } from '../../src/notifications/subscription-template.js';
import { YCloudHttpClient, YCloudSendError } from '../../src/notifications/ycloud-client.js';

// Contrato de fixture: no representa los parámetros aún pendientes de YCloud.
const bindings = parseTemplateBindings(JSON.stringify({
  SUBSCRIPTION_RENEWAL_REMINDER: { languageCode: 'es_AR', body: ['businessName', 'endsAt'] },
  SUBSCRIPTION_PAYMENT_LINK: { languageCode: 'es_AR', body: ['amount'], button: { index: 0, prefix: '' } },
  SUBSCRIPTION_PAYMENT_CONFIRMED: { languageCode: 'es_AR', body: ['planName'] },
}));
const now = new Date('2030-01-01T12:00:00Z');

function fixture(options: { recipientTenantMismatch?: boolean; persistenceFailure?: boolean; attempt?: number;
  expiredLease?: boolean; paymentLink?: boolean; wrongTokenOrder?: boolean; expiredLink?: boolean } = {}) {
  let reserved = options.expiredLease ?? false;
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    $executeRaw: async () => 1,
    $queryRaw: async () => {
      if (reserved) return [];
      reserved = true;
      return [{ id: 'outbound-id', notification_intent_id: 'intent-id', attempt_count: options.attempt ?? 1 }];
    },
    outbound_messages: {
      updateMany: async () => ({ count: options.expiredLease ? 1 : 0 }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.persistenceFailure && data.dispatch_state === 'COMPLETE') throw new Error('db unavailable');
        updates.push(data);
      },
    },
    notification_intents: { findUnique: async () => ({ id: 'intent-id', tenant_id: 'tenant-id',
      recipient_membership_id: 'membership-id', intent_type: options.paymentLink ? 'SUBSCRIPTION_PAYMENT_LINK' : 'SUBSCRIPTION_RENEWAL_REMINDER',
      payload: options.paymentLink ? { orderId: 'order-id', paymentLinkToken: 'x'.repeat(43) } : { endsAt: '2030-01-06T12:00:00Z' } }) },
    subscription_orders: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.tenant_id, 'tenant-id'); assert.equal(where.status, 'PENDING');
      return { id: 'order-id', expires_at: new Date(options.expiredLink ? '2029-12-31' : '2030-01-02'),
        plan_code: 'BASIC', amount: 28000 };
    } },
    subscription_payment_link_tokens: { findUnique: async () => ({
      expires_at: new Date('2030-01-02'), revoked_at: null,
      subscription_order_id: options.wrongTokenOrder ? 'other-order' : 'order-id',
      subscription_orders: { status: 'PENDING', checkout_url: 'https://www.mercadopago.com.ar/checkout/example' },
    }) },
    tenant_memberships: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.tenant_id, 'tenant-id');
      assert.equal(where.role, 'ADMIN');
      assert.equal(where.is_active, true);
      return options.recipientTenantMismatch ? null : { user_id: 'user-id' };
    } },
    whatsapp_identities: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.tenant_id, 'tenant-id');
      assert.equal(where.user_id, 'user-id');
      assert.deepEqual(where.verified_at, { not: null });
      return { id: 'identity-id', phone_number: '+5491100000000' };
    } },
    tenants: { findUnique: async () => ({ business_name: 'Empresa de prueba' }) },
  } as unknown as PrismaClient;
  return { prisma, updates };
}

test('un lease vencido queda ambiguo y no vuelve a enviarse', async () => {
  const { prisma } = fixture({ expiredLease: true });
  const result = await new NotificationDispatcher(prisma, { enqueueTemplate: async () => {
    assert.fail('No debe reenviar una reserva vencida');
  } }, '+5492646276709', bindings, () => now).dispatch(now);
  assert.equal(result.unknown, 1);
});

test('bloquea enlaces vencidos o tokens pertenecientes a otra orden', async () => {
  for (const flags of [{ expiredLink: true }, { wrongTokenOrder: true }]) {
    const { prisma, updates } = fixture({ paymentLink: true, ...flags });
    await new NotificationDispatcher(prisma, { enqueueTemplate: async () => {
      assert.fail('No debe enviar un enlace inválido');
    } }, '+5492646276709', bindings, () => now).dispatch(now);
    assert.equal(updates[0]?.last_error, 'PAYMENT_LINK_UNAVAILABLE');
  }
});

test('dispatcher reserva, acepta y persiste; una segunda ejecución no reenvía', async () => {
  const { prisma, updates } = fixture();
  let calls = 0;
  const dispatcher = new NotificationDispatcher(prisma, { enqueueTemplate: async (message) => {
    calls += 1;
    assert.equal(message.externalId, 'outbound-id');
    assert.equal(message.languageCode, 'es_AR');
    assert.equal(message.templateName, 'subscription_renewal_reminder');
    return { messageId: 'provider-id' };
  } }, '+5492646276709', bindings, () => now);
  assert.deepEqual(await dispatcher.dispatch(now), { accepted: 1, retry: 0, blocked: 0, unknown: 0 });
  assert.equal(updates[0]?.provider_message_id, 'provider-id');
  assert.equal((await dispatcher.dispatch(now)).accepted, 0);
  assert.equal(calls, 1);
});

test('no envía a membresía de otro tenant o inactiva', async () => {
  const { prisma, updates } = fixture({ recipientTenantMismatch: true });
  const result = await new NotificationDispatcher(prisma, { enqueueTemplate: async () => {
    assert.fail('No debe enviar');
  } }, '+5492646276709', bindings, () => now).dispatch(now);
  assert.equal(result.blocked, 1);
  assert.equal(updates[0]?.last_error, 'RECIPIENT_UNAVAILABLE');
});

test('error de red ambiguo se conserva sin persistir el error crudo', async () => {
  const { prisma, updates } = fixture();
  const result = await new NotificationDispatcher(prisma, { enqueueTemplate: async () => {
    throw new Error('sensitive response');
  } }, '+5492646276709', bindings, () => now).dispatch(now);
  assert.equal(result.unknown, 1);
  assert.equal(updates[0]?.dispatch_state, 'UNKNOWN');
  assert.equal(updates[0]?.last_error, 'YCLOUD_SEND_UNKNOWN');
});

test('429 reintenta con backoff y quinto intento agota la política', async () => {
  for (const attempt of [1, 5]) {
    const { prisma, updates } = fixture({ attempt });
    await new NotificationDispatcher(prisma, { enqueueTemplate: async () => {
      throw new YCloudSendError('RETRY', 'YCLOUD_HTTP_429');
    } }, '+5492646276709', bindings, () => now).dispatch(now);
    assert.equal(updates[0]?.dispatch_state, attempt === 5 ? 'BLOCKED' : 'RETRY');
    assert.ok((updates[0]?.next_attempt_at as Date) > now);
  }
});

test('fallo de persistencia después de aceptación no provoca un segundo envío', async () => {
  const { prisma } = fixture({ persistenceFailure: true });
  let calls = 0;
  const dispatcher = new NotificationDispatcher(prisma, { enqueueTemplate: async () => {
    calls += 1; return { messageId: 'provider-id' };
  } }, '+5492646276709', bindings, () => now);
  await assert.rejects(dispatcher.dispatch(now), /db unavailable/);
  await dispatcher.dispatch(now);
  assert.equal(calls, 1);
});

test('botón manda sólo el sufijo opaco; configuración ausente impide activar', () => {
  assert.throws(() => parseTemplateBindings(undefined));
  const message = buildSubscriptionTemplate({ type: 'SUBSCRIPTION_PAYMENT_LINK',
    senderPhone: '+5492646276709', recipientPhone: '+5491100000000', externalId: 'id',
    paymentLinkToken: 'x'.repeat(43), values: { amount: '$ 28.000' } }, bindings);
  assert.deepEqual(message.components[1]?.parameters, [{ type: 'text', text: 'x'.repeat(43) }]);
  assert.ok(!JSON.stringify(message).includes('mercadopago'));
});

test('cliente YCloud clasifica rechazo, rate limit y aceptación ambigua sin filtrar payload', async () => {
  const message = { from: '+5492646276709', to: '+5491100000000',
    templateName: 'subscription_payment_confirmed', components: [], externalId: 'outbound-id' };
  for (const [status, outcome] of [[400, 'BLOCKED'], [429, 'RETRY'], [500, 'UNKNOWN'], [408, 'UNKNOWN'], [200, 'UNKNOWN']] as const) {
    const client = new YCloudHttpClient('fixture-key', async (_url, options) => {
      assert.equal(JSON.parse(String(options?.body)).externalId, 'outbound-id');
      return new Response(JSON.stringify({ error: 'sensitive response' }), { status });
    });
    await assert.rejects(client.enqueueTemplate(message), (error: unknown) =>
      error instanceof YCloudSendError && error.outcome === outcome && !error.message.includes('sensitive'));
  }
});
