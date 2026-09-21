import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpHandler, type ApiDependencies } from '../../src/api/http-handler.js';
import type { ApiGatewayRequest } from '../../src/api/http-types.js';

function dependencies(): ApiDependencies {
  return {
    registerWebTenant: async () => ({ tenantId: 'tenant-1', adminUserId: 'user-1' }),
    authorizeOperational: async (_sub, tenantId) => ({ tenantId, userId: 'user-1', role: 'ADMIN' }),
    createSupplier: async () => ({ id: 'supplier-1', idempotent: false }),
    createInvoice: async () => ({ id: 'invoice-1', status: 'IN_GRID', idempotent: false }),
    createPaymentBatch: async () => ({ batchId: 'batch-1', status: 'RECORDED', totalInCents: 1250n, idempotent: false }),
    listPaymentGrid: async () => [{
      id: 'invoice-1', supplierId: 'supplier-1', supplierBusinessName: 'Proveedor SA', amountInCents: 1250n,
      dueDate: new Date('2026-10-01T00:00:00.000Z'), status: 'IN_GRID',
    }],
    updatePaymentGridConfiguration: async () => ({
      timezone: 'America/Argentina/Buenos_Aires', notificationTime: '08:00', lookAheadHours: 24,
      enabled: true, recipientMembershipIds: ['membership-1'], idempotent: false,
    }),
  };
}

function operationalRequest(path: string, body: object, idempotencyKey = 'request-1'): ApiGatewayRequest {
  return {
    httpMethod: 'POST', path, pathParameters: { tenantId: 'tenant-1' },
    headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body),
    requestContext: { authorizer: { claims: { sub: 'cognito-sub', email: 'admin@example.com' } } },
  };
}

test('crea un proveedor con actor autorizado y clave de idempotencia', async () => {
  let receivedKey: string | undefined;
  const fake = dependencies();
  fake.createSupplier = async (_input, _actor, key) => {
    receivedKey = key;
    return { id: 'supplier-1', idempotent: false };
  };
  const response = await createHttpHandler(fake)(operationalRequest('/v1/tenants/tenant-1/suppliers', {
    businessName: 'Proveedor SA', mobilePhone: '+5491100000000',
  }));
  assert.equal(response.statusCode, 201);
  assert.equal(receivedKey, 'request-1');
  assert.deepEqual(JSON.parse(response.body), { id: 'supplier-1', idempotent: false });
});

test('rechaza una mutación sin Idempotency-Key antes de llamar al servicio', async () => {
  const request = operationalRequest('/v1/tenants/tenant-1/suppliers', {
    businessName: 'Proveedor SA', mobilePhone: '+5491100000000',
  });
  request.headers = {};
  const response = await createHttpHandler(dependencies())(request);
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Idempotency-Key/);
});

test('el tenant de ruta se propaga y no puede ser suplantado por el cuerpo', async () => {
  let receivedTenant: string | undefined;
  const fake = dependencies();
  fake.createInvoice = async (input) => {
    receivedTenant = input.tenantId;
    return { id: 'invoice-1', status: 'IN_GRID', idempotent: false };
  };
  const response = await createHttpHandler(fake)(operationalRequest('/v1/tenants/tenant-1/invoices', {
    tenantId: 'other-tenant', supplierId: 'supplier-1', invoiceType: 'A', invoiceNumber: '0001-00000001',
    amountInCents: '1250', dueDate: '2026-10-01T00:00:00.000Z', confirmImmediately: true,
  }));
  assert.equal(response.statusCode, 201);
  assert.equal(receivedTenant, 'tenant-1');
});

test('serializa importes de pagos como texto exacto', async () => {
  const response = await createHttpHandler(dependencies())(operationalRequest('/v1/tenants/tenant-1/payment-batches', {
    invoiceIds: ['invoice-1'],
  }));
  assert.equal(response.statusCode, 201);
  assert.equal(JSON.parse(response.body).totalInCents, '1250');
});

test('onboarding exige identidad autenticada y nunca un sub enviado por el cliente', async () => {
  const response = await createHttpHandler(dependencies())({
    httpMethod: 'POST', path: '/v1/onboarding/web', body: JSON.stringify({
      businessName: 'Nueva SA', planCode: 'PROFESSIONAL', cognitoSub: 'forged',
    }), requestContext: { authorizer: { claims: { sub: 'actual-sub', email: 'admin@example.com' } } },
  });
  assert.equal(response.statusCode, 201);
});

test('devuelve la grilla sin exigir cuerpo ni clave de idempotencia', async () => {
  const request = operationalRequest('/v1/tenants/tenant-1/payment-grid', {});
  request.httpMethod = 'GET';
  request.body = null;
  request.headers = {};
  const response = await createHttpHandler(dependencies())(request);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).items[0].amountInCents, '1250');
});

test('configura alertas de grilla como comando idempotente de ADMIN', async () => {
  let capturedKey: string | undefined;
  const fake = dependencies();
  fake.updatePaymentGridConfiguration = async (_actor, _input, key) => {
    capturedKey = key;
    return {
      timezone: 'America/Argentina/Buenos_Aires', notificationTime: '08:00', lookAheadHours: 24,
      enabled: true, recipientMembershipIds: ['membership-1'], idempotent: false,
    };
  };
  const request = operationalRequest('/v1/tenants/tenant-1/payment-grid/configuration', {
    timezone: 'America/Argentina/Buenos_Aires', notificationTime: '08:00', lookAheadHours: 24,
    enabled: true, recipientMembershipIds: ['membership-1'],
  });
  request.httpMethod = 'PUT';
  const response = await createHttpHandler(fake)(request);
  assert.equal(response.statusCode, 201);
  assert.equal(capturedKey, 'request-1');
});
