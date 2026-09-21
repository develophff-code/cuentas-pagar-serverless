import assert from 'node:assert/strict';
import test from 'node:test';
import { processConversationBatch } from '../../src/webhooks/conversation-worker.js';
import { relayOutboxRecords, type ConversationQueueMessage } from '../../src/webhooks/ycloud-outbox-relay.js';

const payload = JSON.stringify({
  id: 'evt_retry_1', type: 'whatsapp.message.updated', apiVersion: 'v2', createTime: '2026-09-21T12:00:00.000Z',
  whatsappMessage: { from: '+5491100000000', wabaId: 'waba_1' },
});

test('el relay conserva la misma deduplicación al reintentar un evento de DynamoDB', async () => {
  const sent: ConversationQueueMessage[] = [];
  const records = [{ eventName: 'INSERT', dynamodb: { NewImage: { payload: { S: payload } } } }];
  const sender = { send: async (message: ConversationQueueMessage) => { sent.push(message); } };
  await relayOutboxRecords(records, 'https://sqs.example/queue.fifo', sender);
  await relayOutboxRecords(records, 'https://sqs.example/queue.fifo', sender);
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!.MessageDeduplicationId, 'evt_retry_1');
  assert.equal(sent[0]!.MessageDeduplicationId, sent[1]!.MessageDeduplicationId);
  assert.equal(sent[0]!.MessageGroupId, sent[1]!.MessageGroupId);
});

test('el worker devuelve sólo los mensajes fallidos para reintento', async () => {
  const processed: string[] = [];
  const result = await processConversationBatch({
    Records: [{ messageId: 'ok', body: '{}' }, { messageId: 'retry', body: '{}' }],
  }, async (record) => {
    if (record.messageId === 'retry') throw new Error('transient');
    processed.push(record.messageId);
  });
  assert.deepEqual(processed, ['ok']);
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: 'retry' }]);
});
