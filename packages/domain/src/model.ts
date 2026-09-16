export const PLAN_CODES = ['BASIC', 'PROFESSIONAL', 'ULTRA'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const MEMBERSHIP_ROLES = ['ADMIN', 'OPERATOR_UPLOAD', 'OPERATOR_PAYMENTS'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const INVOICE_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'IN_GRID',
  'PAYMENT_PROPOSED',
  'PAID',
  'CANCELED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface SupplierInput {
  businessName: string;
  mobilePhone: string;
  cuit?: string;
  address?: string;
  cbuCvuOrAlias?: string;
  categoryCode?: string;
}

export interface InvoiceForPayment {
  id: string;
  tenantId: string;
  amountInCents: bigint;
  status: InvoiceStatus;
}

export interface PaymentBatchRequest {
  tenantId: string;
  invoiceIds: readonly string[];
  requestedByRole: MembershipRole;
  idempotencyKey: string;
}

export interface EditablePlanCapabilities {
  maxInvoicesPerMonth: number;
  maxSuppliers: number;
  maxActiveUsers: number;
  maxStorageBytes: bigint;
  monthlyAiQueries: number;
  dashboardEnabled: boolean;
  supplierNotificationsEnabled: boolean;
  webOperationsEnabled: boolean;
  webAdministrationEnabled: boolean;
  aiChatEnabled: boolean;
}

export interface PlanPriceVersion {
  planCode: PlanCode;
  amountInCents: bigint;
  currency: string;
  validFrom: Date;
  validTo?: Date;
}
