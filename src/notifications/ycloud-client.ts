export interface YCloudTemplateComponent {
  type: 'body' | 'button';
  parameters: Array<{ type: 'text'; text: string }>;
  sub_type?: 'url';
  index?: 0;
}

export interface YCloudTemplateMessage {
  from: string;
  to: string;
  templateName: string;
  components: YCloudTemplateComponent[];
}

export interface YCloudMessageGateway {
  enqueueTemplate(message: YCloudTemplateMessage): Promise<{ messageId: string }>;
}

/** Cliente mínimo del endpoint asíncrono de YCloud; nunca registra la API key. */
export class YCloudHttpClient implements YCloudMessageGateway {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async enqueueTemplate(message: YCloudTemplateMessage): Promise<{ messageId: string }> {
    const response = await this.fetcher('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify({
        from: message.from, to: message.to, type: 'template',
        template: {
          name: message.templateName,
          language: { code: 'es_AR', policy: 'deterministic' },
          components: message.components,
        },
      }),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok || typeof payload !== 'object' || payload === null || typeof (payload as { id?: unknown }).id !== 'string') {
      throw new Error(`YCloud rechazó el envío (${response.status}).`);
    }
    return { messageId: (payload as { id: string }).id };
  }
}
