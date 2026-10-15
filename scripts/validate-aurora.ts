/**
 * Validación manual contra Aurora (dev) por Data API: idempotencia, aislamiento
 * entre tenants, concurrencia y transacciones de pago. No forma parte de `npm test`.
 * Uso: npm run db:validate:aurora (requiere SSO y las variables DATABASE_*).
 * Crea datos con el prefijo AURORA-VALIDATION y los elimina al terminar.
 */
import { randomUUID } from 'node:crypto';
import { DomainRuleViolation } from '../packages/domain/src/payment-policy.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { AwsDataApiTransport, PrismaDataApi } from '../src/persistence/data-api-adapter.js';
import { InvoiceService } from '../src/persistence/invoice-service.js';
import { PaymentBatchService } from '../src/persistence/payment-batch-service.js';
import { SupplierService } from '../src/persistence/supplier-service.js';
import { TenantService } from '../src/persistence/tenant-service.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message.slice(-1200) : 'error' });
  }
}
function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
async function rejects(fn: () => Promise<unknown>, type: new (...a: never[]) => Error = DomainRuleViolation as never): Promise<void> {
  try { await fn(); } catch (error) { if (error instanceof type) return; throw new Error(`error inesperado: ${(error as Error).message.slice(0, 100)}`); }
  throw new Error('se esperaba un rechazo y la operación fue aceptada');
}

async function main(): Promise<void> {
  const config = { resourceArn: process.env.DATABASE_CLUSTER_ARN ?? '',
    secretArn: process.env.DATABASE_CREDENTIALS_SECRET_ARN ?? '', database: process.env.DATABASE_NAME ?? '' };
  if (process.env.DEPLOYMENT_STAGE !== 'dev') throw new Error('Sólo se permite DEPLOYMENT_STAGE=dev.');
  const diagnostic = new AwsDataApiTransport();
  const wrap = <T>(label: string, op: () => Promise<T>): Promise<T> => op().catch((error: unknown) => {
    const e = error as Error;
    console.error(`[diag] ${label}: ${e.name}: ${(e.message ?? '').slice(0, 300)}`);
    throw error;
  });
  const transport = {
    execute: (i: Parameters<typeof diagnostic.execute>[0]) => wrap(`execute ${String(i.sql).slice(0, 80)}`, () => diagnostic.execute(i)),
    begin: (i: Parameters<typeof diagnostic.begin>[0]) => wrap('begin', () => diagnostic.begin(i)),
    commit: (i: Parameters<typeof diagnostic.commit>[0]) => wrap('commit', () => diagnostic.commit(i)),
    rollback: (i: Parameters<typeof diagnostic.rollback>[0]) => wrap('rollback', () => diagnostic.rollback(i)),
  };
  const prisma = new PrismaClient({ adapter: new PrismaDataApi(config, transport),
    transactionOptions: { maxWait: 30_000, timeout: 25_000 } });
  const run = randomUUID();
  const tenants: { tenantId: string; userId: string }[] = [];
  const actors: { tenantId: string; userId: string; role: 'ADMIN' }[] = [];
  try {
    for (const label of ['A', 'B']) {
      const t = await new TenantService(prisma).registerWebTenant({
        businessName: `AURORA-VALIDATION ${label} ${run}`, planCode: 'PROFESSIONAL',
        administrator: { cognitoSub: `aurora-val-${label}-${run}`, email: `aurora-val-${label}-${run}@example.invalid` },
      });
      tenants.push({ tenantId: t.tenantId, userId: t.adminUserId });
      actors.push({ tenantId: t.tenantId, userId: t.adminUserId, role: 'ADMIN' });
    }
    const [actorA, actorB] = actors as [typeof actors[0], typeof actors[0]];
    const suppliers = new SupplierService(prisma);
    const invoices = new InvoiceService(prisma);
    const payments = new PaymentBatchService(prisma);
    const supplierA = await suppliers.create({ businessName: 'Prov A', mobilePhone: '+5491100000001' }, actorA, { idempotencyKey: 'val-sup-a' });
    const supplierB = await suppliers.create({ businessName: 'Prov B', mobilePhone: '+5491100000002' }, actorB, { idempotencyKey: 'val-sup-b' });
    const mkInvoice = (actor: typeof actorA, supplierId: string, key: string, amount = 10_000n) => invoices.create({
      tenantId: actor.tenantId, supplierId, invoiceType: 'INFORMAL', description: 'Validación Aurora',
      amountInCents: amount, dueDate: new Date('2030-01-15T00:00:00.000Z'),
    }, actor, { confirmImmediately: true, idempotencyKey: key });
    const invA1 = await mkInvoice(actorA, supplierA.id, 'val-inv-a1');
    const invA2 = await mkInvoice(actorA, supplierA.id, 'val-inv-a2');
    const invA3 = await mkInvoice(actorA, supplierA.id, 'val-inv-a3');
    const invB1 = await mkInvoice(actorB, supplierB.id, 'val-inv-b1');

    await check('Idempotencia: reintento de proveedor devuelve el mismo id', async () => {
      const retry = await suppliers.create({ businessName: 'Prov A', mobilePhone: '+5491100000001' }, actorA, { idempotencyKey: 'val-sup-a' });
      expect(retry.id === supplierA.id && retry.idempotent, 'no devolvió el mismo proveedor');
    });
    await check('Idempotencia: misma clave con otro contenido se rechaza', () =>
      rejects(() => suppliers.create({ businessName: 'Otro', mobilePhone: '+5491100000001' }, actorA, { idempotencyKey: 'val-sup-a' })));
    await check('Aislamiento: tenant A no puede pagar facturas de tenant B', () =>
      rejects(() => payments.create({ tenantId: actorA.tenantId, invoiceIds: [invB1.id], requestedByRole: 'ADMIN', idempotencyKey: 'val-pay-x' }, actorA.userId)));
    await check('Aislamiento: la factura de B sigue sin pagar', async () => {
      const row = await prisma.invoices.findFirst({ where: { tenant_id: actorB.tenantId, id: invB1.id } });
      expect(row?.status === 'IN_GRID', `estado inesperado: ${row?.status}`);
    });
    await check('Aislamiento: consulta de A no ve datos de B', async () => {
      const rows = await prisma.invoices.findMany({ where: { tenant_id: actorA.tenantId } });
      expect(rows.length === 3 && rows.every((r) => r.tenant_id === actorA.tenantId), `A ve ${rows.length} facturas`);
    });
    await check('Concurrencia: 5 pagos simultáneos con la misma clave crean un único lote', async () => {
      const req = { tenantId: actorA.tenantId, invoiceIds: [invA1.id], requestedByRole: 'ADMIN' as const, idempotencyKey: 'val-pay-conc' };
      const settled = await Promise.allSettled(Array.from({ length: 5 }, () => payments.create(req, actorA.userId)));
      const ids = new Set(settled.filter((s) => s.status === 'fulfilled').map((s) => (s as PromiseFulfilledResult<{ batchId: string }>).value.batchId));
      const batches = await prisma.payment_batches.count({ where: { tenant_id: actorA.tenantId, idempotency_key: 'val-pay-conc' } });
      expect(batches === 1 && ids.size === 1, `lotes=${batches}, ids distintos=${ids.size}`);
    });
    await check('Pago: reintento secuencial es idempotente', async () => {
      const r = await payments.create({ tenantId: actorA.tenantId, invoiceIds: [invA1.id], requestedByRole: 'ADMIN', idempotencyKey: 'val-pay-conc' }, actorA.userId);
      expect(r.idempotent, 'no fue idempotente');
    });
    await check('Pago: factura ya pagada no se paga con otra clave', () =>
      rejects(() => payments.create({ tenantId: actorA.tenantId, invoiceIds: [invA1.id], requestedByRole: 'ADMIN', idempotencyKey: 'val-pay-dup' }, actorA.userId)));
    await check('Transacción atómica: lote con una factura inválida no paga ninguna', async () => {
      await rejects(() => payments.create({ tenantId: actorA.tenantId, invoiceIds: [invA2.id, invA1.id], requestedByRole: 'ADMIN', idempotencyKey: 'val-pay-atomic' }, actorA.userId));
      const row = await prisma.invoices.findFirst({ where: { tenant_id: actorA.tenantId, id: invA2.id } });
      expect(row?.status === 'IN_GRID', `invA2 quedó en ${row?.status}`);
    });
    await check('Pago de varias facturas en un lote y total correcto', async () => {
      const r = await payments.create({ tenantId: actorA.tenantId, invoiceIds: [invA2.id, invA3.id], requestedByRole: 'ADMIN', idempotencyKey: 'val-pay-multi' }, actorA.userId);
      expect(r.totalInCents === 20_000n && r.status === 'RECORDED', `total=${r.totalInCents} estado=${r.status}`);
    });
  } finally {
    const cleanup: string[] = [];
    for (const t of tenants) {
      const steps: [string, () => Promise<unknown>][] = [
        ['payment_items', () => prisma.payment_items.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['payment_batches', () => prisma.payment_batches.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['audit_events', () => prisma.audit_events.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['invoices', () => prisma.invoices.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['suppliers', () => prisma.suppliers.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['subscriptions', () => prisma.subscriptions.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['payment_grid_configs', () => prisma.payment_grid_configs.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['tenant_memberships', () => prisma.tenant_memberships.deleteMany({ where: { tenant_id: t.tenantId } })],
        ['tenants', () => prisma.tenants.delete({ where: { id: t.tenantId } })],
        ['application_users', () => prisma.application_users.delete({ where: { id: t.userId } })],
      ];
      for (const [name, step] of steps) {
        try { await step(); } catch { cleanup.push(`${name} (${t.tenantId.slice(0, 8)})`); }
      }
    }
    await prisma.$disconnect();
    for (const r of results) console.info(`${r.ok ? 'OK  ' : 'FALLA'} ${r.name}${r.detail ? ` -> ${r.detail}` : ''}`);
    console.info(cleanup.length === 0 ? 'Limpieza completa.' : `Limpieza incompleta: ${cleanup.join(', ')}. Buscar datos "AURORA-VALIDATION".`);
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('VALIDATION_ABORTED', error instanceof Error ? error.message.slice(0, 200) : 'error');
  process.exitCode = 1;
});
