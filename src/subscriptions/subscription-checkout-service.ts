import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { MembershipRole, PlanCode } from '../../packages/domain/src/model.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import { assertSameCommand, fingerprintCommand, normalizeIdempotencyKey } from '../persistence/idempotency.js';
import type { MercadoPagoGateway } from './mercado-pago-client.js';

export interface SubscriptionCheckoutActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

export interface CheckoutRuntimeConfiguration {
  notificationUrl: string;
  returnBaseUrl: string;
  preferenceLifetimeHours?: number;
}

export interface SubscriptionCheckoutResult {
  orderId: string;
  checkoutUrl: string;
  expiresAt: Date;
  idempotent: boolean;
}

type Transaction = Prisma.TransactionClient;

function addHours(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function returnUrls(baseUrl: string): { success: string; failure: string; pending: string } {
  const base = baseUrl.trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('La URL base de retorno debe usar HTTPS.');
  return {
    success: `${base}/subscription/payment/success`,
    failure: `${base}/subscription/payment/failure`,
    pending: `${base}/subscription/payment/pending`,
  };
}

function requireAdmin(actor: SubscriptionCheckoutActor): void {
  if (actor.role !== 'ADMIN') throw new DomainRuleViolation('Sólo ADMIN puede iniciar una suscripción o renovación.');
}

function resultFromOrder(order: { id: string; checkout_url: string | null; expires_at: Date | null }, idempotent: boolean): SubscriptionCheckoutResult | undefined {
  if (order.checkout_url === null || order.expires_at === null) return undefined;
  return { orderId: order.id, checkoutUrl: order.checkout_url, expiresAt: order.expires_at, idempotent };
}

/**
 * Crea una orden interna antes de llamar al proveedor. Por eso ni el plan ni
 * el importe se aceptan desde el navegador, y los reintentos usan la misma
 * orden y referencia externa.
 */
export class SubscriptionCheckoutService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: MercadoPagoGateway,
    private readonly configuration: CheckoutRuntimeConfiguration,
  ) {}

  async createCheckout(
    actor: SubscriptionCheckoutActor,
    planCode: PlanCode,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<SubscriptionCheckoutResult> {
    requireAdmin(actor);
    const key = normalizeIdempotencyKey(idempotencyKey);
    if (key === undefined) throw new DomainRuleViolation('La suscripción requiere una clave de idempotencia.');
    const fingerprint = fingerprintCommand({ command: 'SUBSCRIPTION_CHECKOUT_CREATED', tenantId: actor.tenantId, planCode });
    // El aviso de vencimiento concede 48 h de gracia; el enlace no puede
    // expirar antes que ese período.
    const lifetimeHours = this.configuration.preferenceLifetimeHours ?? 48;
    if (!Number.isInteger(lifetimeHours) || lifetimeHours < 1 || lifetimeHours > 168) {
      throw new Error('La vigencia de Checkout Pro debe estar entre 1 y 168 horas.');
    }
    const expiresAt = addHours(now, lifetimeHours);
    const urls = returnUrls(this.configuration.returnBaseUrl);

    const order = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.subscription_orders.findFirst({
        where: { tenant_id: actor.tenantId, idempotency_key: key },
        select: { id: true, checkout_url: true, expires_at: true, idempotency_fingerprint: true },
      });
      if (existing !== null) {
        assertSameCommand(existing.idempotency_fingerprint, fingerprint);
        return { ...existing, idempotent: true };
      }
      const price = await transaction.plan_price_versions.findFirst({
        where: { plan_code: planCode, valid_from: { lte: now }, OR: [{ valid_to: null }, { valid_to: { gt: now } }] },
        orderBy: { valid_from: 'desc' },
      });
      if (price === null || price.currency !== 'ARS' || price.amount.lte(0)) {
        throw new DomainRuleViolation('No existe un precio vigente para el plan seleccionado.');
      }
      const created = await transaction.subscription_orders.create({
        data: {
          tenant_id: actor.tenantId, plan_code: planCode, price_version_id: price.id,
          amount: price.amount, currency: 'ARS', external_reference: `subscription-order:${randomUUID()}`,
          expires_at: expiresAt, created_by_user_id: actor.userId,
          idempotency_key: key, idempotency_fingerprint: fingerprint,
        },
        select: { id: true, checkout_url: true, expires_at: true, external_reference: true, amount: true, plan_code: true },
      });
      await transaction.audit_events.create({
        data: {
          tenant_id: actor.tenantId, actor_user_id: actor.userId, action: 'SUBSCRIPTION_ORDER_CREATED',
          entity_type: 'SUBSCRIPTION_ORDER', entity_id: created.id, source: 'WEB',
          metadata: { planCode, amount: created.amount.toString(), currency: 'ARS' },
        },
      });
      return { ...created, idempotent: false };
    }, { isolationLevel: 'Serializable' });

    const ready = resultFromOrder(order, order.idempotent);
    if (ready !== undefined) return ready;

    // Serializa reintentos de la misma orden. La llamada externa queda dentro
    // de una transacción corta, evitando dos preferencias simultáneas.
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.id}))`;
      const lockedOrder = await transaction.subscription_orders.findUnique({ where: { id: order.id } });
      if (lockedOrder === null) throw new Error('La orden de suscripción ya no existe.');
      const existing = resultFromOrder(lockedOrder, order.idempotent);
      if (existing !== undefined) return existing;
      const preference = await this.gateway.createPreference({
        title: `Cuentas a Pagar — Plan ${lockedOrder.plan_code}`,
        amount: Number(lockedOrder.amount.toString()), currency: 'ARS', externalReference: lockedOrder.external_reference,
        notificationUrl: this.configuration.notificationUrl, backUrls: urls, expiresAt: lockedOrder.expires_at ?? expiresAt,
      });
      const updated = await transaction.subscription_orders.update({
        where: { id: lockedOrder.id },
        data: { checkout_preference_id: preference.id, checkout_url: preference.checkoutUrl },
        select: { id: true, checkout_url: true, expires_at: true },
      });
      return resultFromOrder(updated, order.idempotent)!;
    }, { isolationLevel: 'Serializable', timeout: 10_000 });
  }
}
