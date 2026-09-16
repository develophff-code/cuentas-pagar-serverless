import type { PrismaClient } from '../generated/prisma/client.js';
import type { MembershipRole, PlanCode } from '../../packages/domain/src/model.js';
import { canManageMemberships, validateOperatorRole } from '../../packages/domain/src/membership-policy.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import { calculateTrialEndsAt } from '../../packages/domain/src/tenant-access-policy.js';

export interface WebAdministratorInput {
  cognitoSub: string;
  email: string;
  fullName?: string;
}

export interface RegisterWebTenantInput {
  businessName: string;
  cuit?: string;
  planCode: Exclude<PlanCode, 'BASIC'>;
  administrator: WebAdministratorInput;
}

export interface OperatorInput {
  email: string;
  fullName?: string;
  role: Exclude<MembershipRole, 'ADMIN'>;
}

function requiredTrimmed(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainRuleViolation(`${fieldName} es obligatorio.`);
  }
  return trimmed;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export class TenantService {
  constructor(private readonly prisma: PrismaClient) {}

  async registerWebTenant(input: RegisterWebTenantInput, now = new Date()): Promise<{ tenantId: string; adminUserId: string }> {
    const businessName = requiredTrimmed(input.businessName, 'La razón social');
    const cognitoSub = requiredTrimmed(input.administrator.cognitoSub, 'El identificador de Cognito');
    const email = requiredTrimmed(input.administrator.email, 'El email').toLowerCase();
    const fullName = optionalTrimmed(input.administrator.fullName);
    const cuit = optionalTrimmed(input.cuit);
    const trialEndsAt = calculateTrialEndsAt(now);

    return this.prisma.$transaction(async (transaction) => {
      const plan = await transaction.plans.findUnique({ where: { code: input.planCode } });
      if (plan === null) {
        throw new DomainRuleViolation('El plan seleccionado no está disponible.');
      }

      const userBySub = await transaction.application_users.findUnique({
        where: { cognito_sub: cognitoSub },
      });
      const userByEmail = await transaction.application_users.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (userBySub !== null && userByEmail !== null && userBySub.id !== userByEmail.id) {
        throw new DomainRuleViolation('El email ya pertenece a otra identidad de usuario.');
      }

      const existingUser = userBySub ?? userByEmail;
      const administrator = existingUser === null
        ? await transaction.application_users.create({
            data: {
              cognito_sub: cognitoSub,
              email,
              ...(fullName === undefined ? {} : { full_name: fullName }),
            },
          })
        : await transaction.application_users.update({
            where: { id: existingUser.id },
            data: {
              cognito_sub: cognitoSub,
              email,
              ...(fullName === undefined ? {} : { full_name: fullName }),
              is_active: true,
            },
          });

      const tenant = await transaction.tenants.create({
        data: {
          business_name: businessName,
          ...(cuit === undefined ? {} : { cuit }),
          access_status: 'TRIAL',
          trial_started_at: now,
          trial_ends_at: trialEndsAt,
          current_plan_code: input.planCode,
          tenant_memberships: {
            create: {
              user_id: administrator.id,
              role: 'ADMIN',
              created_by_user_id: administrator.id,
            },
          },
          payment_grid_configs: { create: {} },
          subscriptions: {
            create: {
              plan_code: input.planCode,
              status: 'TRIAL',
              starts_at: now,
              ends_at: trialEndsAt,
            },
          },
        },
      });

      await transaction.audit_events.create({
        data: {
          tenant_id: tenant.id,
          actor_user_id: administrator.id,
          action: 'TENANT_REGISTERED',
          entity_type: 'TENANT',
          entity_id: tenant.id,
          source: 'WEB',
          metadata: { planCode: input.planCode },
        },
      });

      return { tenantId: tenant.id, adminUserId: administrator.id };
    }, { isolationLevel: 'Serializable' });
  }

  async addOperator(
    tenantId: string,
    adminUserId: string,
    adminRole: MembershipRole,
    input: OperatorInput,
  ): Promise<{ membershipId: string }> {
    if (!canManageMemberships(adminRole)) {
      throw new DomainRuleViolation('Sólo ADMIN puede administrar operadores.');
    }
    validateOperatorRole(input.role);
    const email = requiredTrimmed(input.email, 'El email').toLowerCase();
    const fullName = optionalTrimmed(input.fullName);

    return this.prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenants.findUnique({ where: { id: tenantId } });
      if (tenant === null || tenant.current_plan_code === null) {
        throw new DomainRuleViolation('El tenant no tiene un plan operativo configurado.');
      }
      if (tenant.current_plan_code === 'BASIC') {
        throw new DomainRuleViolation('El plan Básico no admite operadores web.');
      }

      const administratorMembership = await transaction.tenant_memberships.findUnique({
        where: { tenant_id_user_id: { tenant_id: tenantId, user_id: adminUserId } },
      });
      if (administratorMembership === null || !administratorMembership.is_active || administratorMembership.role !== 'ADMIN') {
        throw new DomainRuleViolation('La identidad no es ADMIN activo del tenant.');
      }

      const capabilities = await transaction.plan_capability_versions.findFirst({
        where: { plan_code: tenant.current_plan_code, valid_to: null },
      });
      if (capabilities === null) {
        throw new DomainRuleViolation('No hay capacidades vigentes para el plan del tenant.');
      }

      const existingUser = await transaction.application_users.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      const operator = existingUser === null
        ? await transaction.application_users.create({
            data: { email, ...(fullName === undefined ? {} : { full_name: fullName }) },
          })
        : await transaction.application_users.update({
            where: { id: existingUser.id },
            data: { ...(fullName === undefined ? {} : { full_name: fullName }), is_active: true },
          });

      const priorMembership = await transaction.tenant_memberships.findUnique({
        where: { tenant_id_user_id: { tenant_id: tenantId, user_id: operator.id } },
      });
      if (priorMembership === null || !priorMembership.is_active) {
        const activeMemberCount = await transaction.tenant_memberships.count({
          where: { tenant_id: tenantId, is_active: true },
        });
        if (activeMemberCount >= capabilities.max_active_users) {
          throw new DomainRuleViolation('El tenant alcanzó el límite de usuarios activos de su plan.');
        }
      }

      const membership = await transaction.tenant_memberships.upsert({
        where: { tenant_id_user_id: { tenant_id: tenantId, user_id: operator.id } },
        create: {
          tenant_id: tenantId,
          user_id: operator.id,
          role: input.role,
          created_by_user_id: adminUserId,
        },
        update: { role: input.role, is_active: true, created_by_user_id: adminUserId },
      });

      await transaction.audit_events.create({
        data: {
          tenant_id: tenantId,
          actor_user_id: adminUserId,
          action: 'OPERATOR_ASSIGNED',
          entity_type: 'TENANT_MEMBERSHIP',
          entity_id: membership.id,
          source: 'WEB',
          metadata: { role: input.role },
        },
      });

      return { membershipId: membership.id };
    }, { isolationLevel: 'Serializable' });
  }
}
