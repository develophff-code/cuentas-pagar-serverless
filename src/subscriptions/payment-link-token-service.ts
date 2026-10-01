import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token opaco para el botón de WhatsApp; nunca expone la URL de Checkout. */
export class PaymentLinkTokenService {
  constructor(private readonly prisma: PrismaClient) {}

  async issue(subscriptionOrderId: string, expiresAt: Date, now = new Date()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.subscription_payment_link_tokens.create({
      data: { subscription_order_id: subscriptionOrderId, token_hash: hashToken(token), expires_at: expiresAt },
    });
    return token;
  }

  async resolve(token: string, now = new Date()): Promise<string | undefined> {
    if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return undefined;
    const record = await this.prisma.subscription_payment_link_tokens.findUnique({
      where: { token_hash: hashToken(token) }, include: { subscription_orders: true },
    });
    if (record === null || record.revoked_at !== null || record.expires_at <= now
      || record.subscription_orders.status !== 'PENDING'
      || record.subscription_orders.checkout_url === null) return undefined;
    return record.subscription_orders.checkout_url;
  }
}
