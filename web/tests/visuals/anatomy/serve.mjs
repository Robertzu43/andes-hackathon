// Isolated synthetic preview. Serves only this lane's two owned trees.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const allowed = ['web/src/visuals/anatomy/', 'web/tests/visuals/anatomy/'];
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1:3054').pathname;
  const name = pathname === '/' ? 'web/tests/visuals/anatomy/preview-es.html' : decodeURIComponent(pathname.slice(1));
  const path = resolve(root, name);
  if (!allowed.some(prefix => path.startsWith(resolve(root, prefix) + '/'))) { res.writeHead(404).end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'text/plain', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }).end(data);
  } catch { res.writeHead(404).end(); }
}).listen(3054, '127.0.0.1', () => console.log('Anatomy synthetic preview ready at http://127.0.0.1:3054'));
