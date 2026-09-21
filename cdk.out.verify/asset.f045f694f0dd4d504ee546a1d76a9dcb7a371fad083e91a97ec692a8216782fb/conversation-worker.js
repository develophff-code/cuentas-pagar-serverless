"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processConversationBatch = processConversationBatch;
exports.handler = handler;
const ycloud_event_js_1 = require("./ycloud-event.js");
/** Punto de extensión para comandos WhatsApp; todavía no descarga archivos ni responde al usuario. */
async function processConversationBatch(event, process = processRecord) {
    const batchItemFailures = [];
    for (const record of event.Records) {
        try {
            await process(record);
        }
        catch {
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }
    return { batchItemFailures };
}
async function processRecord(record) {
    const envelope = JSON.parse(record.body);
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
        throw new Error('Mensaje conversacional inválido.');
    }
    const payload = envelope.payload;
    if (typeof payload !== 'string')
        throw new Error('Mensaje conversacional sin payload.');
    const ycloudEvent = (0, ycloud_event_js_1.parseYCloudEvent)(payload);
    if (!ycloudEvent)
        throw new Error('Payload YCloud inválido en cola conversacional.');
    console.info(JSON.stringify({
        message: 'YCloud conversation event ready for processing',
        eventId: ycloudEvent.id,
        eventType: ycloudEvent.type,
        queueMessageId: record.messageId,
    }));
}
async function handler(event) {
    return processConversationBatch(event);
}
