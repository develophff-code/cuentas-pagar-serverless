import assert from 'node:assert/strict';
import test from 'node:test';
import { MercadoPagoHttpClient } from '../../src/subscriptions/mercado-pago-client.js';

test('crea una preferencia Checkout Pro sólo con datos definidos por el servidor', async () => {
  let received: { url?: string; init?: { body?: string } } = {};
  const client = new MercadoPagoHttpClient('TEST-token', async (url, init) => {
    received = { url, init };
    return { ok: true, status: 201, json: async () => ({ id: 'pref-1', init_point: 'https://checkout.example/pref-1' }) };
  });
  const preference = await client.createPreference({
    title: 'Plan Profesional — renovación mensual', amount: 82000, currency: 'ARS', externalReference: 'order-1',
    notificationUrl: 'https://api.example/webhooks/mercado-pago',
    backUrls: { success: 'https://app.example/payment/success', failure: 'https://app.example/payment/failure', pending: 'https://app.example/payment/pending' },
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
  });
  assert.deepEqual(preference, { id: 'pref-1', checkoutUrl: 'https://checkout.example/pref-1' });
  assert.equal(received.url, 'https://api.mercadopago.com/checkout/preferences');
  assert.match(received.init?.body ?? '', /"external_reference":"order-1"/);
  assert.match(received.init?.body ?? '', /"unit_price":82000/);
});

test('consulta el pago por ID y no toma decisiones desde el cuerpo del webhook', async () => {
  const client = new MercadoPagoHttpClient('TEST-token', async () => ({
    ok: true, status: 200,
    json: async () => ({ id: 123, status: 'approved', external_reference: 'order-1', currency_id: 'ARS', transaction_amount: 82000 }),
  }));
  const payment = await client.getPayment('123');
  assert.deepEqual(payment, { id: '123', status: 'approved', externalReference: 'order-1', currency: 'ARS', transactionAmount: 82000 });
});
