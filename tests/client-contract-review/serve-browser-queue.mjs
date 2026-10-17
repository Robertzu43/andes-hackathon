// Loopback-only static fixture; exposes only the reviewed queue and this probe.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.ANDES_REVIEW_QUEUE_ROOT;
const port = Number(process.env.ANDES_REVIEW_BROWSER_PORT);
assert.ok(root && Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
const allowed = new Set(['index.mjs', 'idb-store.mjs', 'store.mjs', 'queue.mjs', 'upload.mjs', 'pipeline.mjs']);
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    let content;
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      content = '<!doctype html><html lang="en"><meta charset="utf-8"><title>ANDES reviewer storage fixture</title>'
        + '<h1>Reviewer storage fixture</h1><p>Synthetic records. Native IndexedDB. Upload transport stays in this browser.</p>'
        + '<pre>Opening native storage...</pre><script type="module" src="/probe.mjs"></script></html>';
    } else if (url.pathname === '/probe.mjs') {
      response.setHeader('Content-Type', 'text/javascript');
      content = await readFile(fileURLToPath(new URL('./browser-queue.probes.mjs', import.meta.url)));
    } else if (url.pathname.startsWith('/candidate/') && allowed.has(basename(url.pathname))
      && url.pathname === `/candidate/${basename(url.pathname)}`) {
      response.setHeader('Content-Type', 'text/javascript');
      content = await readFile(resolve(root, 'web/src/lib/observations', basename(url.pathname)));
    } else { response.writeHead(404); response.end(); return; }
    response.writeHead(200); response.end(content);
  } catch { response.writeHead(500); response.end('Reviewer fixture failed; details withheld.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Reviewer queue fixture ready at http://127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
