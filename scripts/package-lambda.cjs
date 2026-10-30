// Allowlist de salida compilada y dependencias de producción reales.
// Recorre únicamente el grafo de `dependencies` de producción desde package.json
// (excluyendo CLI de prisma, studio, engines, typescript y dialectos SQL ajenos a PostgreSQL).
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.lambda-build');
if (output !== path.join(root, '.lambda-build')) throw new Error('Invalid artifact path');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const directory of ['src', 'packages']) {
  fs.cpSync(path.join(root, 'dist', directory), path.join(output, directory), {
    recursive: true,
    filter: (source) => fs.statSync(source).isDirectory() || (source.endsWith('.js') && !source.endsWith('.test.js')),
  });
}

const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const visited = new Set();
const queue = Object.keys(pkgJson.dependencies ?? {});

while (queue.length > 0) {
  const depName = queue.shift();
  const relPath = `node_modules/${depName}`;
  if (visited.has(relPath)) continue;
  const entry = lock.packages[relPath];
  if (!entry) continue;
  visited.add(relPath);

  for (const childDep of Object.keys(entry.dependencies ?? {})) {
    queue.push(childDep);
  }
}

const NON_PG_DIALECT_FILE = /\.(mysql|sqlite|sqlserver|cockroachdb)\./i;

for (const relative of visited) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing runtime dependency: ${relative}`);
  fs.cpSync(source, path.join(output, relative), {
    recursive: true,
    dereference: true,
    filter: (srcPath) => {
      const base = path.basename(srcPath);
      if (base.endsWith('.d.ts') || base.endsWith('.d.mts') || base.endsWith('.map')) return false;
      if (NON_PG_DIALECT_FILE.test(base)) return false;
      return true;
    },
  });
}

fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
console.info('Lambda artifact prepared from compiled sources and production dependencies.');
