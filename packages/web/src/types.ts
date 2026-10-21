import type { MembershipRole, PlanCode } from '../../domain/src/model.js';

export interface UserProfile {
  sub: string;
  email: string;
  name?: string | undefined;
}

export interface TenantContext {
  tenantId: string;
  businessName: string;
  planCode: Exclude<PlanCode, 'BASIC'>;
  userRole: MembershipRole;
  dualControlEnabled?: boolean | undefined;
}

export interface CategoryCatalogItem {
  code: string;
  name: string;
}

export const INITIAL_CATEGORIES: readonly CategoryCatalogItem[] = [
  { code: 'ALQUILERES', name: 'Alquileres y Expensas' },
  { code: 'GASTOS_GENERALES', name: 'Gastos Generales' },
  { code: 'HONORARIOS', name: 'Honorarios Profesionales' },
  { code: 'IMPUESTOS', name: 'Impuestos y Tasas' },
  { code: 'LIBRERIA', name: 'Librería e Insumos de Oficina' },
  { code: 'LOGISTICA', name: 'Logística y Fletes' },
  { code: 'MANTENIMIENTO', name: 'Mantenimiento y Limpieza' },
  { code: 'MERCADERIAS', name: 'Mercadería y Materias Primas' },
  { code: 'PUBLICIDAD', name: 'Publicidad y Marketing' },
  { code: 'SERVICIOS_PUBLICOS', name: 'Servicios Públicos (Luz, Gas, Agua, Internet)' },
  { code: 'SIN_CLASIFICAR', name: 'Sin Clasificar (Transitorio)' },
];

export interface SupplierSummary {
  id: string;
  businessName: string;
  cuit?: string | undefined;
  mobilePhone: string;
  cbuCvuOrAlias?: string | undefined;
  categoryCode?: string | undefined;
  categoryName?: string | undefined;
}

export interface InvoiceItem {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceType: 'A' | 'C' | 'INFORMAL';
  invoiceNumber?: string | undefined;
  description?: string | undefined;
  amountInCents: string;
  dueDate: string;
  status: 'PENDING_REVIEW' | 'IN_GRID' | 'PAYMENT_PROPOSED' | 'PAID' | 'CANCELLED';
  scheduledPaymentDate?: string | undefined;
  confidenceScore?: number | undefined;
}

export interface PaymentBatchSummary {
  batchId: string;
  status: 'RECORDED' | 'PENDING_APPROVAL' | 'REVERSED';
  totalInCents: string;
  invoiceIds: string[];
  proposedByRole: MembershipRole;
  proposedAt: string;
  reversalReason?: string | undefined;
}

export interface PaymentGridConfig {
  timezone: string;
  notificationTime: string;
  lookAheadHours: number;
  enabled: boolean;
  recipientMembershipIds: string[];
}

export interface PaymentProposalResult {
  batchId: string;
  status: 'RECORDED' | 'PENDING_APPROVAL' | 'REVERSED';
  totalInCents: string;
  idempotent: boolean;
}

export interface TeamMemberItem {
  membershipId: string;
  email: string;
  fullName: string;
  role: MembershipRole;
  active: boolean;
}

export interface AiChatMessage {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}
