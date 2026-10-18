import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { readTransaction, type Context } from '../db.js';

const INVITATION_LIMIT = 100;
const SHARED_TRIP_LIMIT = 100;

type Row = pg.QueryResultRow;

const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;

export function recipientReadRoutes(app: FastifyInstance, ctx: Context) {
  app.get('/v1/contact/invitations', request => readTransaction(ctx.pool, async client => {
    const readAt = iso(ctx.clock());
    const rows = (await client.query(
      `SELECT id,driver_id,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,revoked_at
       FROM contact_grants WHERE contact_id=$1 ORDER BY id ASC LIMIT $2`,
      [request.actor.id, INVITATION_LIMIT + 1])).rows as Row[];
    return {
      invitations: rows.slice(0, INVITATION_LIMIT).map(row => ({
        id: row.id,
        driverId: row.driver_id,
        requested: { map: row.map_requested, incident: row.incident_requested },
        accepted: { map: row.map_accepted, incident: row.incident_accepted },
        status: row.revoked_at ? 'revoked' : row.accepted_at ? 'accepted' : 'pending',
        acceptedAt: iso(row.accepted_at),
        revokedAt: iso(row.revoked_at)
      })),
      readAt,
      limit: INVITATION_LIMIT,
      hasMore: rows.length > INVITATION_LIMIT
    };
  }));

  app.get('/v1/contact/trips', request => readTransaction(ctx.pool, async client => {
    const readAt = iso(ctx.clock());
    const rows = (await client.query(
      `SELECT t.id AS trip_id, tg.grant_id, t.driver_id, t.status, t.map_active,
              g.map_accepted, g.incident_accepted, i.id AS active_incident_id
       FROM trip_grants tg
       JOIN contact_grants g ON g.id = tg.grant_id
       JOIN trips t ON t.id = tg.trip_id
       LEFT JOIN incidents i ON i.trip_id = t.id AND i.status='active'
       WHERE g.contact_id=$1
         AND g.accepted_at IS NOT NULL AND g.revoked_at IS NULL AND tg.revoked_at IS NULL
         AND (g.map_accepted OR g.incident_accepted)
         AND (t.status='active' OR (g.incident_accepted AND i.id IS NOT NULL))
       ORDER BY (g.incident_accepted AND i.id IS NOT NULL) DESC, t.created_at DESC, t.id DESC, tg.grant_id ASC
       LIMIT $2`,
      [request.actor.id, SHARED_TRIP_LIMIT + 1])).rows as Row[];
    return {
      trips: rows.slice(0, SHARED_TRIP_LIMIT).map(row => ({
        tripId: row.trip_id,
        grantId: row.grant_id,
        driverId: row.driver_id,
        status: row.status,
        scopes: {
          map: Boolean(row.map_accepted && row.status === 'active' && row.map_active),
          incident: Boolean(row.incident_accepted)
        },
        activeIncidentId: row.incident_accepted ? (row.active_incident_id ?? null) : null
      })),
      readAt,
      limit: SHARED_TRIP_LIMIT,
      hasMore: rows.length > SHARED_TRIP_LIMIT
    };
  }));
}
