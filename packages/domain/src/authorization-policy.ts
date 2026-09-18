import type { MembershipRole, TenantAccessStatus } from './model.js';
import { DomainRuleViolation } from './payment-policy.js';

export function allowsOperationalAccess(status: TenantAccessStatus): boolean {
  return status === 'TRIAL' || status === 'ACTIVE';
}

export function allowsBillingAccess(status: TenantAccessStatus): boolean {
  return status === 'TRIAL' || status === 'ACTIVE' || status === 'BLOCKED_PAYMENT';
}

export function assertAuthorizedRole(
  actualRole: MembershipRole,
  allowedRoles: readonly MembershipRole[],
): void {
  if (!allowedRoles.includes(actualRole)) {
    throw new DomainRuleViolation('El rol no está autorizado para esta operación.');
  }
}
