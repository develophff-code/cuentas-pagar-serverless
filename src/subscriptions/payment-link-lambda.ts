import { getRuntimePrismaClient } from '../persistence/runtime-prisma-client.js';
import { createPaymentLinkRedirectHandler } from './payment-link-redirect-handler.js';
import { PaymentLinkTokenService } from './payment-link-token-service.js';
import type { ApiGatewayRequest, ApiGatewayResponse } from '../api/http-types.js';

export async function handler(event: ApiGatewayRequest): Promise<ApiGatewayResponse> {
  if (event.pathParameters?.result) {
    const texts: Record<string, string> = {
      success: 'Estamos verificando el pago con Mercado Pago. La suscripción se activará al confirmar la acreditación.',
      pending: 'Tu pago está pendiente. Te avisaremos cuando Mercado Pago confirme la acreditación.',
      failure: 'El pago no se completó. Podés volver a intentar desde tu enlace de renovación mientras esté vigente.',
    };
    const text = texts[event.pathParameters.result];
    if (!text) return { statusCode: 404, headers: { 'cache-control': 'no-store' }, body: '' };
    return { statusCode: 200, headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
    }, body: `<!doctype html><html lang="es-AR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cuentas a Pagar — Pago</title><style>body{font:18px system-ui;margin:15vh auto;padding:24px;max-width:560px;color:#193348}h1{font-size:28px}p{line-height:1.6}</style><h1>Cuentas a Pagar</h1><p>${text}</p></html>` };
  }
  try {
    const prisma = await getRuntimePrismaClient();
    return await createPaymentLinkRedirectHandler((token) => new PaymentLinkTokenService(prisma).resolve(token))(event);
  } catch {
    return { statusCode: 503, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'TEMPORARY_FAILURE' }) };
  }
}
