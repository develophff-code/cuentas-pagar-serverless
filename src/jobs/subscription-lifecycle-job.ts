import { createPrismaClientFromEnvironment } from '../persistence/prisma-client.js';
import { TenantLifecycleService } from '../persistence/tenant-lifecycle-service.js';
import { MercadoPagoRuntimeGateway } from '../subscriptions/mercado-pago-runtime-gateway.js';
import { SubscriptionCheckoutService } from '../subscriptions/subscription-checkout-service.js';
import { SubscriptionRenewalNotificationService } from '../subscriptions/subscription-renewal-notification-service.js';

/** Lambda programada diaria: no borra datos, sólo reconcilia estados y fechas. */
export async function handler(): Promise<{ reconciled: number; reminders: number; paymentLinks: number }> {
  const prisma = createPrismaClientFromEnvironment();
  const checkout = new SubscriptionCheckoutService(prisma, new MercadoPagoRuntimeGateway(), {
    notificationUrl: process.env.MERCADO_PAGO_WEBHOOK_URL ?? '',
    returnBaseUrl: process.env.PUBLIC_APP_BASE_URL ?? '',
  });
  const notifications = await new SubscriptionRenewalNotificationService(prisma, checkout).schedule();
  const lifecycle = await new TenantLifecycleService(prisma).reconcileAll();
  return { ...lifecycle, ...notifications };
}
