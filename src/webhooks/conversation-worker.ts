import { parseYCloudEvent } from './ycloud-event.js';

interface SqsRecord { body: string; messageId: string; }
interface SqsEvent { Records: SqsRecord[]; }

/** Punto de extensión para comandos WhatsApp; todavía no descarga archivos ni responde al usuario. */
export async function handler(event: SqsEvent): Promise<void> {
  for (const record of event.Records) {
    const envelope: unknown = JSON.parse(record.body);
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
      throw new Error('Mensaje conversacional inválido.');
    }
    const payload = (envelope as Record<string, unknown>).payload;
    if (typeof payload !== 'string') throw new Error('Mensaje conversacional sin payload.');
    const ycloudEvent = parseYCloudEvent(payload);
    if (!ycloudEvent) throw new Error('Payload YCloud inválido en cola conversacional.');
    console.info(JSON.stringify({
      message: 'YCloud conversation event ready for processing',
      eventId: ycloudEvent.id,
      eventType: ycloudEvent.type,
      queueMessageId: record.messageId,
    }));
  }
}
