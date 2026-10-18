import type { IncomingMessage, ServerResponse } from 'node:http';
export function unconfiguredApi(request: IncomingMessage, response: ServerResponse, next: () => void) {
  let pathname: string;
  try { pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname; }
  catch { return next(); }
  if (pathname !== '/v1' && !pathname.startsWith('/v1/')) return next();
  response.statusCode = 503;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify({ code: 'api_unconfigured' }));
}
