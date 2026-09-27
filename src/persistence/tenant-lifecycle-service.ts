import type { PrismaClient } from '../generated/prisma/client.js';
import type { TenantAccessStatus } from '../../packages/domain/src/model.js';
import { evaluateTenantAccess } from '../../packages/domain/src/tenant-access-policy.js';
import { evaluateSubscriptionAccess } from '../../packages/domain/src/subscription-lifecycle-policy.js';

export class TenantLifecycleService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Se invocará desde un job programado. También es seguro llamarlo al iniciar
   * una operación: la transición es monotónica y nunca borra información.
   */
  async reconcileAccess(tenantId: string, now = new Date()): Promise<TenantAccessStatus> {
    return this.prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenants.findUnique({ where: { id: tenantId } });
      if (tenant === null) {
        return 'ACCESS_EXPIRED';
      }

      const paidSubscription = await transaction.subscriptions.findFirst({
        where: { tenant_id: tenantId, status: { in: ['ACTIVE', 'BLOCKED_PAYMENT', 'EXPIRED'] } },
        orderBy: { ends_at: 'desc' },
      });
      if (paidSubscription !== null) {
        const access = evaluateSubscriptionAccess(paidSubscription.ends_at, now);
        await transaction.tenants.update({
          where: { id: tenantId },
          data: {
            access_status: access.status, blocked_until: access.status === 'BLOCKED_PAYMENT' ? access.blockedUntil : null,
            access_expires_at: access.status === 'ACCESS_EXPIRED' ? access.blockedUntil : null,
            data_purge_at: access.status === 'ACCESS_EXPIRED' ? access.dataPurgeAt : null,
          },
        });
        if (access.status !== 'ACTIVE') {
          await transaction.subscriptions.update({ where: { id: paidSubscription.id }, data: { status: access.status === 'BLOCKED_PAYMENT' ? 'BLOCKED_PAYMENT' : 'EXPIRED' } });
        }
        return access.status;
      }

      if (tenant.access_status === 'ACCESS_EXPIRED') return 'ACCESS_EXPIRED';

      const access = evaluateTenantAccess(tenant.trial_started_at, now);
      if (access.status === 'TRIAL') return 'TRIAL';

      await transaction.tenants.update({
        where: { id: tenantId },
        data: {
          access_status: access.status,
          ...(access.blockedUntil === undefined ? {} : { blocked_until: access.blockedUntil }),
          ...(access.status === 'ACCESS_EXPIRED' ? { access_expires_at: now } : {}),
        },
      });
      return access.status;
    }, { isolationLevel: 'Serializable' });
  }

  /** Entrada para el job diario; las mutaciones por tenant siguen siendo aisladas. */
  async reconcileAll(now = new Date()): Promise<{ reconciled: number }> {
    const tenants = await this.prisma.tenants.findMany({ select: { id: true } });
    for (const tenant of tenants) await this.reconcileAccess(tenant.id, now);
    return { reconciled: tenants.length };
  }
}
