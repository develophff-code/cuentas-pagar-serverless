import type { PrismaClient } from '../generated/prisma/client.js';
import { SubscriptionCheckoutService } from './subscription-checkout-service.js';

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Registra avisos; el dispatcher de canales decide cómo y cuándo enviarlos. */
export class SubscriptionRenewalNotificationService {
  constructor(private readonly prisma: PrismaClient, private readonly checkout: SubscriptionCheckoutService) {}

  async schedule(now = new Date()): Promise<{ reminders: number; paymentLinks: number }> {
    const reminderFrom = addDays(now, 5);
    const reminderUntil = addDays(now, 6);
    const dueSoon = await this.prisma.subscriptions.findMany({
      where: { status: 'ACTIVE', ends_at: { gte: reminderFrom, lt: reminderUntil } },
      select: { id: true, tenant_id: true, ends_at: true, plan_code: true },
    });
    for (const subscription of dueSoon) {
      await this.prisma.notification_intents.upsert({
        where: { tenant_id_idempotency_key: { tenant_id: subscription.tenant_id, idempotency_key: `SUBSCRIPTION_REMINDER:${subscription.id}` } },
        create: {
          tenant_id: subscription.tenant_id, intent_type: 'SUBSCRIPTION_RENEWAL_REMINDER',
          idempotency_key: `SUBSCRIPTION_REMINDER:${subscription.id}`,
          payload: { subscriptionId: subscription.id, planCode: subscription.plan_code, endsAt: subscription.ends_at.toISOString() },
          scheduled_for: now,
        }, update: {},
      });
    }

    const dueNow = await this.prisma.subscriptions.findMany({
      where: { status: 'ACTIVE', ends_at: { lte: now, gt: new Date(now.getTime() - 48 * 60 * 60 * 1000) } },
      select: { id: true, tenant_id: true, plan_code: true },
    });
    let paymentLinks = 0;
    for (const subscription of dueNow) {
      const administrator = await this.prisma.tenant_memberships.findFirst({
        where: { tenant_id: subscription.tenant_id, role: 'ADMIN', is_active: true }, select: { id: true, user_id: true },
      });
      if (administrator === null) continue;
      const checkout = await this.checkout.createCheckout({
        tenantId: subscription.tenant_id, userId: administrator.user_id, role: 'ADMIN',
      }, subscription.plan_code, `SUBSCRIPTION_PAYMENT_LINK:${subscription.id}`, now);
      await this.prisma.notification_intents.upsert({
        where: { tenant_id_idempotency_key: { tenant_id: subscription.tenant_id, idempotency_key: `SUBSCRIPTION_PAYMENT_LINK:${subscription.id}` } },
        create: {
          tenant_id: subscription.tenant_id, recipient_membership_id: administrator.id,
          intent_type: 'SUBSCRIPTION_PAYMENT_LINK', idempotency_key: `SUBSCRIPTION_PAYMENT_LINK:${subscription.id}`,
          payload: { subscriptionId: subscription.id, orderId: checkout.orderId, checkoutUrl: checkout.checkoutUrl, expiresAt: checkout.expiresAt.toISOString() },
          scheduled_for: now,
        }, update: {},
      });
      paymentLinks += 1;
    }
    return { reminders: dueSoon.length, paymentLinks };
  }
}
