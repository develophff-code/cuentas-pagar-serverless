import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyMercadoPagoWebhookSignature } from '../../src/subscriptions/mercado-pago-signature.js';

const secret = 'mp_webhook_secret_for_tests';
const dataId = 'PAYMENT_123';
const requestId = 'request-456';
const timestamp = '1789754400';

function signature(): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const value = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${timestamp},v1=${value}`;
}

test('acepta una firma HMAC de Mercado Pago basada en data.id y x-request-id', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    xSignature: signature(), xRequestId: requestId, dataId, secret,
  }), true);
});

test('rechaza firmas, manifiestos y encabezados incompletos', () => {
  assert.equal(verifyMercadoPagoWebhookSignature({
    xSignature: signature(), xRequestId: 'otro-request', dataId, secret,
  }), false);
  assert.equal(verifyMercadoPagoWebhookSignature({
    xSignature: 'ts=1789754400,v1=00', xRequestId: requestId, dataId, secret,
  }), false);
  assert.equal(verifyMercadoPagoWebhookSignature({
    xSignature: signature(), xRequestId: requestId, secret,
  }), false);
});
