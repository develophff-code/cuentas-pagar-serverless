import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import type { ExecuteStatementCommandInput, Field } from '@aws-sdk/client-rds-data';
import type { DataApiTransport } from '../../src/persistence/data-api-adapter.js';
import { MigrationFailure, prepareMigrations, runDataApiMigrations, validateMigrationTarget,
  type MigrationSource } from '../../scripts/migrations/data-api-runner.js';
import { splitSqlStatements } from '../../scripts/migrations/sql-statements.js';

const config = { resourceArn: 'arn:aws:rds:us-east-1:123456789012:cluster:fixture',
  secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:cuentas-pagar/dev/mvp-database-credentials-Ab1234', database: 'cuentas_pagar' };
const sources: MigrationSource[] = [
  { name: '001_initial.sql', sql: 'BEGIN; CREATE TABLE sample (id integer); COMMIT;' },
  { name: '002_next.sql', sql: 'BEGIN; ALTER TABLE sample ADD COLUMN label text; COMMIT;' },
];

function fixture() {
  let count = 0, receipts: Field[][] = [];
  const pending = new Map<string, Field[][]>();
  const statements: ExecuteStatementCommandInput[] = [], actions: string[] = [];
  const transport: DataApiTransport = {
    begin: async () => { const id = `tx-${++count}`; pending.set(id, []); actions.push(`begin:${id}`); return { $metadata: {}, transactionId: id }; },
    execute: async (input) => {
      assert.ok(input.transactionId && pending.has(input.transactionId));
      statements.push(input);
      if (input.sql?.includes('pg_try_advisory_xact_lock')) return { $metadata: {}, records: [[{ booleanValue: true }]] };
      if (input.sql?.startsWith('SELECT migration_id')) return { $metadata: {}, records: structuredClone(receipts) };
      if (input.sql?.includes('to_regclass')) return { $metadata: {}, records: [[{ isNull: true }]] };
      if (input.sql?.startsWith('INSERT INTO public.cuentas_pagar_schema_migrations')) {
        pending.get(input.transactionId)!.push(input.parameters!.map((p) => p.value!));
      }
      return { $metadata: {}, numberOfRecordsUpdated: 1 };
    },
    commit: async (input) => {
      actions.push(`commit:${input.transactionId}`); receipts.push(...pending.get(input.transactionId!)!); pending.delete(input.transactionId!);
    },
    rollback: async (input) => { actions.push(`rollback:${input.transactionId}`); pending.delete(input.transactionId!); },
  };
  return { transport, statements, actions, receipts: () => receipts,
    setHistory: (history: Field[][]) => { receipts = history; } };
}

test('separador conserva funciones PL/pgSQL, strings, comentarios anidados e identificadores', () => {
  const statements = splitSqlStatements(`-- initial;\nBEGIN; /* outer; /* nested; */ */
    CREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM ';'; END; $body$ LANGUAGE plpgsql;
    SELECT E'escaped\\\';value', 'quote'';value', "semi;colon", ident$tag$; COMMIT; -- final`);
  assert.equal(statements.length, 4);
  assert.ok(statements[1]?.includes("PERFORM ';'; END;"));
  assert.ok(statements[2]?.includes('ident$tag$'));
  for (const sql of ["SELECT 'unterminated", '/* unclosed', 'SELECT $tag$unclosed', 'SELECT "unclosed']) {
    assert.throws(() => splitSqlStatements(sql));
  }
});

test('prepara las ocho migraciones reales, preservando los cuerpos de triggers y hashes entre Windows/Linux', () => {
  const files = readdirSync('database/migrations').filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, sql: readFileSync(`database/migrations/${name}`, 'utf8') }));
  const prepared = prepareMigrations(files);
  assert.deepEqual(prepared.map((m) => m.id), ['001', '002', '003', '004', '005', '006', '007', '008']);
  assert.equal(prepared[0]?.statements.filter((sql) => sql.startsWith('CREATE OR REPLACE FUNCTION')).length, 2);
  assert.ok(prepared[0]?.statements.some((sql) => sql.includes('RETURN NEW;\nEND;')));
  assert.deepEqual(prepareMigrations(files.map((m) => ({ ...m, sql: m.sql.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n') }))), prepared);
});

test('rechaza huecos, duplicados, controles de transacción, psql y DDL no transaccional antes de AWS', () => {
  for (const files of [[], [sources[1]!], [sources[0]!, sources[0]!],
    [{ name: '001_bad.sql', sql: 'CREATE TABLE t (id int);' }],
    ...['COMMIT', 'START TRANSACTION', 'VACUUM', 'CREATE INDEX CONCURRENTLY i ON t(id)', '\\echo wrong', 'COPY t FROM STDIN']
      .map((sql) => [{ name: '001_bad.sql', sql: `BEGIN; ${sql}; COMMIT;` }])]) {
    assert.throws(() => prepareMigrations(files), MigrationFailure);
  }
});

test('sólo permite ARNs dev de la misma cuenta y rechaza runtime-config sin leer secretos', () => {
  validateMigrationTarget(config, 'dev');
  for (const [target, stage] of [[config, 'prod'], [config, undefined],
    [{ ...config, database: 'other' }, 'dev'],
    [{ ...config, resourceArn: config.resourceArn.replace('us-east-1', 'us-west-2') }, 'dev'],
    [{ ...config, secretArn: config.secretArn.replace('123456789012', '999999999999') }, 'dev'],
    [{ ...config, secretArn: config.secretArn.replace('mvp-database-credentials', 'runtime-config') }, 'dev']] as const) {
    assert.throws(() => validateMigrationTarget(target, stage), /MIGRATION_TARGET_MUST_BE_DEV_MVP/);
  }
});

test('DDL y recibo comparten transacción; repetir el runner omite migraciones ya confirmadas', async () => {
  const f = fixture();
  assert.deepEqual(await runDataApiMigrations(config, 'dev', sources, f.transport), { applied: ['001', '002'], skipped: [] });
  assert.equal(f.receipts().length, 2);
  const create = f.statements.find((s) => s.sql?.startsWith('CREATE TABLE sample'))!;
  const receipt = f.statements.find((s) => s.sql?.startsWith('INSERT INTO public.cuentas_pagar_schema_migrations'))!;
  assert.equal(create.transactionId, receipt.transactionId);
  assert.ok(f.statements.every((s) => s.transactionId && s.continueAfterTimeout === false));
  const writes = f.statements.length;
  assert.deepEqual(await runDataApiMigrations(config, 'dev', sources, f.transport), { applied: [], skipped: ['001', '002'] });
  assert.ok(!f.statements.slice(writes).some((s) => /^(CREATE TABLE sample|ALTER TABLE sample|INSERT INTO public.cuentas_pagar_schema_migrations)/.test(s.sql!)));
});

test('fallo SQL revierte sólo la migración fallida y permite retomar sin repetir la anterior', async () => {
  const f = fixture(), original = f.transport.execute;
  f.transport.execute = async (input) => {
    if (input.sql?.startsWith('ALTER TABLE sample')) throw new Error('private password SQL data');
    return original(input);
  };
  await assert.rejects(runDataApiMigrations(config, 'dev', sources, f.transport), (error: unknown) => {
    assert.ok(error instanceof MigrationFailure);
    assert.equal(error.message, 'MIGRATION_OPERATION_FAILED 002 statement=1');
    assert.ok(!JSON.stringify(error).includes('private')); return true;
  });
  assert.equal(f.receipts().length, 1);
  assert.ok(f.actions.includes('rollback:tx-2'));
  f.transport.execute = original;
  assert.deepEqual(await runDataApiMigrations(config, 'dev', sources, f.transport), { applied: ['002'], skipped: ['001'] });
});

test('commit ambiguo detiene el lote y un próximo run resuelve mediante el recibo atómico', async () => {
  const f = fixture(), commit = f.transport.commit;
  f.transport.commit = async (input) => { await commit(input); throw new Error('response lost'); };
  await assert.rejects(runDataApiMigrations(config, 'dev', sources, f.transport), /MIGRATION_COMMIT_UNKNOWN 001/);
  assert.deepEqual(f.actions, ['begin:tx-1', 'commit:tx-1']);
  assert.equal(f.receipts().length, 1);
  f.transport.commit = commit;
  assert.deepEqual(await runDataApiMigrations(config, 'dev', sources, f.transport), { applied: ['002'], skipped: ['001'] });
});

test('lock ocupado, drift y esquema sin recibos impiden ejecutar DDL de dominio', async () => {
  for (const mode of ['lock', 'drift', 'unmanaged'] as const) {
    const f = fixture(), original = f.transport.execute;
    if (mode === 'drift') f.setHistory([[{ stringValue: '001' }, { stringValue: sources[0]!.name }, { stringValue: 'changed' }]]);
    f.transport.execute = async (input) => {
      if (mode === 'lock' && input.sql?.includes('pg_try_advisory_xact_lock')) return { $metadata: {}, records: [[{ booleanValue: false }]] };
      if (mode === 'unmanaged' && input.sql?.includes('to_regclass')) return { $metadata: {}, records: [[{ stringValue: 'tenants' }]] };
      return original(input);
    };
    await assert.rejects(runDataApiMigrations(config, 'dev', sources, f.transport),
      new RegExp({ lock: 'MIGRATION_RUNNER_BUSY', drift: 'MIGRATION_HISTORY_DRIFT', unmanaged: 'MIGRATION_UNMANAGED_SCHEMA' }[mode]));
    assert.ok(!f.statements.some((s) => s.sql?.startsWith('CREATE TABLE sample')));
    assert.ok(f.actions.includes('rollback:tx-1'));
  }
});

test('CLI por defecto muestra un plan offline y --apply exige configuración explícita', () => {
  const env = { ...process.env, DEPLOYMENT_STAGE: '', DATABASE_CLUSTER_ARN: '', DATABASE_CREDENTIALS_SECRET_ARN: '', DATABASE_NAME: '',
    AWS_EC2_METADATA_DISABLED: 'true' };
  const plan = execFileSync(process.execPath, ['dist/scripts/migrations/data-api-cli.js'], { encoding: 'utf8', env });
  assert.ok(plan.includes('no consulta AWS'));
  assert.equal(plan.split('\n').filter((line) => /^\d{3} /.test(line)).length, 8);
  const apply = spawnSync(process.execPath, ['dist/scripts/migrations/data-api-cli.js', '--apply'], { encoding: 'utf8', env });
  assert.equal(apply.status, 1);
  assert.equal(apply.stderr.trim(), 'MIGRATION_TARGET_MUST_BE_DEV_MVP');
});
