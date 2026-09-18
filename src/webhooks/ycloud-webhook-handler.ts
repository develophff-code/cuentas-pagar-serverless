import { PutItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { verifyYCloudSignature } from './ycloud-signature.js';
import type { ApiGatewayRequest, ApiGatewayResponse } from '../api/http-types.js';

interface YCloudEvent {
  id: string;
  type: string;
  apiVersion: string;
  createTime: string;
}

const dynamo = new DynamoDBClient({});
const secrets = new SecretsManagerClient({});
let webhookSecret: Promise<string> | undefined;

function header(request: ApiGatewayRequest, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  return Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === lowerName)?.[1];
}

function response(statusCode: number, body: object): ApiGatewayResponse {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function parseEvent(rawBody: string): YCloudEvent | undefined {
  try {
    const event: unknown = JSON.parse(rawBody);
    if (typeof event !== 'object' || event === null || Array.isArray(event)) return undefined;
    const candidate = event as Partial<YCloudEvent>;
    if (![candidate.id, candidate.type, candidate.apiVersion, candidate.createTime].every((value) => typeof value === 'string' && value.trim())) {
      return undefined;
    }
    return candidate as YCloudEvent;
  } catch {
    return undefined;
  }
}

async function getWebhookSecret(): Promise<string> {
  if (webhookSecret === undefined) {
    webhookSecret = (async () => {
      const secretId = process.env.RUNTIME_CONFIG_SECRET_ARN;
      if (!secretId) throw new Error('RUNTIME_CONFIG_SECRET_ARN no está configurada.');
      const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      if (!result.SecretString) throw new Error('El secreto de runtime no contiene texto JSON.');
      const parsed: unknown = JSON.parse(result.SecretString);
      const value = typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>).ycloudWebhookSecret
        : undefined;
      if (typeof value !== 'string' || !value.trim()) throw new Error('ycloudWebhookSecret no está configurado.');
      return value;
    })();
  }
  return webhookSecret;
}

export async function handler(request: ApiGatewayRequest): Promise<ApiGatewayResponse> {
  const rawBody = request.body ?? '';
  try {
    const secret = await getWebhookSecret();
    if (!verifyYCloudSignature(rawBody, header(request, 'YCloud-Signature'), secret)) {
      return response(401, { error: 'INVALID_SIGNATURE' });
    }
    const event = parseEvent(rawBody);
    if (event === undefined) return response(400, { error: 'INVALID_EVENT' });
    const tableName = process.env.INBOUND_EVENTS_TABLE_NAME;
    if (!tableName) throw new Error('INBOUND_EVENTS_TABLE_NAME no está configurada.');
    const now = new Date();
    try {
      await dynamo.send(new PutItemCommand({
        TableName: tableName,
        Item: {
          event_key: { S: `YCLOUD#${event.id}` }, provider: { S: 'YCLOUD' }, event_id: { S: event.id },
          event_type: { S: event.type }, received_at: { S: now.toISOString() }, payload: { S: rawBody },
          expires_at: { N: String(Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60) },
        },
        ConditionExpression: 'attribute_not_exists(event_key)',
      }));
      console.info(JSON.stringify({ message: 'YCloud event accepted', eventId: event.id, eventType: event.type }));
      return response(200, { received: true });
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return response(200, { received: true, duplicate: true });
      }
      throw error;
    }
  } catch (error) {
    console.error('YCloud webhook processing failed', error instanceof Error ? error.message : 'unknown error');
    return response(500, { error: 'TEMPORARY_FAILURE' });
  }
}
