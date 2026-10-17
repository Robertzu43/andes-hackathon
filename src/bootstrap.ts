import pg from 'pg';
import { migrate, transaction } from './db.js';
/** Admin-only one-off task: never run this from API/worker startup. */
export async function bootstrap(pool: pg.Pool, username: string, password: string, schema = 'public'): Promise<void> {
  if (!username || !password || Buffer.byteLength(username) > 63) throw new Error('Valid application credentials required');
  const role = pg.escapeIdentifier(username), namespace = pg.escapeIdentifier(schema);
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(48173423)');
    const exists = (await lock.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [username])).rowCount;
    // Identifiers and credentials cannot be bind parameters in role DDL.
    await lock.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${pg.escapeLiteral(password)}`);
    await migrate(pool);
    await transaction(pool, async client => {
      const database = (await client.query('SELECT current_database() AS name')).rows[0].name as string;
      await client.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(database)} TO ${role}`);
      await client.query(`REVOKE CREATE ON SCHEMA ${namespace} FROM PUBLIC`);
      await client.query(`GRANT USAGE ON SCHEMA ${namespace} TO ${role}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${namespace} TO ${role}`);
      await client.query(`REVOKE ALL ON ${namespace}.schema_migrations FROM ${role}`);
      await client.query(`GRANT SELECT ON ${namespace}.schema_migrations TO ${role}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${namespace} TO ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${namespace} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${namespace} GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
    });
  } finally { await lock.query('SELECT pg_advisory_unlock(48173423)').catch(() => {}); lock.release(); }
}
