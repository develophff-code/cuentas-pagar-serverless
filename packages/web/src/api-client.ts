import type { MembershipRole, PlanCode } from '../../domain/src/model.js';
import type {
  TenantContext,
  SupplierSummary,
  InvoiceItem,
  PaymentGridConfig,
  PaymentProposalResult,
  PaymentBatchSummary,
  TeamMemberItem,
  AiChatMessage,
} from './types.js';
import { INITIAL_CATEGORIES } from './types.js';

export interface ApiClient {
  getTenantContext(): Promise<TenantContext>;
  setDemoPlanAndRole?(planCode: Exclude<PlanCode, 'BASIC'>, role: MembershipRole): Promise<TenantContext>;
  listSuppliers(): Promise<SupplierSummary[]>;
  createSupplier(input: {
    businessName: string;
    mobilePhone: string;
    cuit?: string | undefined;
    cbuCvuOrAlias?: string | undefined;
    categoryCode?: string | undefined;
  }): Promise<{ id: string }>;
  listPaymentGrid(): Promise<InvoiceItem[]>;
  createInvoice(input: {
    supplierId: string;
    invoiceType: 'A' | 'C' | 'INFORMAL';
    invoiceNumber?: string | undefined;
    description?: string | undefined;
    amountInCents: bigint;
    dueDate: string;
    confirmImmediately?: boolean | undefined;
    attachmentFileName?: string | undefined;
    attachmentMimeType?: string | undefined;
  }): Promise<{ id: string }>;
  confirmDraftInvoice?(invoiceId: string): Promise<void>;
  cancelInvoice?(invoiceId: string): Promise<void>;
  createPaymentBatch(invoiceIds: string[]): Promise<PaymentProposalResult>;
  listPaymentBatches?(): Promise<PaymentBatchSummary[]>;
  approvePaymentBatch?(batchId: string): Promise<PaymentProposalResult>;
  reversePaymentBatch?(batchId: string, reason: string): Promise<PaymentProposalResult>;
  getGridConfig(): Promise<PaymentGridConfig>;
  updateGridConfig(input: PaymentGridConfig): Promise<PaymentGridConfig>;
  listTeamMembers?(): Promise<TeamMemberItem[]>;
  inviteTeamMember?(input: { email: string; fullName: string; role: MembershipRole }): Promise<TeamMemberItem>;
  askAiAssistant?(question: string): Promise<AiChatMessage>;
  listAiHistory?(): Promise<AiChatMessage[]>;
}

const FORBIDDEN_MUTATION_REGEX = /\b(pagar|paga|ejecuta|aprobar|aprueba|transferir|transfiere|borrar|borra|eliminar|elimina|modificar|modifica|cambiar\s+plan|insert|update|delete|drop|alter)\b/i;

export class MockApiClient implements ApiClient {
  private context: TenantContext = {
    tenantId: 'demo-tenant-witness-1',
    businessName: 'Empresa Testigo Piloto S.A.',
    planCode: 'ULTRA',
    userRole: 'ADMIN',
    dualControlEnabled: false,
  };

  private suppliers: SupplierSummary[] = [
    {
      id: 'sup-1',
      businessName: 'Distribuidora Central S.R.L.',
      cuit: '30-71123456-8',
      mobilePhone: '+5491140001122',
      cbuCvuOrAlias: 'DISTRIB.CENTRAL',
      categoryCode: 'MERCADERIAS',
      categoryName: 'Mercadería y Materias Primas',
    },
    {
      id: 'sup-2',
      businessName: 'Luz y Fuerza Coop',
      cuit: '30-50009988-1',
      mobilePhone: '+5491140003344',
      cbuCvuOrAlias: 'LUZ.FUERZA.PAGOS',
      categoryCode: 'SERVICIOS_PUBLICOS',
      categoryName: 'Servicios Públicos (Luz, Gas, Agua, Internet)',
    },
    {
      id: 'sup-3',
      businessName: 'Fletes Rápidos Cuyo',
      mobilePhone: '+5492644112233',
      cbuCvuOrAlias: 'FLETES.CUYO.MP',
      categoryCode: 'LOGISTICA',
      categoryName: 'Logística y Fletes',
    },
  ];

  private invoices: InvoiceItem[] = [
    {
      id: 'inv-101',
      supplierId: 'sup-1',
      supplierName: 'Distribuidora Central S.R.L.',
      invoiceType: 'A',
      invoiceNumber: '0001-00045892',
      description: 'Insumos y mercadería mensual',
      amountInCents: '14500000',
      dueDate: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
      status: 'IN_GRID',
      attachmentFileName: 'Factura_A_0001-00045892.pdf',
      attachmentMimeType: 'application/pdf',
    },
    {
      id: 'inv-102',
      supplierId: 'sup-2',
      supplierName: 'Luz y Fuerza Coop',
      invoiceType: 'C',
      invoiceNumber: '0004-00112200',
      description: 'Consumo eléctrico depósito central',
      amountInCents: '3850000',
      dueDate: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10),
      status: 'IN_GRID',
    },
    {
      id: 'inv-103',
      supplierId: 'sup-3',
      supplierName: 'Fletes Rápidos Cuyo',
      invoiceType: 'INFORMAL',
      description: 'Remito capturado por WhatsApp (OCR 94%)',
      amountInCents: '2200000',
      dueDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
      status: 'PENDING_REVIEW',
      confidenceScore: 0.94,
      attachmentFileName: 'remito_whatsapp.jpg',
      attachmentMimeType: 'image/jpeg',
    },
  ];

  private batches: PaymentBatchSummary[] = [];

  private gridConfig: PaymentGridConfig = {
    timezone: 'America/Argentina/Buenos_Aires',
    notificationTime: '09:00',
    lookAheadHours: 24,
    enabled: true,
    recipientMembershipIds: ['mem-1'],
  };

  private teamMembers: TeamMemberItem[] = [
    {
      membershipId: 'mem-1',
      email: 'admin@empresatestigo.com.ar',
      fullName: 'Horacio (Administrador)',
      role: 'ADMIN',
      active: true,
    },
    {
      membershipId: 'mem-2',
      email: 'carga@empresatestigo.com.ar',
      fullName: 'Lucía Operadora Carga',
      role: 'OPERATOR_UPLOAD',
      active: true,
    },
    {
      membershipId: 'mem-3',
      email: 'tesoreria@empresatestigo.com.ar',
      fullName: 'Martín Operador Pagos',
      role: 'OPERATOR_PAYMENTS',
      active: true,
    },
  ];

  private aiMessages: AiChatMessage[] = [
    {
      id: 'ai-1',
      question: '¿Cuál es el resumen de vencimientos pendientes y el rubro principal?',
      answer:
        'Tenés 2 facturas aprobadas en grilla por $ 183.500,00 y 1 comprobante en borrador pendiente de revisión por $ 22.000,00. El rubro de mayor peso es Mercadería y Materias Primas ($ 145.000,00).',
      timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    },
  ];

  async getTenantContext(): Promise<TenantContext> {
    return { ...this.context };
  }

  async setDemoPlanAndRole(planCode: Exclude<PlanCode, 'BASIC'>, role: MembershipRole): Promise<TenantContext> {
    this.context = { ...this.context, planCode, userRole: role };
    return { ...this.context };
  }

  async listSuppliers(): Promise<SupplierSummary[]> {
    return [...this.suppliers];
  }

  async createSupplier(input: {
    businessName: string;
    mobilePhone: string;
    cuit?: string | undefined;
    cbuCvuOrAlias?: string | undefined;
    categoryCode?: string | undefined;
  }): Promise<{ id: string }> {
    if (!input.businessName.trim() || !input.mobilePhone.trim()) {
      throw new Error('Razón social y celular son obligatorios.');
    }
    const id = `sup-${Date.now()}`;
    const cat = INITIAL_CATEGORIES.find((c) => c.code === input.categoryCode);
    this.suppliers.push({
      id,
      businessName: input.businessName.trim(),
      mobilePhone: input.mobilePhone.trim(),
      cuit: input.cuit?.trim() || undefined,
      cbuCvuOrAlias: input.cbuCvuOrAlias?.trim() || undefined,
      categoryCode: cat?.code ?? 'SIN_CLASIFICAR',
      categoryName: cat?.name ?? 'Sin Clasificar (Transitorio)',
    });
    return { id };
  }

  async listPaymentGrid(): Promise<InvoiceItem[]> {
    return [...this.invoices];
  }

  async createInvoice(input: {
    supplierId: string;
    invoiceType: 'A' | 'C' | 'INFORMAL';
    invoiceNumber?: string | undefined;
    description?: string | undefined;
    amountInCents: bigint;
    dueDate: string;
    confirmImmediately?: boolean | undefined;
    attachmentFileName?: string | undefined;
    attachmentMimeType?: string | undefined;
  }): Promise<{ id: string }> {
    const sup = this.suppliers.find((s) => s.id === input.supplierId);
    if (!sup) throw new Error('Proveedor no encontrado.');
    const canConfirm = this.context.userRole === 'ADMIN' && input.confirmImmediately !== false;
    if (canConfirm && sup.categoryCode === 'SIN_CLASIFICAR') {
      throw new Error('Debe clasificar al proveedor antes de confirmar una factura en la grilla.');
    }
    const id = `inv-${Date.now()}`;
    this.invoices.push({
      id,
      supplierId: input.supplierId,
      supplierName: sup.businessName,
      invoiceType: input.invoiceType,
      invoiceNumber: input.invoiceNumber,
      description: input.description,
      amountInCents: input.amountInCents.toString(),
      dueDate: input.dueDate,
      status: canConfirm ? 'IN_GRID' : 'PENDING_REVIEW',
      attachmentFileName: input.attachmentFileName,
      attachmentMimeType: input.attachmentMimeType,
    });
    return { id };
  }

  async confirmDraftInvoice(invoiceId: string): Promise<void> {
    if (this.context.userRole !== 'ADMIN') {
      throw new Error('Sólo un administrador puede confirmar borradores e incluirlos en la grilla.');
    }
    const inv = this.invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new Error('Comprobante no encontrado.');
    const sup = this.suppliers.find((s) => s.id === inv.supplierId);
    if (sup?.categoryCode === 'SIN_CLASIFICAR') {
      throw new Error('Clasifique el proveedor antes de confirmar esta factura.');
    }
    inv.status = 'IN_GRID';
  }

  async cancelInvoice(invoiceId: string): Promise<void> {
    if (this.context.userRole !== 'ADMIN') {
      throw new Error('Sólo un administrador puede anular comprobantes.');
    }
    const inv = this.invoices.find((i) => i.id === invoiceId);
    if (inv) inv.status = 'CANCELLED';
  }

  async createPaymentBatch(invoiceIds: string[]): Promise<PaymentProposalResult> {
    if (this.context.userRole === 'OPERATOR_UPLOAD') {
      throw new Error('El rol Operador de Carga no puede proponer ni registrar pagos.');
    }
    let total = 0n;
    const isRecorded = this.context.userRole === 'ADMIN';
    for (const inv of this.invoices) {
      if (invoiceIds.includes(inv.id)) {
        total += BigInt(inv.amountInCents);
        inv.status = isRecorded ? 'PAID' : 'PAYMENT_PROPOSED';
      }
    }
    const batchId = `batch-${Date.now().toString().slice(-6)}`;
    const status = isRecorded ? 'RECORDED' : 'PENDING_APPROVAL';
    this.batches.unshift({
      batchId,
      status,
      totalInCents: total.toString(),
      invoiceIds: [...invoiceIds],
      proposedByRole: this.context.userRole,
      proposedAt: new Date().toLocaleString('es-AR'),
    });
    return { batchId, status, totalInCents: total.toString(), idempotent: false };
  }

  async listPaymentBatches(): Promise<PaymentBatchSummary[]> {
    return [...this.batches];
  }

  async approvePaymentBatch(batchId: string): Promise<PaymentProposalResult> {
    if (this.context.userRole !== 'ADMIN') {
      throw new Error('Sólo el administrador puede aprobar propuestas de pago.');
    }
    const batch = this.batches.find((b) => b.batchId === batchId);
    if (!batch) throw new Error('Lote no encontrado.');
    batch.status = 'RECORDED';
    for (const inv of this.invoices) {
      if (batch.invoiceIds.includes(inv.id)) {
        inv.status = 'PAID';
      }
    }
    return { batchId: batch.batchId, status: 'RECORDED', totalInCents: batch.totalInCents, idempotent: false };
  }

  async reversePaymentBatch(batchId: string, reason: string): Promise<PaymentProposalResult> {
    if (this.context.userRole !== 'ADMIN') {
      throw new Error('Sólo el administrador puede revertir pagos.');
    }
    if (!reason.trim()) {
      throw new Error('Debe indicar un motivo de auditoría para revertir el lote.');
    }
    const batch = this.batches.find((b) => b.batchId === batchId);
    if (!batch) throw new Error('Lote no encontrado.');
    batch.status = 'REVERSED';
    batch.reversalReason = reason.trim();
    for (const inv of this.invoices) {
      if (batch.invoiceIds.includes(inv.id)) {
        inv.status = 'IN_GRID';
      }
    }
    return { batchId: batch.batchId, status: 'REVERSED', totalInCents: batch.totalInCents, idempotent: false };
  }

  async getGridConfig(): Promise<PaymentGridConfig> {
    return { ...this.gridConfig };
  }

  async updateGridConfig(input: PaymentGridConfig): Promise<PaymentGridConfig> {
    if (this.context.userRole !== 'ADMIN') {
      throw new Error('Sólo un administrador puede modificar la configuración de alertas.');
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.notificationTime)) {
      throw new Error('La hora debe tener formato HH:mm (ej. 09:00).');
    }
    if (input.lookAheadHours < 1 || input.lookAheadHours > 168) {
      throw new Error('La anticipación debe estar entre 1 y 168 horas.');
    }
    this.gridConfig = { ...input };
    return { ...this.gridConfig };
  }

  async listTeamMembers(): Promise<TeamMemberItem[]> {
    return [...this.teamMembers];
  }

  async inviteTeamMember(input: { email: string; fullName: string; role: MembershipRole }): Promise<TeamMemberItem> {
    if (this.context.userRole !== 'ADMIN') {
      throw new Error('Sólo el administrador puede administrar miembros del equipo.');
    }
    if (input.role === 'ADMIN') {
      throw new Error('No se delega el rol ADMIN a operadores secundarios.');
    }
    const item: TeamMemberItem = {
      membershipId: `mem-${Date.now()}`,
      email: input.email.trim(),
      fullName: input.fullName.trim(),
      role: input.role,
      active: true,
    };
    this.teamMembers.push(item);
    return item;
  }

  async listAiHistory(): Promise<AiChatMessage[]> {
    return [...this.aiMessages];
  }

  async askAiAssistant(question: string): Promise<AiChatMessage> {
    if (this.context.planCode !== 'ULTRA') {
      throw new Error('El Chat IA de lectura está disponible únicamente en el plan ULTRA.');
    }
    const q = question.trim();
    if (!q) throw new Error('Escriba una consulta para analizar.');
    if (FORBIDDEN_MUTATION_REGEX.test(q)) {
      throw new Error(
        'Guardrail de seguridad: El asistente IA es de sólo lectura y no tiene permisos para ejecutar pagos, bajas ni modificaciones.',
      );
    }
    const inGrid = this.invoices.filter((i) => i.status === 'IN_GRID');
    const paid = this.invoices.filter((i) => i.status === 'PAID');
    const sumGrid = inGrid.reduce((acc, i) => acc + BigInt(i.amountInCents), 0n);
    const sumPaid = paid.reduce((acc, i) => acc + BigInt(i.amountInCents), 0n);

    const fmt = (cents: bigint) =>
      `$ ${(Number(cents) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const msg: AiChatMessage = {
      id: `ai-${Date.now()}`,
      question: q,
      answer: `Análisis tenant-aware (${this.context.businessName}): hay ${inGrid.length} factura(s) en grilla por ${fmt(sumGrid)} y ${paid.length} pagada(s) por ${fmt(sumPaid)}. Proveedores activos: ${this.suppliers.length}. (Modo sólo lectura auditado).`,
      timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    };
    this.aiMessages.push(msg);
    return msg;
  }
}

export class HttpApiClient implements ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getAuthToken: () => Promise<string | null>,
    private readonly tenantId: string,
  ) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string>) },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Error HTTP ${res.status}`);
    }
    return res.json();
  }

  async getTenantContext(): Promise<TenantContext> {
    return this.request<TenantContext>(`/v1/tenants/${this.tenantId}/context`);
  }

  async listSuppliers(): Promise<SupplierSummary[]> {
    return this.request<SupplierSummary[]>(`/v1/tenants/${this.tenantId}/suppliers`);
  }

  async createSupplier(input: {
    businessName: string;
    mobilePhone: string;
    cuit?: string | undefined;
    cbuCvuOrAlias?: string | undefined;
    categoryCode?: string | undefined;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/v1/tenants/${this.tenantId}/suppliers`, {
      method: 'POST',
      headers: { 'idempotency-key': `sup-${Date.now()}-${Math.random()}` },
      body: JSON.stringify(input),
    });
  }

  async listPaymentGrid(): Promise<InvoiceItem[]> {
    return this.request<InvoiceItem[]>(`/v1/tenants/${this.tenantId}/payment-grid`);
  }

  async createInvoice(input: {
    supplierId: string;
    invoiceType: 'A' | 'C' | 'INFORMAL';
    invoiceNumber?: string | undefined;
    description?: string | undefined;
    amountInCents: bigint;
    dueDate: string;
    confirmImmediately?: boolean | undefined;
    attachmentFileName?: string | undefined;
    attachmentMimeType?: string | undefined;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/v1/tenants/${this.tenantId}/invoices`, {
      method: 'POST',
      headers: { 'idempotency-key': `inv-${Date.now()}-${Math.random()}` },
      body: JSON.stringify({
        ...input,
        amountInCents: input.amountInCents.toString(),
      }),
    });
  }

  async createPaymentBatch(invoiceIds: string[]): Promise<PaymentProposalResult> {
    return this.request<PaymentProposalResult>(`/v1/tenants/${this.tenantId}/payment-batches`, {
      method: 'POST',
      headers: { 'idempotency-key': `pay-${Date.now()}-${Math.random()}` },
      body: JSON.stringify({ invoiceIds }),
    });
  }

  async approvePaymentBatch(batchId: string): Promise<PaymentProposalResult> {
    return this.request<PaymentProposalResult>(`/v1/tenants/${this.tenantId}/payment-batches/${batchId}/approve`, {
      method: 'POST',
      headers: { 'idempotency-key': `app-${batchId}-${Date.now()}` },
      body: JSON.stringify({ batchId }),
    });
  }

  async reversePaymentBatch(batchId: string, reason: string): Promise<PaymentProposalResult> {
    return this.request<PaymentProposalResult>(`/v1/tenants/${this.tenantId}/payment-batches/${batchId}/reverse`, {
      method: 'POST',
      headers: { 'idempotency-key': `rev-${batchId}-${Date.now()}` },
      body: JSON.stringify({ batchId, reason }),
    });
  }

  async getGridConfig(): Promise<PaymentGridConfig> {
    return this.request<PaymentGridConfig>(`/v1/tenants/${this.tenantId}/payment-grid/configuration`);
  }

  async updateGridConfig(input: PaymentGridConfig): Promise<PaymentGridConfig> {
    return this.request<PaymentGridConfig>(`/v1/tenants/${this.tenantId}/payment-grid/configuration`, {
      method: 'PUT',
      headers: { 'idempotency-key': `cfg-${Date.now()}` },
      body: JSON.stringify(input),
    });
  }
}
