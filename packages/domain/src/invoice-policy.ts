import type { InvoiceInput, MembershipRole } from './model.js';
import { DomainRuleViolation } from './payment-policy.js';

export function canCreateInvoices(role: MembershipRole): boolean {
  return role === 'ADMIN' || role === 'OPERATOR_UPLOAD';
}

export function canConfirmInvoices(role: MembershipRole): boolean {
  return role === 'ADMIN';
}

export function validateInvoice(input: InvoiceInput): void {
  if (!input.tenantId.trim() || !input.supplierId.trim()) {
    throw new DomainRuleViolation('La factura debe pertenecer a un tenant y a un proveedor.');
  }

  if (input.amountInCents <= 0n) {
    throw new DomainRuleViolation('El importe de la factura debe ser mayor a cero.');
  }

  if (Number.isNaN(input.dueDate.getTime())) {
    throw new DomainRuleViolation('La fecha de vencimiento es obligatoria y válida.');
  }

  if (input.issueDate !== undefined && Number.isNaN(input.issueDate.getTime())) {
    throw new DomainRuleViolation('La fecha de emisión no es válida.');
  }

  if (input.scheduledPaymentDate !== undefined && Number.isNaN(input.scheduledPaymentDate.getTime())) {
    throw new DomainRuleViolation('La fecha programada de pago no es válida.');
  }

  if (input.invoiceType === 'INFORMAL') {
    if (!input.description?.trim()) {
      throw new DomainRuleViolation('Un comprobante informal requiere una descripción.');
    }
    return;
  }

  if (!input.invoiceNumber?.trim()) {
    throw new DomainRuleViolation(`La factura ${input.invoiceType} requiere número de comprobante.`);
  }
}
