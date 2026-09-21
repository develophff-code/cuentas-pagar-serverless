import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePaymentGridConfiguration } from './payment-grid-policy.js';
import { DomainRuleViolation } from './payment-policy.js';

const validConfiguration = {
  timezone: 'America/Argentina/Buenos_Aires', notificationTime: '08:00', lookAheadHours: 24,
  enabled: true, recipientMembershipIds: ['membership-1'],
};

test('acepta una configuración de alertas válida', () => {
  assert.doesNotThrow(() => validatePaymentGridConfiguration(validConfiguration));
});

test('rechaza horarios, zonas y destinatarios inválidos', () => {
  assert.throws(() => validatePaymentGridConfiguration({ ...validConfiguration, notificationTime: '25:00' }), DomainRuleViolation);
  assert.throws(() => validatePaymentGridConfiguration({ ...validConfiguration, timezone: 'invalid/timezone' }), DomainRuleViolation);
  assert.throws(() => validatePaymentGridConfiguration({ ...validConfiguration, recipientMembershipIds: ['membership-1', 'membership-1'] }), DomainRuleViolation);
});
