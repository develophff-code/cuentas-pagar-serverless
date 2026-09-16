import type { MembershipRole } from './model.js';
import { DomainRuleViolation } from './payment-policy.js';

export function canManageMemberships(role: MembershipRole): boolean {
  return role === 'ADMIN';
}

export function validateOperatorRole(role: MembershipRole): void {
  if (role === 'ADMIN') {
    throw new DomainRuleViolation('El alta inicial es la única vía para crear un ADMIN.');
  }
}
