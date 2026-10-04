import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRetryDelay } from '../../src/notifications/dispatch-queue.js';

test('reintentos SQS respetan fecha futura, redondeo y máximo de quince minutos', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  assert.equal(dispatchRetryDelay(new Date(now.getTime() - 1000), now), 0);
  assert.equal(dispatchRetryDelay(new Date(now.getTime() + 1501), now), 2);
  assert.equal(dispatchRetryDelay(new Date(now.getTime() + 3600_000), now), 900);
});
