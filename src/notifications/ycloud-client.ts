export interface YCloudTemplateComponent {
  type: 'body' | 'button';
  parameters: Array<{ type: 'text'; text: string; parameter_name?: string }>;
  sub_type?: 'url';
  index?: 0;
}

export interface YCloudTemplateMessage {
  from: string;
  to: string;
  templateName: string;
  components: YCloudTemplateComponent[];
  languageCode?: string;
  externalId?: string;
}

/** Sólo códigos sanitizados: nunca conservar cuerpos de error del proveedor. */
export class YCloudSendError extends Error {
  constructor(readonly outcome: 'RETRY' | 'BLOCKED' | 'UNKNOWN', readonly code: string) {
    super(code);
  }
}

export interface YCloudMessageGateway {
  enqueueTemplate(message: YCloudTemplateMessage): Promise<{ messageId: string }>;
}

/** Cliente mínimo del endpoint asíncrono de YCloud; nunca registra la API key. */
export class YCloudHttpClient implements YCloudMessageGateway {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async enqueueTemplate(message: YCloudTemplateMessage): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await this.fetcher('https://api.ycloud.com/v2/whatsapp/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({
          from: message.from, to: message.to, type: 'template', externalId: message.externalId,
          template: {
            name: message.templateName,
            language: { code: message.languageCode ?? 'es_AR', policy: 'deterministic' },
            components: message.components,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new YCloudSendError('UNKNOWN', 'YCLOUD_TRANSPORT_UNKNOWN');
    }
    if (!response.ok) {
      const outcome = response.status === 429 ? 'RETRY'
        : response.status >= 400 && response.status < 500 && response.status !== 408 ? 'BLOCKED' : 'UNKNOWN';
      throw new YCloudSendError(outcome, `YCLOUD_HTTP_${response.status}`);
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (typeof payload !== 'object' || payload === null || typeof (payload as { id?: unknown }).id !== 'string'
      || !(payload as { id: string }).id.trim()) {
      throw new YCloudSendError('UNKNOWN', 'YCLOUD_RESPONSE_UNKNOWN');
    }
    return { messageId: (payload as { id: string }).id };
  }
}
