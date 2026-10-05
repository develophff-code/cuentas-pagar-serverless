/** Separador para migraciones PostgreSQL: conserva funciones y literales completos. */
export function splitSqlStatements(source: string): string[] {
  const sql = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const statements: string[] = [];
  let current = '', index = 0;
  const flush = () => { if (current.trim()) statements.push(current.trim()); current = ''; };
  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      index = end < 0 ? sql.length : end + 1;
      current += '\n'; continue;
    }
    if (sql.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < sql.length && depth) {
        if (sql.startsWith('/*', index)) { depth++; index += 2; }
        else if (sql.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error('MIGRATION_SQL_UNTERMINATED_COMMENT');
      current += ' '; continue;
    }
    const quote = sql[index];
    if (quote === "'" || quote === '"') {
      const start = index++;
      const escaped = quote === "'" && /[eE]/.test(sql[start - 1] ?? '')
        && !/[\w$]/.test(sql[start - 2] ?? '');
      let closed = false;
      while (index < sql.length) {
        if (escaped && sql[index] === '\\') { index += 2; continue; }
        if (sql[index++] === quote) {
          if (sql[index] === quote) { index++; continue; }
          closed = true; break;
        }
      }
      if (!closed) throw new Error('MIGRATION_SQL_UNTERMINATED_QUOTE');
      current += sql.slice(start, index); continue;
    }
    const dollar = !/[\w$]/.test(sql[index - 1] ?? '')
      ? sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0] : undefined;
    if (dollar) {
      const end = sql.indexOf(dollar, index + dollar.length);
      if (end < 0) throw new Error('MIGRATION_SQL_UNTERMINATED_DOLLAR_QUOTE');
      current += sql.slice(index, end + dollar.length); index = end + dollar.length; continue;
    }
    if (sql[index] === ';') { flush(); index++; continue; }
    current += sql[index++];
  }
  flush();
  return statements;
}
