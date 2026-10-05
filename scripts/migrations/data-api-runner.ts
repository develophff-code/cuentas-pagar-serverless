import { createHash } from 'node:crypto';
import type { ExecuteStatementCommandInput, Field, SqlParameter } from '@aws-sdk/client-rds-data';
import type { DataApiConfig, DataApiTransport } from '../../src/persistence/data-api-adapter.js';
import { splitSqlStatements } from './sql-statements.js';

export interface MigrationSource { name: string; sql: string }
export interface PreparedMigration { id: string; name: string; checksum: string; statements: readonly string[] }
export interface MigrationResult { applied: string[]; skipped: string[] }
export class MigrationFailure extends Error {
  constructor(readonly code: string, readonly migrationId?: string, readonly statementIndex?: number) {
    super([code, migrationId, statementIndex === undefined ? undefined : `statement=${statementIndex}`].filter(Boolean).join(' '));
    this.name = 'MigrationFailure';
  }
}

export function prepareMigrations(sources: readonly MigrationSource[]): PreparedMigration[] {
  if (!sources.length) throw new MigrationFailure('MIGRATION_FILES_REQUIRED');
  return [...sources].sort((a, b) => a.name.localeCompare(b.name)).map((source, index) => {
    const id = source.name.match(/^(\d{3})_[a-z0-9_]+\.sql$/)?.[1];
    if (!id || Number(id) !== index + 1) throw new MigrationFailure('MIGRATION_SEQUENCE_INVALID');
    const normalized = source.sql.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    let statements: string[];
    try { statements = splitSqlStatements(normalized); }
    catch { throw new MigrationFailure('MIGRATION_SQL_INVALID', id); }
    if (statements.shift()?.toUpperCase() !== 'BEGIN' || statements.pop()?.toUpperCase() !== 'COMMIT' || !statements.length) {
      throw new MigrationFailure('MIGRATION_TRANSACTION_WRAPPER_REQUIRED', id);
    }
    for (const statement of statements) {
      // El SDK controla BEGIN/COMMIT. No admitir instrucciones que puedan salir
      // de la transacción o que requieran psql, ni DDL no transaccional.
      if (statement.length > 65536 || /^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ABORT|VACUUM|COPY|DISCARD)\b/i.test(statement)
        || /^(?:START|PREPARE)\s+TRANSACTION\b/i.test(statement)
        || /^SET\s+(?:(?:LOCAL|SESSION)\s+)?(?:TRANSACTION|SESSION\s+CHARACTERISTICS)\b/i.test(statement)
        || /^CREATE\s+(?:DATABASE|TABLESPACE)\b/i.test(statement)
        || /^(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX|REINDEX)\s+CONCURRENTLY\b/i.test(statement)
        || !/^(?:CREATE|ALTER|INSERT|UPDATE|DELETE|SELECT|WITH|DO|DROP|COMMENT|GRANT|REVOKE)\b/i.test(statement)) {
        throw new MigrationFailure('MIGRATION_STATEMENT_UNSUPPORTED', id);
      }
    }
    return { id, name: source.name, checksum: createHash('sha256').update(normalized).digest('hex'), statements };
  });
}

/** Sólo el destino dev MVP; el secreto de runtime/YCloud nunca es un destino válido. */
export function validateMigrationTarget(config: DataApiConfig, stage: string | undefined): void {
  const cluster = config.resourceArn.match(/^arn:aws:rds:us-east-1:(\d{12}):cluster:[A-Za-z0-9-]+$/);
  const secret = config.secretArn.match(/^arn:aws:secretsmanager:us-east-1:(\d{12}):secret:cuentas-pagar\/dev\/mvp-database-credentials-[A-Za-z0-9]{6}$/);
  if (stage !== 'dev' || config.database !== 'cuentas_pagar' || !cluster || !secret || cluster[1] !== secret[1]) {
    throw new MigrationFailure('MIGRATION_TARGET_MUST_BE_DEV_MVP');
  }
}

const receiptsTable = 'public.cuentas_pagar_schema_migrations';
const createReceipts = `CREATE TABLE IF NOT EXISTS ${receiptsTable} (
  migration_id text PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;
function text(field: Field | undefined): string {
  if (typeof field?.stringValue !== 'string') throw new MigrationFailure('MIGRATION_HISTORY_INVALID');
  return field.stringValue;
}

/** Una transacción por archivo y recibo; sin reintentos de escrituras ambiguas. */
export async function runDataApiMigrations(config: DataApiConfig, stage: string | undefined,
  sources: readonly MigrationSource[], transport: DataApiTransport): Promise<MigrationResult> {
  validateMigrationTarget(config, stage);
  const migrations = prepareMigrations(sources);
  const result: MigrationResult = { applied: [], skipped: [] };
  for (const migration of migrations) {
    let transactionId: string | undefined, committing = false, rollingBack = false, statementIndex: number | undefined;
    try {
      transactionId = (await transport.begin(config)).transactionId;
      if (!transactionId) throw new MigrationFailure('MIGRATION_TRANSACTION_MISSING', migration.id);
      const execute = (sql: string, parameters?: SqlParameter[]) => transport.execute({ ...config, transactionId,
        sql, ...(parameters ? { parameters } : {}), continueAfterTimeout: false,
      } as ExecuteStatementCommandInput);
      await execute("SET LOCAL statement_timeout = '40s'");
      await execute("SET LOCAL lock_timeout = '5s'");
      await execute('SET LOCAL search_path = public');
      const lock = await execute('SELECT pg_try_advisory_xact_lock(1129333072)');
      if (lock.records?.[0]?.[0]?.booleanValue !== true) throw new MigrationFailure('MIGRATION_RUNNER_BUSY', migration.id);
      await execute(createReceipts);
      const history = (await execute(`SELECT migration_id, filename, checksum FROM ${receiptsTable} ORDER BY migration_id`)).records;
      if (!history) throw new MigrationFailure('MIGRATION_HISTORY_INVALID', migration.id);
      for (const [index, row] of history.entries()) {
        const expected = migrations[index];
        if (row.length !== 3 || !expected || text(row[0]) !== expected.id || text(row[1]) !== expected.name || text(row[2]) !== expected.checksum) {
          throw new MigrationFailure('MIGRATION_HISTORY_DRIFT', migration.id);
        }
      }
      if (!history.length) {
        // No inventar recibos para una base migrada por otro mecanismo.
        const existing = (await execute("SELECT to_regclass('public.tenants')::text")).records?.[0]?.[0];
        if (!existing?.isNull) throw new MigrationFailure('MIGRATION_UNMANAGED_SCHEMA', migration.id);
      }
      if (Number(migration.id) <= history.length) {
        rollingBack = true;
        await transport.rollback({ resourceArn: config.resourceArn, secretArn: config.secretArn, transactionId });
        transactionId = undefined; result.skipped.push(migration.id); continue;
      }
      if (Number(migration.id) !== history.length + 1) throw new MigrationFailure('MIGRATION_HISTORY_DRIFT', migration.id);
      for (const [index, statement] of migration.statements.entries()) {
        statementIndex = index + 1;
        await execute(statement);
      }
      statementIndex = undefined;
      await execute(`INSERT INTO ${receiptsTable} (migration_id, filename, checksum) VALUES (:id, :name, :checksum)`, [
        { name: 'id', value: { stringValue: migration.id } }, { name: 'name', value: { stringValue: migration.name } },
        { name: 'checksum', value: { stringValue: migration.checksum } },
      ]);
      committing = true;
      await transport.commit({ resourceArn: config.resourceArn, secretArn: config.secretArn, transactionId });
      transactionId = undefined; result.applied.push(migration.id);
    } catch (error) {
      // Un commit sin respuesta puede haber aplicado DDL + recibo: no repetirlo
      // dentro de esta ejecución. Un próximo run cotejará los recibos bajo lock.
      if (committing) throw new MigrationFailure('MIGRATION_COMMIT_UNKNOWN', migration.id);
      if (rollingBack) throw new MigrationFailure('MIGRATION_ROLLBACK_UNKNOWN', migration.id);
      if (transactionId) {
        try { await transport.rollback({ resourceArn: config.resourceArn, secretArn: config.secretArn, transactionId }); }
        catch { throw new MigrationFailure('MIGRATION_ROLLBACK_UNKNOWN', migration.id, statementIndex); }
      }
      if (error instanceof MigrationFailure) throw error;
      throw new MigrationFailure('MIGRATION_OPERATION_FAILED', migration.id, statementIndex);
    }
  }
  return result;
}
