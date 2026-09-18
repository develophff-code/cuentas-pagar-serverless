import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import { createPrismaClientFromEnvironment } from '../../src/persistence/prisma-client.js';
import { InvoiceService } from '../../src/persistence/invoice-service.js';
import { SupplierService } from '../../src/persistence/supplier-service.js';
import { TenantService } from '../../src/persistence/tenant-service.js';

test('PostgreSQL conserva un único resultado para reintentos HTTP', async () => {
  const prisma = createPrismaClientFromEnvironment();
  const suffix = randomUUID();
  let tenantId: string | undefined;
  let userId: string | undefined;

  try {
    const tenant = await new TenantService(prisma).registerWebTenant({
      businessName: `Integración ${suffix}`,
      planCode: 'PROFESSIONAL',
      administrator: {
        cognitoSub: `integration-${suffix}`,
        email: `integration-${suffix}@example.invalid`,
      },
    });
    tenantId = tenant.tenantId;
    userId = tenant.adminUserId;
    const actor = { tenantId, userId, role: 'ADMIN' as const };

    const supplierService = new SupplierService(prisma);
    const supplierFirst = await supplierService.create(
      { businessName: 'Proveedor de integración', mobilePhone: '+5491100000000' },
      actor,
      { idempotencyKey: 'supplier-retry-001' },
    );
    const supplierRetry = await supplierService.create(
      { businessName: 'Proveedor de integración', mobilePhone: '+5491100000000' },
      actor,
      { idempotencyKey: 'supplier-retry-001' },
    );
    assert.equal(supplierFirst.idempotent, false);
    assert.deepEqual(supplierRetry, { id: supplierFirst.id, idempotent: true });
    await assert.rejects(
      () => supplierService.create(
        { businessName: 'Proveedor distinto', mobilePhone: '+5491100000000' },
        actor,
        { idempotencyKey: 'supplier-retry-001' },
      ),
      DomainRuleViolation,
    );

    const invoiceService = new InvoiceService(prisma);
    const invoiceInput = {
      tenantId,
      supplierId: supplierFirst.id,
      invoiceType: 'INFORMAL' as const,
      description: 'Servicio de integración',
      amountInCents: 15_000n,
      dueDate: new Date('2030-01-15T00:00:00.000Z'),
    };
    const invoiceFirst = await invoiceService.create(invoiceInput, actor, {
      confirmImmediately: true,
      idempotencyKey: 'invoice-retry-001',
    });
    const invoiceRetry = await invoiceService.create(invoiceInput, actor, {
      confirmImmediately: true,
      idempotencyKey: 'invoice-retry-001',
    });
    assert.equal(invoiceFirst.idempotent, false);
    assert.deepEqual(invoiceRetry, {
      id: invoiceFirst.id,
      status: 'IN_GRID',
      idempotent: true,
    });
    await assert.rejects(
      () => invoiceService.create({ ...invoiceInput, amountInCents: 16_000n }, actor, {
        confirmImmediately: true,
        idempotencyKey: 'invoice-retry-001',
      }),
      DomainRuleViolation,
    );
  } finally {
    if (tenantId !== undefined) {
      await prisma.audit_events.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.invoices.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.suppliers.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.subscriptions.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.payment_grid_configs.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.tenant_memberships.deleteMany({ where: { tenant_id: tenantId } });
      await prisma.tenants.delete({ where: { id: tenantId } });
    }
    if (userId !== undefined) {
      await prisma.application_users.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  }
});
