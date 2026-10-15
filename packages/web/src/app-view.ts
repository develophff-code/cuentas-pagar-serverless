import type { ApiClient } from './api-client.js';
import type { InvoiceItem, SupplierSummary, TenantContext } from './types.js';
import { formatCurrency, formatDate } from './utils.js';

export class AppView {
  private container: HTMLElement;
  private client: ApiClient;
  private tenantContext: TenantContext | null = null;
  private suppliers: SupplierSummary[] = [];
  private invoices: InvoiceItem[] = [];
  private selectedInvoiceIds = new Set<string>();
  private activeTab: 'grid' | 'suppliers' | 'whatsapp' = 'grid';

  constructor(container: HTMLElement, client: ApiClient) {
    this.container = container;
    this.client = client;
  }

  async init(): Promise<void> {
    this.renderLoading();
    try {
      this.tenantContext = await this.client.getTenantContext();
      await this.refreshData();
      this.render();
    } catch (err) {
      this.renderError(err instanceof Error ? err.message : 'Error al cargar la aplicación');
    }
  }

  private async refreshData(): Promise<void> {
    const [suppliers, invoices] = await Promise.all([
      this.client.listSuppliers(),
      this.client.listPaymentGrid()
    ]);
    this.suppliers = suppliers;
    this.invoices = invoices;
    this.selectedInvoiceIds.clear();
  }

  private renderLoading(): void {
    this.container.innerHTML = `
      <div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
        <p style="color:#64748b;font-size:1.125rem;">Cargando Cuentas a Pagar...</p>
      </div>
    `;
  }

  private renderError(msg: string): void {
    this.container.innerHTML = `
      <div style="padding:2rem;max-width:32rem;margin:4rem auto;background:#fef2f2;border:1px solid #f87171;border-radius:0.5rem;font-family:sans-serif;">
        <h2 style="color:#991b1b;margin-top:0;">Error</h2>
        <p style="color:#7f1d1d;">${msg}</p>
        <button id="retry-btn" style="background:#dc2626;color:white;padding:0.5rem 1rem;border:none;border-radius:0.25rem;cursor:pointer;">Reintentar</button>
      </div>
    `;
    this.container.querySelector('#retry-btn')?.addEventListener('click', () => this.init());
  }

  render(): void {
    if (!this.tenantContext) return;

    this.container.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;">
        <!-- Header -->
        <header style="background:#ffffff;border-bottom:1px solid #e2e8f0;padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:1rem;">
            <div style="width:2.25rem;height:2.25rem;background:#0284c7;color:white;border-radius:0.375rem;display:flex;align-items:center;justify-content:center;font-weight:bold;">$</div>
            <div>
              <h1 style="font-size:1.125rem;font-weight:700;margin:0;">Cuentas a Pagar</h1>
              <p style="font-size:0.875rem;color:#64748b;margin:0;">${this.tenantContext.businessName} &bull; Plan ${this.tenantContext.planCode}</p>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="background:#e0f2fe;color:#0369a1;padding:0.25rem 0.625rem;border-radius:9999px;font-size:0.75rem;font-weight:600;">
              Rol: ${this.tenantContext.userRole}
            </span>
          </div>
        </header>

        <!-- Navigation Tabs -->
        <nav style="background:#ffffff;border-bottom:1px solid #e2e8f0;padding:0 2rem;display:flex;gap:2rem;">
          <button id="tab-grid" style="padding:0.875rem 0;background:none;border:none;border-bottom:2px solid ${this.activeTab === 'grid' ? '#0284c7' : 'transparent'};color:${this.activeTab === 'grid' ? '#0284c7' : '#64748b'};font-weight:600;cursor:pointer;">
            Grilla Semanal de Pagos
          </button>
          <button id="tab-suppliers" style="padding:0.875rem 0;background:none;border:none;border-bottom:2px solid ${this.activeTab === 'suppliers' ? '#0284c7' : 'transparent'};color:${this.activeTab === 'suppliers' ? '#0284c7' : '#64748b'};font-weight:600;cursor:pointer;">
            Proveedores (${this.suppliers.length})
          </button>
          <button id="tab-whatsapp" style="padding:0.875rem 0;background:none;border:none;border-bottom:2px solid ${this.activeTab === 'whatsapp' ? '#0284c7' : 'transparent'};color:${this.activeTab === 'whatsapp' ? '#0284c7' : '#64748b'};font-weight:600;cursor:pointer;">
            Vinculación WhatsApp
          </button>
        </nav>

        <!-- Main Content -->
        <main style="flex:1;padding:2rem;max-width:1200px;margin:0 auto;width:100%;box-sizing:border-box;">
          ${this.renderActiveTab()}
        </main>
      </div>
    `;

    this.bindEvents();
  }

  private renderActiveTab(): string {
    switch (this.activeTab) {
      case 'grid':
        return this.renderGridTab();
      case 'suppliers':
        return this.renderSuppliersTab();
      case 'whatsapp':
        return this.renderWhatsAppTab();
    }
  }

  private renderGridTab(): string {
    const pendingInvoices = this.invoices.filter((i) => i.status === 'IN_GRID');
    const totalSelected = Array.from(this.selectedInvoiceIds).reduce((acc, id) => {
      const inv = this.invoices.find((i) => i.id === id);
      return acc + (inv ? BigInt(inv.amountInCents) : 0n);
    }, 0n);

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <h2 style="font-size:1.5rem;font-weight:700;margin:0;">Vencimientos Pendientes</h2>
          <p style="color:#64748b;margin:0.25rem 0 0 0;font-size:0.875rem;">Facturas aprobadas listas para autorizar y transferir</p>
        </div>
        <div style="display:flex;gap:1rem;">
          <button id="btn-new-invoice" style="background:#0284c7;color:white;padding:0.5rem 1rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">
            + Cargar Factura
          </button>
        </div>
      </div>

      <!-- Action bar for selected payments -->
      ${this.selectedInvoiceIds.size > 0 ? `
        <div style="background:#0284c7;color:white;padding:0.875rem 1.5rem;border-radius:0.5rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
          <div>
            <strong>${this.selectedInvoiceIds.size}</strong> comprobante(s) seleccionado(s) &bull; Total: <strong>${formatCurrency(totalSelected)}</strong>
          </div>
          <button id="btn-pay-batch" style="background:white;color:#0284c7;padding:0.5rem 1.25rem;border:none;border-radius:0.25rem;font-weight:700;cursor:pointer;">
            ${this.tenantContext?.userRole === 'ADMIN' ? 'Registrar Pago Completo' : 'Proponer Lote de Pago'}
          </button>
        </div>
      ` : ''}

      <!-- Grid Table -->
      <div style="background:white;border-radius:0.5rem;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <table style="width:100%;border-collapse:collapse;text-align:left;font-size:0.875rem;">
          <thead style="background:#f1f5f9;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">
            <tr>
              <th style="padding:0.75rem 1rem;width:2.5rem;">
                <input type="checkbox" id="select-all" ${this.selectedInvoiceIds.size > 0 && this.selectedInvoiceIds.size === pendingInvoices.length ? 'checked' : ''}/>
              </th>
              <th style="padding:0.75rem 1rem;">Vencimiento</th>
              <th style="padding:0.75rem 1rem;">Proveedor</th>
              <th style="padding:0.75rem 1rem;">Tipo / Comprobante</th>
              <th style="padding:0.75rem 1rem;">Descripción</th>
              <th style="padding:0.75rem 1rem;text-align:right;">Importe</th>
              <th style="padding:0.75rem 1rem;text-align:center;">Estado</th>
            </tr>
          </thead>
          <tbody>
            ${this.invoices.length === 0 ? `
              <tr><td colspan="7" style="padding:2rem;text-align:center;color:#94a3b8;">No hay facturas registradas en el sistema.</td></tr>
            ` : this.invoices.map((inv) => `
              <tr style="border-bottom:1px solid #f1f5f9;background:${this.selectedInvoiceIds.has(inv.id) ? '#f0f9ff' : 'transparent'};">
                <td style="padding:0.75rem 1rem;">
                  ${inv.status === 'IN_GRID' ? `
                    <input type="checkbox" class="invoice-checkbox" data-id="${inv.id}" ${this.selectedInvoiceIds.has(inv.id) ? 'checked' : ''}/>
                  ` : ''}
                </td>
                <td style="padding:0.75rem 1rem;font-weight:600;">${formatDate(inv.dueDate)}</td>
                <td style="padding:0.75rem 1rem;">${inv.supplierName}</td>
                <td style="padding:0.75rem 1rem;">
                  <span style="font-family:monospace;background:#f1f5f9;padding:0.125rem 0.375rem;border-radius:0.25rem;">
                    ${inv.invoiceType} ${inv.invoiceNumber || '(S/N)'}
                  </span>
                </td>
                <td style="padding:0.75rem 1rem;color:#64748b;">${inv.description || '-'}</td>
                <td style="padding:0.75rem 1rem;text-align:right;font-weight:700;">${formatCurrency(inv.amountInCents)}</td>
                <td style="padding:0.75rem 1rem;text-align:center;">
                  <span style="padding:0.25rem 0.5rem;border-radius:9999px;font-size:0.75rem;font-weight:600;${
                    inv.status === 'PAID' ? 'background:#dcfce7;color:#166534;' : 'background:#fef9c3;color:#854d0e;'
                  }">
                    ${inv.status === 'PAID' ? 'PAGADA' : 'EN GRILLA'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderSuppliersTab(): string {
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <h2 style="font-size:1.5rem;font-weight:700;margin:0;">Padrón de Proveedores</h2>
          <p style="color:#64748b;margin:0.25rem 0 0 0;font-size:0.875rem;">Cuentas bancarias, teléfonos WhatsApp y categorías</p>
        </div>
        <button id="btn-new-supplier" style="background:#0284c7;color:white;padding:0.5rem 1rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">
          + Nuevo Proveedor
        </button>
      </div>

      <div style="background:white;border-radius:0.5rem;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <table style="width:100%;border-collapse:collapse;text-align:left;font-size:0.875rem;">
          <thead style="background:#f1f5f9;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">
            <tr>
              <th style="padding:0.75rem 1rem;">Razón Social</th>
              <th style="padding:0.75rem 1rem;">CUIT</th>
              <th style="padding:0.75rem 1rem;">WhatsApp</th>
              <th style="padding:0.75rem 1rem;">CBU / Alias</th>
              <th style="padding:0.75rem 1rem;">Categoría</th>
            </tr>
          </thead>
          <tbody>
            ${this.suppliers.map((s) => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:0.75rem 1rem;font-weight:600;">${s.businessName}</td>
                <td style="padding:0.75rem 1rem;color:#64748b;">${s.cuit || '-'}</td>
                <td style="padding:0.75rem 1rem;">${s.mobilePhone}</td>
                <td style="padding:0.75rem 1rem;font-family:monospace;color:#0369a1;">${s.cbuCvuOrAlias || '-'}</td>
                <td style="padding:0.75rem 1rem;">
                  <span style="background:#f1f5f9;color:#475569;padding:0.25rem 0.5rem;border-radius:0.25rem;font-size:0.75rem;">
                    ${s.categoryName || 'General'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderWhatsAppTab(): string {
    return `
      <div style="max-width:36rem;margin:0 auto;background:white;padding:2rem;border-radius:0.5rem;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <h2 style="font-size:1.25rem;font-weight:700;margin-top:0;">Vincular cuenta móvil con WhatsApp</h2>
        <p style="color:#64748b;font-size:0.875rem;line-height:1.5;">
          Permite capturar fotos de facturas y tickets directamente enviándolos al contacto de WhatsApp oficial (+54 9 264 627-6709) y recibir avisos de vencimientos.
        </p>
        <div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:0.5rem;padding:2rem;text-align:center;margin:1.5rem 0;">
          <div style="font-size:3rem;margin-bottom:0.5rem;">📱</div>
          <p style="font-weight:600;margin:0;">Escanea el código QR o haz clic en el enlace móvil</p>
          <p style="font-size:0.75rem;color:#94a3b8;margin:0.25rem 0 1.5rem 0;">Desafío de uso único válido por 10 minutos</p>
          <a href="https://wa.me/5492646276709?text=VINCULAR%20${this.tenantContext?.tenantId}" target="_blank" style="background:#22c55e;color:white;padding:0.625rem 1.25rem;border-radius:0.375rem;text-decoration:none;font-weight:600;display:inline-block;">
            Abrir WhatsApp Web / App
          </a>
        </div>
        <p style="font-size:0.75rem;color:#64748b;margin-bottom:0;">
          <strong>Nota de seguridad:</strong> El enlace asocia tu remitente verificado al usuario autenticado. La plataforma nunca te solicitará códigos de verificación de WhatsApp.
        </p>
      </div>
    `;
  }

  private bindEvents(): void {
    // Navigation
    this.container.querySelector('#tab-grid')?.addEventListener('click', () => {
      this.activeTab = 'grid';
      this.render();
    });
    this.container.querySelector('#tab-suppliers')?.addEventListener('click', () => {
      this.activeTab = 'suppliers';
      this.render();
    });
    this.container.querySelector('#tab-whatsapp')?.addEventListener('click', () => {
      this.activeTab = 'whatsapp';
      this.render();
    });

    // Checkboxes
    this.container.querySelectorAll('.invoice-checkbox').forEach((el) => {
      el.addEventListener('change', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        if (!id) return;
        if ((e.target as HTMLInputElement).checked) {
          this.selectedInvoiceIds.add(id);
        } else {
          this.selectedInvoiceIds.delete(id);
        }
        this.render();
      });
    });

    const selectAll = this.container.querySelector('#select-all') as HTMLInputElement | null;
    selectAll?.addEventListener('change', () => {
      const pending = this.invoices.filter((i) => i.status === 'IN_GRID');
      if (selectAll.checked) {
        pending.forEach((i) => this.selectedInvoiceIds.add(i.id));
      } else {
        this.selectedInvoiceIds.clear();
      }
      this.render();
    });

    // Pay Batch
    this.container.querySelector('#btn-pay-batch')?.addEventListener('click', async () => {
      if (this.selectedInvoiceIds.size === 0) return;
      const confirmMsg = `¿Confirma el pago de ${this.selectedInvoiceIds.size} factura(s)?`;
      if (!window.confirm(confirmMsg)) return;

      try {
        await this.client.createPaymentBatch(Array.from(this.selectedInvoiceIds));
        await this.refreshData();
        this.render();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Error al registrar el lote de pago');
      }
    });

    // Modals / Prompts para altas rápidas
    this.container.querySelector('#btn-new-supplier')?.addEventListener('click', async () => {
      const name = window.prompt('Razón Social del Proveedor:');
      if (!name) return;
      const phone = window.prompt('Teléfono Móvil (ej: +5491140001122):', '+549');
      if (!phone) return;
      const alias = window.prompt('CBU / CVU o Alias:') || undefined;

      await this.client.createSupplier({ businessName: name, mobilePhone: phone, cbuCvuOrAlias: alias });
      await this.refreshData();
      this.render();
    });

    this.container.querySelector('#btn-new-invoice')?.addEventListener('click', async () => {
      if (this.suppliers.length === 0) {
        alert('Debe crear al menos un proveedor antes de cargar facturas.');
        return;
      }
      const supplierName = this.suppliers[0]?.businessName || 'Proveedor';
      const desc = window.prompt(`Descripción del gasto (para ${supplierName}):`, 'Gasto general');
      if (!desc) return;
      const amountStr = window.prompt('Importe total en pesos (ej: 15000.50):', '10000');
      if (!amountStr) return;
      const amountInCents = BigInt(Math.round(parseFloat(amountStr) * 100));

      await this.client.createInvoice({
        supplierId: this.suppliers[0]!.id,
        invoiceType: 'INFORMAL',
        description: desc,
        amountInCents,
        dueDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10)
      });
      await this.refreshData();
      this.render();
    });
  }
}
