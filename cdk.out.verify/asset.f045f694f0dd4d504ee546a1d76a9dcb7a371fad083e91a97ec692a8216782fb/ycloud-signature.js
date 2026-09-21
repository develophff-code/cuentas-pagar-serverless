"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YCLOUD_SIGNATURE_TOLERANCE_SECONDS = void 0;
exports.verifyYCloudSignature = verifyYCloudSignature;
const node_crypto_1 = require("node:crypto");
exports.YCLOUD_SIGNATURE_TOLERANCE_SECONDS = 300;
function signatureParts(value) {
    const parts = new Map(value.split(',').map((part) => {
        const [key, ...rest] = part.trim().split('=');
        return [key, rest.join('=')];
    }));
    const timestamp = parts.get('t');
    const signature = parts.get('s');
    if (!timestamp || !signature || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature))
        return undefined;
    return { timestamp, signature };
}
function verifyYCloudSignature(rawBody, signatureHeader, secret, now = new Date()) {
    if (!signatureHeader || !secret)
        return false;
    const parts = signatureParts(signatureHeader);
    if (!parts)
        return false;
    const timestampSeconds = Number(parts.timestamp);
    if (!Number.isSafeInteger(timestampSeconds)
        || Math.abs(Math.floor(now.getTime() / 1000) - timestampSeconds) > exports.YCLOUD_SIGNATURE_TOLERANCE_SECONDS) {
        return false;
    }
    const expected = (0, node_crypto_1.createHmac)('sha256', secret).update(`${parts.timestamp}.${rawBody}`).digest();
    const received = Buffer.from(parts.signature, 'hex');
    return received.length === expected.length && (0, node_crypto_1.timingSafeEqual)(received, expected);
}
