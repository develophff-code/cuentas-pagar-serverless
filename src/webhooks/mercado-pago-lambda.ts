import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getRuntimePrismaClient } from '../persistence/runtime-prisma-client.js';
import { MercadoPagoRuntimeGateway } from '../subscriptions/mercado-pago-runtime-gateway.js';
import { SubscriptionPaymentReconciliationService } from '../subscriptions/subscription-payment-reconciliation-service.js';
import { createMercadoPagoWebhookHandler } from './mercado-pago-webhook-handler.js';
import type { ApiGatewayRequest, ApiGatewayResponse } from '../api/http-types.js';

let webhookSecret: Promise<string> | undefined;
async function getWebhookSecret(): Promise<string> {
  if (!webhookSecret) webhookSecret = (async () => {
    if (!process.env.RUNTIME_CONFIG_SECRET_ARN) throw new Error('RUNTIME_CONFIG_REQUIRED');
    const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: process.env.RUNTIME_CONFIG_SECRET_ARN }));
    const parsed: unknown = JSON.parse(response.SecretString ?? '{}');
    const secret = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).mercadoPagoWebhookSecret : undefined;
    if (typeof secret !== 'string' || !secret.trim()) throw new Error('WEBHOOK_SECRET_REQUIRED');
    return secret;
  })().catch(() => { webhookSecret = undefined; throw new Error('WEBHOOK_CONFIG_UNAVAILABLE'); });
  return webhookSecret;
}

export async function handler(event: ApiGatewayRequest): Promise<ApiGatewayResponse> {
  return createMercadoPagoWebhookHandler({
    getWebhookSecret,
    reconcile: async (notification) => new SubscriptionPaymentReconciliationService(
      await getRuntimePrismaClient(), new MercadoPagoRuntimeGateway(),
    ).reconcile(notification),
  })(event);
}
