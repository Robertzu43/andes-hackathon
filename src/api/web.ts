import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { problem } from '../contracts.js';
// Only what a Vite build of web/ emits; any other extension is refused.
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
/** The web app's own routes: everything but the API. The auth hook skips these; every /v1 path stays authenticated. */
export function isWebRoute(request: FastifyRequest): boolean {
  return (request.routeOptions.url === '/' || request.routeOptions.url === '/*') && !/^\/v1(?:[/?]|$)/.test(request.url);
}
/** Serves the built web app from the API origin: real files by extension, index.html for every other app path. */
export function webRoutes(app: FastifyInstance, root: string) {
  const base = resolve(root);
  const index = readFileSync(join(base, 'index.html')); // read once: a missing build fails at startup
  async function serve(request: FastifyRequest, reply: FastifyReply) {
    const path = (request.params as { '*'?: string })['*'] ?? '';
    if (/^v1(?:\/|$)/.test(path)) problem(404, 'not_found');
    if (!extname(path)) return reply.type('text/html; charset=utf-8').send(index); // a client-side route
    const type = types[extname(path).toLowerCase()];
    const file = join(base, path);
    if (!type || path.includes('\0') || path.split(/[\\/]/).includes('..') || !file.startsWith(base + sep)) problem(404, 'not_found');
    const body = await readFile(file).catch(() => null);
    if (!body) problem(404, 'not_found');
    // Vite fingerprints everything under assets/; other files keep their names, so browsers revalidate them.
    reply.header('Cache-Control', path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.type(type).send(body);
  }
  app.get('/', serve);
  app.get('/*', serve);
}
