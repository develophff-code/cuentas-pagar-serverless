import assert from 'node:assert/strict';
import test from 'node:test';
import { ColumnTypeEnum as C, DriverAdapterError, type SqlQuery } from '@prisma/driver-adapter-utils';
import { RDSDataClient, type ExecuteStatementCommandInput } from '@aws-sdk/client-rds-data';
import { AwsDataApiTransport, PrismaDataApi, type DataApiTransport } from '../../src/persistence/data-api-adapter.js';
import { bindDataApiQuery, dataApiResult } from '../../src/persistence/data-api-sql.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const config = { resourceArn: 'arn:aws:rds:us-east-1:123456789012:cluster:fixture',
  secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:fixture', database: 'fixture' };
const query: SqlQuery = { sql: 'SELECT $1::numeric, $2::bigint', args: ['144000.01', 9007199254740993n],
  argTypes: [{ scalarType: 'decimal', arity: 'scalar' }, { scalarType: 'bigint', arity: 'scalar' }] };

function fixture() {
  const statements: ExecuteStatementCommandInput[] = [], actions: string[] = [];
  const transport: DataApiTransport = {
    execute: async (input) => { statements.push(input); return { $metadata: {}, numberOfRecordsUpdated: 1 }; },
    begin: async () => { actions.push('begin'); return { $metadata: {}, transactionId: 'tx-fixture' }; },
    commit: async () => { actions.push('commit'); }, rollback: async () => { actions.push('rollback'); },
  };
  return { statements, actions, transport };
}

test('Data API mantiene parámetros fuera del SQL y no pierde precisión decimal/bigint', () => {
  assert.deepEqual(bindDataApiQuery(query), {
    sql: 'SELECT :p1::numeric, :p2::bigint', parameters: [
      { name: 'p1', value: { stringValue: '144000.01' }, typeHint: 'DECIMAL' },
      { name: 'p2', value: { stringValue: '9007199254740993' } },
    ],
  });
  assert.throws(() => bindDataApiQuery({ ...query, args: [9007199254740992], argTypes: [], sql: 'SELECT $1' }));
  assert.throws(() => bindDataApiQuery({ ...query, args: [9007199254740992, 1n] }));
});

test('no reescribe placeholders en literales, identificadores ni comentarios anidados', () => {
  const sql = `SELECT '$1', E'escaped\\\'$2', "$2", $$ $1 $$, $tag$ $2 $tag$, $1, $1 /* $2 /* $1 */ */ -- $2\n`;
  const result = bindDataApiQuery({ sql, args: ['sensitive value'], argTypes: [{ scalarType: 'string', arity: 'scalar' }] });
  assert.equal(result.sql, sql.replace(', $1, $1 /*', ', :p1, :p1 /*'));
  assert.equal(result.parameters.length, 1);
  assert.ok(!result.sql.includes('sensitive value'));
});

test('fechas UTC, UUID y JSON se vinculan sin interpolación', () => {
  const result = bindDataApiQuery({ sql: 'SELECT $1,$2,$3',
    args: [new Date('2030-01-01T15:20:30.123Z'), '00000000-0000-0000-0000-000000000001', '{"a":1}'],
    argTypes: ['datetime', 'uuid', 'json'].map((scalarType) => ({ scalarType, arity: 'scalar' })) as SqlQuery['argTypes'] });
  assert.deepEqual(result.parameters.map((p) => p.typeHint), ['TIMESTAMP', 'UUID', 'JSON']);
  assert.equal(result.parameters[0]?.value?.stringValue, '2030-01-01 15:20:30.123');
});

test('metadatos convierten decimal, bigint, enum, fecha y null para Prisma', () => {
  const output = dataApiResult({ $metadata: {}, columnMetadata: [
    { name: 'amount', typeName: 'numeric' }, { name: 'id', typeName: 'int8' },
    { name: 'plan', typeName: 'plan_code', type: 1111 }, { name: 'at', typeName: 'timestamptz' },
    { name: 'count', typeName: 'int4' },
  ], records: [[{ stringValue: '28000.01' }, { stringValue: '9007199254740993' },
    { stringValue: 'BASIC' }, { stringValue: '2030-01-01 12:00:00.123' }, { isNull: true }]] });
  assert.deepEqual(output.columnTypes, [C.Numeric, C.Int64, C.Text, C.DateTime, C.Int32]);
  assert.deepEqual(output.rows[0], ['28000.01', '9007199254740993', 'BASIC', '2030-01-01T12:00:00.123Z', null]);
  assert.throws(() => dataApiResult({ $metadata: {}, columnMetadata: [{ typeName: 'int8' }],
    records: [[{ longValue: 9007199254740992 }]] }), /PRECISION_LOSS/);
  assert.throws(() => dataApiResult({ $metadata: {}, columnMetadata: [{ typeName: 'numeric' }],
    records: [[{ doubleValue: 0.1 }]] }), /PRECISION_LOSS/);
});

test('transacción SERIALIZABLE usa el mismo ID, commit remoto y rechaza consultas posteriores', async () => {
  const f = fixture(); const adapter = await new PrismaDataApi(config, f.transport).connect();
  const tx = await adapter.startTransaction('SERIALIZABLE');
  assert.equal(tx.options.usePhantomQuery, true);
  await tx.executeRaw(query);
  assert.deepEqual(f.statements.map((s) => s.transactionId), ['tx-fixture', 'tx-fixture']);
  assert.equal(f.statements[0]?.sql, 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  await tx.commit();
  assert.deepEqual(f.actions, ['begin', 'commit']);
  await assert.rejects(tx.queryRaw(query), DriverAdapterError);
});

test('rollback conserva el error de aislamiento y errores SQL no exponen valores sensibles', async () => {
  const f = fixture(); f.transport.execute = async () => { throw new Error('SQLState: 23505 duplicate customer-secret-value'); };
  const adapter = await new PrismaDataApi(config, f.transport).connect();
  await assert.rejects(adapter.startTransaction('SERIALIZABLE'), (error: unknown) => {
    assert.ok(error instanceof DriverAdapterError);
    assert.equal(error.cause.kind, 'UniqueConstraintViolation');
    assert.ok(!JSON.stringify(error).includes('customer-secret-value')); return true;
  });
  assert.deepEqual(f.actions, ['begin', 'rollback']);
});

test('SDK sólo reintenta DatabaseResumingException, nunca errores de red/commit ambiguos', async () => {
  let calls = 0; const delays: number[] = [];
  const fake = { send: async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('fixture'), { name: 'DatabaseResumingException' });
    return { $metadata: {} };
  } } as unknown as RDSDataClient;
  const transport = new AwsDataApiTransport(fake, async (ms) => { delays.push(ms); });
  await transport.execute({ ...config, sql: 'SELECT 1' });
  assert.equal(calls, 2); assert.deepEqual(delays, [1000]);
  calls = 0;
  fake.send = (async () => { calls++; throw new Error('network failure'); }) as RDSDataClient['send'];
  await assert.rejects(transport.execute({ ...config, sql: 'INSERT INTO fixture VALUES (1)' }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(transport.commit({ resourceArn: config.resourceArn, secretArn: config.secretArn, transactionId: 'tx' }));
  assert.equal(calls, 1);
});

test('cliente Prisma real usa Data API para filtro de tenant, IN y decimal sin rehacer servicios', async () => {
  const f = fixture(); const prisma = new PrismaClient({ adapter: new PrismaDataApi(config, f.transport) });
  try {
    assert.deepEqual(await prisma.subscriptions.findMany({ where: {
      tenant_id: '00000000-0000-0000-0000-000000000001', status: { in: ['ACTIVE', 'EXPIRED'] },
      ends_at: { gt: new Date('2030-01-01T00:00:00Z') },
    } }), []);
    await prisma.$transaction(async (tx) => {
      await tx.subscription_orders.updateMany({ where: { tenant_id: '00000000-0000-0000-0000-000000000001' },
        data: { amount: '144000.01' } });
    }, { isolationLevel: 'Serializable' });
    assert.deepEqual(f.actions, ['begin', 'commit']);
    assert.ok(f.statements.some((s) => s.parameters?.some((p) => p.value?.stringValue === '144000.01')));
    assert.ok(f.statements.every((s) => s.resultSetOptions?.decimalReturnType === 'STRING'));
  } finally { await prisma.$disconnect(); }
});
