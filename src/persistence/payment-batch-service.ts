import type { PrismaClient } from '../generated/prisma/client.js';
import type { InvoiceForPayment, PaymentBatchRequest } from '../../packages/domain/src/model.js';
import {
  DomainRuleViolation,
  canProposePayment,
  validateFullPaymentBatch,
  validatePaymentProposal,
} from '../../packages/domain/src/payment-policy.js';
import { assertSameCommand, fingerprintCommand, normalizeIdempotencyKey } from './idempotency.js';

export interface PaymentBatchResult {
  batchId: string;
  status: 'RECORDED' | 'PENDING_APPROVAL';
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
          payment_items: {
            create: invoices.map((invoice) => ({
              tenant_id: request.tenantId,
              invoice_id: invoice.id,
              amount: invoice.amount,
            })),
          },
        },
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
}
