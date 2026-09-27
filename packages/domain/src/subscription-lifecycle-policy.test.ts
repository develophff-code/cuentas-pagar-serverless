import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSubscriptionLateCharges, evaluateSubscriptionAccess } from './subscription-lifecycle-policy.js';

const periodEndsAt = new Date('2026-10-01T00:00:00.000Z');

test('mantiene operatoria durante las 48 horas de gracia y bloquea los siete días siguientes', () => {
  const grace = evaluateSubscriptionAccess(periodEndsAt, new Date('2026-10-02T23:59:59.000Z'));
  assert.equal(grace.status, 'ACTIVE');
  assert.equal(grace.allowsOperationalAccess, true);
  const blocked = evaluateSubscriptionAccess(periodEndsAt, new Date('2026-10-03T00:00:00.000Z'));
  assert.equal(blocked.status, 'BLOCKED_PAYMENT');
  assert.equal(blocked.allowsBillingAccess, true);
  const expired = evaluateSubscriptionAccess(periodEndsAt, new Date('2026-10-10T00:00:00.000Z'));
  assert.equal(expired.status, 'ACCESS_EXPIRED');
  assert.equal(expired.dataPurgeAt.toISOString(), '2027-01-08T00:00:00.000Z');
});

test('calcula interés sólo durante el bloqueo y recargo de conservación después de la baja', () => {
  const { blockedFrom, blockedUntil } = evaluateSubscriptionAccess(periodEndsAt, periodEndsAt);
  const charges = calculateSubscriptionLateCharges({
    historicalBaseAmountInCents: 82_000_00n, monthlyRateMillionths: 27_500n,
    blockedFrom, blockedUntil, at: new Date('2026-10-15T00:00:00.000Z'),
  });
  assert.equal(charges.interestInCents, 52_617n);
  assert.equal(charges.retentionSurchargeInCents, 37_583n);
});
