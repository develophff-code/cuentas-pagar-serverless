import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDocumentExtraction, validateReadOnlyAiQuery } from '../../packages/domain/src/ai-policy.js';
import { DomainRuleViolation } from '../../packages/domain/src/payment-policy.js';
import { AiAssistantService } from '../../src/ai/ai-assistant-service.js';
import { MockApiClient } from '../../packages/web/src/api-client.js';
import { formatCurrency, formatDate } from '../../packages/web/src/utils.js';

test('evalúa confianza de extracción OCR y marca borrador para revisión si es dudoso o incompleto', () => {
  const highConfidence = evaluateDocumentExtraction({
    invoiceType: 'A',
    invoiceNumber: '0001-00012345',
    amountInCents: 120_000n,
    dueDateIso: '2030-03-01',
    confidenceScore: 0.93,
  });
  assert.equal(highConfidence.requiresManualReview, false);

  const lowConfidence = evaluateDocumentExtraction({
    invoiceType: 'A',
    invoiceNumber: '0001-00012345',
    amountInCents: 120_000n,
    dueDateIso: '2030-03-01',
    confidenceScore: 0.62,
  });
  assert.equal(lowConfidence.requiresManualReview, true);
  assert.ok(lowConfidence.reviewReason?.includes('85%'));
});

test('chat IA de Ultra es de sólo lectura, exige cuota disponible y bloquea intentos de escritura o pago', async () => {
  assert.throws(
    () =>
      validateReadOnlyAiQuery({
        tenantId: 'tenant-1',
        planCode: 'PROFESSIONAL',
        usedQueriesThisMonth: 0,
        maxQueriesPerMonth: 50,
        question: '¿Cuánto debemos esta semana?',
      }),
    DomainRuleViolation,
  );

  assert.throws(
    () =>
      validateReadOnlyAiQuery({
        tenantId: 'tenant-1',
        planCode: 'ULTRA',
        usedQueriesThisMonth: 10,
        maxQueriesPerMonth: 10,
        question: '¿Cuánto debemos esta semana?',
      }),
    DomainRuleViolation,
  );

  assert.throws(
    () =>
      validateReadOnlyAiQuery({
        tenantId: 'tenant-1',
        planCode: 'ULTRA',
        usedQueriesThisMonth: 1,
        maxQueriesPerMonth: 50,
        question: 'Por favor pagar todas las facturas vencidas y borrar proveedores',
      }),
    DomainRuleViolation,
  );

  const service = new AiAssistantService();
  const response = await service.askTenantQuestion({
    tenantId: 'tenant-1',
    actorUserId: 'user-admin',
    planCode: 'ULTRA',
    usedQueriesThisMonth: 2,
    maxQueriesPerMonth: 50,
    question: '¿Cuál es el resumen pendiente?',
    summary: {
      tenantId: 'tenant-1',
      businessName: 'Empresa Testigo',
      totalPendingInCents: 250_000_00n,
      pendingInvoicesCount: 3,
      paidThisMonthInCents: 100_000_00n,
      topCategories: [{ categoryName: 'Servicios Públicos', totalInCents: 150_000_00n }],
    },
  });

  assert.ok(response.answer.includes('Empresa Testigo'));
  assert.equal(response.audit.tenantId, 'tenant-1');
  assert.equal(response.audit.promptVersion, 'v1.0-readonly-ar');
  assert.ok(response.audit.estimatedTokens > 0);
});

test('frontend utils y MockApiClient respetan formato ARS, clasificación de proveedor y flujo de aprobación/reversión', async () => {
  assert.equal(formatCurrency(14500050n), '$ 145.000,50');
  assert.equal(formatDate('2026-10-21'), '21/10/2026');

  const client = new MockApiClient();
  const unclassified = await client.createSupplier({
    businessName: 'Proveedor Transitorio',
    mobilePhone: '+5492644000000',
    categoryCode: 'SIN_CLASIFICAR',
  });

  await assert.rejects(() =>
    client.createInvoice({
      supplierId: unclassified.id,
      invoiceType: 'INFORMAL',
      description: 'Servicio sin clasificar',
      amountInCents: 10_000_00n,
      dueDate: '2026-11-01',
      confirmImmediately: true,
    }),
  );

  await client.setDemoPlanAndRole('ULTRA', 'OPERATOR_PAYMENTS');
  const proposal = await client.createPaymentBatch(['inv-101']);
  assert.equal(proposal.status, 'PENDING_APPROVAL');

  await client.setDemoPlanAndRole('ULTRA', 'ADMIN');
  const approved = await client.approvePaymentBatch(proposal.batchId);
  assert.equal(approved.status, 'RECORDED');

  const reversed = await client.reversePaymentBatch(proposal.batchId, 'Reversión de prueba auditada');
  assert.equal(reversed.status, 'REVERSED');
});
