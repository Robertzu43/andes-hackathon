import type { IncomingMessage, ServerResponse } from 'node:http';
export function unconfiguredApi(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (!request.url?.match(/^\/v1(?:\/|$)/)) return next();
  response.statusCode = 503;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify({ code: 'api_unconfigured' }));
}
