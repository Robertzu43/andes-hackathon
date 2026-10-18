import { callbackRoutes } from '../notifications/callback.js';
import { checkRoutes } from '../checks/routes.js';
import type { CallbackConfig } from '../notifications/zavu.js';
import Fastify, { type FastifyError } from 'fastify';
import { authenticator, type AuthConfig } from '../auth.js';
import type { Actor, ChannelSupport } from '../contracts.js';
import type { Context } from '../db.js';
import { tripRoutes } from '../trips/routes.js';
import { contactRoutes } from '../contacts/routes.js';
import { locationRoutes } from '../location/routes.js';
import { incidentRoutes } from '../incidents/routes.js';
import { clientReadRoutes } from '../client-read/routes.js';
import { recipientReadRoutes } from '../client-read/recipient.js';
import { demoRoutes, type DemoIssuer } from '../demo.js';
import { insightRoutes } from '../insights/routes.js';
import { isWebRoute, webRoutes } from './web.js';
declare module 'fastify' { interface FastifyRequest { actor: Actor } }
export interface AppOptions { ctx: Context; auth: AuthConfig; channelSupport?: ChannelSupport[]; callbackConfig?: CallbackConfig; demo?: DemoIssuer; automaticChecks?: boolean; webRoot?: string; trustProxyHops?: number }
export function createApp({ ctx, auth, channelSupport = [], callbackConfig, demo, automaticChecks = false, webRoot, trustProxyHops = 0 }: AppOptions) {
  const authenticate = authenticator(auth);
  // Fastify disables numeric trustProxy; use its function form for exactly this many hops (0 = none). Never `true`.
  const app = Fastify({ logger: false, trustProxy: trustProxyHops === 0 ? false : (_address, hop) => hop < trustProxyHops, bodyLimit: 128 * 1024, requestTimeout: 10000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  app.decorateRequest('actor');
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (demo && request.routeOptions.url === '/v1/demo/session') return;
    if (request.routeOptions.url === '/health' || request.routeOptions.url === '/v1/insights/hotspots' || request.routeOptions.url === '/mapa' || (callbackConfig && request.routeOptions.url === '/v1/callbacks/zavu')) return;
    if (isWebRoute(request)) return; // the app shell and its files are public; the API keeps its auth boundary
    const telemetry = request.routeOptions.url?.endsWith('/locations') || request.routeOptions.url?.endsWith('/snapshot');
    // Client catalog reads authenticate on the telemetry pool too, so polling never borrows SOS connections.
    request.actor = await authenticate(request.headers.authorization, telemetry || request.routeOptions.config?.clientRead ? ctx.telemetryPool : ctx.pool, ctx.clock());
  });
  app.setErrorHandler((error, _request, reply) => {
    const failure = error instanceof Error ? error as FastifyError : undefined;
    const status = failure?.statusCode && failure.statusCode >= 400 && failure.statusCode < 500 ? failure.statusCode : 500;
    const reason = status === 500 ? undefined : (failure as { reason?: string } | undefined)?.reason; // only problem() sets it
    reply.status(status).send({ code: status === 500 ? 'internal_error' : failure?.validation ? 'invalid_request' : failure?.code ?? 'invalid_request', ...(reason ? { reason } : {}) });
  });
  app.addHook('onClose', () => ctx.close());
  app.get('/health', async (_request, reply) => {
    try { await ctx.pool.query('SELECT 1'); return { status: 'ok' }; }
    catch { return reply.status(503).send({ status: 'unavailable' }); }
  });
  checkRoutes(app, ctx);
  if (demo) demoRoutes(app, ctx, demo);
  app.get('/v1/me', async request => ({ id: request.actor.id }));
  clientReadRoutes(app, ctx); recipientReadRoutes(app, ctx);
  tripRoutes(app, ctx, automaticChecks); contactRoutes(app, ctx); locationRoutes(app, ctx); incidentRoutes(app, ctx, channelSupport); insightRoutes(app, ctx, Boolean(demo));
  if (callbackConfig) callbackRoutes(app, ctx, callbackConfig);
  if (webRoot) webRoutes(app, webRoot);
  return app;
}
