import type { PrismaClient } from '../generated/prisma/client.js';
import type { InvoiceInput, MembershipRole } from '../../packages/domain/src/model.js';
import {
  canConfirmInvoices,
  canCreateInvoices,
  validateInvoice,
} from '../../packages/domain/src/invoice-policy.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import { assertMonthlyInvoiceCapacity } from './plan-usage-guard.js';
import { assertSameCommand, fingerprintCommand, normalizeIdempotencyKey } from './idempotency.js';

export interface InvoiceActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

export interface CreateInvoiceOptions {
  confirmImmediately?: boolean;
  idempotencyKey?: string;
}

function centsToDecimal(amountInCents: bigint): string {
  const sign = amountInCents < 0n ? '-' : '';
  const absolute = amountInCents < 0n ? -amountInCents : amountInCents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export class InvoiceService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: InvoiceInput,
    actor: InvoiceActor,
    options: CreateInvoiceOptions = {},
  ): Promise<{ id: string; status: 'PENDING_REVIEW' | 'IN_GRID'; idempotent: boolean }> {
    validateInvoice(input);
    if (input.tenantId !== actor.tenantId) {
      throw new DomainRuleViolation('No se puede crear una factura para otro tenant.');
    }
    if (!canCreateInvoices(actor.role)) {
      throw new DomainRuleViolation('El rol no puede cargar facturas.');
    }
    if (options.confirmImmediately === true && !canConfirmInvoices(actor.role)) {
      throw new DomainRuleViolation('Sólo ADMIN puede confirmar una factura.');
    }

    const status = options.confirmImmediately === true ? 'IN_GRID' : 'PENDING_REVIEW';
    const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
    const idempotencyFingerprint = idempotencyKey === undefined ? undefined : fingerprintCommand({
      tenantId: actor.tenantId,
      supplierId: input.supplierId,
      invoiceType: input.invoiceType,
      invoiceNumber: input.invoiceNumber?.trim(),
      description: input.description?.trim(),
      amountInCents: input.amountInCents.toString(),
      issueDate: input.issueDate?.toISOString(),
      dueDate: input.dueDate.toISOString(),
      scheduledPaymentDate: input.scheduledPaymentDate?.toISOString(),
      confirmImmediately: options.confirmImmediately === true,
    });
    return this.prisma.$transaction(async (transaction) => {
      if (idempotencyKey !== undefined) {
        const existing = await transaction.invoices.findFirst({
          where: { tenant_id: actor.tenantId, idempotency_key: idempotencyKey },
          select: { id: true, status: true, idempotency_fingerprint: true },
        });
        if (existing !== null) {
          assertSameCommand(existing.idempotency_fingerprint, idempotencyFingerprint!);
          return {
            id: existing.id,
            status: existing.status as 'PENDING_REVIEW' | 'IN_GRID',
            idempotent: true,
          };
        }
      }

      await assertMonthlyInvoiceCapacity(transaction, actor.tenantId);
      const supplier = await transaction.suppliers.findFirst({
        where: { id: input.supplierId, tenant_id: actor.tenantId, is_active: true },
        select: { id: true },
      });
      if (supplier === null) {
        throw new DomainRuleViolation('El proveedor no existe, no está activo o no pertenece al tenant.');
      }

      const invoice = await transaction.invoices.create({
        data: {
          tenant_id: actor.tenantId,
          supplier_id: input.supplierId,
          invoice_type: input.invoiceType,
          ...(input.invoiceNumber?.trim() === undefined ? {} : { invoice_number: input.invoiceNumber.trim() }),
          ...(input.description?.trim() === undefined ? {} : { description: input.description.trim() }),
          amount: centsToDecimal(input.amountInCents),
          ...(input.issueDate === undefined ? {} : { issue_date: input.issueDate }),
          due_date: input.dueDate,
          ...(input.scheduledPaymentDate === undefined
            ? {}
            : { scheduled_payment_date: input.scheduledPaymentDate }),
          status,
          created_by_user_id: actor.userId,
          ...(idempotencyKey === undefined
            ? {}
            : {
                idempotency_key: idempotencyKey,
                idempotency_fingerprint: idempotencyFingerprint!,
              }),
          ...(status === 'IN_GRID' ? { confirmed_by_user_id: actor.userId } : {}),
        },
      });

      return { id: invoice.id, status, idempotent: false };
    }, { isolationLevel: 'Serializable' });
  }
}
