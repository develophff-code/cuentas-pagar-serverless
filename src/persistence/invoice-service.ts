import type { PrismaClient } from '../generated/prisma/client.js';
import type { InvoiceInput, MembershipRole } from '../../packages/domain/src/model.js';
import {
  canConfirmInvoices,
  canCreateInvoices,
  validateInvoice,
} from '../../packages/domain/src/invoice-policy.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';

export interface InvoiceActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

export interface CreateInvoiceOptions {
  confirmImmediately?: boolean;
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
  ): Promise<{ id: string; status: 'PENDING_REVIEW' | 'IN_GRID' }> {
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

    const supplier = await this.prisma.suppliers.findFirst({
      where: { id: input.supplierId, tenant_id: actor.tenantId, is_active: true },
      select: { id: true },
    });
    if (supplier === null) {
      throw new DomainRuleViolation('El proveedor no existe, no está activo o no pertenece al tenant.');
    }

    const status = options.confirmImmediately === true ? 'IN_GRID' : 'PENDING_REVIEW';
    const invoice = await this.prisma.invoices.create({
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
        ...(status === 'IN_GRID' ? { confirmed_by_user_id: actor.userId } : {}),
      },
    });

    return { id: invoice.id, status };
  }
}
