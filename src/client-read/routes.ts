import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Actor } from '../contracts.js';
import { readTransaction, type Context } from '../db.js';
import type { ClientBootstrap, ClientContacts, ClientProfile, ClientRead, ClientTrips, ClientTripSummary, ClientTrucks } from './contracts.js';

declare module 'fastify' { interface FastifyContextConfig { clientRead?: boolean } }

const TRUCK_LIMIT = 100;
const CONTACT_LIMIT = 100;
const ACTIVE_TRIP_LIMIT = 50;
const RECENT_TRIP_LIMIT = 20;

type Client = pg.PoolClient;
type Row = pg.QueryResultRow;

const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;

function readProfile(actor: Actor): ClientProfile {
  return { id: actor.id, phoneVerified: actor.phoneVerified };
}

async function readTrucks(client: Client, actor: Actor): Promise<ClientTrucks> {
  const rows = (await client.query('SELECT id,label FROM trucks WHERE driver_id=$1 ORDER BY label,id LIMIT $2', [actor.id, TRUCK_LIMIT + 1])).rows as Row[];
  return { trucks: rows.slice(0, TRUCK_LIMIT).map(row => ({ id: row.id, label: row.label })), limit: TRUCK_LIMIT, hasMore: rows.length > TRUCK_LIMIT };
}

async function readContacts(client: Client, actor: Actor): Promise<ClientContacts> {
  const rows = (await client.query(`SELECT id,contact_id,role,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,revoked_at,revoked_by,driver_id
    FROM contact_grants cg WHERE driver_id=$1 ORDER BY id LIMIT $2`, [actor.id, CONTACT_LIMIT + 1])).rows as Row[];
  return {
    contacts: rows.slice(0, CONTACT_LIMIT).map(row => ({
      id: row.id,
      contactId: row.contact_id,
      role: row.role === 'family' || row.role === 'colleague' ? row.role : null,
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

function tripSummary(row: Row): ClientTripSummary {
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
    createdAt: row.created_at.toISOString(),
    closedAt: iso(row.closed_at),
    expectedArrivalAt: iso(row.expected_arrival_at),
    sharingStoppedAt: iso(row.sharing_stopped_at),
    contactGrantIds: row.contact_grant_ids
  };
}

const tripSelect = `SELECT t.id,t.truck_id,t.origin,t.destination,t.country,t.locale,t.time_zone,t.status,t.map_active,t.checkins_active,t.paused,t.version,t.created_at,t.closed_at,
  t.expected_arrival_at,t.sharing_stopped_at,
  COALESCE((SELECT array_agg(tg.grant_id ORDER BY tg.grant_id) FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id
    WHERE tg.trip_id=t.id AND tg.revoked_at IS NULL AND cg.revoked_at IS NULL AND cg.accepted_at IS NOT NULL
      AND (cg.map_accepted OR cg.incident_accepted)), '{}') AS contact_grant_ids
  FROM trips t WHERE t.driver_id=$1`;

async function readTrips(client: Client, actor: Actor): Promise<ClientTrips> {
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
  const options = { config: { clientRead: true } };
  app.get('/v1/profile', options, request => readSnapshot(ctx, async () => readProfile(request.actor)));
  app.get('/v1/trucks', options, request => readSnapshot(ctx, client => readTrucks(client, request.actor)));
  app.get('/v1/contacts', options, request => readSnapshot(ctx, client => readContacts(client, request.actor)));
  app.get('/v1/trips', options, request => readSnapshot(ctx, client => readTrips(client, request.actor)));
  app.get('/v1/bootstrap', options, request =>
    readSnapshot<ClientBootstrap>(ctx, async client => {
      const profile = readProfile(request.actor);
      const trucks = await readTrucks(client, request.actor);
      const contacts = await readContacts(client, request.actor);
      const trips = await readTrips(client, request.actor);
      return {
        profile,
        trucks: trucks.trucks,
        contacts: contacts.contacts,
        trips: { active: trips.active, recent: trips.recent },
        limits: { trucks: trucks.limit, contacts: contacts.limit, activeTrips: trips.limits.active, recentTrips: trips.limits.recent },
        hasMore: { trucks: trucks.hasMore, contacts: contacts.hasMore, activeTrips: trips.hasMore.active, recentTrips: trips.hasMore.recent }
      };
    }));
}

async function readSnapshot<T>(ctx: Context, read: (client: Client) => Promise<T>): Promise<ClientRead<T>> {
  return readTransaction(ctx.telemetryPool, async client => {
    // BEGIN alone does not pin the PostgreSQL snapshot; establish it before sampling readAt.
    await client.query('SELECT pg_current_snapshot()');
    const readAt = ctx.clock().toISOString();
    return { ...(await read(client)), readAt };
  });
}
