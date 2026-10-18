import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { owner, problem } from '../contracts.js';
import { withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { idParams, object } from '../api/schemas.js';
interface Observation { capturedAt: string; latitude: number; longitude: number; accuracy: number }
export async function latestLocation(client: pg.PoolClient, tripId: string, now: Date) {
  const row = (await client.query('SELECT * FROM latest_locations WHERE trip_id=$1', [tripId])).rows[0];
  if (!row) return { location: null, freshness: 'unavailable' as const, ageMs: null };
  const ageMs = Math.max(0, now.getTime() - row.captured_at.getTime());
  return { location: { capturedAt: row.captured_at.toISOString(), receivedAt: row.received_at.toISOString(), latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy },
    freshness: ageMs <= 120000 ? 'fresh' as const : 'stale' as const, ageMs };
}
export function locationRoutes(app: FastifyInstance, ctx: Context) {
  app.post('/v1/trips/:id/locations', { schema: { params: idParams, body: object({ observations: { type: 'array', minItems: 1, maxItems: 100, items: object({
    capturedAt: { type: 'string', format: 'date-time' }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, accuracy: { type: 'number', minimum: 0, maximum: 100000 }
  }) } }) } }, request => withTripTransaction(ctx, (request.params as { id: string }).id, async (client, trip) => {
    owner(trip, request.actor);
    return idempotent(ctx, client, request, async () => {
      if (!trip.map_active || trip.status !== 'active') problem(409, 'location_stopped');
      const now = ctx.clock(); const observations = (request.body as { observations: Observation[] }).observations;
      // shortcut: synthetic freshness/retention bounds; qualify phone cadence before live use.
      // Some RFC 3339 forms that pass the schema parse to NaN, which would slip past both bounds: fail closed.
      if (observations.some(o => { const at = Date.parse(o.capturedAt); return !Number.isFinite(at) || at > now.getTime() + 30000 || at < now.getTime() - 86400000; })) problem(400, 'capture_time_out_of_bounds');
      for (const o of observations) {
        const args = [trip.id, o.capturedAt, now, o.latitude, o.longitude, o.accuracy];
        await client.query('INSERT INTO locations VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', args);
        await client.query(`INSERT INTO latest_locations VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(trip_id) DO UPDATE SET captured_at=excluded.captured_at,received_at=excluded.received_at,latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy WHERE excluded.captured_at > latest_locations.captured_at`, args);
      }
      await client.query(`DELETE FROM locations WHERE trip_id=$1 AND (captured_at < $2 OR captured_at IN (SELECT captured_at FROM locations WHERE trip_id=$1 ORDER BY captured_at DESC OFFSET 500))`, [trip.id, new Date(now.getTime() - 86400000)]);
      return { id: trip.id, received: observations.length };
    });
  }, ctx.telemetryPool));
  app.get('/v1/trips/:id/snapshot', { schema: { params: idParams } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return withTripTransaction(ctx, (request.params as { id: string }).id, async (client, trip) => {
      if (!trip.map_active) problem(403, 'map_inactive');
      if (trip.driver_id !== request.actor.id && !(await client.query(`SELECT 1 FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id WHERE tg.trip_id=$1 AND tg.revoked_at IS NULL AND cg.contact_id=$2 AND cg.accepted_at IS NOT NULL AND cg.revoked_at IS NULL AND cg.map_accepted`, [trip.id, request.actor.id])).rowCount) problem(403, 'forbidden');
      const now = ctx.clock(); const { location, freshness, ageMs } = await latestLocation(client, trip.id, now);
      return { tripId: trip.id, location, freshness, ageMs, readAt: now.toISOString() };
    }, ctx.telemetryPool);
  });
}
