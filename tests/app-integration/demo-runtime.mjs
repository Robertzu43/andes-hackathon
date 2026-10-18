// Explicit launcher smoke, not acceptance of this provisional backend or a UI receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import {writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {startDemoFixture, assertDemoSource} from '../../scripts/app-integration/demo-fixture.mjs';
import {stop, testEnvironment} from '../../scripts/app-integration/runtime.mjs';

test('an explicit actual-demo candidate is required before resource allocation', async () => {
  await assert.rejects(startDemoFixture(), /explicit full backend commit/);
  await assert.rejects(startDemoFixture({backendSha: 'dfa308b3b745a3342891ebcc0771f32a30862d5a'}), /backend Git object/);
});

test('actual HTTP personas share one persisted world, unavailable sends stay honest, and resources close', async () => {
  const fixture = await startDemoFixture({backendSha: process.env.APP_INTEGRATION_BACKEND_SHA, port: 0});
  let oldToken;
  try {
    async function request(method, path, token, body, status = 200) {
      const response = await fetch(fixture.origin + path, {method, signal: AbortSignal.timeout(10000),
        headers: {...(token ? {Authorization: `Bearer ${token}`} : {}),
          ...(body === undefined ? {} : {'Content-Type': 'application/json', 'Idempotency-Key': randomUUID()})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      assert.equal(response.status, status, `${method} ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return response.json();
    }
    await request('GET', '/health');
    await request('GET', '/v1/me', undefined, undefined, 401);
    const world = await request('POST', '/v1/demo/session', undefined, {});
    assert.equal(world.synthetic, true);
    for (const role of ['driver', 'family', 'colleague']) {
      const me = await request('GET', '/v1/me', world[role].token);
      assert.equal(me.id, world[role].id);
    }
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM identities')).rows[0].n, 3);
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM contact_grants WHERE accepted_at IS NOT NULL')).rows[0].n, 2);
    const {driver, family, colleague} = world;
    oldToken = driver.token;
    const draft = await request('POST', '/v1/trip-drafts', driver.token, {text: 'Lima a Ica, solo demostración',
      fields: {truckId: driver.truckId, origin: 'Lima', destination: 'Ica', country: 'PE', locale: 'es-PE', timeZone: 'America/Lima'}});
    const trip = await request('POST', `/v1/trip-drafts/${draft.id}/confirm`, driver.token,
      {confirmed: true, contactGrantIds: [family.grantId, colleague.grantId]});
    await request('GET', `/v1/trips/${trip.id}/snapshot`, family.token);
    const incident = await request('POST', `/v1/trips/${trip.id}/sos`, driver.token, {});
    await request('GET', `/v1/incidents/${incident.id}`, family.token);
    const acknowledged = await request('POST', `/v1/incidents/${incident.id}/acknowledgements`, family.token, {});
    assert.equal(acknowledged.recorded, 'acknowledged');
    await request('POST', `/v1/trips/${trip.id}/commands`, driver.token, {type: 'arrived'});
    assert.equal((await request('GET', `/v1/incidents/${incident.id}`, family.token)).status, 'active');
    assert.deepEqual((await fixture.pool.query('SELECT status,map_active,checkins_active FROM trips')).rows,
      [{status: 'arrived', map_active: false, checkins_active: false}]);
    assert.deepEqual((await fixture.pool.query('SELECT kind FROM incident_events ORDER BY created_at')).rows.map(row => row.kind), ['sos_report', 'acknowledged']);
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM dispatch_attempts')).rows[0].n, 0);
    assert.equal((await fixture.pool.query("SELECT count(*)::int n FROM jobs WHERE status <> 'unavailable'")).rows[0].n, 0);
    const ignored = join(fixture.backend, 'db/migrations/999-fixture.sql');
    await writeFile(ignored, 'SELECT 1;\n');
    assert.throws(() => assertDemoSource(fixture.backend, fixture.backendSha), /Untracked or ignored/);
    await rm(ignored);
    assertDemoSource(fixture.backend, fixture.backendSha);
  } finally {await fixture.close();}
  assert.equal(existsSync(fixture.directory), false);
  assert.equal(existsSync(fixture.databaseDirectory), false);
  await assert.rejects(fetch(fixture.origin + '/health', {signal: AbortSignal.timeout(2000)}));
  const reset = await startDemoFixture({backendSha: process.env.APP_INTEGRATION_BACKEND_SHA, port: 0});
  try {
    assert.equal((await reset.pool.query('SELECT count(*)::int n FROM identities')).rows[0].n, 0);
    const denied = await fetch(reset.origin + '/v1/me', {headers: {Authorization: `Bearer ${oldToken}`}, signal: AbortSignal.timeout(5000)});
    assert.equal(denied.status, 401, 'Restart must not authenticate a credential from the previous signer/world');
  } finally {await reset.close();}
});

test('forced CLI foreground-group exit still removes its isolated database and checkout', async () => {
  const child = fork(fileURLToPath(new URL('../../scripts/app-integration/demo-fixture.mjs', import.meta.url)), [], {
    env: testEnvironment({APP_INTEGRATION_BACKEND_SHA: process.env.APP_INTEGRATION_BACKEND_SHA,
      APP_INTEGRATION_PG_BIN: process.env.APP_INTEGRATION_PG_BIN,
      APP_INTEGRATION_PG_PORT: process.env.APP_INTEGRATION_PG_PORT,
      APP_INTEGRATION_API_PORT: '0'}), detached: true, silent: true, execArgv: [],
  });
  child.stdout.resume(); child.stderr.resume();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const ready = await Promise.race([
      once(child, 'message', {signal: controller.signal}).then(([value]) => value),
      once(child, 'exit', {signal: controller.signal}).then(() => {throw Error('Demo CLI exited before readiness');}),
    ]);
    const exited = once(child, 'exit');
    process.kill(-child.pid, 'SIGKILL');
    await exited;
    for (let i = 0; i < 100 && (existsSync(ready.directory) || existsSync(ready.databaseDirectory)); i++) await delay(100);
    assert.equal(existsSync(ready.directory), false);
    assert.equal(existsSync(ready.databaseDirectory), false);
    await assert.rejects(fetch(ready.origin + '/health', {signal: AbortSignal.timeout(2000)}));
  } finally {clearTimeout(timer); controller.abort(); await stop(child);}
});
