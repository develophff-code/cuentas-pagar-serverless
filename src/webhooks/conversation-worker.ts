import { parseYCloudEvent } from './ycloud-event.js';

interface SqsRecord { body: string; messageId: string; }
interface SqsEvent { Records: SqsRecord[]; }
export interface SqsBatchResult { batchItemFailures: Array<{ itemIdentifier: string }>; }

/** Punto de extensión para comandos WhatsApp; todavía no descarga archivos ni responde al usuario. */
export async function processConversationBatch(
  event: SqsEvent,
  process: (record: SqsRecord) => Promise<void> = processRecord,
): Promise<SqsBatchResult> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await process(record);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

async function processRecord(record: SqsRecord): Promise<void> {
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

export async function handler(event: SqsEvent): Promise<SqsBatchResult> {
  return processConversationBatch(event);
}
