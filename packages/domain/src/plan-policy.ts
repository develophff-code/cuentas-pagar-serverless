import type { EditablePlanCapabilities, PlanCode, PlanPriceVersion } from './model.js';
import { DomainRuleViolation } from './payment-policy.js';

export const TRIAL_LENGTH_DAYS = 7;

export function calculateTrialEndsAt(createdAt: Date): Date {
  const result = new Date(createdAt);
  result.setUTCDate(result.getUTCDate() + TRIAL_LENGTH_DAYS);
  return result;
}

export function validatePlanCapabilities(capabilities: EditablePlanCapabilities): void {
  if (!Number.isInteger(capabilities.maxInvoicesPerMonth) || capabilities.maxInvoicesPerMonth < 1) {
    throw new DomainRuleViolation('El límite mensual de facturas debe ser un entero positivo.');
  }

  if (!Number.isInteger(capabilities.maxSuppliers) || capabilities.maxSuppliers < 1) {
    throw new DomainRuleViolation('El límite de proveedores debe ser un entero positivo.');
  }

  if (!Number.isInteger(capabilities.maxActiveUsers) || capabilities.maxActiveUsers < 1) {
    throw new DomainRuleViolation('El límite de usuarios debe ser un entero positivo.');
  }

  if (capabilities.maxStorageBytes < 0n || capabilities.monthlyAiQueries < 0) {
    throw new DomainRuleViolation('Los límites de almacenamiento y consultas IA no pueden ser negativos.');
  }
}

export function selectActivePrice(
  planCode: PlanCode,
  prices: readonly PlanPriceVersion[],
  at: Date,
): PlanPriceVersion {
  const active = prices.filter(
    (price) =>
      price.planCode === planCode &&
      price.validFrom <= at &&
      (price.validTo === undefined || price.validTo > at),
  );

  if (active.length !== 1) {
    throw new DomainRuleViolation(`Debe existir exactamente un precio vigente para ${planCode}.`);
  }

  return active[0]!;
}
