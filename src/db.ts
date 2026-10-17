import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { problem, type Trip } from './contracts.js';
export interface Context { pool: pg.Pool; telemetryPool: pg.Pool; clock: () => Date; close: () => Promise<void> }
export function createContext(databaseUrl: string, clock: () => Date = () => new Date()): Context {
  const config = { connectionString: databaseUrl, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000,
    statement_timeout: 5000, idle_in_transaction_session_timeout: 5000 };
  const pool = new pg.Pool({ ...config, max: 6 });
  const telemetryPool = new pg.Pool({ ...config, max: 2 });
  // Pool errors must not crash the process or leak connection strings to logs.
  pool.on('error', () => {}); telemetryPool.on('error', () => {});
  return { pool, telemetryPool, clock, close: async () => { await Promise.all([pool.end(), telemetryPool.end()]); } };
}
export async function transaction<T>(pool: pg.Pool, callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
/** Callbacks are SQL-only; release the client before any network/provider operation. */
export async function withTripTransaction<T>(ctx: Context, tripId: string, callback: (client: pg.PoolClient, trip: Trip) => Promise<T>, pool = ctx.pool): Promise<T> {
  return transaction(pool, async client => {
    const trip = (await client.query<Trip>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [tripId])).rows[0];
    if (!trip) problem(404, 'trip_not_found');
    return callback(client, trip);
  });
}
export async function migrate(pool: pg.Pool): Promise<void> {
  const sql = await readFile(new URL('../db/migrations/001-core.sql', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex');
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(48173422)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, hash text NOT NULL)');
    const existing = (await client.query('SELECT hash FROM schema_migrations WHERE version=$1', ['001-core'])).rows[0];
    if (existing) { if (existing.hash !== hash) throw new Error('Applied migration changed'); return; }
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations VALUES($1,$2)', ['001-core', hash]);
  });
}
