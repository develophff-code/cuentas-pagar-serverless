import {
  RDSDataClient, ExecuteStatementCommand, BeginTransactionCommand, CommitTransactionCommand, RollbackTransactionCommand,
  type ExecuteStatementCommandInput, type ExecuteStatementCommandOutput,
  type BeginTransactionCommandInput, type BeginTransactionCommandOutput,
  type CommitTransactionCommandInput, type RollbackTransactionCommandInput,
} from '@aws-sdk/client-rds-data';
import { DriverAdapterError, type IsolationLevel, type SqlDriverAdapterFactory, type SqlDriverAdapter,
  type SqlQuery, type Transaction, type SqlQueryable } from '@prisma/driver-adapter-utils';
import { bindDataApiQuery, dataApiResult } from './data-api-sql.js';

export interface DataApiConfig { resourceArn: string; secretArn: string; database: string }
export interface DataApiTransport {
  execute(input: ExecuteStatementCommandInput): Promise<ExecuteStatementCommandOutput>;
  begin(input: BeginTransactionCommandInput): Promise<BeginTransactionCommandOutput>;
  commit(input: CommitTransactionCommandInput): Promise<void>;
  rollback(input: RollbackTransactionCommandInput): Promise<void>;
}

/** SDK sin reintentos automáticos de escrituras cuyo resultado pudo perderse. */
export class AwsDataApiTransport implements DataApiTransport {
  constructor(
    private readonly client = new RDSDataClient({ maxAttempts: 1,
      requestHandler: { requestTimeout: 50_000, connectionTimeout: 5000 } }),
    private readonly delay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  private async resume<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); } catch (error) {
        // AWS confirma que esta petición no ejecutó SQL mientras reanuda la base.
        if (!(error instanceof Error) || error.name !== 'DatabaseResumingException' || attempt >= 4) throw error;
        await this.delay(1000 * 2 ** attempt);
      }
    }
  }
  execute(input: ExecuteStatementCommandInput) { return this.resume(() => this.client.send(new ExecuteStatementCommand(input))); }
  begin(input: BeginTransactionCommandInput) { return this.resume(() => this.client.send(new BeginTransactionCommand(input))); }
  async commit(input: CommitTransactionCommandInput) { await this.client.send(new CommitTransactionCommand(input)); }
  async rollback(input: RollbackTransactionCommandInput) { await this.client.send(new RollbackTransactionCommand(input)); }
}

function sanitize(error: unknown): never {
  if (error instanceof DriverAdapterError) throw error;
  const state = error instanceof Error ? error.message.match(/SQLState\s*:\s*([0-9A-Z]{5})/i)?.[1]?.toUpperCase() : undefined;
  // Conservar códigos que Prisma usa para idempotencia/conflictos, sin detalles,
  // parámetros SQL ni mensajes de PostgreSQL que pueden contener datos personales.
  if (state === '23505') throw new DriverAdapterError({ kind: 'UniqueConstraintViolation' });
  if (state === '23503') throw new DriverAdapterError({ kind: 'ForeignKeyConstraintViolation' });
  if (state === '23502') throw new DriverAdapterError({ kind: 'NullConstraintViolation' });
  if (state === '40001' || state === '40P01') throw new DriverAdapterError({ kind: 'TransactionWriteConflict' });
  throw new Error('DATA_API_OPERATION_FAILED');
}

class DataApiQueryable implements SqlQueryable {
  readonly provider = 'postgres' as const;
  readonly adapterName = 'cuentas-pagar/data-api';
  constructor(protected readonly config: DataApiConfig, protected readonly transport: DataApiTransport,
    protected readonly transactionId?: string) {}
  protected async execute(query: SqlQuery) {
    try {
      return await this.transport.execute({ ...this.config, ...bindDataApiQuery(query),
        includeResultMetadata: true, resultSetOptions: { decimalReturnType: 'STRING', longReturnType: 'STRING' },
        ...(this.transactionId ? { transactionId: this.transactionId } : {}),
      });
    } catch (error) { return sanitize(error); }
  }
  async queryRaw(query: SqlQuery) { return dataApiResult(await this.execute(query)); }
  async executeRaw(query: SqlQuery) { return (await this.execute(query)).numberOfRecordsUpdated ?? 0; }
}

class DataApiTransaction extends DataApiQueryable implements Transaction {
  readonly options = { usePhantomQuery: true };
  private closed = false;
  private checkOpen() { if (this.closed) throw new DriverAdapterError({ kind: 'TransactionAlreadyClosed', cause: 'DATA_API_TRANSACTION_CLOSED' }); }
  protected override async execute(query: SqlQuery) { this.checkOpen(); return super.execute(query); }
  async commit() {
    this.checkOpen(); this.closed = true;
    try { await this.transport.commit({ resourceArn: this.config.resourceArn, secretArn: this.config.secretArn, transactionId: this.transactionId! }); }
    catch (error) { sanitize(error); }
  }
  async rollback() {
    if (this.closed) return;
    this.closed = true;
    try { await this.transport.rollback({ resourceArn: this.config.resourceArn, secretArn: this.config.secretArn, transactionId: this.transactionId! }); }
    catch (error) { sanitize(error); }
  }
}

class DataApiAdapter extends DataApiQueryable implements SqlDriverAdapter {
  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    const allowed: IsolationLevel[] = ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'];
    if (isolationLevel && !allowed.includes(isolationLevel)) throw new DriverAdapterError({ kind: 'InvalidIsolationLevel', level: isolationLevel });
    let transaction: DataApiTransaction | undefined;
    try {
      const result = await this.transport.begin(this.config);
      if (!result.transactionId) throw new Error('DATA_API_TRANSACTION_ID_MISSING');
      transaction = new DataApiTransaction(this.config, this.transport, result.transactionId);
      if (isolationLevel) await transaction.executeRaw({ sql: `SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`, args: [], argTypes: [] });
      return transaction;
    } catch (error) {
      if (transaction) await transaction.rollback().catch(() => undefined);
      return sanitize(error);
    }
  }
  getConnectionInfo() { return { schemaName: 'public', supportsRelationJoins: false, maxBindValues: 1000 }; }
  async executeScript(): Promise<void> { throw new Error('DATA_API_USE_MIGRATION_RUNNER'); }
  async dispose(): Promise<void> { /* HTTP sin pool ni sesiones persistentes. */ }
}

/** Adaptador local para Prisma 7.10; mantiene los servicios de dominio existentes. */
export class PrismaDataApi implements SqlDriverAdapterFactory {
  readonly provider = 'postgres' as const;
  readonly adapterName = 'cuentas-pagar/data-api';
  constructor(private readonly config: DataApiConfig, private readonly transport: DataApiTransport = new AwsDataApiTransport()) {
    if (!config.resourceArn || !config.secretArn || !config.database) throw new Error('DATA_API_CONFIG_REQUIRED');
  }
  async connect(): Promise<SqlDriverAdapter> { return new DataApiAdapter(this.config, this.transport); }
}
