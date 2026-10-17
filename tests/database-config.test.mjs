import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

test('AWS database components survive pinned pg parsing with verified CA TLS', async () => {
  const {databaseConfig} = await import('../dist/db.js');
  assert.equal(typeof databaseConfig, 'function');
  const config = databaseConfig({PGHOST:'database.internal',PGDATABASE:'andes unicode☃',PGUSER:'app@/user',PGPASSWORD:'p@:/%?# word',PGSSLROOTCERT:'infra/rds-global-bundle.pem'});
  const client = new pg.Client(config);
  assert.equal(client.connectionParameters.user, 'app@/user');
  assert.equal(client.connectionParameters.password, 'p@:/%?# word');
  assert.equal(client.connectionParameters.database, 'andes unicode☃');
  assert.equal(client.ssl.rejectUnauthorized, true);
  assert.equal(client.ssl.ca, readFileSync('infra/rds-global-bundle.pem','utf8'));
  assert.throws(() => databaseConfig({DATABASE_URL:'postgres://a:b@host/db?sslmode=no-verify',PGSSLROOTCERT:'infra/rds-global-bundle.pem'}), /SSL/);
  assert.throws(() => databaseConfig({PGHOST:'host',PGDATABASE:'db',PGUSER:'u',PGPASSWORD:'p',PGSSLMODE:'no-verify',PGSSLROOTCERT:'infra/rds-global-bundle.pem'}), /SSL/);
  assert.deepEqual(databaseConfig({DATABASE_URL:'postgres://localhost/test'}), {connectionString:'postgres://localhost/test'});
});

test('retryable admin bootstrap grants app DML, never DDL or migration-bookkeeping writes', async t => {
  const {bootstrap} = await import('../dist/bootstrap.js');
  assert.ok(process.env.TEST_DATABASE_URL);
  const schema = `bootstrap_${randomUUID().replaceAll('-','')}`;
  const username = `app_\"'/%@_${randomUUID().replaceAll('-','')}`;
  const role = pg.escapeIdentifier(username);
  const password = `quotes'" and @/%? ${randomUUID()}`;
  const admin = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:2});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
  const migration = new pg.Pool({connectionString:url.toString(),max:2});
  t.after(async()=> {await migration.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.query(`DROP OWNED BY ${role}`);await admin.query(`DROP ROLE ${role}`);await admin.end();});
  await bootstrap(migration,username,password,schema);await bootstrap(migration,username,password,schema);
  const {databaseConfig} = await import('../dist/db.js');
  const app = new pg.Pool({...databaseConfig({PGHOST:url.hostname,PGPORT:url.port,PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:username,PGPASSWORD:password}),options:`-c search_path=${schema}`,max:1});
  try {
    await app.query(`INSERT INTO ${schema}.identities(id,issuer,subject) VALUES (gen_random_uuid(),'synthetic','bootstrap')`);
    assert.equal((await app.query(`SELECT count(*)::int AS n FROM ${schema}.identities`)).rows[0].n,1);
    await assert.rejects(app.query(`CREATE TABLE ${schema}.forbidden(id int)`),/permission denied/);
    await assert.rejects(app.query(`DELETE FROM ${schema}.schema_migrations`),/permission denied/);
  } finally {await app.end();}
  await migration.query(`CREATE TABLE ${schema}.future_table(id serial primary key)`);
  const permissions = await admin.query('SELECT has_table_privilege($1,$2,\'INSERT\') AS insert, has_sequence_privilege($1,$3,\'USAGE\') AS sequence',[username,`${schema}.future_table`,`${schema}.future_table_id_seq`]);
  assert.deepEqual(permissions.rows[0],{insert:true,sequence:true});
});
