import type { PrismaClient } from '../generated/prisma/client.js';
import type { InvoiceForPayment, MembershipRole, PaymentBatchRequest } from '../../packages/domain/src/model.js';
import {
  DomainRuleViolation,
  canProposePayment,
  validateFullPaymentBatch,
  validatePaymentApproval,
  validatePaymentProposal,
  validatePaymentReversal,
} from '../../packages/domain/src/payment-policy.js';
import { assertSameCommand, fingerprintCommand, normalizeIdempotencyKey } from './idempotency.js';

export interface PaymentBatchResult {
  batchId: string;
  status: 'RECORDED' | 'PENDING_APPROVAL' | 'REVERSED';
  totalInCents: bigint;
  idempotent: boolean;
}

function toInvoiceForPayment(invoice: {
  id: string;
  tenant_id: string;
  amount: { mul(value: number): { toFixed(decimalPlaces: number): string } };
  status: string;
}): InvoiceForPayment {
  return {
    id: invoice.id,
    tenantId: invoice.tenant_id,
    amountInCents: BigInt(invoice.amount.mul(100).toFixed(0)),
    status: invoice.status as InvoiceForPayment['status'],
  };
}

export class PaymentBatchService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(request: PaymentBatchRequest, actorUserId: string): Promise<PaymentBatchResult> {
    if (!canProposePayment(request.requestedByRole)) {
      throw new DomainRuleViolation('El rol no puede proponer ni registrar pagos.');
    }

    const idempotencyKey = normalizeIdempotencyKey(request.idempotencyKey);
    if (idempotencyKey === undefined) {
      throw new DomainRuleViolation('Toda operación de pago requiere una clave de idempotencia.');
    }
    const idempotencyFingerprint = fingerprintCommand({
      tenantId: request.tenantId,
      invoiceIds: [...request.invoiceIds].sort(),
      requestedByRole: request.requestedByRole,
    });

    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.payment_batches.findUnique({
        where: {
          tenant_id_idempotency_key: {
            tenant_id: request.tenantId,
            idempotency_key: idempotencyKey,
          },
        },
        include: { payment_items: true },
      });

      if (existing !== null) {
        assertSameCommand(existing.idempotency_fingerprint, idempotencyFingerprint);
        return {
          batchId: existing.id,
          status: existing.status as PaymentBatchResult['status'],
          totalInCents: existing.payment_items.reduce(
            (total, item) => total + BigInt(item.amount.mul(100).toFixed(0)),
            0n,
          ),
          idempotent: true,
        };
      }

      const invoices = await transaction.invoices.findMany({
        where: { tenant_id: request.tenantId, id: { in: [...request.invoiceIds] } },
      });
      const domainInvoices = invoices.map(toInvoiceForPayment);

      const isRecorded = request.requestedByRole === 'ADMIN';
      const totalInCents = isRecorded
        ? validateFullPaymentBatch(request, domainInvoices)
        : validatePaymentProposal(request, domainInvoices);
      const status = isRecorded ? 'RECORDED' : 'PENDING_APPROVAL';

      const batch = await transaction.payment_batches.create({
        data: {
          tenant_id: request.tenantId,
          status,
          idempotency_key: idempotencyKey,
          idempotency_fingerprint: idempotencyFingerprint,
          proposed_by_user_id: actorUserId,
          ...(isRecorded
            ? { confirmed_by_user_id: actorUserId, confirmed_at: new Date() }
            : {}),
        },
      });

      await transaction.payment_items.createMany({
        data: invoices.map((invoice) => ({
          tenant_id: request.tenantId,
          payment_batch_id: batch.id,
          invoice_id: invoice.id,
          amount: invoice.amount,
        })),
      });

      await transaction.invoices.updateMany({
        where: { tenant_id: request.tenantId, id: { in: [...request.invoiceIds] } },
        data: { status: isRecorded ? 'PAID' : 'PAYMENT_PROPOSED' },
      });

      await transaction.audit_events.create({
        data: {
          tenant_id: request.tenantId,
          actor_user_id: actorUserId,
          action: isRecorded ? 'PAYMENT_RECORDED' : 'PAYMENT_PROPOSED',
          entity_type: 'PAYMENT_BATCH',
          entity_id: batch.id,
          source: 'WEB',
          metadata: { invoiceCount: request.invoiceIds.length },
        },
      });

      return { batchId: batch.id, status, totalInCents, idempotent: false };
    }, { isolationLevel: 'Serializable' });
  }

  async approveProposal(input: {
    tenantId: string;
    batchId: string;
    actorUserId: string;
    actorRole: MembershipRole;
    enforceDualControl?: boolean;
  }): Promise<PaymentBatchResult> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.payment_batches.findUnique({
        where: { id: input.batchId },
        include: { payment_items: true },
      });

      if (existing === null) {
        throw new DomainRuleViolation('No se encontró el lote de pago solicitado.');
      }

      const totalInCents = existing.payment_items.reduce(
        (total, item) => total + BigInt(item.amount.mul(100).toFixed(0)),
        0n,
      );

      if (existing.tenant_id === input.tenantId && existing.status === 'RECORDED') {
        return { batchId: existing.id, status: 'RECORDED', totalInCents, idempotent: true };
      }

      validatePaymentApproval({
        tenantId: input.tenantId,
        batchTenantId: existing.tenant_id,
        batchStatus: existing.status,
        proposedByUserId: existing.proposed_by_user_id,
        approvedByUserId: input.actorUserId,
        approvedByRole: input.actorRole,
        ...(input.enforceDualControl !== undefined ? { enforceDualControl: input.enforceDualControl } : {}),
      });

      await transaction.payment_batches.update({
        where: { id: existing.id },
        data: {
          status: 'RECORDED',
          confirmed_by_user_id: input.actorUserId,
          confirmed_at: new Date(),
        },
      });

      const invoiceIds = existing.payment_items.map((item) => item.invoice_id);
      await transaction.invoices.updateMany({
        where: { tenant_id: input.tenantId, id: { in: invoiceIds } },
        data: { status: 'PAID' },
      });

      await transaction.audit_events.create({
        data: {
          tenant_id: input.tenantId,
          actor_user_id: input.actorUserId,
          action: 'PAYMENT_APPROVED',
          entity_type: 'PAYMENT_BATCH',
          entity_id: existing.id,
          source: 'WEB',
          metadata: { invoiceCount: invoiceIds.length },
        },
      });

      return { batchId: existing.id, status: 'RECORDED', totalInCents, idempotent: false };
    }, { isolationLevel: 'Serializable' });
  }

  async reverseBatch(input: {
    tenantId: string;
    batchId: string;
    actorUserId: string;
    actorRole: MembershipRole;
    reason: string;
  }): Promise<PaymentBatchResult> {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.payment_batches.findUnique({
        where: { id: input.batchId },
        include: { payment_items: true },
      });

      if (existing === null) {
        throw new DomainRuleViolation('No se encontró el lote de pago solicitado.');
      }

      const totalInCents = existing.payment_items.reduce(
        (total, item) => total + BigInt(item.amount.mul(100).toFixed(0)),
        0n,
      );

      if (existing.tenant_id === input.tenantId && existing.status === 'REVERSED') {
        return { batchId: existing.id, status: 'REVERSED', totalInCents, idempotent: true };
      }

      validatePaymentReversal({
        tenantId: input.tenantId,
        batchTenantId: existing.tenant_id,
        batchStatus: existing.status,
        reversedByRole: input.actorRole,
        reason: input.reason,
      });

      await transaction.payment_batches.update({
        where: { id: existing.id },
        data: {
          status: 'REVERSED',
          reversed_by_user_id: input.actorUserId,
          reversed_at: new Date(),
          reversal_reason: input.reason.trim(),
        },
      });

      const invoiceIds = existing.payment_items.map((item) => item.invoice_id);
      await transaction.invoices.updateMany({
        where: { tenant_id: input.tenantId, id: { in: invoiceIds } },
        data: { status: 'IN_GRID' },
      });

      await transaction.audit_events.create({
        data: {
          tenant_id: input.tenantId,
          actor_user_id: input.actorUserId,
          action: 'PAYMENT_REVERSED',
          entity_type: 'PAYMENT_BATCH',
          entity_id: existing.id,
          source: 'WEB',
          metadata: { invoiceCount: invoiceIds.length, reason: input.reason.trim() },
        },
      });

      return { batchId: existing.id, status: 'REVERSED', totalInCents, idempotent: false };
    }, { isolationLevel: 'Serializable' });
  }
}
