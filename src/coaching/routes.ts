import type { FastifyInstance, FastifyReply } from 'fastify';
import { problem } from '../contracts.js';
import { object } from '../api/schemas.js';
import { CoachingMemoryUnavailable, noteSchema, type CoachingMemory } from './memory.js';
// No database transaction or pool is held while the provider answers; the note never gates a trip or an alert.
// Saves are upserts and deletes are idempotent by construction, so no idempotency row is written.
export function coachingRoutes(app: FastifyInstance, memory: CoachingMemory | undefined) {
  async function provider<T>(reply: FastifyReply, operation: (memory: CoachingMemory) => Promise<T>) {
    if (!memory) problem(409, 'memory_not_configured');
    try { return await operation(memory); }
    catch (error) {
      if (!(error instanceof CoachingMemoryUnavailable)) throw error;
      return reply.status(503).send({ code: 'memory_unavailable' }); // the write may or may not have reached the provider
    }
  }
  app.get('/v1/coaching/note', async (request, reply) => {
    if (!memory) return { available: false };
    return provider(reply, async m => ({ available: true, note: await m.read(request.actor.id) }));
  });
  // Explicit consent on every save: the driver chooses to keep this text beyond the trip.
  app.post<{ Body: { text: string; consent: true } }>('/v1/coaching/note', { schema: { body: object({ text: noteSchema, consent: { const: true } }) } }, async (request, reply) => {
    const { text } = request.body;
    return provider(reply, async m => ({ saved: true, note: await m.save(request.actor.id, text.trim()) }));
  });
  app.post('/v1/coaching/note/delete', { schema: { body: object({}) } }, async (request, reply) =>
    provider(reply, async m => ({ deleted: await m.remove(request.actor.id) })));
}
