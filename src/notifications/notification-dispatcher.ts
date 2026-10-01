import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { createHash } from 'node:crypto';
import { PaymentLinkTokenService } from '../subscriptions/payment-link-token-service.js';
import { buildSubscriptionTemplate, type SubscriptionIntentType, type TemplateBindings, type TemplateValue } from './subscription-template.js';
import { YCloudSendError, type YCloudMessageGateway } from './ycloud-client.js';

interface ClaimedMessage { id: string; notification_intent_id: string; attempt_count: number }
export interface DispatchSummary { accepted: number; retry: number; blocked: number; unknown: number }

/** Outbox PostgreSQL: llamadas externas siempre fuera de transacciones y reservas. */
export class NotificationDispatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: YCloudMessageGateway,
    private readonly senderPhone: string,
    private readonly bindings: TemplateBindings,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async dispatch(now = new Date(), limit = 10, tenantId?: string): Promise<DispatchSummary> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('DISPATCH_LIMIT_INVALID');
    const summary: DispatchSummary = { accepted: 0, retry: 0, blocked: 0, unknown: 0 };
    // Lease de cinco minutos, mayor que timeout de Lambda y que el lote completo.
    const expired = await this.prisma.outbound_messages.updateMany({
      where: { dispatch_state: 'PROCESSING', claimed_at: { lt: new Date(now.getTime() - 300_000) },
        ...(tenantId ? { tenant_id: tenantId } : {}) },
      data: { dispatch_state: 'UNKNOWN', last_error: 'DISPATCH_LEASE_EXPIRED', updated_at: now },
    });
    summary.unknown += expired.count;
    await this.prisma.$executeRaw`
      INSERT INTO outbound_messages (tenant_id, notification_intent_id, logical_key, next_attempt_at)
      SELECT n.tenant_id, n.id, 'SUBSCRIPTION_INTENT:' || n.id::text, ${now}
      FROM notification_intents n
      WHERE (n.scheduled_for IS NULL OR n.scheduled_for <= ${now})
        AND n.intent_type IN ('SUBSCRIPTION_RENEWAL_REMINDER', 'SUBSCRIPTION_PAYMENT_LINK', 'SUBSCRIPTION_PAYMENT_CONFIRMED')
        AND (${tenantId ?? null}::uuid IS NULL OR n.tenant_id = ${tenantId ?? null}::uuid)
        AND NOT EXISTS (SELECT 1 FROM outbound_messages o
          WHERE o.tenant_id = n.tenant_id AND o.logical_key = 'SUBSCRIPTION_INTENT:' || n.id::text)
      ORDER BY n.created_at, n.id LIMIT ${limit}
      ON CONFLICT (tenant_id, logical_key) DO NOTHING`;
    // Reserva un mensaje a la vez para no dejar un lote completo ambiguo si falla una escritura.
    for (let index = 0; index < limit; index += 1) {
      const claimed = await this.prisma.$queryRaw<ClaimedMessage[]>`
        WITH due AS (
          SELECT id FROM outbound_messages
          WHERE dispatch_state IN ('READY', 'RETRY') AND provider = 'YCLOUD'
            AND logical_key LIKE 'SUBSCRIPTION_INTENT:%'
            AND (${tenantId ?? null}::uuid IS NULL OR tenant_id = ${tenantId ?? null}::uuid)
            AND next_attempt_at <= ${now} AND attempt_count < 5
          ORDER BY next_attempt_at, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE outbound_messages o SET dispatch_state = 'PROCESSING', claimed_at = ${now},
          attempt_count = attempt_count + 1, updated_at = ${now}
        FROM due WHERE o.id = due.id RETURNING o.id, o.notification_intent_id, o.attempt_count`;
      const message = claimed[0];
      if (!message) break;
      let prepared: Awaited<ReturnType<NotificationDispatcher['prepare']>>;
      try {
        prepared = await this.prepare(message);
      } catch (error) {
        // La consulta falló antes del envío: es seguro reintentar, sin guardar error crudo.
        await this.finish(message, 'RETRY', 'DISPATCH_PREPARATION_FAILED', now, summary);
        continue;
      }
      if (typeof prepared === 'string') {
        await this.finish(message, 'BLOCKED', prepared, now, summary);
        continue;
      }
      let messageId: string;
      try {
        messageId = (await this.gateway.enqueueTemplate(prepared.message)).messageId;
      } catch (error) {
        await this.finish(message, error instanceof YCloudSendError ? error.outcome : 'UNKNOWN',
          error instanceof YCloudSendError ? error.code : 'YCLOUD_SEND_UNKNOWN', now, summary);
        continue;
      }
      // Si esta escritura falla, conservar PROCESSING para revisión por lease vencido.
      // Jamás volver a enviar por un fallo de persistencia posterior a la aceptación.
      await this.prisma.outbound_messages.update({ where: { id: message.id }, data: {
        dispatch_state: 'COMPLETE', status: 'SENT', provider_message_id: messageId,
        recipient_identity_id: prepared.identityId, sent_at: new Date(), last_error: null, updated_at: new Date(),
      } });
      summary.accepted += 1;
    }
    return summary;
  }

  private async prepare(claimed: ClaimedMessage) {
    const intent = await this.prisma.notification_intents.findUnique({ where: { id: claimed.notification_intent_id } });
    if (!intent) return 'INTENT_UNAVAILABLE';
    const membership = intent.recipient_membership_id === null ? null : await this.prisma.tenant_memberships.findFirst({
      where: { id: intent.recipient_membership_id, tenant_id: intent.tenant_id, is_active: true, role: 'ADMIN' },
    });
    if (!membership) return 'RECIPIENT_UNAVAILABLE';
    const identity = await this.prisma.whatsapp_identities.findFirst({
      where: { tenant_id: intent.tenant_id, user_id: membership.user_id, is_active: true,
        provider: 'YCLOUD', verified_at: { not: null }, phone_number: { not: null } },
      orderBy: [{ verified_at: 'desc' }, { id: 'asc' }],
    });
    if (!identity?.phone_number || !/^\+[1-9]\d{7,14}$/.test(identity.phone_number)) return 'RECIPIENT_UNAVAILABLE';
    const tenant = await this.prisma.tenants.findUnique({ where: { id: intent.tenant_id }, select: { business_name: true } });
    if (!tenant) return 'TENANT_UNAVAILABLE';
    const payload = intent.payload as Prisma.JsonObject;
    const values: Partial<Record<TemplateValue, string>> = { businessName: tenant.business_name };
    const names: Record<string, string> = { BASIC: 'Básico', PROFESSIONAL: 'Profesional', ULTRA: 'Ultra' };
    if (typeof payload.planCode === 'string' && names[payload.planCode]) values.planName = names[payload.planCode]!;
    let token: string | undefined;
    if (intent.intent_type === 'SUBSCRIPTION_PAYMENT_CONFIRMED') {
      const order = typeof payload.orderId !== 'string' ? null : await this.prisma.subscription_orders.findFirst({
        where: { id: payload.orderId, tenant_id: intent.tenant_id, status: 'PAID' },
      });
      if (!order) return 'PAYMENT_CONFIRMATION_UNAVAILABLE';
      values.planName = names[order.plan_code]!;
      values.amount = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(order.amount));
    }
    if (intent.intent_type === 'SUBSCRIPTION_PAYMENT_LINK') {
      token = typeof payload.paymentLinkToken === 'string' ? payload.paymentLinkToken : undefined;
      const order = typeof payload.orderId !== 'string' ? null : await this.prisma.subscription_orders.findFirst({
        where: { id: payload.orderId, tenant_id: intent.tenant_id, status: 'PENDING' },
      });
      if (!order || !order.expires_at || order.expires_at <= this.clock() || !token
        || !await new PaymentLinkTokenService(this.prisma).resolve(token, this.clock())) return 'PAYMENT_LINK_UNAVAILABLE';
      // Resolver no basta: verificar que el token corresponde a ESTA orden/tenant.
      const record = await this.prisma.subscription_payment_link_tokens.findUnique({
        where: { token_hash: createHash('sha256').update(token).digest('hex') },
        select: { subscription_order_id: true },
      });
      if (record?.subscription_order_id !== order.id) return 'PAYMENT_LINK_UNAVAILABLE';
      values.planName = names[order.plan_code]!;
      values.amount = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(order.amount));
      values.expiresAt = this.formatDate(order.expires_at);
    }
    if (typeof payload.endsAt === 'string') {
      const date = new Date(payload.endsAt);
      if (Number.isNaN(date.getTime())) return 'INTENT_PAYLOAD_INVALID';
      if (intent.intent_type === 'SUBSCRIPTION_RENEWAL_REMINDER' && date <= this.clock()) return 'REMINDER_EXPIRED';
      values.endsAt = this.formatDate(date);
    }
    try {
      return { identityId: identity.id, message: buildSubscriptionTemplate({
        type: intent.intent_type as SubscriptionIntentType, senderPhone: this.senderPhone,
        recipientPhone: identity.phone_number, externalId: claimed.id, values,
        ...(token ? { paymentLinkToken: token } : {}),
      }, this.bindings) };
    } catch { return 'INTENT_PAYLOAD_INVALID'; }
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short' }).format(date);
  }

  private async finish(message: ClaimedMessage, outcome: 'RETRY' | 'BLOCKED' | 'UNKNOWN', code: string,
    now: Date, summary: DispatchSummary): Promise<void> {
    const state = outcome === 'RETRY' && message.attempt_count >= 5 ? 'BLOCKED' : outcome;
    await this.prisma.outbound_messages.update({ where: { id: message.id }, data: {
      dispatch_state: state, status: state === 'BLOCKED' ? 'FAILED' : 'PENDING', last_error: code,
      next_attempt_at: new Date(now.getTime() + Math.min(3600, 60 * 2 ** (message.attempt_count - 1)) * 1000),
      updated_at: now,
    } });
    if (state === 'UNKNOWN') summary.unknown += 1;
    else if (state === 'BLOCKED') summary.blocked += 1;
    else summary.retry += 1;
  }
}
