import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createMercadoPagoWebhookHandler } from '../../src/webhooks/mercado-pago-webhook-handler.js';

const secret = 'mp_webhook_test_secret';
const requestId = 'request-1';
const dataId = 'payment-1';
const timestamp = '1789754400';
const rawBody = JSON.stringify({ id: 'notification-1', type: 'payment', data: { id: dataId } });

function signature(): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  return `ts=${timestamp},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
}

test('rechaza un ID de cuerpo distinto del ID firmado en la URL', async () => {
  const handler = createMercadoPagoWebhookHandler({
    getWebhookSecret: async () => secret,
    reconcile: async () => { assert.fail('No debe acreditar otro pago'); },
  });
  const response = await handler({ httpMethod: 'POST', path: '/api/webhook/mercado-pago',
    body: JSON.stringify({ id: 'notification-1', type: 'payment', data: { id: 'other-payment' } }),
    headers: { 'x-signature': signature(), 'x-request-id': requestId }, queryStringParameters: { 'data.id': dataId } });
  assert.equal(response.statusCode, 400);
});

test('acepta sólo un webhook firmado y delega la acreditación con el identificador del pago', async () => {
  let receivedPaymentId: string | undefined;
  const handler = createMercadoPagoWebhookHandler({
    getWebhookSecret: async () => secret,
    reconcile: async (input) => {
      receivedPaymentId = input.paymentId;
      return { duplicate: false, credited: true };
    },
  });
  const response = await handler({
    httpMethod: 'POST', path: '/api/webhook/mercado-pago', body: rawBody,
    headers: { 'x-signature': signature(), 'x-request-id': requestId },
    queryStringParameters: { 'data.id': dataId },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(receivedPaymentId, dataId);
  assert.equal(JSON.parse(response.body).credited, true);
});

test('rechaza una firma inválida sin intentar acreditar el pago', async () => {
  let reconciled = false;
  const handler = createMercadoPagoWebhookHandler({
    getWebhookSecret: async () => secret,
    reconcile: async () => {
      reconciled = true;
      return { duplicate: false, credited: true };
    },
  });
  const response = await handler({
    httpMethod: 'POST', path: '/api/webhook/mercado-pago', body: rawBody,
    headers: { 'x-signature': 'ts=1789754400,v1=00', 'x-request-id': requestId },
    queryStringParameters: { 'data.id': dataId },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(reconciled, false);
});
