import type { MembershipRole, PlanCode } from '../../domain/src/model.js';
import type { ApiClient } from './api-client.js';
import type {
  AiChatMessage,
  InvoiceItem,
  PaymentBatchSummary,
  PaymentGridConfig,
  SupplierSummary,
  TeamMemberItem,
  TenantContext,
} from './types.js';
import { INITIAL_CATEGORIES } from './types.js';
import { formatCurrency, formatDate } from './utils.js';

type ActiveTab = 'grid' | 'suppliers' | 'alerts' | 'team' | 'whatsapp' | 'ai';

export class AppView {
  private container: HTMLElement;
  private client: ApiClient;
  private tenantContext: TenantContext | null = null;
  private suppliers: SupplierSummary[] = [];
  private invoices: InvoiceItem[] = [];
  private batches: PaymentBatchSummary[] = [];
  private gridConfig: PaymentGridConfig | null = null;
  private teamMembers: TeamMemberItem[] = [];
  private aiMessages: AiChatMessage[] = [];
  private selectedInvoiceIds = new Set<string>();
  private statusFilter: 'ALL' | 'IN_GRID' | 'PENDING_REVIEW' | 'PAYMENT_PROPOSED' | 'PAID' | 'CANCELLED' = 'ALL';
  private activeTab: ActiveTab = 'grid';
  private showSupplierForm = false;
  private showInvoiceForm = false;
  private feedbackBanner: { type: 'success' | 'error'; text: string } | null = null;

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
    const [suppliers, invoices, gridConfig, batches, team, aiHistory] = await Promise.all([
      this.client.listSuppliers(),
      this.client.listPaymentGrid(),
      this.client.getGridConfig(),
      this.client.listPaymentBatches ? this.client.listPaymentBatches() : Promise.resolve([]),
      this.client.listTeamMembers ? this.client.listTeamMembers() : Promise.resolve([]),
      this.client.listAiHistory ? this.client.listAiHistory() : Promise.resolve([]),
    ]);
    this.suppliers = suppliers;
    this.invoices = invoices;
    this.gridConfig = gridConfig;
    this.batches = batches;
    this.teamMembers = team;
    this.aiMessages = aiHistory;
    this.selectedInvoiceIds.clear();
  }

  private showBanner(type: 'success' | 'error', text: string): void {
    this.feedbackBanner = { type, text };
    this.render();
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
    const isUltra = this.tenantContext.planCode === 'ULTRA';

    this.container.innerHTML = `
      <div style="min-height:100vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#0f172a;">
        <!-- Header -->
        <header style="background:#ffffff;border-bottom:1px solid #e2e8f0;padding:0.875rem 2rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
          <div style="display:flex;align-items:center;gap:0.875rem;">
            <div style="width:2.25rem;height:2.25rem;background:#0284c7;color:white;border-radius:0.375rem;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:1.125rem;">$</div>
            <div>
              <h1 style="font-size:1.125rem;font-weight:700;margin:0;">Cuentas a Pagar Serverless</h1>
              <p style="font-size:0.8125rem;color:#64748b;margin:0;">${this.tenantContext.businessName} &bull; Tenant ID: <code>${this.tenantContext.tenantId}</code></p>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
            <label style="font-size:0.75rem;color:#475569;font-weight:600;">Simulador Plan / Rol:</label>
            <select id="demo-plan-select" style="padding:0.35rem 0.5rem;border:1px solid #cbd5e1;border-radius:0.375rem;font-size:0.75rem;font-weight:600;">
              <option value="PROFESSIONAL" ${this.tenantContext.planCode === 'PROFESSIONAL' ? 'selected' : ''}>Plan PROFESSIONAL ($82.000/mes)</option>
              <option value="ULTRA" ${this.tenantContext.planCode === 'ULTRA' ? 'selected' : ''}>Plan ULTRA ($144.000/mes)</option>
            </select>
            <select id="demo-role-select" style="padding:0.35rem 0.5rem;border:1px solid #cbd5e1;border-radius:0.375rem;font-size:0.75rem;font-weight:600;">
              <option value="ADMIN" ${this.tenantContext.userRole === 'ADMIN' ? 'selected' : ''}>Rol: ADMIN</option>
              <option value="OPERATOR_UPLOAD" ${this.tenantContext.userRole === 'OPERATOR_UPLOAD' ? 'selected' : ''}>Rol: OPERATOR_UPLOAD (Carga)</option>
              <option value="OPERATOR_PAYMENTS" ${this.tenantContext.userRole === 'OPERATOR_PAYMENTS' ? 'selected' : ''}>Rol: OPERATOR_PAYMENTS (Pagos)</option>
            </select>
          </div>
        </header>

        <!-- Navigation Tabs -->
        <nav style="background:#ffffff;border-bottom:1px solid #e2e8f0;padding:0 2rem;display:flex;gap:1.5rem;overflow-x:auto;">
          ${this.renderTabButton('grid', `Grilla y Pagos (${this.invoices.length})`)}
          ${this.renderTabButton('suppliers', `Proveedores (${this.suppliers.length})`)}
          ${this.renderTabButton('alerts', 'Alertas WhatsApp')}
          ${this.renderTabButton('team', 'Usuarios y Suscripción')}
          ${this.renderTabButton('whatsapp', 'Vincular Móvil QR')}
          ${isUltra ? this.renderTabButton('ai', '✨ Asistente IA (Ultra)') : ''}
        </nav>

        <!-- Main Content -->
        <main style="flex:1;padding:1.75rem 2rem;max-width:1240px;margin:0 auto;width:100%;box-sizing:border-box;">
          ${this.feedbackBanner ? `
            <div style="margin-bottom:1.25rem;padding:0.75rem 1rem;border-radius:0.375rem;display:flex;justify-content:space-between;align-items:center;font-size:0.875rem;${
              this.feedbackBanner.type === 'success'
                ? 'background:#dcfce7;color:#166534;border:1px solid #86efac;'
                : 'background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;'
            }">
              <span>${this.feedbackBanner.text}</span>
              <button id="close-banner" style="background:none;border:none;cursor:pointer;font-weight:bold;color:inherit;">✕</button>
            </div>
          ` : ''}
          ${this.renderActiveTab()}
        </main>
      </div>
    `;

    this.bindEvents();
  }

  private renderTabButton(tab: ActiveTab, label: string): string {
    const active = this.activeTab === tab;
    return `
      <button data-tab="${tab}" class="nav-tab-btn" style="padding:0.875rem 0.25rem;background:none;border:none;border-bottom:2px solid ${
        active ? '#0284c7' : 'transparent'
      };color:${active ? '#0284c7' : '#64748b'};font-weight:600;cursor:pointer;white-space:nowrap;font-size:0.875rem;">
        ${label}
      </button>
    `;
  }

  private renderActiveTab(): string {
    switch (this.activeTab) {
      case 'grid':
        return this.renderGridTab();
      case 'suppliers':
        return this.renderSuppliersTab();
      case 'alerts':
        return this.renderAlertsTab();
      case 'team':
        return this.renderTeamTab();
      case 'whatsapp':
        return this.renderWhatsAppTab();
      case 'ai':
        return this.renderAiTab();
    }
  }

  private renderKpiCards(): string {
    const inGrid = this.invoices.filter((i) => i.status === 'IN_GRID');
    const review = this.invoices.filter((i) => i.status === 'PENDING_REVIEW');
    const proposed = this.invoices.filter((i) => i.status === 'PAYMENT_PROPOSED');
    const paid = this.invoices.filter((i) => i.status === 'PAID');

    const sum = (items: InvoiceItem[]) => items.reduce((a, b) => a + BigInt(b.amountInCents), 0n);

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1rem;margin-bottom:1.5rem;">
        <div style="background:white;padding:1rem 1.25rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
          <div style="font-size:0.75rem;color:#64748b;font-weight:600;text-transform:uppercase;">En Grilla (Para Pagar)</div>
          <div style="font-size:1.375rem;font-weight:700;color:#0f172a;margin-top:0.25rem;">${formatCurrency(sum(inGrid))}</div>
          <div style="font-size:0.75rem;color:#64748b;">${inGrid.length} comprobante(s)</div>
        </div>
        <div style="background:white;padding:1rem 1.25rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
          <div style="font-size:0.75rem;color:#854d0e;font-weight:600;text-transform:uppercase;">Borradores / Revisión OCR</div>
          <div style="font-size:1.375rem;font-weight:700;color:#854d0e;margin-top:0.25rem;">${formatCurrency(sum(review))}</div>
          <div style="font-size:0.75rem;color:#64748b;">${review.length} pendiente(s) de confirmar</div>
        </div>
        <div style="background:white;padding:1rem 1.25rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
          <div style="font-size:0.75rem;color:#1d4ed8;font-weight:600;text-transform:uppercase;">Propuestas de Pago</div>
          <div style="font-size:1.375rem;font-weight:700;color:#1d4ed8;margin-top:0.25rem;">${formatCurrency(sum(proposed))}</div>
          <div style="font-size:0.75rem;color:#64748b;">${proposed.length} esperando firma ADMIN</div>
        </div>
        <div style="background:white;padding:1rem 1.25rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
          <div style="font-size:0.75rem;color:#166534;font-weight:600;text-transform:uppercase;">Pagos Registrados</div>
          <div style="font-size:1.375rem;font-weight:700;color:#166534;margin-top:0.25rem;">${formatCurrency(sum(paid))}</div>
          <div style="font-size:0.75rem;color:#64748b;">${paid.length} pagada(s)</div>
        </div>
      </div>
    `;
  }

  private renderGridTab(): string {
    const filtered = this.invoices.filter((i) => this.statusFilter === 'ALL' || i.status === this.statusFilter);
    const selectableInvoices = filtered.filter((i) => i.status === 'IN_GRID');
    const totalSelected = Array.from(this.selectedInvoiceIds).reduce((acc, id) => {
      const inv = this.invoices.find((i) => i.id === id);
      return acc + (inv ? BigInt(inv.amountInCents) : 0n);
    }, 0n);

    const canCreateInvoice = this.tenantContext?.userRole === 'ADMIN' || this.tenantContext?.userRole === 'OPERATOR_UPLOAD';
    const canOperatePayments = this.tenantContext?.userRole === 'ADMIN' || this.tenantContext?.userRole === 'OPERATOR_PAYMENTS';

    return `
      ${this.renderKpiCards()}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.75rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <span style="font-size:0.8125rem;font-weight:600;color:#475569;">Estado:</span>
          ${(['ALL', 'IN_GRID', 'PENDING_REVIEW', 'PAYMENT_PROPOSED', 'PAID', 'CANCELLED'] as const)
            .map(
              (st) => `
            <button class="filter-status-btn" data-status="${st}" style="padding:0.3rem 0.65rem;border-radius:9999px;font-size:0.75rem;font-weight:600;cursor:pointer;border:1px solid ${
              this.statusFilter === st ? '#0284c7' : '#cbd5e1'
            };background:${this.statusFilter === st ? '#e0f2fe' : 'white'};color:${
                this.statusFilter === st ? '#0369a1' : '#475569'
              };">
              ${this.statusLabel(st)}
            </button>
          `,
            )
            .join('')}
        </div>
        ${
          canCreateInvoice
            ? `
          <button id="btn-toggle-invoice-form" style="background:#0284c7;color:white;padding:0.5rem 1rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;font-size:0.875rem;">
            ${this.showInvoiceForm ? 'Cerrar Formulario' : '+ Cargar Factura / Comprobante'}
          </button>
        `
            : ''
        }
      </div>

      ${this.showInvoiceForm ? this.renderInvoiceFormModal() : ''}

      <!-- Action bar for selected payments -->
      ${
        this.selectedInvoiceIds.size > 0 && canOperatePayments
          ? `
        <div style="background:#0284c7;color:white;padding:0.875rem 1.5rem;border-radius:0.5rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <div>
            <strong>${this.selectedInvoiceIds.size}</strong> comprobante(s) seleccionado(s) &bull; Total Lote: <strong>${formatCurrency(totalSelected)}</strong>
          </div>
          <button id="btn-pay-batch" style="background:white;color:#0284c7;padding:0.5rem 1.25rem;border:none;border-radius:0.25rem;font-weight:700;cursor:pointer;">
            ${this.tenantContext?.userRole === 'ADMIN' ? 'Confirmar y Registrar Pago Total' : 'Crear Propuesta de Pago (Requiere Aprobación)'}
          </button>
        </div>
      `
          : ''
      }

      <!-- Grid Table -->
      <div style="background:white;border-radius:0.5rem;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:2rem;">
        <table style="width:100%;border-collapse:collapse;text-align:left;font-size:0.875rem;">
          <thead style="background:#f1f5f9;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">
            <tr>
              <th style="padding:0.75rem 1rem;width:2.5rem;">
                ${
                  canOperatePayments
                    ? `<input type="checkbox" id="select-all" ${
                        selectableInvoices.length > 0 && this.selectedInvoiceIds.size === selectableInvoices.length ? 'checked' : ''
                      }/>`
                    : ''
                }
              </th>
              <th style="padding:0.75rem 1rem;">Vencimiento</th>
              <th style="padding:0.75rem 1rem;">Proveedor</th>
              <th style="padding:0.75rem 1rem;">Comprobante</th>
              <th style="padding:0.75rem 1rem;">Detalle</th>
              <th style="padding:0.75rem 1rem;text-align:right;">Importe Total</th>
              <th style="padding:0.75rem 1rem;text-align:center;">Estado</th>
              <th style="padding:0.75rem 1rem;text-align:right;">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length === 0
                ? `<tr><td colspan="8" style="padding:2rem;text-align:center;color:#94a3b8;">No hay comprobantes para el filtro seleccionado.</td></tr>`
                : filtered
                    .map(
                      (inv) => `
              <tr style="border-bottom:1px solid #f1f5f9;background:${this.selectedInvoiceIds.has(inv.id) ? '#f0f9ff' : 'transparent'};">
                <td style="padding:0.75rem 1rem;">
                  ${
                    inv.status === 'IN_GRID' && canOperatePayments
                      ? `<input type="checkbox" class="invoice-checkbox" data-id="${inv.id}" ${
                          this.selectedInvoiceIds.has(inv.id) ? 'checked' : ''
                        }/>`
                      : ''
                  }
                </td>
                <td style="padding:0.75rem 1rem;font-weight:600;">${formatDate(inv.dueDate)}</td>
                <td style="padding:0.75rem 1rem;">${inv.supplierName}</td>
                <td style="padding:0.75rem 1rem;">
                  <span style="font-family:monospace;background:#f1f5f9;padding:0.125rem 0.375rem;border-radius:0.25rem;">
                    ${inv.invoiceType} ${inv.invoiceNumber || '(Informal)'}
                  </span>
                </td>
                <td style="padding:0.75rem 1rem;color:#64748b;">${inv.description || '-'}</td>
                <td style="padding:0.75rem 1rem;text-align:right;font-weight:700;">${formatCurrency(inv.amountInCents)}</td>
                <td style="padding:0.75rem 1rem;text-align:center;">${this.renderInvoiceStatusBadge(inv.status)}</td>
                <td style="padding:0.75rem 1rem;text-align:right;">
                  ${
                    inv.status === 'PENDING_REVIEW' && this.tenantContext?.userRole === 'ADMIN'
                      ? `<button class="btn-confirm-draft" data-id="${inv.id}" style="background:#16a34a;color:white;border:none;padding:0.25rem 0.6rem;border-radius:0.25rem;font-size:0.75rem;font-weight:600;cursor:pointer;margin-right:0.25rem;">Confirmar a Grilla</button>`
                      : ''
                  }
                  ${
                    inv.status !== 'PAID' && inv.status !== 'CANCELLED' && this.tenantContext?.userRole === 'ADMIN'
                      ? `<button class="btn-cancel-invoice" data-id="${inv.id}" style="background:#fee2e2;color:#991b1b;border:none;padding:0.25rem 0.5rem;border-radius:0.25rem;font-size:0.75rem;cursor:pointer;">Anular</button>`
                      : ''
                  }
                </td>
              </tr>
            `,
                    )
                    .join('')
            }
          </tbody>
        </table>
      </div>

      ${this.renderBatchesSection()}
    `;
  }

  private renderInvoiceFormModal(): string {
    return `
      <form id="form-new-invoice" style="background:white;padding:1.25rem;border-radius:0.5rem;border:1px solid #bae6fd;margin-bottom:1.25rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;align-items:end;">
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Proveedor *</label>
          <select name="supplierId" required style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;">
            ${this.suppliers.map((s) => `<option value="${s.id}">${s.businessName} (${s.categoryName || 'Sin Clasificar'})</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Tipo Comprobante *</label>
          <select name="invoiceType" id="invoice-type-select" required style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;">
            <option value="A">Factura A</option>
            <option value="C">Factura C</option>
            <option value="INFORMAL">Comprobante Informal / Ticket</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Número (Obligatorio en A/C)</label>
          <input name="invoiceNumber" placeholder="0001-00012345" style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Descripción / Concepto</label>
          <input name="description" placeholder="Detalle del servicio o entrega" style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Importe en ARS *</label>
          <input name="amountPesos" type="number" step="0.01" min="1" required placeholder="25000.00" style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
        </div>
        <div>
          <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Fecha Vencimiento *</label>
          <input name="dueDate" type="date" required value="${new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10)}" style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
        </div>
        <div>
          <button type="submit" style="width:100%;background:#0284c7;color:white;padding:0.5rem 1rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">
            Guardar Comprobante
          </button>
        </div>
      </form>
    `;
  }

  private renderBatchesSection(): string {
    if (this.batches.length === 0) return '';
    return `
      <div style="background:white;border-radius:0.5rem;border:1px solid #e2e8f0;padding:1.25rem;">
        <h3 style="margin:0 0 0.75rem 0;font-size:1rem;">Historial de Operaciones y Propuestas de Pago (Auditoría)</h3>
        <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;text-align:left;">
          <thead style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
            <tr>
              <th style="padding:0.5rem;">Lote ID</th>
              <th style="padding:0.5rem;">Fecha</th>
              <th style="padding:0.5rem;">Originado por</th>
              <th style="padding:0.5rem;">Facturas</th>
              <th style="padding:0.5rem;text-align:right;">Total</th>
              <th style="padding:0.5rem;text-align:center;">Estado</th>
              <th style="padding:0.5rem;text-align:right;">Acción ADMIN</th>
            </tr>
          </thead>
          <tbody>
            ${this.batches
              .map(
                (b) => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:0.5rem;font-family:monospace;">${b.batchId}</td>
                <td style="padding:0.5rem;">${b.proposedAt}</td>
                <td style="padding:0.5rem;">${b.proposedByRole}</td>
                <td style="padding:0.5rem;">${b.invoiceIds.length} ítem(s)</td>
                <td style="padding:0.5rem;text-align:right;font-weight:700;">${formatCurrency(b.totalInCents)}</td>
                <td style="padding:0.5rem;text-align:center;">
                  <span style="padding:0.2rem 0.5rem;border-radius:9999px;font-weight:600;font-size:0.7rem;${
                    b.status === 'RECORDED'
                      ? 'background:#dcfce7;color:#166534;'
                      : b.status === 'PENDING_APPROVAL'
                      ? 'background:#dbeafe;color:#1e40af;'
                      : 'background:#fee2e2;color:#991b1b;'
                  }">
                    ${b.status}${b.reversalReason ? ` (${b.reversalReason})` : ''}
                  </span>
                </td>
                <td style="padding:0.5rem;text-align:right;">
                  ${
                    b.status === 'PENDING_APPROVAL' && this.tenantContext?.userRole === 'ADMIN'
                      ? `<button class="btn-approve-batch" data-batch="${b.batchId}" style="background:#16a34a;color:white;border:none;padding:0.25rem 0.6rem;border-radius:0.25rem;cursor:pointer;font-size:0.75rem;margin-right:0.25rem;">Aprobar Pago</button>`
                      : ''
                  }
                  ${
                    (b.status === 'RECORDED' || b.status === 'PENDING_APPROVAL') && this.tenantContext?.userRole === 'ADMIN'
                      ? `<button class="btn-reverse-batch" data-batch="${b.batchId}" style="background:#f1f5f9;color:#991b1b;border:1px solid #fca5a5;padding:0.25rem 0.6rem;border-radius:0.25rem;cursor:pointer;font-size:0.75rem;">Revertir</button>`
                      : ''
                  }
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderSuppliersTab(): string {
    const canCreate = this.tenantContext?.userRole === 'ADMIN' || this.tenantContext?.userRole === 'OPERATOR_UPLOAD';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
        <div>
          <h2 style="font-size:1.35rem;font-weight:700;margin:0;">Padrón de Proveedores</h2>
          <p style="color:#64748b;margin:0.25rem 0 0 0;font-size:0.875rem;">Datos fiscales, celular WhatsApp obligatorio y categoría primaria</p>
        </div>
        ${
          canCreate
            ? `
          <button id="btn-toggle-supplier-form" style="background:#0284c7;color:white;padding:0.5rem 1rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">
            ${this.showSupplierForm ? 'Cerrar Formulario' : '+ Nuevo Proveedor'}
          </button>
        `
            : ''
        }
      </div>

      ${
        this.showSupplierForm
          ? `
        <form id="form-new-supplier" style="background:white;padding:1.25rem;border-radius:0.5rem;border:1px solid #bae6fd;margin-bottom:1.25rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;align-items:end;">
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Razón Social *</label>
            <input name="businessName" required placeholder="Ej. Insumos Cuyo S.A." style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Celular WhatsApp *</label>
            <input name="mobilePhone" required value="+549" placeholder="+549264..." style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">CUIT (Opcional)</label>
            <input name="cuit" placeholder="30-12345678-9" style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">CBU / CVU o Alias</label>
            <input name="cbuCvuOrAlias" placeholder="MI.ALIAS.MP" style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;color:#475569;margin-bottom:0.25rem;">Categoría Primaria *</label>
            <select name="categoryCode" style="width:100%;padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;">
              ${INITIAL_CATEGORIES.map((c) => `<option value="${c.code}">${c.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <button type="submit" style="width:100%;background:#0284c7;color:white;padding:0.5rem 1rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">
              Registrar Proveedor
            </button>
          </div>
        </form>
      `
          : ''
      }

      <div style="background:white;border-radius:0.5rem;border:1px solid #e2e8f0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;text-align:left;font-size:0.875rem;">
          <thead style="background:#f1f5f9;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">
            <tr>
              <th style="padding:0.75rem 1rem;">Razón Social</th>
              <th style="padding:0.75rem 1rem;">CUIT</th>
              <th style="padding:0.75rem 1rem;">WhatsApp</th>
              <th style="padding:0.75rem 1rem;">CBU / Alias (Informativo)</th>
              <th style="padding:0.75rem 1rem;">Categoría</th>
            </tr>
          </thead>
          <tbody>
            ${this.suppliers
              .map(
                (s) => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:0.75rem 1rem;font-weight:600;">${s.businessName}</td>
                <td style="padding:0.75rem 1rem;color:#64748b;">${s.cuit || '-'}</td>
                <td style="padding:0.75rem 1rem;">${s.mobilePhone}</td>
                <td style="padding:0.75rem 1rem;font-family:monospace;color:#0369a1;">${s.cbuCvuOrAlias || '-'}</td>
                <td style="padding:0.75rem 1rem;">
                  <span style="background:${
                    s.categoryCode === 'SIN_CLASIFICAR' ? '#fef9c3;color:#854d0e;' : '#f1f5f9;color:#475569;'
                  };padding:0.25rem 0.5rem;border-radius:0.25rem;font-size:0.75rem;font-weight:600;">
                    ${s.categoryName || 'General'}
                  </span>
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderAlertsTab(): string {
    const cfg = this.gridConfig ?? {
      timezone: 'America/Argentina/Buenos_Aires',
      notificationTime: '09:00',
      lookAheadHours: 24,
      enabled: true,
      recipientMembershipIds: ['mem-1'],
    };
    const isAdmin = this.tenantContext?.userRole === 'ADMIN';

    return `
      <div style="max-width:40rem;margin:0 auto;background:white;padding:1.75rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
        <h2 style="margin-top:0;font-size:1.25rem;">Configuración de Alertas de Próximos Pagos</h2>
        <p style="color:#64748b;font-size:0.875rem;">
          Configura el recordatorio proactivo por WhatsApp mediante EventBridge Scheduler (sin necesidad de redeploy).
        </p>
        <form id="form-grid-config" style="display:grid;gap:1rem;margin-top:1.25rem;">
          <div>
            <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.25rem;">Zona Horaria IANA</label>
            <input name="timezone" value="${cfg.timezone}" ${!isAdmin ? 'disabled' : ''} style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
            <div>
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.25rem;">Hora de Envío (HH:mm)</label>
              <input name="notificationTime" value="${cfg.notificationTime}" ${!isAdmin ? 'disabled' : ''} placeholder="09:00" style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
            </div>
            <div>
              <label style="display:block;font-size:0.8125rem;font-weight:600;margin-bottom:0.25rem;">Anticipación (1 a 168 horas)</label>
              <input name="lookAheadHours" type="number" min="1" max="168" value="${cfg.lookAheadHours}" ${!isAdmin ? 'disabled' : ''} style="width:100%;padding:0.5rem;border:1px solid #cbd5e1;border-radius:0.375rem;box-sizing:border-box;" />
            </div>
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;font-weight:600;">
              <input type="checkbox" name="enabled" ${cfg.enabled ? 'checked' : ''} ${!isAdmin ? 'disabled' : ''} />
              Alertas proactivas activadas para este tenant
            </label>
          </div>
          ${
            isAdmin
              ? `<button type="submit" style="background:#0284c7;color:white;padding:0.6rem 1.2rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">Guardar Configuración (Idempotente)</button>`
              : `<p style="color:#991b1b;font-size:0.8125rem;">Sólo el rol ADMIN puede editar la configuración de alertas.</p>`
          }
        </form>
      </div>
    `;
  }

  private renderTeamTab(): string {
    const isAdmin = this.tenantContext?.userRole === 'ADMIN';
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1.5rem;">
        <!-- Suscripción Mercado Pago -->
        <div style="background:white;padding:1.5rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
          <h3 style="margin-top:0;">Suscripción SaaS &bull; Mercado Pago Checkout Pro</h3>
          <p style="font-size:0.875rem;color:#64748b;">
            Plan activo: <strong>${this.tenantContext?.planCode}</strong> (${
      this.tenantContext?.planCode === 'ULTRA' ? '$ 144.000,00 / mes' : '$ 82.000,00 / mes'
    }).<br/>
            Los precios se calculan en servidor y el plan se habilita únicamente tras webhook HMAC verificado.
          </p>
          <div style="background:#f8fafc;padding:1rem;border-radius:0.375rem;border:1px solid #e2e8f0;font-size:0.8125rem;margin-bottom:1rem;">
            <div>&bull; Emisor oficial WhatsApp: <code>+5492646276709</code></div>
            <div>&bull; Plantillas activas (es_AR): <code>subscription_renewal_reminder</code>, <code>subscription_payment_link_v2</code>, <code>subscription_payment_confirmed</code></div>
          </div>
          ${
            isAdmin
              ? `<button id="btn-simulate-checkout" style="background:#009ee3;color:white;padding:0.6rem 1.2rem;border:none;border-radius:0.375rem;font-weight:700;cursor:pointer;">Generar Orden de Renovación (Checkout Pro)</button>`
              : `<p style="font-size:0.75rem;color:#64748b;">Sólo el administrador puede gestionar la suscripción.</p>`
          }
        </div>

        <!-- Usuarios y Roles -->
        <div style="background:white;padding:1.5rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
          <h3 style="margin-top:0;">Usuarios y Membresías del Tenant</h3>
          <ul style="list-style:none;padding:0;margin:0 0 1rem 0;">
            ${this.teamMembers
              .map(
                (m) => `
              <li style="padding:0.6rem 0;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;font-size:0.875rem;">
                <div>
                  <div style="font-weight:600;">${m.fullName}</div>
                  <div style="font-size:0.75rem;color:#64748b;">${m.email}</div>
                </div>
                <span style="background:#f1f5f9;padding:0.2rem 0.5rem;border-radius:0.25rem;font-size:0.75rem;font-weight:600;">${m.role}</span>
              </li>
            `,
              )
              .join('')}
          </ul>
          ${
            isAdmin
              ? `
            <form id="form-invite-member" style="display:grid;gap:0.6rem;border-top:1px solid #e2e8f0;padding-top:1rem;">
              <div style="font-size:0.8125rem;font-weight:600;">Agregar Operador</div>
              <input name="fullName" required placeholder="Nombre y Apellido" style="padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;" />
              <input name="email" type="email" required placeholder="operador@empresa.com" style="padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;" />
              <select name="role" style="padding:0.45rem;border:1px solid #cbd5e1;border-radius:0.375rem;">
                <option value="OPERATOR_UPLOAD">OPERATOR_UPLOAD (Carga comprobantes)</option>
                <option value="OPERATOR_PAYMENTS">OPERATOR_PAYMENTS (Propone pagos)</option>
              </select>
              <button type="submit" style="background:#0284c7;color:white;padding:0.5rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">Invitar Usuario</button>
            </form>
          `
              : ''
          }
        </div>
      </div>
    `;
  }

  private renderWhatsAppTab(): string {
    return `
      <div style="max-width:36rem;margin:0 auto;background:white;padding:2rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
        <h2 style="font-size:1.25rem;font-weight:700;margin-top:0;">Vincular cuenta móvil con WhatsApp</h2>
        <p style="color:#64748b;font-size:0.875rem;line-height:1.5;">
          Permite capturar fotos/PDF de facturas enviándolos al contacto oficial (<strong>+54 9 264 627-6709</strong>) y recibir avisos de vencimientos.
        </p>
        <div style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:0.5rem;padding:2rem;text-align:center;margin:1.5rem 0;">
          <div style="font-size:3rem;margin-bottom:0.5rem;">📱</div>
          <p style="font-weight:600;margin:0;">Desafío de vinculación para usuario autenticado</p>
          <p style="font-size:0.75rem;color:#94a3b8;margin:0.25rem 0 1.5rem 0;">Válido por 10 minutos &bull; Almacena teléfono y BSUID de YCloud</p>
          <a href="https://wa.me/5492646276709?text=VINCULAR%20${this.tenantContext?.tenantId}" target="_blank" style="background:#22c55e;color:white;padding:0.625rem 1.25rem;border-radius:0.375rem;text-decoration:none;font-weight:600;display:inline-block;">
            Abrir WhatsApp Oficial
          </a>
        </div>
      </div>
    `;
  }

  private renderAiTab(): string {
    return `
      <div style="max-width:48rem;margin:0 auto;background:white;padding:1.75rem;border-radius:0.5rem;border:1px solid #e2e8f0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <div>
            <h2 style="margin:0;font-size:1.25rem;">✨ Chat IA de Análisis Financiero (Exclusivo Plan Ultra)</h2>
            <p style="margin:0.25rem 0 0 0;font-size:0.8125rem;color:#64748b;">
              Asistente tenant-aware de <strong>sólo lectura</strong>. No tiene acceso directo a SQL ni puede ejecutar escrituras, pagos o bajas.
            </p>
          </div>
          <span style="background:#f3e8ff;color:#6b21a8;padding:0.25rem 0.6rem;border-radius:9999px;font-size:0.75rem;font-weight:600;">Guardrails Activos</span>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.5rem;padding:1rem;max-height:320px;overflow-y:auto;margin-bottom:1rem;display:grid;gap:0.75rem;">
          ${this.aiMessages
            .map(
              (m) => `
            <div style="background:white;padding:0.75rem 1rem;border-radius:0.375rem;border:1px solid #e2e8f0;">
              <div style="font-size:0.75rem;font-weight:700;color:#0284c7;margin-bottom:0.25rem;">Consulta (${m.timestamp}): ${m.question}</div>
              <div style="font-size:0.875rem;color:#1e293b;">${m.answer}</div>
            </div>
          `,
            )
            .join('')}
        </div>

        <form id="form-ai-chat" style="display:flex;gap:0.75rem;">
          <input name="question" required placeholder="Ej: ¿Cuánto tenemos pendiente de pagar esta semana? (Probá pedir 'pagar facturas' para ver el guardrail)" style="flex:1;padding:0.6rem 0.75rem;border:1px solid #cbd5e1;border-radius:0.375rem;font-size:0.875rem;" />
          <button type="submit" style="background:#7c3aed;color:white;padding:0.6rem 1.25rem;border:none;border-radius:0.375rem;font-weight:600;cursor:pointer;">Consultar IA</button>
        </form>
      </div>
    `;
  }

  private statusLabel(st: string): string {
    const labels: Record<string, string> = {
      ALL: 'Todas',
      IN_GRID: 'En Grilla',
      PENDING_REVIEW: 'En Revisión (Borrador)',
      PAYMENT_PROPOSED: 'Propuesta Pago',
      PAID: 'Pagadas',
      CANCELLED: 'Anuladas',
    };
    return labels[st] ?? st;
  }

  private renderInvoiceStatusBadge(status: InvoiceItem['status']): string {
    const styles: Record<InvoiceItem['status'], string> = {
      IN_GRID: 'background:#fef9c3;color:#854d0e;',
      PENDING_REVIEW: 'background:#ffedd5;color:#9a3412;',
      PAYMENT_PROPOSED: 'background:#dbeafe;color:#1e40af;',
      PAID: 'background:#dcfce7;color:#166534;',
      CANCELLED: 'background:#f1f5f9;color:#64748b;text-decoration:line-through;',
    };
    return `<span style="padding:0.25rem 0.55rem;border-radius:9999px;font-size:0.72rem;font-weight:600;${styles[status]}">${this.statusLabel(
      status,
    )}</span>`;
  }

  private bindEvents(): void {
    this.container.querySelector('#close-banner')?.addEventListener('click', () => {
      this.feedbackBanner = null;
      this.render();
    });

    // Simulator selectors
    const planSelect = this.container.querySelector('#demo-plan-select') as HTMLSelectElement | null;
    const roleSelect = this.container.querySelector('#demo-role-select') as HTMLSelectElement | null;
    const updateSim = async () => {
      if (!planSelect || !roleSelect || !this.client.setDemoPlanAndRole) return;
      const plan = planSelect.value as Exclude<PlanCode, 'BASIC'>;
      const role = roleSelect.value as MembershipRole;
      this.tenantContext = await this.client.setDemoPlanAndRole(plan, role);
      if (plan !== 'ULTRA' && this.activeTab === 'ai') this.activeTab = 'grid';
      this.selectedInvoiceIds.clear();
      this.render();
    };
    planSelect?.addEventListener('change', updateSim);
    roleSelect?.addEventListener('change', updateSim);

    // Tabs
    this.container.querySelectorAll('.nav-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as ActiveTab | null;
        if (tab) {
          this.activeTab = tab;
          this.feedbackBanner = null;
          this.render();
        }
      });
    });

    // Filter status
    this.container.querySelectorAll('.filter-status-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const st = btn.getAttribute('data-status') as typeof this.statusFilter | null;
        if (st) {
          this.statusFilter = st;
          this.selectedInvoiceIds.clear();
          this.render();
        }
      });
    });

    // Toggle forms
    this.container.querySelector('#btn-toggle-invoice-form')?.addEventListener('click', () => {
      this.showInvoiceForm = !this.showInvoiceForm;
      this.render();
    });
    this.container.querySelector('#btn-toggle-supplier-form')?.addEventListener('click', () => {
      this.showSupplierForm = !this.showSupplierForm;
      this.render();
    });

    // Checkboxes
    this.container.querySelectorAll('.invoice-checkbox').forEach((el) => {
      el.addEventListener('change', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-id');
        if (!id) return;
        if ((e.target as HTMLInputElement).checked) this.selectedInvoiceIds.add(id);
        else this.selectedInvoiceIds.delete(id);
        this.render();
      });
    });

    const selectAll = this.container.querySelector('#select-all') as HTMLInputElement | null;
    selectAll?.addEventListener('change', () => {
      const pending = this.invoices.filter((i) => i.status === 'IN_GRID');
      if (selectAll.checked) pending.forEach((i) => this.selectedInvoiceIds.add(i.id));
      else this.selectedInvoiceIds.clear();
      this.render();
    });

    // Create invoice form
    const invForm = this.container.querySelector('#form-new-invoice') as HTMLFormElement | null;
    invForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(invForm);
      const invoiceType = (fd.get('invoiceType') as 'A' | 'C' | 'INFORMAL') || 'A';
      const invoiceNumber = (fd.get('invoiceNumber') as string)?.trim() || undefined;
      const description = (fd.get('description') as string)?.trim() || undefined;
      const amountPesos = parseFloat((fd.get('amountPesos') as string) || '0');
      const dueDate = (fd.get('dueDate') as string) || '';
      const supplierId = (fd.get('supplierId') as string) || '';

      if ((invoiceType === 'A' || invoiceType === 'C') && !invoiceNumber) {
        this.showBanner('error', `La factura tipo ${invoiceType} requiere número de comprobante.`);
        return;
      }
      if (invoiceType === 'INFORMAL' && !description) {
        this.showBanner('error', 'Un comprobante informal requiere descripción.');
        return;
      }
      try {
        await this.client.createInvoice({
          supplierId,
          invoiceType,
          invoiceNumber,
          description,
          amountInCents: BigInt(Math.round(amountPesos * 100)),
          dueDate,
          confirmImmediately: this.tenantContext?.userRole === 'ADMIN',
        });
        this.showInvoiceForm = false;
        await this.refreshData();
        this.showBanner(
          'success',
          this.tenantContext?.userRole === 'ADMIN'
            ? 'Factura registrada y confirmada en la grilla.'
            : 'Borrador cargado en estado PENDING_REVIEW (esperando confirmación del Administrador).',
        );
      } catch (err) {
        this.showBanner('error', err instanceof Error ? err.message : 'Error al crear comprobante.');
      }
    });

    // Confirm / Cancel invoice
    this.container.querySelectorAll('.btn-confirm-draft').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id || !this.client.confirmDraftInvoice) return;
        try {
          await this.client.confirmDraftInvoice(id);
          await this.refreshData();
          this.showBanner('success', 'Comprobante confirmado e incorporado a la grilla de pagos.');
        } catch (err) {
          this.showBanner('error', err instanceof Error ? err.message : 'Error al confirmar.');
        }
      });
    });

    this.container.querySelectorAll('.btn-cancel-invoice').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id || !this.client.cancelInvoice) return;
        await this.client.cancelInvoice(id);
        await this.refreshData();
        this.showBanner('success', 'Comprobante anulado (se preserva en el historial para auditoría).');
      });
    });

    // Pay Batch
    this.container.querySelector('#btn-pay-batch')?.addEventListener('click', async () => {
      if (this.selectedInvoiceIds.size === 0) return;
      try {
        const res = await this.client.createPaymentBatch(Array.from(this.selectedInvoiceIds));
        await this.refreshData();
        this.showBanner(
          'success',
          res.status === 'RECORDED'
            ? `Lote ${res.batchId} pagado por ${formatCurrency(res.totalInCents)}.`
            : `Propuesta ${res.batchId} creada en estado PENDING_APPROVAL. Requiere aprobación de un ADMIN.`,
        );
      } catch (err) {
        this.showBanner('error', err instanceof Error ? err.message : 'Error al procesar el lote.');
      }
    });

    // Approve / Reverse Batch
    this.container.querySelectorAll('.btn-approve-batch').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const batchId = btn.getAttribute('data-batch');
        if (!batchId || !this.client.approvePaymentBatch) return;
        try {
          await this.client.approvePaymentBatch(batchId);
          await this.refreshData();
          this.showBanner('success', `Propuesta ${batchId} aprobada y facturas marcadas como PAGADAS.`);
        } catch (err) {
          this.showBanner('error', err instanceof Error ? err.message : 'No se pudo aprobar.');
        }
      });
    });

    this.container.querySelectorAll('.btn-reverse-batch').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const batchId = btn.getAttribute('data-batch');
        if (!batchId || !this.client.reversePaymentBatch) return;
        const reason = window.prompt('Motivo de auditoría para revertir la operación:', 'Error en selección de comprobantes');
        if (!reason) return;
        try {
          await this.client.reversePaymentBatch(batchId, reason);
          await this.refreshData();
          this.showBanner('success', `Lote ${batchId} revertido con trazabilidad. Las facturas regresaron a la grilla.`);
        } catch (err) {
          this.showBanner('error', err instanceof Error ? err.message : 'No se pudo revertir.');
        }
      });
    });

    // Supplier form
    const supForm = this.container.querySelector('#form-new-supplier') as HTMLFormElement | null;
    supForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(supForm);
      try {
        await this.client.createSupplier({
          businessName: (fd.get('businessName') as string) || '',
          mobilePhone: (fd.get('mobilePhone') as string) || '',
          cuit: (fd.get('cuit') as string) || undefined,
          cbuCvuOrAlias: (fd.get('cbuCvuOrAlias') as string) || undefined,
          categoryCode: (fd.get('categoryCode') as string) || undefined,
        });
        this.showSupplierForm = false;
        await this.refreshData();
        this.showBanner('success', 'Proveedor registrado en el padrón.');
      } catch (err) {
        this.showBanner('error', err instanceof Error ? err.message : 'Error al registrar proveedor.');
      }
    });

    // Grid alerts config
    const cfgForm = this.container.querySelector('#form-grid-config') as HTMLFormElement | null;
    cfgForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(cfgForm);
      try {
        await this.client.updateGridConfig({
          timezone: (fd.get('timezone') as string) || 'America/Argentina/Buenos_Aires',
          notificationTime: (fd.get('notificationTime') as string) || '09:00',
          lookAheadHours: Number(fd.get('lookAheadHours') || 24),
          enabled: fd.get('enabled') !== null,
          recipientMembershipIds: ['mem-1'],
        });
        await this.refreshData();
        this.showBanner('success', 'Configuración de alertas guardada.');
      } catch (err) {
        this.showBanner('error', err instanceof Error ? err.message : 'Error al actualizar alertas.');
      }
    });

    // Team invite & Checkout
    this.container.querySelector('#btn-simulate-checkout')?.addEventListener('click', () => {
      this.showBanner(
        'success',
        `Orden idempotente generada en servidor para plan ${this.tenantContext?.planCode}. En producción redirige a Mercado Pago Checkout Pro (/p/{token}).`,
      );
    });

    const inviteForm = this.container.querySelector('#form-invite-member') as HTMLFormElement | null;
    inviteForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.client.inviteTeamMember) return;
      const fd = new FormData(inviteForm);
      try {
        await this.client.inviteTeamMember({
          fullName: (fd.get('fullName') as string) || '',
          email: (fd.get('email') as string) || '',
          role: (fd.get('role') as MembershipRole) || 'OPERATOR_UPLOAD',
        });
        await this.refreshData();
        this.showBanner('success', 'Operador incorporado a la membresía del tenant.');
      } catch (err) {
        this.showBanner('error', err instanceof Error ? err.message : 'Error al invitar usuario.');
      }
    });

    // AI Chat
    const aiForm = this.container.querySelector('#form-ai-chat') as HTMLFormElement | null;
    aiForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.client.askAiAssistant) return;
      const fd = new FormData(aiForm);
      const question = (fd.get('question') as string) || '';
      try {
        await this.client.askAiAssistant(question);
        await this.refreshData();
        this.render();
      } catch (err) {
        this.showBanner('error', err instanceof Error ? err.message : 'Consulta bloqueada por política IA.');
      }
    });
  }
}
