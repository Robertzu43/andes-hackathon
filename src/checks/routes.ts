import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { owner, problem, type Trip } from '../contracts.js';
import { readTransaction, withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { idParams, object } from '../api/schemas.js';
import { latestLocation } from '../location/routes.js';
export function checkRoutes(app: FastifyInstance, ctx: Context) {
  app.post('/v1/trips/:id/sharing', { schema: { params: idParams, body: object({ state: { enum: ['stopped', 'resumed'] }, reason: { enum: ['user', 'page_hidden', 'permission_denied', 'error'] } }) } }, request => withTripTransaction(ctx, (request.params as { id: string }).id, async (client, trip) => {
    owner(trip, request.actor);
    return idempotent(ctx, client, request, async () => {
      if (trip.status !== 'active') problem(409, 'trip_closed');
      const { state, reason } = request.body as { state: 'stopped' | 'resumed'; reason: string };
      // Each stop records its own time, so a stop after an OK opens a new check.
      await client.query('UPDATE trips SET sharing_stopped_at=$2 WHERE id=$1', [trip.id, state === 'stopped' ? ctx.clock() : null]);
      // Resuming removes the condition behind a sharing-stopped check; other open checks stay.
      if (state === 'resumed') await client.query("UPDATE security_checks SET status='cancelled',closed_at=$2 WHERE trip_id=$1 AND status='asking' AND reason='sharing_stopped'", [trip.id, ctx.clock()]);
      await client.query('INSERT INTO trip_events VALUES($1,$2,$3,$4,$5)', [randomUUID(), trip.id, request.actor.id, state === 'stopped' ? `sharing_stopped:${reason}` : 'sharing_resumed', ctx.clock()]);
      return { id: trip.id, sharing: state };
    });
  }));
  // A polled read: one consistent snapshot on command capacity, no trip lock, so polls never queue behind writers or starve telemetry.
  app.get('/v1/trips/:id/status', { schema: { params: idParams } }, request => readTransaction(ctx.pool, async client => {
    const trip = (await client.query<Trip>('SELECT * FROM trips WHERE id=$1', [(request.params as { id: string }).id])).rows[0];
    if (!trip) problem(404, 'trip_not_found');
    const driver = trip.driver_id === request.actor.id;
    const grant = driver ? null : (await client.query(`SELECT cg.map_accepted,cg.incident_accepted FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id
      WHERE tg.trip_id=$1 AND tg.revoked_at IS NULL AND cg.contact_id=$2 AND cg.accepted_at IS NOT NULL AND cg.revoked_at IS NULL`, [trip.id, request.actor.id])).rows[0];
    if (!driver && !grant) problem(403, 'forbidden');
    const now = ctx.clock();
    // The check and incident are incident-scope data; map-only contacts get location alone.
    const incidentScope = driver || grant.incident_accepted;
    const check = incidentScope ? (await client.query("SELECT reason,ask_until FROM security_checks WHERE trip_id=$1 AND status='asking'", [trip.id])).rows[0] : undefined;
    const incident = incidentScope ? (await client.query('SELECT id,trigger,check_reason,status,label,created_at FROM incidents WHERE trip_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [trip.id])).rows[0] : undefined;
    // Only the current alert wave: after an SOS upgrade, its SOS alerts replace the missed-check ones on screen.
    const deliveries = incident ? (await client.query(`SELECT COALESCE(cg.role,'group') AS role,j.channel,j.status,j.unavailable_reason FROM jobs j
      LEFT JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 AND j.trigger=$2 ORDER BY role,j.channel`, [incident.id, incident.trigger])).rows : [];
    let location;
    if (trip.map_active && (driver || grant.map_accepted)) {
      const latest = await latestLocation(client, trip.id, now);
      location = { freshness: latest.freshness, ageMs: latest.ageMs, capturedAt: latest.location?.capturedAt ?? null, accuracy: latest.location?.accuracy ?? null };
    }
    return {
      trip: { status: trip.status, paused: trip.paused, expectedArrivalAt: trip.expected_arrival_at?.toISOString() ?? null },
      check: check ? { status: 'asking', reason: check.reason, askUntil: check.ask_until.toISOString() } : null,
      incident: incident ? { id: incident.id, trigger: incident.trigger, checkReason: incident.check_reason, status: incident.status, label: incident.label, createdAt: incident.created_at.toISOString() } : null,
      deliveries: deliveries.map(d => ({ role: d.role, channel: d.channel, status: d.status, unavailableReason: d.unavailable_reason })),
      location
    };
  }));
}
