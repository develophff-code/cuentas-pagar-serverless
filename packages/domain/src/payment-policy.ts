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

export function canProposePayment(role: MembershipRole): boolean {
  return role === 'ADMIN' || role === 'OPERATOR_PAYMENTS';
}

export function validateFullPaymentBatch(
  request: PaymentBatchRequest,
  invoices: readonly InvoiceForPayment[],
): bigint {
  if (!canRecordPayment(request.requestedByRole)) {
    throw new DomainRuleViolation('El rol no puede registrar pagos.');
  }

  return validatePaymentBatch(request, invoices);
}

export function validatePaymentProposal(
  request: PaymentBatchRequest,
  invoices: readonly InvoiceForPayment[],
): bigint {
  if (!canProposePayment(request.requestedByRole)) {
    throw new DomainRuleViolation('El rol no puede proponer pagos.');
  }

  return validatePaymentBatch(request, invoices);
}

export interface PaymentBatchApprovalRequest {
  tenantId: string;
  batchTenantId: string;
  batchStatus: 'PENDING_APPROVAL' | 'RECORDED' | 'REVERSED' | 'DRAFT';
  proposedByUserId: string;
  approvedByUserId: string;
  approvedByRole: MembershipRole;
  enforceDualControl?: boolean;
}

export function validatePaymentApproval(request: PaymentBatchApprovalRequest): void {
  if (request.tenantId !== request.batchTenantId) {
    throw new DomainRuleViolation('El lote de pago no pertenece al tenant de la operación.');
  }
  if (!canRecordPayment(request.approvedByRole)) {
    throw new DomainRuleViolation('Sólo un administrador puede aprobar propuestas de pago.');
  }
  if (request.batchStatus !== 'PENDING_APPROVAL') {
    throw new DomainRuleViolation('Sólo se pueden aprobar lotes en estado PENDING_APPROVAL.');
  }
  if (request.enforceDualControl && request.proposedByUserId === request.approvedByUserId) {
    throw new DomainRuleViolation('La política de doble control exige que quien propone no sea quien aprueba.');
  }
}

export interface PaymentBatchReversalRequest {
  tenantId: string;
  batchTenantId: string;
  batchStatus: 'PENDING_APPROVAL' | 'RECORDED' | 'REVERSED' | 'DRAFT';
  reversedByRole: MembershipRole;
  reason: string;
}

export function validatePaymentReversal(request: PaymentBatchReversalRequest): void {
  if (request.tenantId !== request.batchTenantId) {
    throw new DomainRuleViolation('El lote de pago no pertenece al tenant de la operación.');
  }
  if (!canRecordPayment(request.reversedByRole)) {
    throw new DomainRuleViolation('Sólo un administrador puede revertir una operación de pago.');
  }
  if (request.batchStatus !== 'RECORDED' && request.batchStatus !== 'PENDING_APPROVAL') {
    throw new DomainRuleViolation('El lote no se encuentra en un estado reversible.');
  }
  if (!request.reason.trim()) {
    throw new DomainRuleViolation('La reversión de pago exige un motivo de auditoría.');
  }
}

function validatePaymentBatch(
  request: PaymentBatchRequest,
  invoices: readonly InvoiceForPayment[],
): bigint {

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
