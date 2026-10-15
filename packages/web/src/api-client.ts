import type {
  TenantContext,
  SupplierSummary,
  InvoiceItem,
  PaymentGridConfig,
  PaymentProposalResult
} from './types.js';

export interface ApiClient {
  getTenantContext(): Promise<TenantContext>;
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
    invoiceNumber?: string;
    description?: string;
    amountInCents: bigint;
    dueDate: string;
  }): Promise<{ id: string }>;
  createPaymentBatch(invoiceIds: string[]): Promise<PaymentProposalResult>;
  getGridConfig(): Promise<PaymentGridConfig>;
  updateGridConfig(input: PaymentGridConfig): Promise<PaymentGridConfig>;
}

export class MockApiClient implements ApiClient {
  private suppliers: SupplierSummary[] = [
    {
      id: 'sup-1',
      businessName: 'Distribuidora Central S.R.L.',
      cuit: '30-71123456-8',
      mobilePhone: '+5491140001122',
      cbuCvuOrAlias: 'DISTRIB.CENTRAL',
      categoryCode: 'MERCADERIAS',
      categoryName: 'Mercadería y Materias Primas'
    },
    {
      id: 'sup-2',
      businessName: 'Luz y Fuerza Coop',
      mobilePhone: '+5491140003344',
      cbuCvuOrAlias: 'LUZ.FUERZA.PAGOS',
      categoryCode: 'SERVICIOS_PUBLICOS',
      categoryName: 'Servicios Públicos'
    }
  ];

  private invoices: InvoiceItem[] = [
    {
      id: 'inv-101',
      supplierId: 'sup-1',
      supplierName: 'Distribuidora Central S.R.L.',
      invoiceType: 'A',
      invoiceNumber: '0001-00045892',
      description: 'Insumos y mercadería mensual',
      amountInCents: '14500000', // $145.000,00
      dueDate: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
      status: 'IN_GRID'
    },
    {
      id: 'inv-102',
      supplierId: 'sup-2',
      supplierName: 'Luz y Fuerza Coop',
      invoiceType: 'INFORMAL',
      description: 'Servicio de mantenimiento de luminaria',
      amountInCents: '3850000', // $38.500,00
      dueDate: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10),
      status: 'IN_GRID'
    }
  ];

  private gridConfig: PaymentGridConfig = {
    timezone: 'America/Argentina/Buenos_Aires',
    notificationTime: '09:00',
    lookAheadHours: 24,
    enabled: true,
    recipientMembershipIds: ['mem-1']
  };

  async getTenantContext(): Promise<TenantContext> {
    return {
      tenantId: 'demo-tenant-witness-1',
      businessName: 'Empresa Testigo Piloto S.A.',
      planCode: 'PROFESSIONAL',
      userRole: 'ADMIN'
    };
  }

  async listSuppliers(): Promise<SupplierSummary[]> {
    return [...this.suppliers];
  }

  async createSupplier(input: {
    businessName: string;
    mobilePhone: string;
    cuit?: string;
    cbuCvuOrAlias?: string;
    categoryCode?: string;
  }): Promise<{ id: string }> {
    const id = `sup-${Date.now()}`;
    this.suppliers.push({
      id,
      ...input,
      categoryName: input.categoryCode ?? 'General'
    });
    return { id };
  }

  async listPaymentGrid(): Promise<InvoiceItem[]> {
    return [...this.invoices];
  }

  async createInvoice(input: {
    supplierId: string;
    invoiceType: 'A' | 'C' | 'INFORMAL';
    invoiceNumber?: string;
    description?: string;
    amountInCents: bigint;
    dueDate: string;
  }): Promise<{ id: string }> {
    const sup = this.suppliers.find((s) => s.id === input.supplierId);
    const id = `inv-${Date.now()}`;
    const newItem: InvoiceItem = {
      id,
      supplierId: input.supplierId,
      supplierName: sup ? sup.businessName : 'Proveedor Desconocido',
      invoiceType: input.invoiceType,
      invoiceNumber: input.invoiceNumber,
      description: input.description,
      amountInCents: input.amountInCents.toString(),
      dueDate: input.dueDate,
      status: 'IN_GRID'
    };
    this.invoices.push(newItem);
    return { id };
  }

  async createPaymentBatch(invoiceIds: string[]): Promise<PaymentProposalResult> {
    let total = 0n;
    for (const inv of this.invoices) {
      if (invoiceIds.includes(inv.id)) {
        total += BigInt(inv.amountInCents);
        inv.status = 'PAID';
      }
    }
    return {
      batchId: `batch-${Date.now()}`,
      status: 'RECORDED',
      totalInCents: total.toString(),
      idempotent: false
    };
  }

  async getGridConfig(): Promise<PaymentGridConfig> {
    return { ...this.gridConfig };
  }

  async updateGridConfig(input: PaymentGridConfig): Promise<PaymentGridConfig> {
    this.gridConfig = { ...input };
    return { ...this.gridConfig };
  }
}

export class HttpApiClient implements ApiClient {
  constructor(private readonly baseUrl: string, private readonly getAuthToken: () => Promise<string | null>, private readonly tenantId: string) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    };
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string>) }
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
    cuit?: string;
    cbuCvuOrAlias?: string;
    categoryCode?: string;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/v1/tenants/${this.tenantId}/suppliers`, {
      method: 'POST',
      headers: { 'idempotency-key': `sup-${Date.now()}-${Math.random()}` },
      body: JSON.stringify(input)
    });
  }

  async listPaymentGrid(): Promise<InvoiceItem[]> {
    return this.request<InvoiceItem[]>(`/v1/tenants/${this.tenantId}/payment-grid`);
  }

  async createInvoice(input: {
    supplierId: string;
    invoiceType: 'A' | 'C' | 'INFORMAL';
    invoiceNumber?: string;
    description?: string;
    amountInCents: bigint;
    dueDate: string;
  }): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/v1/tenants/${this.tenantId}/invoices`, {
      method: 'POST',
      headers: { 'idempotency-key': `inv-${Date.now()}-${Math.random()}` },
      body: JSON.stringify({
        ...input,
        amountInCents: input.amountInCents.toString()
      })
    });
  }

  async createPaymentBatch(invoiceIds: string[]): Promise<PaymentProposalResult> {
    return this.request<PaymentProposalResult>(`/v1/tenants/${this.tenantId}/payment-batches`, {
      method: 'POST',
      headers: { 'idempotency-key': `pay-${Date.now()}-${Math.random()}` },
      body: JSON.stringify({ invoiceIds, requestedByRole: 'ADMIN' })
    });
  }

  async getGridConfig(): Promise<PaymentGridConfig> {
    return this.request<PaymentGridConfig>(`/v1/tenants/${this.tenantId}/payment-grid/configuration`);
  }

  async updateGridConfig(input: PaymentGridConfig): Promise<PaymentGridConfig> {
    return this.request<PaymentGridConfig>(`/v1/tenants/${this.tenantId}/payment-grid/configuration`, {
      method: 'PUT',
      headers: { 'idempotency-key': `cfg-${Date.now()}` },
      body: JSON.stringify(input)
    });
  }
}
