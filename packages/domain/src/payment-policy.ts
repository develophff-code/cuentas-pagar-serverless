import type { InvoiceForPayment, MembershipRole, PaymentBatchRequest, SupplierInput } from './model.js';

const PAYABLE_STATUSES = new Set(['IN_GRID', 'PAYMENT_PROPOSED'] as const);

export class DomainRuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainRuleViolation';
  }
}

export function validateSupplier(input: SupplierInput): void {
  if (!input.businessName.trim()) {
    throw new DomainRuleViolation('La razón social del proveedor es obligatoria.');
  }

  if (!input.mobilePhone.trim()) {
    throw new DomainRuleViolation('El celular del proveedor es obligatorio.');
  }
}

export function canRecordPayment(role: MembershipRole): boolean {
  return role === 'ADMIN';
}

export function validateFullPaymentBatch(
  request: PaymentBatchRequest,
  invoices: readonly InvoiceForPayment[],
): bigint {
  if (!canRecordPayment(request.requestedByRole)) {
    throw new DomainRuleViolation('El rol no puede registrar pagos.');
  }

  if (!request.idempotencyKey.trim()) {
    throw new DomainRuleViolation('Toda operación de pago requiere una clave de idempotencia.');
  }

  if (request.invoiceIds.length === 0) {
    throw new DomainRuleViolation('Un pago debe incluir al menos una factura.');
  }

  const requestedIds = new Set(request.invoiceIds);
  if (requestedIds.size !== request.invoiceIds.length) {
    throw new DomainRuleViolation('Una factura no puede repetirse dentro de la misma operación.');
  }

  if (invoices.length !== requestedIds.size) {
    throw new DomainRuleViolation('No se encontraron todas las facturas solicitadas.');
  }

  let total = 0n;
  for (const invoice of invoices) {
    if (invoice.tenantId !== request.tenantId) {
      throw new DomainRuleViolation('Una factura no pertenece al tenant de la operación.');
    }

    if (!PAYABLE_STATUSES.has(invoice.status as 'IN_GRID' | 'PAYMENT_PROPOSED')) {
      throw new DomainRuleViolation(`La factura ${invoice.id} no está disponible para pago.`);
    }

    if (invoice.amountInCents <= 0n) {
      throw new DomainRuleViolation(`La factura ${invoice.id} tiene un importe inválido.`);
    }

    total += invoice.amountInCents;
  }

  return total;
}

