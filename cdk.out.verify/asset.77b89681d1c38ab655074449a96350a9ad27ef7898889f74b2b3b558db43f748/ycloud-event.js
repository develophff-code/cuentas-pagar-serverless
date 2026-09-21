"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseYCloudEvent = parseYCloudEvent;
exports.conversationMessageGroupId = conversationMessageGroupId;
const node_crypto_1 = require("node:crypto");
function parseYCloudEvent(rawPayload) {
    try {
        const parsed = JSON.parse(rawPayload);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return undefined;
        const event = parsed;
        if (![event.id, event.type, event.apiVersion, event.createTime].every((value) => typeof value === 'string' && value.trim())) {
            return undefined;
        }
        return event;
    }
    catch {
        return undefined;
    }
}
/** No expone teléfono ni BSUID en MessageGroupId, pero conserva orden por identidad. */
function conversationMessageGroupId(event) {
    const from = event.whatsappMessage?.from?.trim();
    const wabaId = event.whatsappMessage?.wabaId?.trim();
    const identity = from ? `${wabaId ?? 'unknown'}:${from}` : `event:${event.id}`;
    return `ycloud-${(0, node_crypto_1.createHash)('sha256').update(identity).digest('hex')}`;
}
