export interface MercadoPagoPreferenceInput {
  title: string;
  amount: number;
  currency: 'ARS';
  externalReference: string;
  notificationUrl: string;
  backUrls: { success: string; failure: string; pending: string };
  expiresAt: Date;
}

export interface MercadoPagoPreference {
  id: string;
  checkoutUrl: string;
}

export interface MercadoPagoPayment {
  id: string;
  status: string;
  externalReference?: string;
  currency?: string;
  transactionAmount?: number;
}

export interface MercadoPagoGateway {
  createPreference(input: MercadoPagoPreferenceInput): Promise<MercadoPagoPreference>;
  getPayment(paymentId: string): Promise<MercadoPagoPayment>;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchImplementation = (input: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<FetchResponse>;

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Mercado Pago respondió un JSON inválido.');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Mercado Pago no devolvió ${field}.`);
  return value;
}

function requiredIdentifier(value: unknown, field: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) {
    throw new Error(`Mercado Pago no devolvió ${field}.`);
  }
  return String(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Cliente mínimo de Checkout Pro; el Access Token nunca sale de este proceso. */
export class MercadoPagoHttpClient implements MercadoPagoGateway {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImplementation: FetchImplementation = fetch as unknown as FetchImplementation,
  ) {
    if (!accessToken.trim()) throw new Error('mercadoPagoAccessToken no está configurado.');
  }

  async createPreference(input: MercadoPagoPreferenceInput): Promise<MercadoPagoPreference> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('El importe de la preferencia debe ser positivo.');
    const payload = {
      items: [{ title: input.title, quantity: 1, unit_price: input.amount, currency_id: input.currency }],
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: input.backUrls,
      auto_return: 'approved',
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: input.expiresAt.toISOString(),
    };
    const response = await this.request('/checkout/preferences', 'POST', payload);
    return {
      id: requiredText(response.id, 'id'),
      checkoutUrl: requiredText(response.init_point, 'init_point'),
    };
  }

  async getPayment(paymentId: string): Promise<MercadoPagoPayment> {
    if (!paymentId.trim()) throw new Error('El identificador de pago es obligatorio.');
    const response = await this.request(`/v1/payments/${encodeURIComponent(paymentId)}`, 'GET');
    const transactionAmount = optionalNumber(response.transaction_amount);
    return {
      id: requiredIdentifier(response.id, 'id'),
      status: requiredText(response.status, 'status'),
      ...(typeof response.external_reference === 'string' ? { externalReference: response.external_reference } : {}),
      ...(typeof response.currency_id === 'string' ? { currency: response.currency_id } : {}),
      ...(transactionAmount === undefined ? {} : { transactionAmount }),
    };
  }

  private async request(path: string, method: 'GET' | 'POST', body?: object): Promise<Record<string, unknown>> {
    const response = await this.fetchImplementation(`https://api.mercadopago.com${path}`, {
      method,
      headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Mercado Pago rechazó la solicitud (${response.status}).`);
    return asObject(payload);
  }
}
