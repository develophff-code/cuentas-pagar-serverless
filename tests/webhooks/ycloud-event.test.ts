import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationMessageGroupId, parseYCloudEvent } from '../../src/webhooks/ycloud-event.js';

const rawEvent = JSON.stringify({
  id: 'evt_1', type: 'whatsapp.message.updated', apiVersion: 'v2', createTime: '2026-09-18T18:00:00.000Z',
  whatsappMessage: { from: '+5491100000000', wabaId: 'waba_1' },
});

test('deriva un MessageGroupId estable sin revelar la identidad de WhatsApp', () => {
  const event = parseYCloudEvent(rawEvent)!;
  const groupId = conversationMessageGroupId(event);
  assert.equal(groupId, conversationMessageGroupId(event));
  assert.match(groupId, /^ycloud-[a-f0-9]{64}$/);
  assert.doesNotMatch(groupId, /5491100000000|waba_1/);
});

test('rechaza payloads que no cumplen el sobre común de YCloud', () => {
  assert.equal(parseYCloudEvent('{"id":"evt_1"}'), undefined);
  assert.equal(parseYCloudEvent('not-json'), undefined);
});
