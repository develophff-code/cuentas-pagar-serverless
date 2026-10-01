import assert from 'node:assert/strict';
import test from 'node:test';
import { infrastructurePlan, parseInfrastructureProfile } from './infrastructure-profile.js';

test('perfil por defecto respeta el MVP sin sintetizar Aurora permanente ni Proxy/NAT', () => {
  assert.equal(parseInfrastructureProfile(undefined), 'mvp');
  assert.deepEqual(infrastructurePlan('mvp', false), { includeData: false, includeBusiness: false });
});

test('pedir negocio sin adaptar el MVP falla antes de preparar recursos caros', () => {
  assert.throws(() => infrastructurePlan('mvp', true), /todavía requiere adaptación/);
});

test('la infraestructura expandida necesita selección explícita', () => {
  assert.equal(parseInfrastructureProfile('expanded'), 'expanded');
  assert.deepEqual(infrastructurePlan('expanded', false), { includeData: true, includeBusiness: false });
  assert.deepEqual(infrastructurePlan('expanded', true), { includeData: true, includeBusiness: true });
  for (const value of ['typo', '', true, 20, null]) assert.throws(() => parseInfrastructureProfile(value));
});
