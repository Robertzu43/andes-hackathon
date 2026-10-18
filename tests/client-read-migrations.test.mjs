import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers/runtime.mjs';
import { migrate, transaction } from '../dist/db.js';

const published = 'c0e82a5fa81de0ac4b71ccac40b24c215d597520';
const legacyVersion = '004-client-read-indexes';
const currentVersion = '009-client-read-indexes';
const legacySql = version => execFileSync('git', ['show', `${published}:db/migrations/${version}.sql`], { encoding: 'utf8' });
const hash = sql => createHash('sha256').update(sql).digest('hex');
const currentSql = readFileSync(new URL(`../db/migrations/${currentVersion}.sql`, import.meta.url), 'utf8');
const history = async pool => (await pool.query('SELECT version,hash FROM schema_migrations ORDER BY version')).rows;
const indexes = async pool => (await pool.query(`SELECT relname,oid::text FROM pg_class
  WHERE relnamespace=current_schema()::regnamespace AND relname = ANY($1) ORDER BY relname`,
[['trucks_driver_catalog', 'contacts_driver_catalog', 'trips_driver_active_catalog', 'trips_driver_recent_catalog']])).rows;

async function publishedDatabase(t) {
  assert.ok(process.env.TEST_DATABASE_URL, 'disposable PostgreSQL required');
  const schema = `upgrade_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  // Execute the actual published SQL and store the same full-name/SHA256 receipts as its migrator.
  await transaction(pool, async client => {
    await client.query('CREATE TABLE schema_migrations(version text PRIMARY KEY, hash text NOT NULL)');
    for (const version of ['001-core', '002-dispatch', legacyVersion]) {
      const sql = legacySql(version);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations VALUES($1,$2)', [version, hash(sql)]);
    }
  });
  const owner = randomUUID();
  await pool.query('INSERT INTO identities(id,issuer,subject) VALUES($1,$2,$3)', [owner, 'https://synthetic.test', 'upgrade-driver']);
  await pool.query('INSERT INTO trucks VALUES($1,$2,$3)', [randomUUID(), owner, 'SYNTHETIC published truck']);
  return pool;
}

test('a database migrated at published c0e82a5 upgrades without replaying catalog indexes', async t => {
  const pool = await publishedDatabase(t);
  const normalize = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(legacySql(legacyVersion)), normalize(currentSql), 'the renamed migrations really have identical DDL');
  const beforeIndexes = await indexes(pool);
  assert.equal(beforeIndexes.length, 4, 'positive control: original index DDL already ran');
  const originalReceipt = (await history(pool)).find(row => row.version === legacyVersion);
  await migrate(pool);
  const after = await history(pool);
  assert.deepEqual(after.find(row => row.version === legacyVersion), originalReceipt, 'published receipt stays intact');
  assert.deepEqual(after.find(row => row.version === currentVersion), { version: currentVersion, hash: hash(currentSql) });
  assert.deepEqual(await indexes(pool), beforeIndexes, 'existing indexes keep their OIDs rather than being rebuilt');
  assert.equal((await pool.query('SELECT label FROM trucks')).rows[0].label, 'SYNTHETIC published truck');
  assert.ok((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='trips' AND column_name='expected_arrival_at'")).rowCount);
  await migrate(pool);
  assert.deepEqual(await history(pool), after, 'repeat migration is a no-op');
  assert.deepEqual(await indexes(pool), beforeIndexes);
});

test('a fresh database already migrated through 009 retains its recorded hash and indexes', async t => {
  const f = await fixture(t);
  const before = await history(f.ctx.pool);
  const beforeIndexes = await indexes(f.ctx.pool);
  assert.deepEqual(before.find(row => row.version === currentVersion), { version: currentVersion, hash: hash(currentSql) });
  assert.equal(before.some(row => row.version === legacyVersion), false);
  await migrate(f.ctx.pool);
  assert.deepEqual(await history(f.ctx.pool), before);
  assert.deepEqual(await indexes(f.ctx.pool), beforeIndexes);
});

test('a changed historical 004 receipt cannot authorize skipping the 009 migration', async t => {
  const pool = await publishedDatabase(t);
  await pool.query('UPDATE schema_migrations SET hash=$2 WHERE version=$1', [legacyVersion, '0'.repeat(64)]);
  const before = await history(pool);
  await assert.rejects(migrate(pool), /Applied migration changed/);
  assert.deepEqual(await history(pool), before, 'failed upgrade rolls back all newly applied migrations');
});
