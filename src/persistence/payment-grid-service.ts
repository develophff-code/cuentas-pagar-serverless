import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { MembershipRole } from '../../packages/domain/src/model.js';
import {
  type PaymentGridConfigurationInput,
  validatePaymentGridConfiguration,
} from '../../packages/domain/src/payment-grid-policy.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import { assertSameCommand, fingerprintCommand, normalizeIdempotencyKey } from './idempotency.js';
import { assertSupplierNotificationsEnabled } from './plan-usage-guard.js';

type Transaction = Prisma.TransactionClient;

export interface PaymentGridActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
}

export interface PaymentGridEntry {
  id: string;
  supplierId: string;
  supplierBusinessName: string;
  amountInCents: bigint;
  dueDate: Date;
  scheduledPaymentDate?: Date;
  status: 'IN_GRID' | 'PAYMENT_PROPOSED';
}

export interface PaymentGridConfiguration {
  timezone: string;
  notificationTime: string;
  lookAheadHours: number;
  enabled: boolean;
  recipientMembershipIds: string[];
  idempotent: boolean;
}

function requireAdmin(role: MembershipRole): void {
  if (role !== 'ADMIN') throw new DomainRuleViolation('Sólo ADMIN puede configurar alertas de la grilla.');
}

function timeToDate(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function dateToTime(value: Date): string {
  return value.toISOString().slice(11, 16);
}

function receiptToConfiguration(value: Prisma.JsonValue): PaymentGridConfiguration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainRuleViolation('El recibo de idempotencia de la grilla es inválido.');
  }
  const response = value as Record<string, Prisma.JsonValue>;
  if (typeof response.timezone !== 'string' || typeof response.notificationTime !== 'string'
    || typeof response.lookAheadHours !== 'number' || typeof response.enabled !== 'boolean'
    || !Array.isArray(response.recipientMembershipIds) || !response.recipientMembershipIds.every((id) => typeof id === 'string')) {
    throw new DomainRuleViolation('El recibo de idempotencia de la grilla es inválido.');
  }
  return {
    timezone: response.timezone,
    notificationTime: response.notificationTime,
    lookAheadHours: response.lookAheadHours,
    enabled: response.enabled,
    recipientMembershipIds: response.recipientMembershipIds as string[],
    idempotent: true,
  };
}

export class PaymentGridService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(actor: PaymentGridActor): Promise<PaymentGridEntry[]> {
    const invoices = await this.prisma.invoices.findMany({
      where: { tenant_id: actor.tenantId, status: { in: ['IN_GRID', 'PAYMENT_PROPOSED'] } },
      include: { suppliers: { select: { business_name: true } } },
      orderBy: [{ scheduled_payment_date: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
    });
    return invoices.map((invoice) => ({
      id: invoice.id,
      supplierId: invoice.supplier_id,
      supplierBusinessName: invoice.suppliers.business_name,
      amountInCents: BigInt(invoice.amount.mul(100).toFixed(0)),
      dueDate: invoice.due_date,
      ...(invoice.scheduled_payment_date === null ? {} : { scheduledPaymentDate: invoice.scheduled_payment_date }),
      status: invoice.status as PaymentGridEntry['status'],
    }));
  }

  async updateConfiguration(
    actor: PaymentGridActor,
    input: PaymentGridConfigurationInput,
    idempotencyKey: string,
  ): Promise<PaymentGridConfiguration> {
    requireAdmin(actor.role);
    validatePaymentGridConfiguration(input);
    const key = normalizeIdempotencyKey(idempotencyKey);
    if (key === undefined) throw new DomainRuleViolation('La configuración requiere una clave de idempotencia.');
    const fingerprint = fingerprintCommand({
      command: 'PAYMENT_GRID_CONFIGURATION_UPDATED', tenantId: actor.tenantId,
      timezone: input.timezone, notificationTime: input.notificationTime,
      lookAheadHours: input.lookAheadHours, enabled: input.enabled,
      recipientMembershipIds: [...input.recipientMembershipIds].sort(),
    });

    return this.prisma.$transaction(async (transaction) => {
      const receipt = await transaction.http_command_receipts.findUnique({
        where: { tenant_id_idempotency_key: { tenant_id: actor.tenantId, idempotency_key: key } },
      });
      if (receipt !== null) {
        if (receipt.command_name !== 'PAYMENT_GRID_CONFIGURATION_UPDATED') {
          throw new DomainRuleViolation('La clave de idempotencia ya fue usada para otro comando.');
        }
        assertSameCommand(receipt.request_fingerprint, fingerprint);
        return receiptToConfiguration(receipt.response);
      }

      await assertSupplierNotificationsEnabled(transaction, actor.tenantId);
      const memberships = await transaction.tenant_memberships.findMany({
        where: { tenant_id: actor.tenantId, id: { in: [...input.recipientMembershipIds] }, is_active: true },
        select: { id: true },
      });
      if (memberships.length !== input.recipientMembershipIds.length) {
        throw new DomainRuleViolation('Cada destinatario debe pertenecer al tenant y estar activo.');
      }

      const configuration = await transaction.payment_grid_configs.upsert({
        where: { tenant_id: actor.tenantId },
        create: {
          tenant_id: actor.tenantId, timezone: input.timezone, notification_time: timeToDate(input.notificationTime),
          look_ahead_hours: input.lookAheadHours, enabled: input.enabled,
        },
        update: {
          timezone: input.timezone, notification_time: timeToDate(input.notificationTime),
          look_ahead_hours: input.lookAheadHours, enabled: input.enabled,
        },
      });
      await transaction.payment_grid_recipients.deleteMany({ where: { tenant_id: actor.tenantId } });
      if (input.recipientMembershipIds.length > 0) {
        await transaction.payment_grid_recipients.createMany({
          data: input.recipientMembershipIds.map((membershipId) => ({ tenant_id: actor.tenantId, membership_id: membershipId })),
        });
      }
      const result: PaymentGridConfiguration = {
        timezone: configuration.timezone, notificationTime: dateToTime(configuration.notification_time),
        lookAheadHours: configuration.look_ahead_hours, enabled: configuration.enabled,
        recipientMembershipIds: [...input.recipientMembershipIds], idempotent: false,
      };
      await transaction.http_command_receipts.create({
        data: {
          tenant_id: actor.tenantId, idempotency_key: key, command_name: 'PAYMENT_GRID_CONFIGURATION_UPDATED',
          request_fingerprint: fingerprint,
          response: {
            timezone: result.timezone, notificationTime: result.notificationTime,
            lookAheadHours: result.lookAheadHours, enabled: result.enabled,
            recipientMembershipIds: result.recipientMembershipIds,
          },
        },
      });
      await transaction.audit_events.create({
        data: {
          tenant_id: actor.tenantId, actor_user_id: actor.userId,
          action: 'PAYMENT_GRID_CONFIGURATION_UPDATED', entity_type: 'PAYMENT_GRID_CONFIG',
          source: 'WEB', metadata: { recipientCount: result.recipientMembershipIds.length },
        },
      });
      return result;
    }, { isolationLevel: 'Serializable' });
  }
}
