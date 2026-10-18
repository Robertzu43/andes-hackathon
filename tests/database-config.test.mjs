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

test('non-superuser database owner bootstraps twice with app DML but no DDL or migration writes', async t => {
  const {bootstrap} = await import('../dist/bootstrap.js');
  const {databaseConfig} = await import('../dist/db.js');
  assert.ok(process.env.TEST_DATABASE_URL);
  const suffix=randomUUID().replaceAll('-','');
  const database=`bootstrap_${suffix}`, owner=`migration_${suffix}`;
  const username = `app_\"'/%@_${suffix}`;
  const role = pg.escapeIdentifier(username), namespace='public';
  const password = `quotes'" and @/%? ${randomUUID()}`, ownerPassword=randomUUID();
  const admin = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});
  // Pool.end() can resolve before its clients finish their socket shutdown.
  // Wait for every scoped client before FORCE-dropping their database.
  const clientEnds=[];
  function scopedPool(config) {
    const pool=new pg.Pool(config);
    pool.on('connect',client=>clientEnds.push(new Promise(resolve=>client.once('end',resolve))));
    return pool;
  }
  let maintenance, migration;
  t.after(async()=> {
    await migration?.end();await maintenance?.end();
    await Promise.all(clientEnds);
    await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(database)} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.query(`DROP ROLE IF EXISTS ${pg.escapeIdentifier(owner)}`);await admin.end();
  });
  await admin.query(`CREATE ROLE ${pg.escapeIdentifier(owner)} LOGIN NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION PASSWORD ${pg.escapeLiteral(ownerPassword)}`);
  const url=new URL(process.env.TEST_DATABASE_URL);
  const credentials={PGHOST:url.hostname,PGPORT:url.port,PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:owner,PGPASSWORD:ownerPassword};
  maintenance=scopedPool({...databaseConfig(credentials),max:1});
  await maintenance.query(`CREATE DATABASE ${pg.escapeIdentifier(database)}`);
  migration=scopedPool({...databaseConfig({...credentials,PGDATABASE:database}),max:2});
  const attributes=(await migration.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.deepEqual(attributes,{rolsuper:false,rolcreatedb:true,rolcreaterole:true});
  assert.equal((await migration.query('SELECT pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=current_database()')).rows[0].owned,true);
  assert.equal((await migration.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS create")).rows[0].create,true);
  await bootstrap(migration,username,password,namespace);await bootstrap(migration,username,password,namespace);
  const app = scopedPool({...databaseConfig({...credentials,PGDATABASE:database,PGUSER:username,PGPASSWORD:password}),max:1});
  try {
    await app.query("INSERT INTO identities(id,issuer,subject) VALUES (gen_random_uuid(),'synthetic','bootstrap')");
    assert.equal((await app.query('SELECT count(*)::int AS n FROM identities')).rows[0].n,1);
    await assert.rejects(app.query('CREATE TABLE forbidden(id int)'),/permission denied/);
    await assert.rejects(app.query('DELETE FROM schema_migrations'),/permission denied/);
  } finally {await app.end();}
  await migration.query('CREATE TABLE future_table(id serial primary key)');
  const permissions = await migration.query('SELECT has_table_privilege($1,$2,\'INSERT\') AS insert, has_sequence_privilege($1,$3,\'USAGE\') AS sequence',[username,'public.future_table','public.future_table_id_seq']);
  assert.deepEqual(permissions.rows[0],{insert:true,sequence:true});
  for(const attribute of ['SUPERUSER','CREATEDB','CREATEROLE','REPLICATION','BYPASSRLS']) {
    await admin.query(`ALTER ROLE ${role} ${attribute}`);
    try {await assert.rejects(bootstrap(migration,username,password,namespace),/Unsafe existing application role/);}
    finally {await admin.query(`ALTER ROLE ${role} NO${attribute}`);}
  }
  await admin.query(`GRANT pg_read_all_data TO ${role}`);
  try {await assert.rejects(bootstrap(migration,username,password,namespace),/Unsafe existing application role/);}
  finally {await admin.query(`REVOKE pg_read_all_data FROM ${role}`);}
  await admin.query(`ALTER DATABASE ${pg.escapeIdentifier(database)} OWNER TO ${role}`);
  try {await assert.rejects(bootstrap(migration,username,password,namespace),/Unsafe existing application role/);}
  finally {await admin.query(`ALTER DATABASE ${pg.escapeIdentifier(database)} OWNER TO ${pg.escapeIdentifier(owner)}`);}
});
