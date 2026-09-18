import { createHash } from 'node:crypto';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';

export function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = value.trim();
  if (!key) {
    throw new DomainRuleViolation('La clave de idempotencia no puede estar vacía.');
  }
  if (key.length > 200) {
    throw new DomainRuleViolation('La clave de idempotencia supera el máximo permitido.');
  }
  return key;
}

export function fingerprintCommand(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function assertSameCommand(
  storedFingerprint: string | null,
  expectedFingerprint: string,
): void {
  if (storedFingerprint !== expectedFingerprint) {
    throw new DomainRuleViolation(
      'La clave de idempotencia ya fue usada para una solicitud distinta.',
    );
  }
}
