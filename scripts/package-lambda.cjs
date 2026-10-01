// Allowlist de salida compilada y dependencias de producción. Nunca copiar el
// workspace, .env, perfiles AWS o archivos de configuración local al artefacto.
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
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative.startsWith('node_modules/') || entry.dev || entry.optional) continue;
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing runtime dependency: ${relative}`);
  fs.cpSync(source, path.join(output, relative), { recursive: true });
}
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
console.info('Lambda artifact prepared from compiled sources and production dependencies.');
