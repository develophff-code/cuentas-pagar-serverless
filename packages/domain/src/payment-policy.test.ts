import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canProposePayment,
  DomainRuleViolation,
  validateFullPaymentBatch,
  validatePaymentApproval,
  validatePaymentReversal,
  validateSupplier,
} from './payment-policy.js';
import { canConfirmInvoices, canCreateInvoices, validateInvoice } from './invoice-policy.js';
import { canManageMemberships, validateOperatorRole } from './membership-policy.js';
import { allowsBillingAccess, allowsOperationalAccess, assertAuthorizedRole } from './authorization-policy.js';

test('acepta un pago total de varias facturas del mismo tenant', () => {
  const total = validateFullPaymentBatch(
    {
      tenantId: 'tenant-a',
      invoiceIds: ['invoice-1', 'invoice-2'],
      requestedByRole: 'ADMIN',
      idempotencyKey: 'payment-001',
    },
    [
      { id: 'invoice-1', tenantId: 'tenant-a', amountInCents: 1050n, status: 'IN_GRID' },
      { id: 'invoice-2', tenantId: 'tenant-a', amountInCents: 2500n, status: 'PAYMENT_PROPOSED' },
    ],
  );

  assert.equal(total, 3550n);
});

test('rechaza pago de una factura cancelada', () => {
  assert.throws(
    () =>
      validateFullPaymentBatch(
        {
          tenantId: 'tenant-a',
          invoiceIds: ['invoice-1'],
          requestedByRole: 'ADMIN',
          idempotencyKey: 'payment-001',
        },
        [{ id: 'invoice-1', tenantId: 'tenant-a', amountInCents: 1050n, status: 'CANCELED' }],
      ),
    DomainRuleViolation,
  );
});

test('requiere razón social y celular para proveedor', () => {
  assert.throws(
    () => validateSupplier({ businessName: 'Proveedor informal', mobilePhone: '  ' }),
    DomainRuleViolation,
  );
});

test('un operador de pagos puede proponer pero no confirmar pagos', () => {
  assert.equal(canProposePayment('OPERATOR_PAYMENTS'), true);
  assert.throws(
    () =>
      validateFullPaymentBatch(
        {
          tenantId: 'tenant-a',
          invoiceIds: ['invoice-1'],
          requestedByRole: 'OPERATOR_PAYMENTS',
          idempotencyKey: 'payment-001',
        },
        [{ id: 'invoice-1', tenantId: 'tenant-a', amountInCents: 100n, status: 'IN_GRID' }],
      ),
    DomainRuleViolation,
  );
});

test('operador de carga puede crear facturas pero sólo admin puede confirmarlas', () => {
  assert.equal(canCreateInvoices('OPERATOR_UPLOAD'), true);
  assert.equal(canConfirmInvoices('OPERATOR_UPLOAD'), false);
  assert.equal(canConfirmInvoices('ADMIN'), true);
});

test('distingue comprobantes fiscales e informales', () => {
  assert.throws(
    () => validateInvoice({
      tenantId: 'tenant-a', supplierId: 'supplier-a', invoiceType: 'A', amountInCents: 100n,
      dueDate: new Date('2026-10-01'),
    }),
    DomainRuleViolation,
  );
  assert.doesNotThrow(() => validateInvoice({
    tenantId: 'tenant-a', supplierId: 'supplier-a', invoiceType: 'INFORMAL',
    description: 'Servicio de flete', amountInCents: 100n, dueDate: new Date('2026-10-01'),
  }));
});

test('sólo admin administra miembros y no delega el rol admin', () => {
  assert.equal(canManageMemberships('ADMIN'), true);
  assert.equal(canManageMemberships('OPERATOR_PAYMENTS'), false);
  assert.throws(() => validateOperatorRole('ADMIN'), DomainRuleViolation);
  assert.doesNotThrow(() => validateOperatorRole('OPERATOR_UPLOAD'));
});

test('el bloqueo conserva facturación pero corta operatoria', () => {
  assert.equal(allowsOperationalAccess('BLOCKED_PAYMENT'), false);
  assert.equal(allowsBillingAccess('BLOCKED_PAYMENT'), true);
  assert.equal(allowsBillingAccess('ACCESS_EXPIRED'), false);
  assert.throws(() => assertAuthorizedRole('OPERATOR_UPLOAD', ['ADMIN']), DomainRuleViolation);
});

test('aprueba propuesta de pago por administrador y respeta política de doble control en Ultra', () => {
  assert.doesNotThrow(() =>
    validatePaymentApproval({
      tenantId: 'tenant-a',
      batchTenantId: 'tenant-a',
      batchStatus: 'PENDING_APPROVAL',
      proposedByUserId: 'user-op',
      approvedByUserId: 'user-admin',
      approvedByRole: 'ADMIN',
      enforceDualControl: true,
    }),
  );

  assert.throws(
    () =>
      validatePaymentApproval({
        tenantId: 'tenant-a',
        batchTenantId: 'tenant-a',
        batchStatus: 'PENDING_APPROVAL',
        proposedByUserId: 'user-admin',
        approvedByUserId: 'user-admin',
        approvedByRole: 'ADMIN',
        enforceDualControl: true,
      }),
    DomainRuleViolation,
  );
});

test('reversión de pago exige rol ADMIN y motivo de auditoría sin borrar historial', () => {
  assert.throws(
    () =>
      validatePaymentReversal({
        tenantId: 'tenant-a',
        batchTenantId: 'tenant-a',
        batchStatus: 'RECORDED',
        reversedByRole: 'ADMIN',
        reason: '   ',
      }),
    DomainRuleViolation,
  );

  assert.doesNotThrow(() =>
    validatePaymentReversal({
      tenantId: 'tenant-a',
      batchTenantId: 'tenant-a',
      batchStatus: 'RECORDED',
      reversedByRole: 'ADMIN',
      reason: 'Error en selección de cuenta destino',
    }),
  );
});
