import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaymentLinkRedirectHandler } from '../../src/subscriptions/payment-link-redirect-handler.js';

test('redirige un token válido al Checkout sin almacenar la respuesta en caché', async () => {
  const handler = createPaymentLinkRedirectHandler(async () => 'https://checkout.mercadopago.com/valid');
  const response = await handler({ httpMethod: 'GET', path: '/p/token', pathParameters: { token: 'token' } });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, 'https://checkout.mercadopago.com/valid');
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('no revela el motivo de un enlace de pago inválido', async () => {
  const handler = createPaymentLinkRedirectHandler(async () => undefined);
  const response = await handler({ httpMethod: 'GET', path: '/p/token', pathParameters: { token: 'token' } });
  assert.equal(response.statusCode, 404);
});
