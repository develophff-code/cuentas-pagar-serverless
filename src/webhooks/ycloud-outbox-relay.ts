import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { conversationMessageGroupId, parseYCloudEvent } from './ycloud-event.js';

interface DynamoStreamRecord {
  eventName?: string;
  dynamodb?: { NewImage?: Record<string, { S?: string }> };
}

interface DynamoStreamEvent {
  Records: DynamoStreamRecord[];
}

const sqs = new SQSClient({});

export async function handler(event: DynamoStreamEvent): Promise<void> {
  const queueUrl = process.env.CONVERSATION_QUEUE_URL;
  if (!queueUrl) throw new Error('CONVERSATION_QUEUE_URL no está configurada.');
  for (const record of event.Records) {
    if (record.eventName !== 'INSERT') continue;
    const rawPayload = record.dynamodb?.NewImage?.payload?.S;
    if (!rawPayload) continue;
    const ycloudEvent = parseYCloudEvent(rawPayload);
    if (!ycloudEvent) throw new Error('El outbox contiene un evento YCloud inválido.');
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ eventId: ycloudEvent.id, eventType: ycloudEvent.type, payload: rawPayload }),
      MessageGroupId: conversationMessageGroupId(ycloudEvent),
      MessageDeduplicationId: ycloudEvent.id,
    }));
  }
}
