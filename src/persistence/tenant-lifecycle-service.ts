import type { PrismaClient } from '../generated/prisma/client.js';
import type { TenantAccessStatus } from '../../packages/domain/src/model.js';
import { evaluateTenantAccess } from '../../packages/domain/src/tenant-access-policy.js';

export class TenantLifecycleService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Se invocará desde un job programado. También es seguro llamarlo al iniciar
   * una operación: la transición es monotónica y nunca borra información.
   */
  async reconcileAccess(tenantId: string, now = new Date()): Promise<TenantAccessStatus> {
    return this.prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenants.findUnique({ where: { id: tenantId } });
      if (tenant === null || tenant.access_status === 'ACTIVE' || tenant.access_status === 'ACCESS_EXPIRED') {
        return (tenant?.access_status ?? 'ACCESS_EXPIRED') as TenantAccessStatus;
      }

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
}
