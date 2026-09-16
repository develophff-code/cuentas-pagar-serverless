import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeploymentStage, TARGET_REGION } from './environment.js';

test('usa Norte de Virginia como región objetivo', () => {
  assert.equal(TARGET_REGION, 'us-east-1');
});

test('acepta sólo los ambientes definidos', () => {
  assert.equal(parseDeploymentStage('staging'), 'staging');
  assert.throws(() => parseDeploymentStage('production'));
});
