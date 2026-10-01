import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { MercadoPagoGateway } from './mercado-pago-client.js';

export interface MercadoPagoNotification {
  notificationId: string;
  eventType: string;
  paymentId: string;
  payload: Prisma.InputJsonValue;
}

export interface ReconciliationResult {
  duplicate: boolean;
  credited: boolean;
  reason?: 'NOT_A_PAYMENT' | 'ORDER_NOT_FOUND' | 'PAYMENT_NOT_APPROVED' | 'PAYMENT_MISMATCH' | 'ORDER_ALREADY_FINAL';
}

function addCalendarMonth(date: Date): Date {
  const targetMonth = date.getUTCMonth() + 1;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;
  const finalDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear, normalizedMonth, Math.min(date.getUTCDate(), finalDay),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(),
  ));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
}

/** Acredita sólo pagos aprobados que Mercado Pago confirma desde su API. */
export class SubscriptionPaymentReconciliationService {
  constructor(private readonly prisma: PrismaClient, private readonly gateway: MercadoPagoGateway) {}

  async reconcile(notification: MercadoPagoNotification, now = new Date()): Promise<ReconciliationResult> {
    const payment = await this.gateway.getPayment(notification.paymentId);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.inbound_events.create({
          data: {
            provider: 'MERCADO_PAGO', external_event_id: notification.notificationId,
            event_type: notification.eventType, payload: notification.payload,
          },
        });
        if (notification.eventType !== 'payment') {
          await this.markEvent(transaction, notification.notificationId, 'IGNORED');
          return { duplicate: false, credited: false, reason: 'NOT_A_PAYMENT' };
        }
        if (payment.status !== 'approved') {
          await this.markEvent(transaction, notification.notificationId, 'IGNORED');
          return { duplicate: false, credited: false, reason: 'PAYMENT_NOT_APPROVED' };
        }
        const order = payment.externalReference === undefined ? null : await transaction.subscription_orders.findUnique({
          where: { external_reference: payment.externalReference },
        });
        if (order === null) {
          await this.markEvent(transaction, notification.notificationId, 'IGNORED');
          return { duplicate: false, credited: false, reason: 'ORDER_NOT_FOUND' };
        }
        if (payment.currency !== order.currency || payment.transactionAmount === undefined || !order.amount.equals(payment.transactionAmount)) {
          await this.markEvent(transaction, notification.notificationId, 'REJECTED');
          return { duplicate: false, credited: false, reason: 'PAYMENT_MISMATCH' };
        }
        const markedPaid = await transaction.subscription_orders.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: { status: 'PAID', paid_at: now },
        });
        if (markedPaid.count !== 1) {
          await this.markEvent(transaction, notification.notificationId, 'IGNORED');
          return { duplicate: false, credited: false, reason: 'ORDER_ALREADY_FINAL' };
        }
        const endsAt = addCalendarMonth(now);
        await transaction.subscriptions.create({
          data: {
            tenant_id: order.tenant_id, plan_code: order.plan_code, status: 'ACTIVE',
            starts_at: now, ends_at: endsAt, source_order_id: order.id,
          },
        });
        await transaction.tenants.update({
          where: { id: order.tenant_id },
          data: { current_plan_code: order.plan_code, access_status: 'ACTIVE', blocked_until: null, access_expires_at: null },
        });
        const administrator = await transaction.tenant_memberships.findFirst({
          where: { tenant_id: order.tenant_id, role: 'ADMIN', is_active: true }, select: { id: true },
        });
        if (administrator !== null) {
          await transaction.notification_intents.upsert({
            where: { tenant_id_idempotency_key: { tenant_id: order.tenant_id, idempotency_key: `SUBSCRIPTION_PAYMENT_CONFIRMED:${order.id}` } },
            create: {
              tenant_id: order.tenant_id, recipient_membership_id: administrator.id,
              intent_type: 'SUBSCRIPTION_PAYMENT_CONFIRMED',
              idempotency_key: `SUBSCRIPTION_PAYMENT_CONFIRMED:${order.id}`,
              payload: { orderId: order.id, planCode: order.plan_code, endsAt: endsAt.toISOString() },
              scheduled_for: now,
            }, update: {},
          });
        }
        await transaction.audit_events.create({
          data: {
            tenant_id: order.tenant_id, action: 'SUBSCRIPTION_PAYMENT_CREDITED',
            entity_type: 'SUBSCRIPTION_ORDER', entity_id: order.id, source: 'MERCADO_PAGO',
            metadata: { paymentId: payment.id, planCode: order.plan_code, amount: order.amount.toString(), currency: order.currency },
          },
        });
        await this.markEvent(transaction, notification.notificationId, 'PROCESSED');
        return { duplicate: false, credited: true };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (isUniqueViolation(error)) return { duplicate: true, credited: false };
      throw error;
    }
  }

  private async markEvent(transaction: Prisma.TransactionClient, externalEventId: string, status: string): Promise<void> {
    await transaction.inbound_events.update({
      where: { provider_external_event_id: { provider: 'MERCADO_PAGO', external_event_id: externalEventId } },
      data: { processing_status: status, processed_at: new Date() },
    });
  }
}
