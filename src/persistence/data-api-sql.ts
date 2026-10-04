import type { ArgType, ColumnType, SqlQuery, SqlResultSet } from '@prisma/driver-adapter-utils';
import { ColumnTypeEnum as C, DriverAdapterError } from '@prisma/driver-adapter-utils';
import type { ColumnMetadata, ExecuteStatementCommandOutput, Field, SqlParameter } from '@aws-sdk/client-rds-data';

/** Reemplaza posiciones SQL, nunca texto entre comillas, comentarios o cuerpos dollar-quoted. */
export function bindDataApiQuery(query: SqlQuery): { sql: string; parameters: SqlParameter[] } {
  const used = new Set<number>();
  let sql = '', index = 0;
  while (index < query.sql.length) {
    const rest = query.sql.slice(index);
    const quoted = rest[0] === "'" || rest[0] === '"' ? rest[0] : undefined;
    if (quoted) {
      const start = index++;
      const escapedString = quoted === "'" && start > 0 && /[eE]/.test(query.sql[start - 1]!)
        && (start < 2 || !/[\w$]/.test(query.sql[start - 2]!));
      while (index < query.sql.length) {
        if (escapedString && query.sql[index] === '\\') { index += 2; continue; }
        if (query.sql[index++] === quoted) {
          if (query.sql[index] === quoted) { index++; continue; }
          break;
        }
      }
      sql += query.sql.slice(start, index); continue;
    }
    if (rest.startsWith('--')) {
      const end = query.sql.indexOf('\n', index);
      const stop = end === -1 ? query.sql.length : end + 1;
      sql += query.sql.slice(index, stop); index = stop; continue;
    }
    if (rest.startsWith('/*')) {
      const start = index; let depth = 1; index += 2;
      while (index < query.sql.length && depth) {
        if (query.sql.startsWith('/*', index)) { depth++; index += 2; }
        else if (query.sql.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      sql += query.sql.slice(start, index); continue;
    }
    const dollar = rest.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      const end = query.sql.indexOf(dollar, index + dollar.length);
      if (end === -1) throw new Error('DATA_API_SQL_INVALID');
      const stop = end + dollar.length;
      sql += query.sql.slice(index, stop); index = stop; continue;
    }
    const placeholder = rest.match(/^\$([1-9][0-9]*)/);
    if (placeholder) {
      const position = Number(placeholder[1]);
      if (position > query.args.length) throw new Error('DATA_API_BINDING_INVALID');
      used.add(position); sql += `:p${position}`; index += placeholder[0].length; continue;
    }
    sql += query.sql[index++];
  }
  if (used.size !== query.args.length) throw new Error('DATA_API_BINDING_INVALID');
  return { sql, parameters: [...used].sort((a, b) => a - b).map((position) =>
    parameter(`p${position}`, query.args[position - 1], query.argTypes[position - 1])) };
}

function parameter(name: string, value: unknown, type: ArgType | undefined): SqlParameter {
  if (value === null) return { name, value: { isNull: true } };
  if (typeof value === 'number' && (!Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('DATA_API_NUMBER_INVALID');
  // Data API no acepta parámetros array. Los modelos actuales no tienen listas SQL.
  // Rechazar explícitamente, sin convertir a texto y alterar sus garantías.
  if (type?.arity === 'list') throw new Error('DATA_API_ARRAY_PARAMETER_UNSUPPORTED');
  if (value instanceof Uint8Array) return { name, value: { blobValue: value } };
  if (value instanceof Date || type?.scalarType === 'datetime') {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new Error('DATA_API_DATE_INVALID');
    return { name, value: { stringValue: date.toISOString().replace('T', ' ').replace('Z', '') }, typeHint: 'TIMESTAMP' };
  }
  if (type?.scalarType === 'decimal') return { name, value: { stringValue: String(value) }, typeHint: 'DECIMAL' };
  if (typeof value === 'bigint' || type?.scalarType === 'bigint') return { name, value: { stringValue: String(value) } };
  if (type?.scalarType === 'json') return { name, value: { stringValue: typeof value === 'string' ? value : JSON.stringify(value) }, typeHint: 'JSON' };
  if (typeof value === 'boolean') return { name, value: { booleanValue: value } };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('DATA_API_NUMBER_INVALID');
    return { name, value: Number.isInteger(value) ? { longValue: value } : { doubleValue: value } };
  }
  if (typeof value === 'string') return { name, value: { stringValue: value }, ...(type?.scalarType === 'uuid' ? { typeHint: 'UUID' as const } : {}) };
  throw new Error('DATA_API_PARAMETER_UNSUPPORTED');
}

function columnType(metadata: ColumnMetadata): ColumnType {
  const name = metadata.typeName?.toLowerCase();
  const types: Record<string, ColumnType> = {
    int2: C.Int32, smallint: C.Int32, int4: C.Int32, integer: C.Int32,
    int8: C.Int64, bigint: C.Int64, numeric: C.Numeric, decimal: C.Numeric,
    float4: C.Float, real: C.Float, float8: C.Double, 'double precision': C.Double,
    bool: C.Boolean, boolean: C.Boolean, date: C.Date, time: C.Time, timetz: C.Time,
    timestamp: C.DateTime, timestamptz: C.DateTime, 'timestamp with time zone': C.DateTime,
    'timestamp without time zone': C.DateTime, json: C.Json, jsonb: C.Json, uuid: C.Uuid, bytea: C.Bytes,
    text: C.Text, varchar: C.Text, bpchar: C.Text, char: C.Text, name: C.Text,
  };
  if (name && types[name] !== undefined) return types[name]!;
  if (metadata.type === 12 || metadata.type === 1 || metadata.type === -1) return C.Text;
  // JDBC OTHER cubre enums PostgreSQL: devolver texto, como adapter-pg.
  if (metadata.type === 1111 && name && !name.startsWith('_')) return C.Text;
  throw new DriverAdapterError({ kind: 'UnsupportedNativeDataType', type: name ?? 'unknown' });
}

function fieldValue(field: Field, type: ColumnType): unknown {
  if (field.isNull) return null;
  if (field.blobValue !== undefined) return field.blobValue;
  const value = field.stringValue ?? field.longValue ?? field.doubleValue ?? field.booleanValue;
  if (value === undefined) throw new Error('DATA_API_FIELD_UNSUPPORTED');
  if (type === C.Int32) {
    const integer = Number(value);
    if (!Number.isSafeInteger(integer) || integer < -2147483648 || integer > 2147483647) throw new Error('DATA_API_INTEGER_INVALID');
    return integer;
  }
  if (type === C.Int64 || type === C.Numeric) {
    // Se solicitó STRING: no aceptar un decimal ya convertido a double ni un
    // bigint numérico que perdió precisión antes de llegar al adaptador.
    if (typeof value === 'number' && (type === C.Numeric || !Number.isSafeInteger(value))) throw new Error('DATA_API_PRECISION_LOSS');
    return String(value);
  }
  if (type === C.DateTime) {
    const text = String(value).replace(' ', 'T');
    return /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(text) ? text : `${text}Z`;
  }
  return value;
}

export function dataApiResult(output: ExecuteStatementCommandOutput): SqlResultSet {
  const metadata = output.columnMetadata ?? [];
  const columnTypes = metadata.map(columnType);
  return {
    columnNames: metadata.map((column) => column.label ?? column.name ?? ''), columnTypes,
    rows: (output.records ?? []).map((row) => {
      if (row.length !== metadata.length) throw new Error('DATA_API_ROW_INVALID');
      return row.map((field, index) => fieldValue(field, columnTypes[index]!));
    }),
  };
}
