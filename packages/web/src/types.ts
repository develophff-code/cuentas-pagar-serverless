import type { MembershipRole, PlanCode } from '../../domain/src/model.js';

export interface UserProfile {
  sub: string;
  email: string;
  name?: string;
}

export interface TenantContext {
  tenantId: string;
  businessName: string;
  planCode: Exclude<PlanCode, 'BASIC'>;
  userRole: MembershipRole;
}

export interface SupplierSummary {
  id: string;
  businessName: string;
  cuit?: string;
  mobilePhone: string;
  cbuCvuOrAlias?: string;
  categoryCode?: string;
  categoryName?: string;
}

export interface InvoiceItem {
  id: string;
  supplierId: string;
  supplierName: string;
  invoiceType: 'A' | 'C' | 'INFORMAL';
  invoiceNumber?: string | undefined;
  description?: string | undefined;
  amountInCents: string; // Serializado como string para evitar overflow en frontend
  dueDate: string;
  status: 'PENDING_REVIEW' | 'IN_GRID' | 'PAID' | 'CANCELLED';
  scheduledPaymentDate?: string | undefined;
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
  status: 'RECORDED' | 'PENDING_APPROVAL';
  totalInCents: string;
  idempotent: boolean;
}
