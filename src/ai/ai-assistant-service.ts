import type { DocumentExtractionDraft, EvaluatedDocumentExtraction } from '../../packages/domain/src/ai-policy.js';
import { evaluateDocumentExtraction, validateReadOnlyAiQuery } from '../../packages/domain/src/ai-policy.js';
import type { PlanCode } from '../../packages/domain/src/model.js';

export interface TenantAggregatedSummary {
  tenantId: string;
  businessName: string;
  totalPendingInCents: bigint;
  pendingInvoicesCount: number;
  paidThisMonthInCents: bigint;
  topCategories: readonly { categoryName: string; totalInCents: bigint }[];
}

export interface AiQueryAuditRecord {
  tenantId: string;
  actorUserId: string;
  promptVersion: string;
  question: string;
  answer: string;
  latencyMs: number;
  estimatedTokens: number;
  providerName: string;
  createdAt: Date;
}

export interface AiProviderAdapter {
  readonly providerName: string;
  extractInvoiceDraft(input: {
    tenantId: string;
    mimeType: string;
    fileSha256: string;
    extractedTextHint?: string;
  }): Promise<DocumentExtractionDraft>;
  answerReadOnlyQuestion(input: {
    question: string;
    summary: TenantAggregatedSummary;
    promptVersion: string;
  }): Promise<{ answer: string; estimatedTokens: number }>;
}

/**
 * Adaptador determinístico sin llamadas externas ni costos variables para pruebas,
 * desarrollo local y validación de guardrails de seguridad.
 */
export class DeterministicAiProviderAdapter implements AiProviderAdapter {
  readonly providerName = 'deterministic-local';

  async extractInvoiceDraft(input: {
    tenantId: string;
    mimeType: string;
    fileSha256: string;
    extractedTextHint?: string;
  }): Promise<DocumentExtractionDraft> {
    const hint = input.extractedTextHint ?? '';
    const isInformal = /ticket|remito|informal/i.test(hint);
    const hasHighConfidence = !/borroso|ilegible|dudoso/i.test(hint);

    return {
      invoiceType: isInformal ? 'INFORMAL' : 'A',
      supplierNameCandidate: 'Proveedor Extraído S.A.',
      ...(isInformal ? { description: hint || 'Comprobante móvil capturado' } : { invoiceNumber: '0001-00098765' }),
      amountInCents: 45_000_00n,
      dueDateIso: '2030-02-15',
      confidenceScore: hasHighConfidence ? 0.92 : 0.65,
    };
  }

  async answerReadOnlyQuestion(input: {
    question: string;
    summary: TenantAggregatedSummary;
    promptVersion: string;
  }): Promise<{ answer: string; estimatedTokens: number }> {
    const pendingPesos = (Number(input.summary.totalPendingInCents) / 100).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const paidPesos = (Number(input.summary.paidThisMonthInCents) / 100).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const topCategory = input.summary.topCategories[0]?.categoryName ?? 'Sin registros';

    const answer =
      `Resumen de ${input.summary.businessName}: tenés ${input.summary.pendingInvoicesCount} comprobante(s) ` +
      `pendiente(s) por $ ${pendingPesos} y pagos registrados este mes por $ ${paidPesos}. ` +
      `Principal rubro: ${topCategory}. (Consulta de sólo lectura [${input.promptVersion}]).`;

    const estimatedTokens = Math.ceil((input.question.length + answer.length) / 4);
    return { answer, estimatedTokens };
  }
}

export class AiAssistantService {
  private readonly promptVersion = 'v1.0-readonly-ar';

  constructor(private readonly adapter: AiProviderAdapter = new DeterministicAiProviderAdapter()) {}

  async processDocumentCapture(input: {
    tenantId: string;
    mimeType: string;
    fileSha256: string;
    extractedTextHint?: string;
  }): Promise<EvaluatedDocumentExtraction> {
    const rawDraft = await this.adapter.extractInvoiceDraft(input);
    return evaluateDocumentExtraction(rawDraft);
  }

  async askTenantQuestion(input: {
    tenantId: string;
    actorUserId: string;
    planCode: PlanCode;
    usedQueriesThisMonth: number;
    maxQueriesPerMonth: number;
    question: string;
    summary: TenantAggregatedSummary;
  }): Promise<{ answer: string; audit: AiQueryAuditRecord }> {
    const startedAt = Date.now();
    const sanitizedQuestion = validateReadOnlyAiQuery({
      tenantId: input.tenantId,
      planCode: input.planCode,
      usedQueriesThisMonth: input.usedQueriesThisMonth,
      maxQueriesPerMonth: input.maxQueriesPerMonth,
      question: input.question,
    });

    const result = await this.adapter.answerReadOnlyQuestion({
      question: sanitizedQuestion,
      summary: input.summary,
      promptVersion: this.promptVersion,
    });

    const latencyMs = Math.max(1, Date.now() - startedAt);
    return {
      answer: result.answer,
      audit: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        promptVersion: this.promptVersion,
        question: sanitizedQuestion,
        answer: result.answer,
        latencyMs,
        estimatedTokens: result.estimatedTokens,
        providerName: this.adapter.providerName,
        createdAt: new Date(),
      },
    };
  }
}
