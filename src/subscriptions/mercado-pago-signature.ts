import { createHmac, timingSafeEqual } from 'node:crypto';

function headerParts(value: string | undefined): Map<string, string> {
  const parts = new Map<string, string>();
  for (const item of value?.split(',') ?? []) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim().toLowerCase();
    const content = item.slice(separator + 1).trim();
    if (key && content) parts.set(key, content);
  }
  return parts;
}

/**
 * Verifica la firma descrita por Mercado Pago para Webhooks. La notificación
 * sólo identifica un recurso: su estado final siempre se consulta a la API.
 */
export function verifyMercadoPagoWebhookSignature(input: {
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
  secret: string;
}): boolean {
  if (!input.secret || !input.xRequestId || !input.dataId) return false;
  const parts = headerParts(input.xSignature);
  const timestamp = parts.get('ts');
  const signature = parts.get('v1');
  if (!timestamp || !signature || !/^[0-9]+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;

  // El SDK oficial usa este manifiesto; data.id se normaliza para que la
  // comparación no dependa de mayúsculas enviadas por el proveedor.
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${timestamp};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
