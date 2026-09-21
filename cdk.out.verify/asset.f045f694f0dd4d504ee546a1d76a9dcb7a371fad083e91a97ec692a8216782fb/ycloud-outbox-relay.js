"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayOutboxRecords = relayOutboxRecords;
exports.handler = handler;
const client_sqs_1 = require("@aws-sdk/client-sqs");
const ycloud_event_js_1 = require("./ycloud-event.js");
const sqs = new client_sqs_1.SQSClient({});
async function relayOutboxRecords(records, queueUrl, sender) {
    for (const record of records) {
        if (record.eventName !== 'INSERT')
            continue;
        const rawPayload = record.dynamodb?.NewImage?.payload?.S;
        if (!rawPayload)
            continue;
        const ycloudEvent = (0, ycloud_event_js_1.parseYCloudEvent)(rawPayload);
        if (!ycloudEvent)
            throw new Error('El outbox contiene un evento YCloud inválido.');
        await sender.send({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({ eventId: ycloudEvent.id, eventType: ycloudEvent.type, payload: rawPayload }),
            MessageGroupId: (0, ycloud_event_js_1.conversationMessageGroupId)(ycloudEvent),
            MessageDeduplicationId: ycloudEvent.id,
        });
    }
}
async function handler(event) {
    const queueUrl = process.env.CONVERSATION_QUEUE_URL;
    if (!queueUrl)
        throw new Error('CONVERSATION_QUEUE_URL no está configurada.');
    await relayOutboxRecords(event.Records, queueUrl, {
        send: async (message) => { await sqs.send(new client_sqs_1.SendMessageCommand(message)); },
    });
}
