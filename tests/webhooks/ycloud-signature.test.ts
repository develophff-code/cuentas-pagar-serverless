import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyYCloudSignature } from '../../src/webhooks/ycloud-signature.js';

const secret = 'whsec_test_only';
const now = new Date('2026-09-18T18:00:00.000Z');
const body = '{"id":"evt_1","type":"whatsapp.message.updated","apiVersion":"v2","createTime":"2026-09-18T18:00:00.000Z"}';

function signature(timestamp = '1789754400'): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},s=${digest}`;
}

test('acepta una firma HMAC YCloud sobre el cuerpo original', () => {
  assert.equal(verifyYCloudSignature(body, signature(), secret, now), true);
});

test('rechaza cambios de cuerpo, firmas inválidas y eventos vencidos', () => {
  assert.equal(verifyYCloudSignature(`${body} `, signature(), secret, now), false);
  assert.equal(verifyYCloudSignature(body, 't=1789754400,s=00', secret, now), false);
  assert.equal(verifyYCloudSignature(body, signature('1789753000'), secret, now), false);
});
