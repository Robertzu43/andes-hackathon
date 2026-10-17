import type { FastifyInstance } from 'fastify';
import type { Context } from '../db.js';
import { saveCallback } from './dispatch.js';
import { verifyCallback, type CallbackConfig } from './zavu.js';
export function loadCallbackConfig(env: NodeJS.ProcessEnv): CallbackConfig | undefined {
  const values = [env.ZAVU_PROJECT_ID, env.ZAVU_SENDER_ID, env.ZAVU_CALLBACK_SECRET];
  if (values.every(value => !value)) return undefined;
  if (values.some(value => !value || value.length > 512)) throw new Error('Complete Zavu callback configuration required');
  return { projectId: values[0]!, senderId: values[1]!, secret: values[2]! };
}
export function callbackRoutes(app: FastifyInstance, ctx: Context, config: CallbackConfig) {
  app.register(async receiver => {
    receiver.removeContentTypeParser('application/json');
    receiver.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    receiver.post('/v1/callbacks/zavu', async request => {
      const header = request.headers['x-zavu-signature'];
      const raw = request.body as Buffer;
      const event = verifyCallback(raw, typeof header === 'string' ? header : undefined, config, ctx.clock());
      await saveCallback(ctx, event, raw);
      return { received: true };
    });
  });
}
