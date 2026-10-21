import type { PlanCode } from './model.js';
import { DomainRuleViolation } from './payment-policy.js';

export interface DocumentExtractionDraft {
  invoiceType: 'A' | 'C' | 'INFORMAL';
  supplierNameCandidate?: string | undefined;
  supplierCuitCandidate?: string | undefined;
  invoiceNumber?: string | undefined;
  description?: string | undefined;
  amountInCents: bigint;
  dueDateIso: string;
  confidenceScore: number; // 0.0 to 1.0
}

export interface EvaluatedDocumentExtraction extends DocumentExtractionDraft {
  requiresManualReview: boolean;
  reviewReason?: string | undefined;
}

const MINIMUM_CONFIDENCE_FOR_DIRECT_PROPOSAL = 0.85;

export function evaluateDocumentExtraction(draft: DocumentExtractionDraft): EvaluatedDocumentExtraction {
  if (!Number.isFinite(draft.confidenceScore) || draft.confidenceScore < 0 || draft.confidenceScore > 1) {
    throw new DomainRuleViolation('El puntaje de confianza de extracción debe estar entre 0 y 1.');
  }
  if (draft.amountInCents <= 0n) {
    throw new DomainRuleViolation('El importe extraído del documento debe ser mayor a cero.');
  }
  if (Number.isNaN(new Date(draft.dueDateIso).getTime())) {
    throw new DomainRuleViolation('La fecha de vencimiento extraída no es válida.');
  }

  let requiresManualReview = false;
  let reviewReason: string | undefined;

  if (draft.confidenceScore < MINIMUM_CONFIDENCE_FOR_DIRECT_PROPOSAL) {
    requiresManualReview = true;
    reviewReason = 'Confianza de extracción inferior al umbral de seguridad (85%).';
  } else if ((draft.invoiceType === 'A' || draft.invoiceType === 'C') && !draft.invoiceNumber?.trim()) {
    requiresManualReview = true;
    reviewReason = 'Comprobante fiscal sin número detectado.';
  } else if (draft.invoiceType === 'INFORMAL' && !draft.description?.trim()) {
    requiresManualReview = true;
    reviewReason = 'Comprobante informal sin descripción detectada.';
  }

  return {
    ...draft,
    requiresManualReview,
    ...(reviewReason !== undefined ? { reviewReason } : {}),
  };
}

export interface AiChatRequest {
  tenantId: string;
  planCode: PlanCode;
  usedQueriesThisMonth: number;
  maxQueriesPerMonth: number;
  question: string;
}

const FORBIDDEN_MUTATION_PATTERNS = [
  /\b(pagar|paga|ejecuta|aprobar|aprueba|transferir|transfiere|borrar|borra|eliminar|elimina|modificar|modifica|cambiar\s+plan|insert|update|delete|drop|alter)\b/i,
];

export function validateReadOnlyAiQuery(request: AiChatRequest): string {
  if (!request.tenantId.trim()) {
    throw new DomainRuleViolation('La consulta IA debe estar asociada a un tenant válido.');
  }
  if (request.planCode !== 'ULTRA') {
    throw new DomainRuleViolation('El chat de análisis con IA es exclusivo del plan ULTRA.');
  }
  if (request.maxQueriesPerMonth <= 0 || request.usedQueriesThisMonth >= request.maxQueriesPerMonth) {
    throw new DomainRuleViolation('Se alcanzó la cuota mensual de consultas de IA para el tenant.');
  }
  const normalized = request.question.trim();
  if (normalized.length < 3 || normalized.length > 500) {
    throw new DomainRuleViolation('La consulta debe tener entre 3 y 500 caracteres.');
  }
  for (const pattern of FORBIDDEN_MUTATION_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new DomainRuleViolation(
        'El asistente IA es de sólo lectura y no puede ejecutar pagos, bajas ni modificaciones.',
      );
    }
  }
  return normalized;
}
