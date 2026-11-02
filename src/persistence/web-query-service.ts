import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuthenticatedActor } from '../api/http-handler.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';

/** Queries receive an actor already authorized against the requested tenant. */
export class WebQueryService {
  constructor(private readonly prisma: PrismaClient) {}

  async memberships(sub: string) {
    const user = await this.prisma.application_users.findUnique({ where: { cognito_sub: sub } });
    if (!user?.is_active) return [];
    const rows = await this.prisma.tenant_memberships.findMany({
      where: { user_id: user.id, is_active: true }, include: { tenants: true },
      orderBy: { created_at: 'asc' },
    });
    return rows.map(row => ({ tenantId: row.tenant_id, businessName: row.tenants.business_name }));
  }

  async context(actor: AuthenticatedActor & { accessStatus?: string }) {
    const tenant = await this.prisma.tenants.findUniqueOrThrow({ where: { id: actor.tenantId } });
    if (tenant.current_plan_code !== 'PROFESSIONAL' && tenant.current_plan_code !== 'ULTRA') {
      throw new DomainRuleViolation('La empresa no tiene un plan web habilitado.');
    }
    return { tenantId: actor.tenantId, businessName: tenant.business_name,
      planCode: tenant.current_plan_code, userRole: actor.role,
      operationalAccess: actor.accessStatus === 'ACTIVE' || actor.accessStatus === 'TRIAL' };
  }

  async suppliers(actor: AuthenticatedActor) {
    const rows = await this.prisma.suppliers.findMany({
      where: { tenant_id: actor.tenantId, is_active: true }, include: { categories: true },
      orderBy: { business_name: 'asc' },
    });
    return rows.map(row => ({ id: row.id, businessName: row.business_name, mobilePhone: row.mobile_phone,
      cuit: row.cuit ?? undefined, categoryCode: row.category_code ?? undefined,
      categoryName: row.categories?.name }));
  }

  async categories() {
    const rows = await this.prisma.categories.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } });
    return [...rows.map(row => ({ code: row.code, name: row.name })), { code: 'SIN_CLASIFICAR', name: 'Sin clasificar (transitorio)' }];
  }

  async invoices(actor: AuthenticatedActor) {
    const rows = await this.prisma.invoices.findMany({
      where: { tenant_id: actor.tenantId }, include: { suppliers: true }, orderBy: { due_date: 'asc' },
    });
    return rows.map(row => ({ id: row.id, supplierId: row.supplier_id,
      supplierName: row.suppliers.business_name, invoiceType: row.invoice_type,
      invoiceNumber: row.invoice_number ?? undefined, description: row.description ?? undefined,
      amountInCents: row.amount.mul(100).toFixed(0), dueDate: row.due_date.toISOString(),
      scheduledPaymentDate: row.scheduled_payment_date?.toISOString(),
      status: row.status === 'CANCELED' ? 'CANCELLED' : row.status }));
  }

  async configuration(actor: AuthenticatedActor) {
    const row = await this.prisma.payment_grid_configs.findUnique({ where: { tenant_id: actor.tenantId } });
    const recipients = await this.prisma.payment_grid_recipients.findMany({
      where: { tenant_id: actor.tenantId, enabled: true },
    });
    return { timezone: row?.timezone ?? 'America/Argentina/Buenos_Aires',
      notificationTime: row?.notification_time.toISOString().slice(11, 16) ?? '08:00',
      lookAheadHours: row?.look_ahead_hours ?? 24, enabled: row?.enabled ?? false,
      recipientMembershipIds: recipients.map(item => item.membership_id) };
  }

  async batches(actor: AuthenticatedActor) {
    const rows = await this.prisma.payment_batches.findMany({ where: {
      tenant_id: actor.tenantId, status: { in: ['RECORDED', 'PENDING_APPROVAL', 'REVERSED'] },
    }, include: { payment_items: true }, orderBy: { created_at: 'desc' } });
    return rows.map(row => ({ batchId: row.id, status: row.status,
      totalInCents: row.payment_items.reduce((sum, item) => sum + BigInt(item.amount.mul(100).toFixed(0)), 0n).toString(),
      invoiceIds: row.payment_items.map(item => item.invoice_id),
      proposedAt: row.proposed_at.toISOString(),
      reversalReason: row.reversal_reason ?? undefined }));
  }

  async members(actor: AuthenticatedActor) {
    const rows = await this.prisma.tenant_memberships.findMany({ where: { tenant_id: actor.tenantId },
      include: { application_users_tenant_memberships_user_idToapplication_users: true } });
    return rows.map(row => {
      const user = row.application_users_tenant_memberships_user_idToapplication_users;
      return { membershipId: row.id, email: user.email, fullName: user.full_name ?? '',
        role: row.role, active: row.is_active && user.is_active };
    });
  }
}
