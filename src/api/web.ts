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

/** Only the SPA handlers skip auth; decoded API paths still authenticate. Existing public routes keep their own exemptions. */
export function isWebRoute(request: FastifyRequest): boolean {
  return (request.routeOptions.url === '/' || request.routeOptions.url === '/*')
    && !/^v1(?:\/|$)/.test((request.params as { '*'?: string })['*'] ?? '');
}

/** Serves built files and the SPA shell from the API origin, confined to the canonical build root. */
export function webRoutes(app: FastifyInstance, root: string) {
  let indexFile: string;
  try { indexFile = realpathSync(join(root, 'index.html')); }
  catch (cause) { throw new Error('Web build requires a readable index.html', { cause }); }
  const base = realpathSync(root);
  if (!indexFile.startsWith(base + sep)) throw new Error('index.html must stay inside the web root');
  const index = readFileSync(indexFile);

  async function serve(request: FastifyRequest, reply: FastifyReply) {
    const path = (request.params as { '*'?: string })['*'] ?? ''; // the router has decoded the wildcard
    // Check decoded segments before the extensionless fallback as well as before static reads.
    if (/^v1(?:\/|$)/.test(path) || path.includes('\0') || path.split(/[\\/]/).includes('..')) problem(404, 'not_found');
    if (!extname(path)) return reply.type('text/html; charset=utf-8').send(index);
    const type = types[extname(path).toLowerCase()];
    const file = join(base, path);
    if (!type || !file.startsWith(base + sep)) problem(404, 'not_found');
    const canonicalFile = await realpath(file).catch(() => null);
    if (!canonicalFile || !canonicalFile.startsWith(base + sep)) problem(404, 'not_found');
    const body = await readFile(canonicalFile).catch(() => null);
    if (!body) problem(404, 'not_found');
    // Vite fingerprints assets; root files retain their names and must revalidate.
    reply.header('Cache-Control', path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.type(type).send(body);
  }
  app.get('/', serve);
  app.get('/*', serve);
}
