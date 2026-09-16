import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainRuleViolation, validateFullPaymentBatch, validateSupplier } from './payment-policy.js';

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

