"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
const ycloud_signature_js_1 = require("./ycloud-signature.js");
const dynamo = new client_dynamodb_1.DynamoDBClient({});
const secrets = new client_secrets_manager_1.SecretsManagerClient({});
let webhookSecret;
function header(request, name) {
    const lowerName = name.toLowerCase();
    return Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === lowerName)?.[1];
}
function response(statusCode, body) {
    return {
        statusCode,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
    };
}
function parseEvent(rawBody) {
    try {
        const event = JSON.parse(rawBody);
        if (typeof event !== 'object' || event === null || Array.isArray(event))
            return undefined;
        const candidate = event;
        if (![candidate.id, candidate.type, candidate.apiVersion, candidate.createTime].every((value) => typeof value === 'string' && value.trim())) {
            return undefined;
        }
        return candidate;
    }
    catch {
        return undefined;
    }
}
async function getWebhookSecret() {
    if (webhookSecret === undefined) {
        webhookSecret = (async () => {
            const secretId = process.env.RUNTIME_CONFIG_SECRET_ARN;
            if (!secretId)
                throw new Error('RUNTIME_CONFIG_SECRET_ARN no está configurada.');
            const result = await secrets.send(new client_secrets_manager_1.GetSecretValueCommand({ SecretId: secretId }));
            if (!result.SecretString)
                throw new Error('El secreto de runtime no contiene texto JSON.');
            const parsed = JSON.parse(result.SecretString);
            const value = typeof parsed === 'object' && parsed !== null
                ? parsed.ycloudWebhookSecret
                : undefined;
            if (typeof value !== 'string' || !value.trim())
                throw new Error('ycloudWebhookSecret no está configurado.');
            return value;
        })();
    }
    return webhookSecret;
}
async function handler(request) {
    const rawBody = request.body ?? '';
    try {
        const secret = await getWebhookSecret();
        if (!(0, ycloud_signature_js_1.verifyYCloudSignature)(rawBody, header(request, 'YCloud-Signature'), secret)) {
            return response(401, { error: 'INVALID_SIGNATURE' });
        }
        const event = parseEvent(rawBody);
        if (event === undefined)
            return response(400, { error: 'INVALID_EVENT' });
        const tableName = process.env.INBOUND_EVENTS_TABLE_NAME;
        if (!tableName)
            throw new Error('INBOUND_EVENTS_TABLE_NAME no está configurada.');
        const now = new Date();
        try {
            await dynamo.send(new client_dynamodb_1.PutItemCommand({
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
        }
        catch (error) {
            if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
                return response(200, { received: true, duplicate: true });
            }
            throw error;
        }
    }
    catch (error) {
        console.error('YCloud webhook processing failed', error instanceof Error ? error.message : 'unknown error');
        return response(500, { error: 'TEMPORARY_FAILURE' });
    }
}
