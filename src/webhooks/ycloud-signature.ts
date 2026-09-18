import { createHmac, timingSafeEqual } from 'node:crypto';

export const YCLOUD_SIGNATURE_TOLERANCE_SECONDS = 300;

function signatureParts(value: string): { timestamp: string; signature: string } | undefined {
  const parts = new Map(value.split(',').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')] as const;
  }));
  const timestamp = parts.get('t');
  const signature = parts.get('s');
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return undefined;
  return { timestamp, signature };
}

export function verifyYCloudSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  now = new Date(),
): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = signatureParts(signatureHeader);
  if (!parts) return false;
  const timestampSeconds = Number(parts.timestamp);
  if (!Number.isSafeInteger(timestampSeconds)
    || Math.abs(Math.floor(now.getTime() / 1000) - timestampSeconds) > YCLOUD_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${parts.timestamp}.${rawBody}`).digest();
  const received = Buffer.from(parts.signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
