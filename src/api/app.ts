import { callbackRoutes } from '../notifications/callback.js';
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
declare module 'fastify' { interface FastifyRequest { actor: Actor } }
export interface AppOptions { ctx: Context; auth: AuthConfig; channelSupport?: ChannelSupport[]; callbackConfig?: CallbackConfig }
export function createApp({ ctx, auth, channelSupport = [], callbackConfig }: AppOptions) {
  const authenticate = authenticator(auth);
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024, requestTimeout: 10000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  app.decorateRequest('actor');
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.routeOptions.url === '/health' || (callbackConfig && request.routeOptions.url === '/v1/callbacks/zavu')) return;
    const telemetry = request.routeOptions.url?.endsWith('/locations') || request.routeOptions.url?.endsWith('/snapshot');
    request.actor = await authenticate(request.headers.authorization, telemetry ? ctx.telemetryPool : ctx.pool);
  });
  app.setErrorHandler((error, _request, reply) => {
    const failure = error instanceof Error ? error as FastifyError : undefined;
    const status = failure?.statusCode && failure.statusCode >= 400 && failure.statusCode < 500 ? failure.statusCode : 500;
    reply.status(status).send({ code: status === 500 ? 'internal_error' : failure?.validation ? 'invalid_request' : failure?.code ?? 'invalid_request' });
  });
  app.addHook('onClose', () => ctx.close());
  app.get('/health', async (_request, reply) => {
    try { await ctx.pool.query('SELECT 1'); return { status: 'ok' }; }
    catch { return reply.status(503).send({ status: 'unavailable' }); }
  });
  app.get('/v1/me', async request => ({ id: request.actor.id }));
  clientReadRoutes(app, ctx);
  tripRoutes(app, ctx); contactRoutes(app, ctx); locationRoutes(app, ctx); incidentRoutes(app, ctx, channelSupport);
  if (callbackConfig) callbackRoutes(app, ctx, callbackConfig);
  return app;
}
