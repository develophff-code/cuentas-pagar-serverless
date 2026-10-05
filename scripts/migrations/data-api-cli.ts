import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AwsDataApiTransport } from '../../src/persistence/data-api-adapter.js';
import { MigrationFailure, prepareMigrations, runDataApiMigrations, validateMigrationTarget } from './data-api-runner.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--plan' && args[0] !== '--apply')) throw new MigrationFailure('MIGRATION_USE_PLAN_OR_APPLY');
  const directory = resolve(process.cwd(), 'database/migrations');
  const files = await readdir(directory);
  const sources = await Promise.all(files.filter((name) => name.endsWith('.sql')).map(async (name) => ({
    name, sql: await readFile(resolve(directory, name), 'utf8'),
  })));
  const migrations = prepareMigrations(sources);
  if (args[0] !== '--apply') {
    console.info('Plan local: no consulta AWS ni determina qué migraciones están aplicadas.');
    for (const m of migrations) console.info(`${m.id} ${m.name} statements=${m.statements.length} sha256=${m.checksum}`);
    return;
  }
  const config = { resourceArn: process.env.DATABASE_CLUSTER_ARN ?? '',
    secretArn: process.env.DATABASE_CREDENTIALS_SECRET_ARN ?? '', database: process.env.DATABASE_NAME ?? '' };
  validateMigrationTarget(config, process.env.DEPLOYMENT_STAGE);
  const result = await runDataApiMigrations(config, process.env.DEPLOYMENT_STAGE, sources, new AwsDataApiTransport());
  console.info(`Aplicadas: ${result.applied.join(', ') || 'ninguna'}. Ya registradas: ${result.skipped.join(', ') || 'ninguna'}.`);
}

main().catch((error: unknown) => {
  // Ni stack, causa del SDK, SQL ni configuración del destino en la salida.
  console.error(error instanceof MigrationFailure ? error.message : 'MIGRATION_LOCAL_OPERATION_FAILED');
  process.exitCode = 1;
});
