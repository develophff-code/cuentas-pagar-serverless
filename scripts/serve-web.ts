import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const PORT = 3000;
const BASE_DIR = resolve(process.cwd(), 'dist/packages/web');
const SOURCE_INDEX = resolve(process.cwd(), 'packages/web/index.html');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : (req.url?.split('?')[0] ?? '/index.html');
  const filePath = resolve(BASE_DIR, `.${urlPath}`);

  if (!filePath.startsWith(BASE_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const data = urlPath === '/index.html'
      ? await readFile(SOURCE_INDEX).catch(() => readFile(filePath))
      : await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.statusCode = 200;
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Frontend Dev Server] Servidor local disponible en: http://127.0.0.1:${PORT}`);
});
