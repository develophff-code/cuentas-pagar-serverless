import type { Prisma } from '../generated/prisma/client.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';

type Transaction = Prisma.TransactionClient;

async function currentCapabilities(transaction: Transaction, tenantId: string) {
  const tenant = await transaction.tenants.findUnique({
    where: { id: tenantId },
    select: { current_plan_code: true },
  });
  if (tenant?.current_plan_code === null || tenant === null) {
    throw new DomainRuleViolation('El tenant no tiene un plan configurado.');
  }

  const capabilities = await transaction.plan_capability_versions.findFirst({
    where: { plan_code: tenant.current_plan_code, valid_to: null },
  });
  if (capabilities === null) {
    throw new DomainRuleViolation('No hay capacidades vigentes para el plan del tenant.');
  }
  return capabilities;
}

export async function assertSupplierCapacity(transaction: Transaction, tenantId: string): Promise<void> {
  const capabilities = await currentCapabilities(transaction, tenantId);
  const activeSupplierCount = await transaction.suppliers.count({
    where: { tenant_id: tenantId, is_active: true },
  });
  if (activeSupplierCount >= capabilities.max_suppliers) {
    throw new DomainRuleViolation('El tenant alcanzó el límite de proveedores activos de su plan.');
  }
}

export async function assertMonthlyInvoiceCapacity(
  transaction: Transaction,
  tenantId: string,
  now = new Date(),
): Promise<void> {
  const capabilities = await currentCapabilities(transaction, tenantId);
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const invoiceCount = await transaction.invoices.count({
    where: { tenant_id: tenantId, created_at: { gte: startOfMonth } },
  });
  if (invoiceCount >= capabilities.max_invoices_per_month) {
    throw new DomainRuleViolation('El tenant alcanzó el límite mensual de facturas de su plan.');
  }
}
