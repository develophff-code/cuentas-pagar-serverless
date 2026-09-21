import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { conversationMessageGroupId, parseYCloudEvent } from './ycloud-event.js';

interface DynamoStreamRecord {
  eventName?: string;
  dynamodb?: { NewImage?: Record<string, { S?: string }> };
}

interface DynamoStreamEvent {
  Records: DynamoStreamRecord[];
}

export interface ConversationQueueMessage {
  QueueUrl: string;
  MessageBody: string;
  MessageGroupId: string;
  MessageDeduplicationId: string;
}

export interface ConversationQueueSender {
  send(message: ConversationQueueMessage): Promise<void>;
}

const sqs = new SQSClient({});

export async function relayOutboxRecords(
  records: readonly DynamoStreamRecord[],
  queueUrl: string,
  sender: ConversationQueueSender,
): Promise<void> {
  for (const record of records) {
    if (record.eventName !== 'INSERT') continue;
    const rawPayload = record.dynamodb?.NewImage?.payload?.S;
    if (!rawPayload) continue;
    const ycloudEvent = parseYCloudEvent(rawPayload);
    if (!ycloudEvent) throw new Error('El outbox contiene un evento YCloud inválido.');
    await sender.send({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ eventId: ycloudEvent.id, eventType: ycloudEvent.type, payload: rawPayload }),
      MessageGroupId: conversationMessageGroupId(ycloudEvent),
      MessageDeduplicationId: ycloudEvent.id,
    });
  }
}

export async function handler(event: DynamoStreamEvent): Promise<void> {
  const queueUrl = process.env.CONVERSATION_QUEUE_URL;
  if (!queueUrl) throw new Error('CONVERSATION_QUEUE_URL no está configurada.');
  await relayOutboxRecords(event.Records, queueUrl, {
    send: async (message) => { await sqs.send(new SendMessageCommand(message)); },
  });
}
