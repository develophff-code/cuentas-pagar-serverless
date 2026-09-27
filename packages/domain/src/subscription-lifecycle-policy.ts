export const SUBSCRIPTION_GRACE_HOURS = 48;
export const SUBSCRIPTION_BLOCKED_DAYS = 7;
export const SUBSCRIPTION_DATA_RETENTION_DAYS = 90;

export interface SubscriptionAccessWindow {
  status: 'ACTIVE' | 'BLOCKED_PAYMENT' | 'ACCESS_EXPIRED';
  graceEndsAt: Date;
  blockedFrom: Date;
  blockedUntil: Date;
  dataPurgeAt: Date;
  allowsOperationalAccess: boolean;
  allowsBillingAccess: boolean;
}

function addUtcHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Evalúa renovación mensual: 48 h de gracia, 7 días de bloqueo y 90 de retención. */
export function evaluateSubscriptionAccess(periodEndsAt: Date, at: Date): SubscriptionAccessWindow {
  const graceEndsAt = addUtcHours(periodEndsAt, SUBSCRIPTION_GRACE_HOURS);
  const blockedFrom = graceEndsAt;
  const blockedUntil = addUtcDays(blockedFrom, SUBSCRIPTION_BLOCKED_DAYS);
  const dataPurgeAt = addUtcDays(blockedUntil, SUBSCRIPTION_DATA_RETENTION_DAYS);
  if (at < blockedFrom) {
    return { status: 'ACTIVE', graceEndsAt, blockedFrom, blockedUntil, dataPurgeAt, allowsOperationalAccess: true, allowsBillingAccess: true };
  }
  if (at < blockedUntil) {
    return { status: 'BLOCKED_PAYMENT', graceEndsAt, blockedFrom, blockedUntil, dataPurgeAt, allowsOperationalAccess: false, allowsBillingAccess: true };
  }
  return { status: 'ACCESS_EXPIRED', graceEndsAt, blockedFrom, blockedUntil, dataPurgeAt, allowsOperationalAccess: false, allowsBillingAccess: false };
}

/**
 * La tasa se expresa en millonésimos mensuales: 27.500 representa 2,75 %.
 * El cálculo es simple, diario y se redondea al centavo más cercano.
 */
export function calculateSubscriptionLateCharges(input: {
  historicalBaseAmountInCents: bigint;
  monthlyRateMillionths: bigint;
  blockedFrom: Date;
  blockedUntil: Date;
  at: Date;
}): { interestInCents: bigint; retentionSurchargeInCents: bigint } {
  if (input.historicalBaseAmountInCents < 0n || input.monthlyRateMillionths < 0n) {
    throw new Error('El importe histórico y la tasa deben ser no negativos.');
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const blockedDays = BigInt(Math.max(0, Math.ceil((Math.min(input.at.getTime(), input.blockedUntil.getTime()) - input.blockedFrom.getTime()) / dayMs)));
  const retainedDays = BigInt(Math.max(0, Math.ceil((input.at.getTime() - input.blockedUntil.getTime()) / dayMs)));
  const denominator = 30_000_000n;
  const calculate = (days: bigint) => (input.historicalBaseAmountInCents * input.monthlyRateMillionths * days + denominator / 2n) / denominator;
  return { interestInCents: calculate(blockedDays), retentionSurchargeInCents: calculate(retainedDays) };
}
