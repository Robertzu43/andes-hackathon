import { readFileSync, realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { problem } from '../contracts.js';
// Only what a Vite build of web/ emits; any other extension is refused.
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
/** The web app's own routes: everything but the API. The auth hook skips these; every decoded /v1 path stays authenticated. */
export function isWebRoute(request: FastifyRequest): boolean {
  return (request.routeOptions.url === '/' || request.routeOptions.url === '/*') && !/^v1(?:\/|$)/.test((request.params as { '*'?: string })['*'] ?? '');
}
/** Serves the built web app from the API origin: real files by extension, index.html for every other app path. */
export function webRoutes(app: FastifyInstance, root: string) {
  let indexFile: string;
  try { indexFile = realpathSync(join(root, 'index.html')); }
  catch (cause) { throw new Error('Web build requires a readable index.html', { cause }); }
  const base = realpathSync(root); // canonical root, so a sibling with the same prefix cannot match
  if (!indexFile.startsWith(base + sep)) throw new Error('index.html must stay inside the web root');
  const index = readFileSync(indexFile);
  async function serve(request: FastifyRequest, reply: FastifyReply) {
    const path = (request.params as { '*'?: string })['*'] ?? ''; // the router has already decoded the wildcard
    if (/^v1(?:\/|$)/.test(path) || path.includes('\0') || path.split(/[\\/]/).includes('..')) problem(404, 'not_found');
    if (!extname(path)) return reply.type('text/html; charset=utf-8').send(index); // a client-side route
    const type = types[extname(path).toLowerCase()];
    const file = join(base, path);
    if (!type || !file.startsWith(base + sep)) problem(404, 'not_found');
    const canonical = await realpath(file).catch(() => null);
    if (!canonical || !canonical.startsWith(base + sep)) problem(404, 'not_found');
    const body = await readFile(canonical).catch(() => null);
    if (!body) problem(404, 'not_found');
    // Vite fingerprints everything under assets/; other files keep their names, so browsers revalidate them.
    reply.header('Cache-Control', path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.type(type).send(body);
  }
  app.get('/', serve);
  app.get('/*', serve);
}
