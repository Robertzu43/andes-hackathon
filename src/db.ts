import pg from 'pg';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { problem, type Trip } from './contracts.js';
export interface Context { pool: pg.Pool; telemetryPool: pg.Pool; callbackPool: pg.Pool; clock: () => Date; close: () => Promise<void> }
export function databaseConfig(env: NodeJS.ProcessEnv = process.env): pg.PoolConfig {
  let connectionString = env.DATABASE_URL;
  if (!connectionString) {
    if (!env.PGHOST || !env.PGDATABASE || !env.PGUSER || !env.PGPASSWORD) throw new Error('Database URL or complete PostgreSQL components required');
    const url = new URL('postgresql://database');
    url.hostname = env.PGHOST; url.port = env.PGPORT ?? '5432';
    url.pathname = `/${encodeURIComponent(env.PGDATABASE)}`;
    url.username = encodeURIComponent(env.PGUSER); url.password = encodeURIComponent(env.PGPASSWORD);
    connectionString = url.toString();
  }
  if (!env.PGSSLROOTCERT) return { connectionString };
  // pg connection-string SSL options replace the explicit verified TLS object.
  if (env.PGSSLMODE || [...new URL(connectionString).searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl'))) throw new Error('SSL URL/environment options cannot override verified TLS');
  return { connectionString, ssl: { ca: readFileSync(env.PGSSLROOTCERT, 'utf8'), rejectUnauthorized: true } };
}
export function createContext(databaseUrl: string | pg.PoolConfig, clock: () => Date = () => new Date(), commandPoolSize = 6): Context {
  const config = { ...(typeof databaseUrl === 'string' ? { connectionString: databaseUrl } : databaseUrl), connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000,
    statement_timeout: 5000, idle_in_transaction_session_timeout: 5000 };
  const pool = new pg.Pool({ ...config, max: commandPoolSize });
  const telemetryPool = new pg.Pool({ ...config, max: 2 });
  const callbackPool = new pg.Pool({ ...config, max: 2 });
  // Pool errors must not crash the process or leak connection strings to logs.
  pool.on('error', () => {}); telemetryPool.on('error', () => {}); callbackPool.on('error', () => {});
  return { pool, telemetryPool, callbackPool, clock, close: async () => { await Promise.all([pool.end(), telemetryPool.end(), callbackPool.end()]); } };
}
export async function transaction<T>(pool: pg.Pool, callback: (client: pg.PoolClient) => Promise<T>,
  begin: 'BEGIN' | 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' = 'BEGIN'): Promise<T> {
  const client = await pool.connect();
  try { await client.query(begin); const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
/** Read-only snapshot: every statement sees the same committed state. */
export async function readTransaction<T>(pool: pg.Pool, callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return transaction(pool, callback, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
}
/** Callbacks are SQL-only; release the client before any network/provider operation. */
export async function withTripTransaction<T>(ctx: Context, tripId: string, callback: (client: pg.PoolClient, trip: Trip) => Promise<T>, pool = ctx.pool): Promise<T> {
  return transaction(pool, async client => {
    const trip = (await client.query<Trip>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [tripId])).rows[0];
    if (!trip) problem(404, 'trip_not_found');
    return callback(client, trip);
  });
}
// schema_migrations.version is the filename stem. These files are not idempotent, so a rename keeps the old stem.
const previousMigrationNames = new Map([['010-insights-provenance', '006-insights-provenance']]);
export async function migrate(pool: pg.Pool): Promise<void> {
  const directory = new URL('../db/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d{3}-[a-z-]+\.sql$/.test(name)).sort();
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(48173422)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, hash text NOT NULL)');
    for (const file of files) {
      const version = file.slice(0, -4);
      const sql = await readFile(new URL(file, directory), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const previous = previousMigrationNames.get(version);
      const found = (await client.query('SELECT version, hash FROM schema_migrations WHERE version = ANY($1::text[])', [[version, previous].filter(Boolean)])).rows;
      if (found.length > 1) throw new Error('Applied migration changed');
      const existing = found[0];
      if (existing) {
        if (existing.hash !== hash) throw new Error('Applied migration changed');
        if (existing.version !== version) await client.query('UPDATE schema_migrations SET version=$1 WHERE version=$2', [version, existing.version]);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations VALUES($1,$2)', [version, hash]);
    }
  });
}
