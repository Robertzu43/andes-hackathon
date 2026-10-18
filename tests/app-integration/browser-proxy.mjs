// Real web dev/production-preview sockets, signed API and SQL; not UI acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {startBrowserFixture} from '../../scripts/app-integration/browser-fixture.mjs';
import {stop, testEnvironment} from '../../scripts/app-integration/runtime.mjs';

test('checkout web proxy and its client gateway reach the actual signed SQL backend', {timeout: 60000}, async t => {
  const fixture = await startBrowserFixture();
  t.after(() => fixture.close());
  const {MemorySession, createApiClient, createSessionGateway, createIdempotencyKey} = await import(pathToFileURL(fixture.clientModule));
  const credentialUrl = fixture.origin + '/__andes_fixture__/credentials';
  let credentials, identity, api;
  const session = new MemorySession();
  let gateway;
  t.after(() => gateway?.dispose());
  await t.test('credential fixture rejects GET, absent provenance and foreign origins', async () => {
    assert.equal((await fetch(credentialUrl)).status, 403);
    assert.equal((await fetch(credentialUrl, {method: 'POST'})).status, 403);
    assert.equal((await fetch(credentialUrl, {method: 'POST', headers: {Origin: 'https://foreign.invalid', 'X-Andes-Fixture': 'synthetic-only'}})).status, 403);
    const response = await fetch(credentialUrl, {method: 'POST', headers: {Origin: fixture.origin, 'X-Andes-Fixture': 'synthetic-only'}});
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.has('access-control-allow-origin'), false);
    credentials = await response.json(); // In memory only; never an assertion diagnostic.
  });
  await t.test('development proxy preserves real authentication and verifies identity before gateway authentication', async () => {
    const unauthenticated = await fetch(fixture.origin + '/v1/me');
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).code, 'unauthorized');
    let reads = 0;
    api = createApiClient({baseUrl: fixture.origin, session, fetch: (...args) => {reads++; return fetch(...args);}});
    gateway = createSessionGateway({session, api, mode: 'demo', acquire: async () => credentials});
    const initial = gateway.getSnapshot();
    assert.equal(initial.state, 'signed-out'); assert.equal(gateway.getSnapshot(), initial);
    const first = gateway.begin(), duplicate = gateway.begin();
    assert.equal(first, duplicate); assert.equal(gateway.getSnapshot().state, 'connecting');
    await first;
    assert.equal(reads, 1, 'Only actual /v1/me verifies the session; duplicate begin must not send twice');
    assert.equal(gateway.getSnapshot().state, 'authenticated');
    assert.deepEqual(Object.keys(gateway.getSnapshot()).sort(), ['mode', 'state']);
    identity = (await api.getIdentity()).id;
    assert.notEqual(identity, credentials.subject);
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM identities WHERE id=$1', [identity])).rows[0].n, 1);
    const html = await (await fetch(fixture.origin + '/session')).text();
    assert.ok(html.includes('/src/main.tsx'));
    const hook = await (await fetch(fixture.origin + '/src/main.tsx')).text();
    assert.ok(hook.includes('__ANDES_TEST_MOUNT__'));
    const bootstrap = await fetch(fixture.origin + '/__andes_fixture__/bootstrap.mjs');
    assert.equal(bootstrap.status, 200);
    assert.match(await bootstrap.text(), /from ['"]\/src\/lib\/api\/index\.ts['"]/, 'Bootstrap must mount the checkout client');
    assert.equal((await fetch(fixture.origin + '/src/lib/api/index.ts')).status, 200);
  });
  await t.test('production-build preview forwards actual signed reads and idempotent writes without development hooks', async () => {
    const preview = await fixture.productionPreview();
    assert.equal((await fetch(preview + '/v1/me')).status, 401);
    const builtApi = createApiClient({baseUrl: preview, session});
    assert.equal((await builtApi.getIdentity()).id, identity);
    const write = {idempotencyKey: createIdempotencyKey()}, body = {label: 'SYNTHETIC web proxy control'};
    const created = await builtApi.createTruck(body, write);
    assert.equal((await builtApi.createTruck(body, write)).id, created.id);
    assert.equal((await fixture.pool.query('SELECT count(*)::int n FROM trucks WHERE driver_id=$1', [identity])).rows[0].n, 1);
    const assetDir = join(fixture.directory, 'production/assets');
    const scripts = (await readdir(assetDir)).filter(name => name.endsWith('.js'));
    assert.ok(scripts.length > 0);
    for (const name of scripts) {
      const code = await readFile(join(assetDir, name), 'utf8');
      assert.equal(code.includes('__ANDES_TEST_MOUNT__'), false, 'Production must omit the mount hook');
      assert.equal(code.includes('__andes_fixture__'), false, 'Production must omit fixture modules');
    }
  });
  await t.test('unconfigured production proxy returns explicit JSON failure rather than SPA HTML', async () => {
    const unconfigured = await fixture.productionPreview(false);
    const response = await fetch(unconfigured + '/v1/me');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {code: 'api_unconfigured'});
  });
  await t.test('rejected actual authorization cannot authenticate gateway, and signout clears the session', async () => {
    gateway.end();
    assert.equal(gateway.getSnapshot().state, 'signed-out');
    await assert.rejects(api.getIdentity(), error => error.kind === 'unauthenticated');
    const invalid = createSessionGateway({session, api, mode: 'demo', acquire: async () => ({...credentials, accessToken: 'synthetic.invalid.signature'})});
    // An actual 401 invalidates MemorySession; main's gateway reports that refusal as 'error' (b5bc921).
    try {await invalid.begin(); assert.equal(invalid.getSnapshot().state, 'error');}
    finally {invalid.dispose();}
    assert.equal(session.snapshot().status, 'anonymous');
  });
  gateway.dispose();
  await fixture.close();
  assert.equal(existsSync(fixture.directory), false, 'Owned run directory and database resources must be cleaned');
});

for (const shutdownSignal of ['SIGHUP', 'SIGKILL']) test(`interactive CLI resource owner cleans after ${shutdownSignal}`, {timeout: 30000}, async t => {
  const extra = {};
  for (const key of ['APP_INTEGRATION_PG_BIN', 'APP_INTEGRATION_PG_PORT', 'APP_INTEGRATION_ADMIN_URL']) {
    if (process.env[key]) extra[key] = process.env[key];
  }
  // Own a separate test process group so force-kill cannot affect the runner.
  const child = fork('scripts/app-integration/browser-fixture.mjs', [], {env: testEnvironment(extra), silent: true, execArgv: [], detached: true});
  child.stdout.resume(); child.stderr.resume();
  t.after(() => stop(child));
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
  try {
    const ready = await Promise.race([
      once(child, 'message', {signal: abort.signal}).then(([value]) => value),
      once(child, 'exit', {signal: abort.signal}).then(() => {throw Error('Interactive fixture exited before readiness');}),
    ]);
    assert.equal((await fetch(ready.origin + '/v1/me')).status, 401);
    const exited = once(child, 'exit', {signal: abort.signal});
    if (shutdownSignal === 'SIGKILL') process.kill(-child.pid, 'SIGKILL');
    else child.kill(shutdownSignal);
    const [code, signal] = await exited;
    if (shutdownSignal === 'SIGHUP') {assert.equal(code, 0); assert.equal(signal, null);}
    else {assert.equal(code, null); assert.equal(signal, 'SIGKILL');}
    for (let i = 0; i < 100 && existsSync(ready.directory); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(existsSync(ready.directory), false);
    if (!process.env.APP_INTEGRATION_ADMIN_URL) {
      const probe = createServer();
      try {
        await new Promise((resolve, reject) => {probe.once('error', reject); probe.listen(Number(process.env.APP_INTEGRATION_PG_PORT ?? 56446), '127.0.0.1', resolve);});
      } finally {if (probe.listening) await new Promise(resolve => probe.close(resolve));}
    }
  } finally {clearTimeout(timer); abort.abort();}
});
