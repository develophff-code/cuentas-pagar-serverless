import type { Prisma } from '../generated/prisma/client.js';
import type { ApiGatewayRequest, ApiGatewayResponse } from '../api/http-types.js';
import { verifyMercadoPagoWebhookSignature } from '../subscriptions/mercado-pago-signature.js';
import type { ReconciliationResult } from '../subscriptions/subscription-payment-reconciliation-service.js';

interface MercadoPagoWebhookPayload {
  id: string | number;
  type: string;
  data: { id: string | number };
}

export interface MercadoPagoWebhookDependencies {
  getWebhookSecret(): Promise<string>;
  reconcile(input: {
    notificationId: string;
    eventType: string;
    paymentId: string;
    payload: Prisma.InputJsonValue;
  }): Promise<ReconciliationResult>;
}

function header(request: ApiGatewayRequest, name: string): string | undefined {
  const expected = name.toLowerCase();
  return Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === expected)?.[1];
}

function response(statusCode: number, body: object): ApiGatewayResponse {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function parsePayload(rawBody: string): MercadoPagoWebhookPayload | undefined {
  try {
    const value: unknown = JSON.parse(rawBody);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const payload = value as Partial<MercadoPagoWebhookPayload>;
    if ((typeof payload.id !== 'string' && typeof payload.id !== 'number') || typeof payload.type !== 'string'
      || typeof payload.data !== 'object' || payload.data === null
      || (typeof payload.data.id !== 'string' && typeof payload.data.id !== 'number')) return undefined;
    return payload as MercadoPagoWebhookPayload;
  } catch {
    return undefined;
  }
}

/** Handler puro: la Lambda futura sólo le proveerá secreto y conciliador. */
export function createMercadoPagoWebhookHandler(dependencies: MercadoPagoWebhookDependencies) {
  return async (request: ApiGatewayRequest): Promise<ApiGatewayResponse> => {
    const rawBody = request.body ?? '';
    const payload = parsePayload(rawBody);
    const dataId = request.queryStringParameters?.['data.id'] ?? (payload === undefined ? undefined : String(payload.data.id));
    if (payload === undefined || dataId === undefined) return response(400, { error: 'INVALID_EVENT' });
    if (String(payload.data.id) !== dataId) return response(400, { error: 'INVALID_EVENT' });
    try {
      const secret = await dependencies.getWebhookSecret();
      if (!verifyMercadoPagoWebhookSignature({
        ...(header(request, 'x-signature') === undefined ? {} : { xSignature: header(request, 'x-signature') }),
        ...(header(request, 'x-request-id') === undefined ? {} : { xRequestId: header(request, 'x-request-id') }),
        dataId, secret,
      })) return response(401, { error: 'INVALID_SIGNATURE' });
      const result = await dependencies.reconcile({
        notificationId: String(payload.id), eventType: payload.type, paymentId: dataId,
        payload: payload as unknown as Prisma.InputJsonValue,
      });
      return response(200, { received: true, ...result });
    } catch (error) {
      console.error('Mercado Pago webhook processing failed');
      return response(500, { error: 'TEMPORARY_FAILURE' });
    }
  };
}
