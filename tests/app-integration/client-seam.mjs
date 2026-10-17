// Explicitly selected by check-client-seam.mjs, never a mocked API contract test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import pg from 'pg';
import {migrate} from '../../dist/db.js';
import {runDatabaseUrl, stop, testEnvironment} from '../../scripts/app-integration/runtime.mjs';

const CLIENT_SHA = '78efad0a207e98cc44336a03ba6af9fc0c1d2901';
function deferred() { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; }

test('accepted native client integrates with signed HTTP, SQL persistence and session isolation', {timeout: 45000}, async t => {
  assert.equal(process.env.ANDES_APP_INTEGRATION, 'synthetic-only');
  assert.equal(process.env.APP_INTEGRATION_CLIENT_SHA, CLIENT_SHA);
  const {MemorySession, createApiClient, createIdempotencyKey, ApiError} = await import(pathToFileURL(process.env.APP_INTEGRATION_CLIENT_MODULE));
  const parentUrl = runDatabaseUrl(process.env.APP_INTEGRATION_DATABASE_URL);
  const admin = new pg.Pool({connectionString: parentUrl.toString(), max: 1});
  const database = 'andes_q46_' + randomBytes(8).toString('hex');
  let created = false, pool, apiProcess;
  t.after(async () => {
    try { await stop(apiProcess); await pool?.end(); }
    finally {
      try { if (created) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  });
  // Separate database prevents this test from racing the existing HTTP journey.
  await admin.query(`CREATE DATABASE ${database}`); created = true;
  const url = new URL(parentUrl); url.pathname = '/' + database;
  runDatabaseUrl(url.toString());
  pool = new pg.Pool({connectionString: url.toString(), max: 2});
  await migrate(pool);
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const clockPath = join(process.env.APP_INTEGRATION_RUN_DIR, 'client-clock.txt');
  let now = new Date();
  await writeFile(clockPath, now.toISOString());
  const env = testEnvironment({APP_INTEGRATION_DATABASE_URL: url.toString(),
    APP_INTEGRATION_CLOCK: clockPath, APP_INTEGRATION_PUBLIC_JWK: JSON.stringify(await exportJWK(publicKey))});
  let origin;
  async function start() {
    apiProcess = fork('scripts/app-integration/api-process.mjs', [], {env, silent: true, execArgv: []});
    apiProcess.stdout.resume(); apiProcess.stderr.resume();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    try {
      const ready = once(apiProcess, 'message', {signal: abort.signal}).then(([value]) => value);
      const exited = once(apiProcess, 'exit', {signal: abort.signal}).then(() => { throw Error('Client test API exited before readiness'); });
      const value = await Promise.race([ready, exited]);
      origin = `http://127.0.0.1:${value.port}`;
      return value.pid;
    } finally { clearTimeout(timer); abort.abort(); }
  }
  async function credentials(subject, key = privateKey) {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = await new SignJWT({phone_number: '+551155550200', phone_number_verified: true})
      .setProtectedHeader({alg: 'RS256'}).setIssuer('https://andes-integration.invalid')
      .setAudience('andes-q46').setSubject(subject).setIssuedAt().setExpirationTime(expires).sign(key);
    return {issuer: 'https://andes-integration.invalid', subject, accessToken, expiresAt: expires * 1000};
  }
  const driverCredentials = await credentials('client-driver');
  const contactCredentials = await credentials('client-contact');
  const strangerCredentials = await credentials('client-stranger');
  const sessions = {};
  for (const [actor, value] of Object.entries({driver: driverCredentials, contact: contactCredentials, stranger: strangerCredentials})) {
    sessions[actor] = new MemorySession(); sessions[actor].setCredentials(value);
  }
  const intent = () => ({idempotencyKey: createIdempotencyKey()});
  function clients() { return Object.fromEntries(Object.entries(sessions).map(([actor, session]) => [actor, createApiClient({baseUrl: origin, session})])); }
  const rejected = (kind, outcome, status) => error => error instanceof ApiError && error.kind === kind && error.outcome === outcome && (status === undefined || error.status === status);
  let driver, contact, stranger, driverId, contactId, strangerId, truck, grant, trip, incident;

  await t.test('signed per-account sessions resolve distinct backend UUIDs without exposing tokens in snapshots', async () => {
    await start(); ({driver, contact, stranger} = clients());
    driverId = (await driver.getIdentity()).id;
    contactId = (await contact.getIdentity()).id;
    strangerId = (await stranger.getIdentity()).id;
    assert.equal(new Set([driverId, contactId, strangerId]).size, 3);
    assert.notEqual(driverId, driverCredentials.subject);
    for (const session of Object.values(sessions)) {
      assert.equal(session.snapshot().status, 'authenticated');
      assert.equal(Object.hasOwn(session.snapshot(), 'accessToken'), false);
    }
  });

  await t.test('committed response loss stays unknown with one attempt; explicit same-key reconciliation returns persisted result', async () => {
    let calls = 0, committedId;
    const lossy = createApiClient({baseUrl: origin, session: sessions.driver, fetch: async (target, init) => {
      calls++;
      const response = await fetch(target, init);
      assert.equal(response.status, 200);
      committedId = (await response.json()).id;
      throw new TypeError('Synthetic response loss after real server commit');
    }});
    const write = intent(), body = {label: 'SYNTHETIC lost-response truck'};
    await assert.rejects(lossy.createTruck(body, write), rejected('network', 'unknown'));
    assert.equal(calls, 1, 'No automatic replay');
    truck = (await driver.createTruck(body, write)).id;
    assert.equal(truck, committedId);
    assert.equal((await pool.query('SELECT count(*)::int n FROM trucks WHERE driver_id=$1', [driverId])).rows[0].n, 1);
    await assert.rejects(driver.createTruck({label: 'changed'}, write), rejected('conflict', 'rejected', 409));
    const other = await stranger.createTruck(body, write);
    assert.notEqual(other.id, truck, 'The same key is scoped to a different authenticated actor');
  });

  await t.test('typed consent and explicit confirmation preserve ownership and canonical idempotent paths', async () => {
    grant = (await driver.inviteContact({contactId, phone: '+551155550200', map: true, incident: true}, intent())).id;
    await assert.rejects(stranger.acceptContact(grant, {map: true, incident: true}, intent()), rejected('forbidden', 'rejected', 403));
    assert.equal((await contact.acceptContact(grant, {map: true, incident: true}, intent())).status, 'accepted');
    const draft = await driver.createDraft({text: 'SYNTHETIC client journey', fields: {truckId: truck}}, intent());
    await assert.rejects(driver.confirmTrip(draft.id, {confirmed: true, contactGrantIds: [grant]}, intent()), rejected('conflict', 'rejected', 409));
    const body = {confirmed: true, contactGrantIds: [grant], fields: {origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}};
    const write = intent();
    trip = (await driver.confirmTrip(draft.id, body, write)).id;
    assert.equal((await driver.confirmTrip(draft.id.toUpperCase(), body, write)).id, trip);
    await assert.rejects(stranger.getTrip(trip), rejected('forbidden', 'not_applicable', 403));
  });

  await t.test('location receipt count and source-based freshness survive typed decoding unchanged', async () => {
    assert.equal((await contact.getSnapshot(trip)).freshness, 'unavailable');
    const sample = {capturedAt: now.toISOString(), latitude: -12, longitude: -77, accuracy: 8};
    assert.equal((await driver.uploadLocations(trip, [sample], intent())).received, 1);
    const fresh = await contact.getSnapshot(trip);
    assert.equal(fresh.freshness, 'fresh'); assert.equal(fresh.location.capturedAt, sample.capturedAt);
    now = new Date(now.getTime() + 121000); await writeFile(clockPath, now.toISOString());
    const stale = await contact.getSnapshot(trip);
    assert.equal(stale.freshness, 'stale'); assert.equal(stale.ageMs, 121000);
    assert.equal(stale.location.receivedAt, fresh.location.receivedAt);
  });

  await t.test('API restart retains client-visible SQL state with credentials kept only in memory', async () => {
    const oldPid = apiProcess.pid;
    await stop(apiProcess);
    assert.notEqual(await start(), oldPid);
    ({driver, contact, stranger} = clients()); // Explicit new trusted endpoint after port0 restart.
    assert.equal((await driver.getIdentity()).id, driverId);
    assert.equal((await driver.getTrip(trip)).truck_id, truck);
    assert.equal((await contact.getSnapshot(trip)).freshness, 'stale');
  });

  await t.test('typed SOS acceptance, contact action, arrival and driver resolution remain distinct', async () => {
    incident = (await driver.reportSos(trip, intent())).id;
    assert.equal((await driver.reportSos(trip, intent())).id, incident);
    assert.equal((await contact.acknowledgeIncident(incident, intent())).recorded, 'acknowledged');
    assert.equal((await contact.reportAction(incident, 'SYNTHETIC reported support', intent())).recorded, 'action');
    await driver.commandTrip(trip, 'arrived', intent());
    assert.equal((await contact.getIncident(incident)).status, 'active');
    await assert.rejects(contact.getSnapshot(trip), rejected('forbidden', 'not_applicable', 403));
    await assert.rejects(contact.resolveIncident(incident, intent()), rejected('forbidden', 'rejected', 403));
    assert.equal((await driver.resolveIncident(incident, intent())).status, 'resolved');
  });

  await t.test('previously readable active-trip snapshot is not cached after recipient revocation', async () => {
    const draft = await driver.createDraft({text: 'SYNTHETIC revoke', fields: {truckId: truck, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}}, intent());
    const active = await driver.confirmTrip(draft.id, {confirmed: true, contactGrantIds: [grant]}, intent());
    await contact.getSnapshot(active.id);
    await contact.revokeTripContact(active.id, grant, intent());
    await assert.rejects(contact.getSnapshot(active.id), rejected('forbidden', 'not_applicable', 403));
  });

  await t.test('signout drops a real buffered old-account response and prevents a new unauthenticated request', async () => {
    const entered = deferred(), release = deferred(); let calls = 0;
    const delayed = createApiClient({baseUrl: origin, session: sessions.driver, fetch: async (target, init) => {
      calls++; const response = await fetch(target, init); const bytes = await response.arrayBuffer();
      entered.resolve(); await release.promise;
      return new Response(bytes, {status: response.status, headers: response.headers});
    }});
    const pending = delayed.getIdentity();
    await entered.promise; sessions.driver.clear(); release.resolve();
    await assert.rejects(pending, rejected('session_changed', 'not_applicable'));
    await assert.rejects(delayed.getIdentity(), error =>
      rejected('unauthenticated', 'not_sent')(error) && error.operation === 'session');
    assert.equal(calls, 1); sessions.driver.setCredentials(driverCredentials);
  });

  await t.test('account replacement rejects a real old response and next request uses the new signed identity', async () => {
    const entered = deferred(), release = deferred();
    const switched = new MemorySession(); switched.setCredentials(driverCredentials);
    const delayed = createApiClient({baseUrl: origin, session: switched, fetch: async (target, init) => {
      const response = await fetch(target, init); const bytes = await response.arrayBuffer();
      entered.resolve(); await release.promise;
      return new Response(bytes, {status: response.status, headers: response.headers});
    }});
    const pending = delayed.getIdentity();
    await entered.promise; switched.setCredentials(strangerCredentials); release.resolve();
    await assert.rejects(pending, rejected('session_changed', 'not_applicable'));
    assert.equal((await createApiClient({baseUrl: origin, session: switched}).getIdentity()).id, strangerId);
  });

  await t.test('late real 401 cannot invalidate replacement credentials', async () => {
    const wrong = await generateKeyPair('RS256');
    const session = new MemorySession(); session.setCredentials(await credentials('invalid-signature', wrong.privateKey));
    const entered = deferred(), release = deferred();
    const delayed = createApiClient({baseUrl: origin, session, fetch: async (target, init) => {
      const response = await fetch(target, init); const bytes = await response.arrayBuffer();
      assert.equal(response.status, 401); entered.resolve(); await release.promise;
      return new Response(bytes, {status: response.status, headers: response.headers});
    }});
    const pending = delayed.getIdentity();
    await entered.promise; session.setCredentials(contactCredentials); release.resolve();
    await assert.rejects(pending, rejected('session_changed', 'not_applicable'));
    assert.equal(session.snapshot().status, 'authenticated');
    assert.equal((await createApiClient({baseUrl: origin, session}).getIdentity()).id, contactId);
    assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE status='delivered'")).rows[0].n, 0);
  });
});
