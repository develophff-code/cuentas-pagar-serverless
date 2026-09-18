import { createHash } from 'node:crypto';

export interface YCloudEventForConversation {
  id: string;
  type: string;
  apiVersion: string;
  createTime: string;
  whatsappMessage?: { from?: string; wabaId?: string };
}

export function parseYCloudEvent(rawPayload: string): YCloudEventForConversation | undefined {
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    const event = parsed as YCloudEventForConversation;
    if (![event.id, event.type, event.apiVersion, event.createTime].every((value) => typeof value === 'string' && value.trim())) {
      return undefined;
    }
    return event;
  } catch {
    return undefined;
  }
}

/** No expone teléfono ni BSUID en MessageGroupId, pero conserva orden por identidad. */
export function conversationMessageGroupId(event: YCloudEventForConversation): string {
  const from = event.whatsappMessage?.from?.trim();
  const wabaId = event.whatsappMessage?.wabaId?.trim();
  const identity = from ? `${wabaId ?? 'unknown'}:${from}` : `event:${event.id}`;
  return `ycloud-${createHash('sha256').update(identity).digest('hex')}`;
}
