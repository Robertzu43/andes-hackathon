// Serves only the two reviewer-instrument files. No repository/private file access.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/sensitivity.html', ['sensitivity.html', 'text/html; charset=utf-8']],
  ['/probe.js', ['probe.js', 'text/javascript; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  const entry = files.get(new URL(request.url, 'http://127.0.0.1:3056').pathname);
  if (!entry || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(new URL(entry[0], import.meta.url));
    response.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500).end();
  }
});
server.listen(3056, '127.0.0.1', () => console.log('Reviewer instrument ready at http://127.0.0.1:3056/sensitivity.html'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
