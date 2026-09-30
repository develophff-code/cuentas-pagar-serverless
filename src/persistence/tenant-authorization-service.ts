import type { PrismaClient } from '../generated/prisma/client.js';
import type { MembershipRole, TenantAccessStatus } from '../../packages/domain/src/model.js';
import {
  allowsBillingAccess,
  allowsOperationalAccess,
  assertAuthorizedRole,
} from '../../packages/domain/src/authorization-policy.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import { evaluateTenantAccess } from '../../packages/domain/src/tenant-access-policy.js';

export interface AuthorizedTenantActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  accessStatus: TenantAccessStatus;
}

export class TenantAuthorizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async authorizeOperational(
    cognitoSub: string,
    tenantId: string,
    allowedRoles: readonly MembershipRole[],
    now = new Date(),
  ): Promise<AuthorizedTenantActor> {
    const { actor } = await this.resolveMembership(cognitoSub, tenantId, now);
    if (!allowsOperationalAccess(actor.accessStatus)) {
      throw new DomainRuleViolation('El tenant no tiene acceso operativo. Debe renovar su suscripción.');
    }
    assertAuthorizedRole(actor.role, allowedRoles);
    return actor;
  }

  async authorizeBilling(
    cognitoSub: string,
    tenantId: string,
    allowedRoles: readonly MembershipRole[] = ['ADMIN'],
    now = new Date(),
  ): Promise<AuthorizedTenantActor> {
    const { actor } = await this.resolveMembership(cognitoSub, tenantId, now);
    if (!allowsBillingAccess(actor.accessStatus)) {
      throw new DomainRuleViolation('El tenant ya no tiene acceso a facturación.');
    }
    assertAuthorizedRole(actor.role, allowedRoles);
    return actor;
  }

  /**
   * La baja de acceso no impide que el ADMIN regularice durante la retención.
   * No habilita ninguna operación del producto: sólo la creación de la orden
   * de renovación, que volverá a activar el tenant tras la conciliación.
   */
  async authorizeSubscriptionRenewal(
    cognitoSub: string,
    tenantId: string,
    allowedRoles: readonly MembershipRole[] = ['ADMIN'],
    now = new Date(),
  ): Promise<AuthorizedTenantActor> {
    const resolved = await this.resolveMembership(cognitoSub, tenantId, now);
    if (!allowsBillingAccess(resolved.actor.accessStatus)
      && !(resolved.actor.accessStatus === 'ACCESS_EXPIRED'
        && resolved.dataPurgeAt !== null
        && now < resolved.dataPurgeAt)) {
      throw new DomainRuleViolation('El período de retención para renovar este tenant ya finalizó.');
    }
    assertAuthorizedRole(resolved.actor.role, allowedRoles);
    return resolved.actor;
  }

  private async resolveMembership(
    cognitoSub: string,
    tenantId: string,
    now: Date,
  ): Promise<{ actor: AuthorizedTenantActor; dataPurgeAt: Date | null }> {
    const user = await this.prisma.application_users.findUnique({
      where: { cognito_sub: cognitoSub },
      select: { id: true, is_active: true },
    });
    if (user === null || !user.is_active) {
      throw new DomainRuleViolation('La identidad autenticada no está habilitada.');
    }

    const membership = await this.prisma.tenant_memberships.findUnique({
      where: { tenant_id_user_id: { tenant_id: tenantId, user_id: user.id } },
      include: { tenants: true },
    });
    if (membership === null || !membership.is_active) {
      throw new DomainRuleViolation('La identidad no pertenece a un tenant activo.');
    }

    const accessStatus = this.effectiveAccessStatus(
      membership.tenants.access_status as TenantAccessStatus,
      membership.tenants.trial_started_at,
      membership.tenants.blocked_until,
      membership.tenants.access_expires_at,
      now,
    );
    return {
      actor: {
        tenantId,
        userId: user.id,
        role: membership.role as MembershipRole,
        accessStatus,
      },
      dataPurgeAt: membership.tenants.data_purge_at,
    };
  }

  private effectiveAccessStatus(
    persistedStatus: TenantAccessStatus,
    trialStartedAt: Date,
    blockedUntil: Date | null,
    accessExpiresAt: Date | null,
    now: Date,
  ): TenantAccessStatus {
    if (persistedStatus === 'ACTIVE') return 'ACTIVE';
    if (persistedStatus === 'ACCESS_EXPIRED') return 'ACCESS_EXPIRED';

    if (persistedStatus === 'BLOCKED_PAYMENT') {
      if (blockedUntil !== null && now >= blockedUntil) return 'ACCESS_EXPIRED';
      return 'BLOCKED_PAYMENT';
    }

    const evaluated = evaluateTenantAccess(trialStartedAt, now);
    if (evaluated.status === 'TRIAL') return 'TRIAL';
    if (evaluated.status === 'BLOCKED_PAYMENT') return 'BLOCKED_PAYMENT';
    if (accessExpiresAt !== null && now < accessExpiresAt) return 'BLOCKED_PAYMENT';
    return 'ACCESS_EXPIRED';
  }
}
