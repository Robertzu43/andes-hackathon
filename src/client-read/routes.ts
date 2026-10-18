import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Actor } from '../contracts.js';
import { readTransaction, type Context } from '../db.js';
import { recipientReadRoutes } from './recipient.js';

const TRUCK_LIMIT = 100;
const CONTACT_LIMIT = 100;
const ACTIVE_TRIP_LIMIT = 50;
const RECENT_TRIP_LIMIT = 20;

type Client = pg.PoolClient;
type Row = pg.QueryResultRow;

const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;

async function readProfile(client: Client, actor: Actor) {
  const row = (await client.query('SELECT id,phone,phone_verified FROM identities WHERE id=$1', [actor.id])).rows[0] as Row | undefined;
  return { id: actor.id, phone: row?.phone ?? null, phoneVerified: row?.phone_verified ?? actor.phoneVerified };
}

async function readTrucks(client: Client, actor: Actor) {
  const rows = (await client.query('SELECT id,label FROM trucks WHERE driver_id=$1 ORDER BY label,id LIMIT $2', [actor.id, TRUCK_LIMIT + 1])).rows as Row[];
  return { trucks: rows.slice(0, TRUCK_LIMIT).map(row => ({ id: row.id, label: row.label })), limit: TRUCK_LIMIT, hasMore: rows.length > TRUCK_LIMIT };
}

async function readContacts(client: Client, actor: Actor) {
  const rows = (await client.query(`SELECT id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,revoked_at,revoked_by,driver_id
    FROM contact_grants WHERE driver_id=$1 ORDER BY phone,id LIMIT $2`, [actor.id, CONTACT_LIMIT + 1])).rows as Row[];
  return {
    contacts: rows.slice(0, CONTACT_LIMIT).map(row => ({
      id: row.id,
      contactId: row.contact_id,
      phone: row.phone,
      map: { requested: row.map_requested, accepted: row.map_accepted },
      incident: { requested: row.incident_requested, accepted: row.incident_accepted },
      status: row.revoked_at ? 'revoked' : row.accepted_at ? 'accepted' : 'pending',
      acceptedAt: iso(row.accepted_at),
      revokedAt: iso(row.revoked_at),
      revokedBy: row.revoked_by ? (row.revoked_by === row.driver_id ? 'driver' : 'contact') : null
    })),
    limit: CONTACT_LIMIT,
    hasMore: rows.length > CONTACT_LIMIT
  };
}

function tripSummary(row: Row) {
  return {
    id: row.id,
    truckId: row.truck_id,
    origin: row.origin,
    destination: row.destination,
    country: row.country,
    locale: row.locale,
    timeZone: row.time_zone,
    status: row.status,
    mapActive: row.map_active,
    checkinsActive: row.checkins_active,
    paused: row.paused,
    version: row.version,
    createdAt: iso(row.created_at),
    closedAt: iso(row.closed_at),
    contactGrantIds: row.contact_grant_ids
  };
}

const tripSelect = `SELECT t.id,t.truck_id,t.origin,t.destination,t.country,t.locale,t.time_zone,t.status,t.map_active,t.checkins_active,t.paused,t.version,t.created_at,t.closed_at,
  COALESCE((SELECT array_agg(tg.grant_id ORDER BY tg.grant_id) FROM trip_grants tg WHERE tg.trip_id=t.id), '{}') AS contact_grant_ids
  FROM trips t WHERE t.driver_id=$1`;

async function readTrips(client: Client, actor: Actor) {
  const activeRows = (await client.query(`${tripSelect} AND t.status='active' ORDER BY t.created_at DESC,t.id DESC LIMIT $2`, [actor.id, ACTIVE_TRIP_LIMIT + 1])).rows as Row[];
  const recentRows = (await client.query(`${tripSelect} AND t.status<>'active' ORDER BY COALESCE(t.closed_at,t.created_at) DESC,t.id DESC LIMIT $2`, [actor.id, RECENT_TRIP_LIMIT + 1])).rows as Row[];
  return {
    active: activeRows.slice(0, ACTIVE_TRIP_LIMIT).map(tripSummary),
    recent: recentRows.slice(0, RECENT_TRIP_LIMIT).map(tripSummary),
    limits: { active: ACTIVE_TRIP_LIMIT, recent: RECENT_TRIP_LIMIT },
    hasMore: { active: activeRows.length > ACTIVE_TRIP_LIMIT, recent: recentRows.length > RECENT_TRIP_LIMIT }
  };
}

export function clientReadRoutes(app: FastifyInstance, ctx: Context) {
  app.get('/v1/profile', request => {
    const readAt = iso(ctx.clock());
    return readTransaction(ctx.pool, async client => ({ ...(await readProfile(client, request.actor)), readAt }));
  });
  app.get('/v1/trucks', request => {
    const readAt = iso(ctx.clock());
    return readTransaction(ctx.pool, async client => ({ ...(await readTrucks(client, request.actor)), readAt }));
  });
  app.get('/v1/contacts', request => {
    const readAt = iso(ctx.clock());
    return readTransaction(ctx.pool, async client => ({ ...(await readContacts(client, request.actor)), readAt }));
  });
  app.get('/v1/trips', request => {
    const readAt = iso(ctx.clock());
    return readTransaction(ctx.pool, async client => ({ ...(await readTrips(client, request.actor)), readAt }));
  });
  app.get('/v1/bootstrap', request => {
    const readAt = iso(ctx.clock());
    return readTransaction(ctx.pool, async client => {
      const profile = await readProfile(client, request.actor);
      const trucks = await readTrucks(client, request.actor);
      const contacts = await readContacts(client, request.actor);
      const trips = await readTrips(client, request.actor);
      return {
        profile,
        trucks: trucks.trucks,
        contacts: contacts.contacts,
        trips: { active: trips.active, recent: trips.recent },
        limits: { trucks: trucks.limit, contacts: contacts.limit, activeTrips: trips.limits.active, recentTrips: trips.limits.recent },
        hasMore: { trucks: trucks.hasMore, contacts: contacts.hasMore, activeTrips: trips.hasMore.active, recentTrips: trips.hasMore.recent },
        readAt
      };
    });
  });
  recipientReadRoutes(app, ctx);
}
