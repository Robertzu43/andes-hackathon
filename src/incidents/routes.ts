import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { owner, problem, type ChannelSupport, type Trip } from '../contracts.js';
import { withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { createIncident, fanOut } from './create.js';
import { empty, idParams, object, text } from '../api/schemas.js';
export function incidentRoutes(app: FastifyInstance, ctx: Context, support: ChannelSupport[]) {
  app.post('/v1/trips/:id/sos', { schema: { params: idParams, body: empty } }, request => withTripTransaction(ctx, (request.params as { id: string }).id, async (client, trip) => {
    owner(trip, request.actor);
    return idempotent(ctx, client, request, async () => {
      let incident = (await client.query("SELECT id,trigger FROM incidents WHERE trip_id=$1 AND status='active'", [trip.id])).rows[0];
      if (!incident) incident = { id: await createIncident(client, trip, 'sos', null, support, ctx.clock()) };
      else if (incident.trigger === 'missed_check') {
        // An explicit SOS always gets its own SOS-worded alerts: unsent missed-check work is superseded; attempted work keeps its facts.
        await client.query("UPDATE incidents SET trigger='sos',check_reason=NULL WHERE id=$1", [incident.id]);
        await client.query("UPDATE jobs SET status='cancelled',cancelled_at=$2,version=version+1,unavailable_reason='superseded_by_sos' WHERE incident_id=$1 AND status IN ('pending','claimed')", [incident.id, ctx.clock()]);
        await fanOut(client, trip, incident.id, 'sos', support, ctx.clock());
      }
      await client.query("UPDATE security_checks SET status='escalated',incident_id=$2,closed_at=$3 WHERE trip_id=$1 AND status='asking'", [trip.id, incident.id, ctx.clock()]);
      await client.query("INSERT INTO incident_events VALUES($1,$2,$3,'sos_report',NULL,$4)", [randomUUID(), incident.id, request.actor.id, ctx.clock()]);
      return { id: incident.id, tripId: trip.id, status: 'active', groupCapability: 'unavailable' };
    });
  }));
  async function withIncidentTransaction(request: FastifyRequest, operation: (client: pg.PoolClient, trip: Trip, incident: pg.QueryResultRow) => Promise<unknown>) {
    const id = (request.params as { id: string }).id;
    const row = (await ctx.pool.query('SELECT trip_id FROM incidents WHERE id=$1', [id])).rows[0];
    if (!row) problem(404, 'incident_not_found');
    return withTripTransaction(ctx, row.trip_id, async (client, trip) => {
      const incident = (await client.query('SELECT * FROM incidents WHERE id=$1 FOR UPDATE', [id])).rows[0]!;
      return operation(client, trip, incident);
    });
  }
  async function incidentContact(client: pg.PoolClient, trip: Trip, request: FastifyRequest) {
    if (!(await client.query(`SELECT 1 FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id WHERE tg.trip_id=$1 AND tg.revoked_at IS NULL AND cg.contact_id=$2 AND cg.accepted_at IS NOT NULL AND cg.revoked_at IS NULL AND cg.incident_accepted`, [trip.id, request.actor.id])).rowCount) problem(403, 'forbidden');
  }
  async function mutateIncident(request: FastifyRequest, operation: (client: pg.PoolClient, trip: Trip, incident: pg.QueryResultRow) => Promise<unknown>) {
    return withIncidentTransaction(request, (client, trip, incident) => idempotent(ctx, client, request, () => operation(client, trip, incident)));
  }
  app.get('/v1/incidents/:id', { schema: { params: idParams } }, request => withIncidentTransaction(request, async (client, trip, incident) => {
    if (trip.driver_id !== request.actor.id) await incidentContact(client, trip, request);
    return { id: incident.id, tripId: trip.id, status: incident.status, createdAt: incident.created_at, resolvedAt: incident.resolved_at, groupCapability: 'unavailable' };
  }));
  for (const kind of ['acknowledgements', 'actions'] as const) {
    app.post(`/v1/incidents/:id/${kind}`, { schema: { params: idParams, body: kind === 'actions' ? object({ action: text }) : empty } }, request => mutateIncident(request, async (client, trip, incident) => {
      await incidentContact(client, trip, request);
      if (incident.status !== 'active') problem(409, 'incident_resolved');
      const eventKind = kind === 'actions' ? 'action' : 'acknowledged';
      await client.query('INSERT INTO incident_events VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), incident.id, request.actor.id, eventKind, kind === 'actions' ? (request.body as { action: string }).action : null, ctx.clock()]);
      return { id: incident.id, status: 'active', recorded: eventKind };
    }));
  }
  app.post('/v1/incidents/:id/resolve', { schema: { params: idParams, body: empty } }, request => mutateIncident(request, async (client, trip, incident) => {
    owner(trip, request.actor);
    if (incident.status === 'active') {
      await client.query("UPDATE incidents SET status='resolved',resolved_at=$2,resolved_by=$3 WHERE id=$1", [incident.id, ctx.clock(), request.actor.id]);
      await client.query(`UPDATE jobs SET status='cancelled',cancelled_at=$2,version=version+1 WHERE incident_id=$1 AND status IN ('pending','claimed')`, [incident.id, ctx.clock()]);
      await client.query("INSERT INTO incident_events VALUES($1,$2,$3,'resolved',NULL,$4)", [randomUUID(), incident.id, request.actor.id, ctx.clock()]);
    }
    return { id: incident.id, status: 'resolved' };
  }));
}
