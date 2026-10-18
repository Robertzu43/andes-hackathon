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
import { demoRoutes, type DemoIssuer } from '../demo.js';
import { insightRoutes } from '../insights/routes.js';
declare module 'fastify' { interface FastifyRequest { actor: Actor } }
export interface AppOptions { ctx: Context; auth: AuthConfig; channelSupport?: ChannelSupport[]; callbackConfig?: CallbackConfig; demo?: DemoIssuer; automaticChecks?: boolean }
export function createApp({ ctx, auth, channelSupport = [], callbackConfig, demo, automaticChecks = false }: AppOptions) {
  const authenticate = authenticator(auth);
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024, requestTimeout: 10000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  app.decorateRequest('actor');
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (demo && request.routeOptions.url === '/v1/demo/session') return;
    if (request.routeOptions.url === '/health' || request.routeOptions.url === '/v1/insights/hotspots' || request.routeOptions.url === '/mapa' || (callbackConfig && request.routeOptions.url === '/v1/callbacks/zavu')) return;
    const telemetry = request.routeOptions.url?.endsWith('/locations') || request.routeOptions.url?.endsWith('/snapshot');
    request.actor = await authenticate(request.headers.authorization, telemetry || request.routeOptions.config.clientRead ? ctx.telemetryPool : ctx.pool, ctx.clock());
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
  clientReadRoutes(app, ctx);
  tripRoutes(app, ctx, automaticChecks); contactRoutes(app, ctx); locationRoutes(app, ctx); incidentRoutes(app, ctx, channelSupport); insightRoutes(app, ctx, Boolean(demo));
  if (callbackConfig) callbackRoutes(app, ctx, callbackConfig);
  return app;
}
