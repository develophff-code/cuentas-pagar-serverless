import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTrialEndsAt, selectActivePrice, validatePlanCapabilities } from './plan-policy.js';
import { INITIAL_PLAN_CAPABILITIES } from './initial-plan-catalog.js';

test('la prueba termina siete días después del alta', () => {
  assert.equal(calculateTrialEndsAt(new Date('2026-09-16T00:00:00.000Z')).toISOString(), '2026-09-23T00:00:00.000Z');
});

test('elige el precio vigente y conserva versionado', () => {
  const selected = selectActivePrice(
    'PROFESSIONAL',
    [
      {
        planCode: 'PROFESSIONAL',
        amountInCents: 250000n,
        currency: 'ARS',
        validFrom: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
    new Date('2026-09-16T00:00:00.000Z'),
  );

  assert.equal(selected.amountInCents, 250000n);
});

test('no permite capacidades negativas o vacías', () => {
  assert.throws(() =>
    validatePlanCapabilities({
      maxInvoicesPerMonth: 0,
      maxSuppliers: 25,
      maxActiveUsers: 1,
      maxStorageBytes: 0n,
      monthlyAiQueries: 0,
      dashboardEnabled: false,
      supplierNotificationsEnabled: false,
      webOperationsEnabled: false,
      webAdministrationEnabled: false,
      aiChatEnabled: false,
    }),
  );
});

test('la grilla inicial conserva los límites y capacidades comerciales', () => {
  assert.deepEqual(INITIAL_PLAN_CAPABILITIES.BASIC.maxInvoicesPerMonth, 100);
  assert.deepEqual(INITIAL_PLAN_CAPABILITIES.PROFESSIONAL.maxSuppliers, 80);
  assert.deepEqual(INITIAL_PLAN_CAPABILITIES.ULTRA.maxActiveUsers, 5);
  assert.equal(INITIAL_PLAN_CAPABILITIES.PROFESSIONAL.webOperationsEnabled, true);
  assert.equal(INITIAL_PLAN_CAPABILITIES.PROFESSIONAL.webAdministrationEnabled, true);
  assert.equal(INITIAL_PLAN_CAPABILITIES.ULTRA.aiChatEnabled, true);
});
