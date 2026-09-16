import type { TenantAccessWindow } from './model.js';

export const TRIAL_LENGTH_DAYS = 7;
export const TRIAL_WARNING_START_DAYS = 5;
export const BLOCKED_PAYMENT_LENGTH_DAYS = 7;

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function calculateTrialEndsAt(createdAt: Date): Date {
  return addUtcDays(createdAt, TRIAL_LENGTH_DAYS);
}

/**
 * Evalúa sólo el acceso. Nunca ordena borrado de tenant o de información;
 * la retención posterior a ACCESS_EXPIRED queda pendiente de política legal.
 */
export function evaluateTenantAccess(createdAt: Date, at: Date): TenantAccessWindow {
  const trialEndsAt = calculateTrialEndsAt(createdAt);
  const warningStartsAt = addUtcDays(createdAt, TRIAL_WARNING_START_DAYS);

  if (at < trialEndsAt) {
    return {
      status: 'TRIAL',
      trialEndsAt,
      shouldSendTrialWarning: at >= warningStartsAt,
      allowsOperationalAccess: true,
      allowsBillingAccess: true,
    };
  }

  const blockedUntil = addUtcDays(trialEndsAt, BLOCKED_PAYMENT_LENGTH_DAYS);
  if (at < blockedUntil) {
    return {
      status: 'BLOCKED_PAYMENT',
      trialEndsAt,
      blockedUntil,
      shouldSendTrialWarning: false,
      allowsOperationalAccess: false,
      allowsBillingAccess: true,
    };
  }

  return {
    status: 'ACCESS_EXPIRED',
    trialEndsAt,
    blockedUntil,
    shouldSendTrialWarning: false,
    allowsOperationalAccess: false,
    allowsBillingAccess: false,
  };
}
