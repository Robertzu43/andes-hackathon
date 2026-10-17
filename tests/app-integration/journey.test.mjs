import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import pg from 'pg';
import {migrate} from '../../dist/db.js';
import {command, runDatabaseUrl, stop, testEnvironment} from '../../scripts/app-integration/runtime.mjs';
import {recorder, writeCapture} from '../../scripts/app-integration/receipts.mjs';

test('synthetic HTTP journey persists across actual API and dispatch-process restarts', {timeout: 45000}, async t => {
  assert.equal(process.env.ANDES_APP_INTEGRATION, 'synthetic-only', 'Run scripts/app-integration/run.mjs');
  const databaseUrl = process.env.APP_INTEGRATION_DATABASE_URL;
  runDatabaseUrl(databaseUrl);
  const pool = new pg.Pool({connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 3000});
  let api;
  t.after(async () => { try { await stop(api); } finally { await pool.end(); } });
  await migrate(pool);
  const {privateKey, publicKey} = await generateKeyPair('RS256');
  const publicJwk = JSON.stringify(await exportJWK(publicKey));
  const clockPath = join(process.env.APP_INTEGRATION_RUN_DIR, 'clock.txt');
  const stubLog = join(process.env.APP_INTEGRATION_RUN_DIR, 'stub.jsonl');
  let now = new Date();
  await writeFile(clockPath, now.toISOString());
  await writeFile(stubLog, '');
  const env = testEnvironment({APP_INTEGRATION_DATABASE_URL: databaseUrl,
    APP_INTEGRATION_PUBLIC_JWK: publicJwk, APP_INTEGRATION_CLOCK: clockPath,
    APP_INTEGRATION_STUB_LOG: stubLog});
  let origin, firstPid;
  async function startApi() {
    api = fork('scripts/app-integration/api-process.mjs', [], {env, silent: true, execArgv: []});
    api.stderr.resume(); // Never surface configuration values from a child startup failure.
    api.stdout.resume();
    // Race startup failure against readiness; never leave a dead child hanging the test.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const ready = once(api, 'message', {signal: controller.signal}).then(([value]) => value);
      const exited = once(api, 'exit', {signal: controller.signal}).then(() => { throw Error('Synthetic API exited before readiness'); });
      const value = await Promise.race([ready, exited]);
      assert.ok(value.pid > 0 && value.port > 0);
      origin = `http://127.0.0.1:${value.port}`;
      t.diagnostic(`Synthetic API listening on loopback port ${value.port}, PID ${value.pid}`);
      return value.pid;
    } finally { clearTimeout(timer); controller.abort(); }
  }
  async function token(subject, extra = {}, signingKey = privateKey) {
    return new SignJWT({phone_number: '+551155550100', phone_number_verified: true, ...extra})
      .setProtectedHeader({alg: 'RS256'}).setIssuer('https://andes-integration.invalid')
      .setAudience('andes-q46').setSubject(subject).setIssuedAt().setExpirationTime('1h').sign(signingKey);
  }
  const driver = await token('synthetic-driver');
  const contact = await token('synthetic-contact');
  const stranger = await token('synthetic-stranger');
  const capture = recorder({kind: 'isolated-backend-run', backendSha: process.env.APP_INTEGRATION_BACKEND_SHA,
    externalSends: false, isolatedDatabase: true, producer: 'Q46 isolated PostgreSQL / loopback HTTP; synthetic signed identities',
    command: 'node scripts/app-integration/run.mjs'});
  t.after(async () => {
    if (process.env.APP_INTEGRATION_EVIDENCE_DIR) await writeCapture(process.env.APP_INTEGRATION_EVIDENCE_DIR, capture.raw());
  });
  async function request(method, path, body, jwt = driver, {key = randomUUID(), status = 200, bindings = []} = {}) {
    const response = await fetch(origin + path, {method, signal: AbortSignal.timeout(5000),
      headers: {...(jwt ? {authorization: `Bearer ${jwt}`} : {}),
        ...(method === 'POST' ? {'content-type': 'application/json', ...(key ? {'idempotency-key': key} : {})} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    if (bindings.length) capture.record({method, path, actor: jwt === driver ? 'driver' : jwt === contact ? 'contact' : 'stranger',
      request: body, response: result, status: response.status, key, bindings});
    assert.equal(response.status, status, `${method} ${path}: ${result.code ?? 'unexpected status'}`);
    return result;
  }
  async function advance(ms) { now = new Date(now.getTime() + ms); await writeFile(clockPath, now.toISOString()); }
  async function row(sql, args = []) { return (await pool.query(sql, args)).rows[0]; }
  let driverId, contactId, truck, grant, draft, trip, incident, jobs;

  await t.test('health and signed identity have valid and unauthenticated/wrong-signature controls', async () => {
    firstPid = await startApi();
    assert.equal((await request('GET', '/health', undefined, null)).status, 'ok');
    await request('GET', '/v1/me', undefined, null, {status: 401});
    const otherKey = await generateKeyPair('RS256');
    await request('GET', '/v1/me', undefined, await token('synthetic-forged', {}, otherKey.privateKey), {status: 401});
    driverId = (await request('GET', '/v1/me', undefined, driver, {bindings: [['setup', 0]]})).id;
    contactId = (await request('GET', '/v1/me', undefined, contact)).id;
    await request('GET', '/v1/me', undefined, stranger);
    assert.notEqual(driverId, contactId);
  });

  await t.test('owned truck creation persists idempotent response and rejects mismatched reuse', async () => {
    const key = randomUUID();
    truck = (await request('POST', '/v1/trucks', {label: 'SYNTHETIC owner-operator truck'}, driver, {key, bindings: [['setup', 1]]})).id;
    assert.equal((await request('POST', '/v1/trucks', {label: 'SYNTHETIC owner-operator truck'}, driver, {key})).id, truck);
    await request('POST', '/v1/trucks', {label: 'changed'}, driver, {key, status: 409});
    await request('POST', '/v1/trucks', {label: 'missing-key'}, driver, {key: null, status: 400});
    assert.equal((await row('SELECT driver_id FROM trucks WHERE id=$1', [truck])).driver_id, driverId);
  });

  await t.test('only intended verified contact can accept scoped standing invitation', async () => {
    grant = (await request('POST', '/v1/contacts', {contactId, phone: '+551155550100', map: true, incident: true}, driver, {bindings: [['setup', 2]]})).id;
    await request('POST', `/v1/contacts/${grant}/accept`, {map: true, incident: true}, stranger, {status: 403});
    await request('POST', `/v1/contacts/${grant}/accept`, {map: true, incident: true}, await token('synthetic-contact', {phone_number_verified: false}), {status: 409});
    assert.equal((await request('POST', `/v1/contacts/${grant}/accept`, {map: true, incident: true}, contact, {bindings: [['setup', 3]]})).status, 'accepted');
  });

  await t.test('draft remains inactive until complete explicit confirmation; cross-user ownership enforced', async () => {
    await request('POST', '/v1/trip-drafts', {text: 'SYNTHETIC', fields: {truckId: truck}}, stranger, {status: 403});
    await request('POST', '/v1/trip-drafts', {audio: 'synthetic-unsupported'}, driver, {status: 422});
    const created = await request('POST', '/v1/trip-drafts', {text: 'SYNTHETIC freight trip', fields: {truckId: truck}}, driver, {bindings: [['explicit-confirm', 0]]});
    draft = created.id;
    assert.ok(created.missingFields.includes('country'));
    await request('POST', `/v1/trip-drafts/${draft}/confirm`, {confirmed: true, contactGrantIds: [grant]}, driver, {status: 409});
    assert.equal((await row('SELECT count(*)::int n FROM trips')).n, 0);
    const fields = {origin: 'SYNTHETIC A', destination: 'SYNTHETIC B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'};
    await request('POST', `/v1/trip-drafts/${draft}/confirm`, {confirmed: true, contactGrantIds: [grant], fields}, stranger, {status: 403});
    const confirmation = {confirmed: true, contactGrantIds: [grant], fields};
    const confirmKey = randomUUID();
    trip = (await request('POST', `/v1/trip-drafts/${draft}/confirm`, confirmation, driver,
      {key: confirmKey, bindings: [['explicit-confirm', 1], ['duplicate-confirm', 0]]})).id;
    assert.equal((await request('POST', `/v1/trip-drafts/${draft}/confirm`, confirmation, driver,
      {key: confirmKey, bindings: [['duplicate-confirm', 1]]})).id, trip);
    await request('POST', `/v1/trip-drafts/${draft}/confirm`, confirmation, driver,
      {status: 409, bindings: [['duplicate-confirm', 2]]});
    assert.equal(trip, draft);
    await request('GET', `/v1/trips/${trip}`, undefined, stranger, {status: 403, bindings: [['cross-user', 0]]});
  });

  await t.test('fresh/stale location retains capture/receipt/read distinctions and denies strangers', async () => {
    const empty = await request('GET', `/v1/trips/${trip}/snapshot`, undefined, contact, {bindings: [['unavailable-snapshot', 0]]});
    assert.equal(empty.freshness, 'unavailable');
    const observation = {capturedAt: now.toISOString(), latitude: -12, longitude: -77, accuracy: 8};
    await request('POST', `/v1/trips/${trip}/locations`, {observations: [observation]});
    const fresh = await request('GET', `/v1/trips/${trip}/snapshot`, undefined, contact, {bindings: [['stale-snapshot', 0]]});
    assert.equal(fresh.freshness, 'fresh');
    assert.equal(fresh.location.capturedAt, observation.capturedAt);
    assert.equal(fresh.location.receivedAt, now.toISOString());
    await request('GET', `/v1/trips/${trip}/snapshot`, undefined, stranger, {status: 403});
    await request('POST', `/v1/trips/${trip}/locations`, {observations: [observation]}, stranger, {status: 403});
    await advance(121000);
    assert.equal((await request('GET', `/v1/trips/${trip}/snapshot`, undefined, contact, {bindings: [['stale-snapshot', 1]]})).freshness, 'stale');
    await request('POST', `/v1/trips/${trip}/locations`, {observations: [{...observation, capturedAt: new Date(now.getTime() + 31000).toISOString()}]}, driver, {status: 400});
  });

  await t.test('pause/resume and attributed OK/rest reports preserve map without automatic escalation', async () => {
    for (const type of ['pause', 'checkin_ok', 'rest_report']) {
      assert.equal((await request('POST', `/v1/trips/${trip}/commands`, {type}, driver,
        {bindings: type === 'pause' ? [] : [['self-report', type === 'checkin_ok' ? 0 : 1]]})).automaticEscalation, false);
    }
    const paused = await request('GET', `/v1/trips/${trip}`);
    assert.equal(paused.paused, true); assert.equal(paused.checkins_active, false); assert.equal(paused.map_active, true);
    await request('POST', `/v1/trips/${trip}/commands`, {type: 'resume'});
    assert.equal((await request('GET', `/v1/trips/${trip}`)).checkins_active, true);
    assert.equal((await row('SELECT count(*)::int n FROM incidents')).n, 0);
  });

  await t.test('actual API-process restart retains identity, trip, location and idempotent mutation response', async () => {
    const key = randomUUID();
    const before = await request('POST', `/v1/trips/${trip}/commands`, {type: 'checkin_ok'}, driver, {key});
    await stop(api);
    const restartedPid = await startApi();
    assert.notEqual(restartedPid, firstPid);
    assert.equal((await request('GET', '/v1/me')).id, driverId);
    assert.equal((await request('GET', `/v1/trips/${trip}`)).truck_id, truck);
    assert.equal((await request('GET', `/v1/trips/${trip}/snapshot`, undefined, contact)).freshness, 'stale');
    assert.deepEqual(await request('POST', `/v1/trips/${trip}/commands`, {type: 'checkin_ok'}, driver, {key}), before);
  });

  await t.test('SOS duplicate taps create one episode; contact acknowledgement/action do not resolve it', async () => {
    await request('POST', `/v1/trips/${trip}/sos`, {}, stranger, {status: 403, bindings: [['cross-user', 1]]});
    incident = (await request('POST', `/v1/trips/${trip}/sos`, {}, driver, {bindings: [['sos-acceptance', 0], ['arrival-preserves-sos', 0]]})).id;
    assert.equal((await request('POST', `/v1/trips/${trip}/sos`, {}, driver, {bindings: [['sos-acceptance', 1]]})).id, incident);
    await request('GET', `/v1/incidents/${incident}`, undefined, stranger, {status: 403});
    await request('POST', `/v1/incidents/${incident}/resolve`, {}, contact, {status: 403, bindings: [['owner-resolution', 0]]});
    assert.equal((await request('POST', `/v1/incidents/${incident}/acknowledgements`, {}, contact, {bindings: [['acknowledgement-action', 0]]})).recorded, 'acknowledged');
    assert.equal((await request('POST', `/v1/incidents/${incident}/actions`, {action: 'SYNTHETIC reported support action'}, contact, {bindings: [['acknowledgement-action', 1]]})).recorded, 'action');
    assert.equal((await request('GET', `/v1/incidents/${incident}`, undefined, contact)).status, 'active');
    jobs = (await pool.query('SELECT id AS "jobId",version,class FROM jobs WHERE incident_id=$1 AND channel<>\'group\' ORDER BY channel', [incident])).rows;
    assert.equal(jobs.length, 3);
    assert.equal((await row("SELECT status FROM jobs WHERE incident_id=$1 AND channel='group'", [incident])).status, 'unavailable');
  });

  await t.test('dispatch process exit/restart recovers unattempted claim and never resends ambiguous authorization', async () => {
    const dispatchEnv = {...env, APP_INTEGRATION_JOBS: JSON.stringify(jobs.slice(0, 2))};
    await command(process.execPath, ['scripts/app-integration/dispatch-process.mjs', 'abandon'], {env: dispatchEnv});
    assert.equal(await readFile(stubLog, 'utf8'), '');
    await advance(61000);
    await command(process.execPath, ['scripts/app-integration/dispatch-process.mjs', 'recover'], {env: dispatchEnv});
    await command(process.execPath, ['scripts/app-integration/dispatch-process.mjs', 'recover'], {env: dispatchEnv});
    const calls = (await readFile(stubLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 1, 'Only one synthetic stub call, never a real delivered notification');
    assert.equal((await row('SELECT state FROM dispatch_attempts WHERE job_id=$1', [jobs[0].jobId])).state, 'accepted');
    assert.equal((await row('SELECT state FROM dispatch_attempts WHERE job_id=$1', [jobs[1].jobId])).state, 'unknown');
    assert.equal((await row("SELECT count(*)::int n FROM jobs WHERE status='delivered'")).n, 0);
  });

  await t.test('arrival closes map but keeps SOS readable/actionable until driver resolution', async () => {
    await request('POST', `/v1/trips/${trip}/commands`, {type: 'arrived'}, driver, {bindings: [['arrival-preserves-sos', 1]]});
    assert.equal((await request('GET', `/v1/trips/${trip}`)).status, 'arrived');
    await request('POST', `/v1/trips/${trip}/locations`, {observations: [{capturedAt: now.toISOString(), latitude: -12, longitude: -77, accuracy: 8}]}, driver, {status: 409});
    const read = await request('GET', `/v1/incidents/${incident}`, undefined, contact, {bindings: [['arrival-preserves-sos', 2]]});
    assert.equal(read.status, 'active'); assert.equal(Object.hasOwn(read, 'location'), false);
    await request('GET', `/v1/trips/${trip}/snapshot`, undefined, contact, {status: 403, bindings: [['arrival-preserves-sos', 3]]});
    await request('POST', `/v1/incidents/${incident}/actions`, {action: 'SYNTHETIC follow-up after arrival'}, contact);
    await request('POST', `/v1/incidents/${incident}/resolve`, {}, driver, {bindings: [['owner-resolution', 1]]});
    assert.equal((await request('GET', `/v1/incidents/${incident}`)).status, 'resolved');
    assert.equal((await row('SELECT status FROM jobs WHERE id=$1', [jobs[2].jobId])).status, 'cancelled');
    await request('POST', `/v1/incidents/${incident}/acknowledgements`, {}, contact, {status: 409});
  });

  await t.test('per-trip then standing revocation persist and deny future contact reads/selection', async () => {
    // A separate active trip isolates revocation from arrival's earlier map denial.
    const activeDraft = await request('POST', '/v1/trip-drafts', {text: 'SYNTHETIC revocation control', fields: {
      truckId: truck, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}});
    const activeTrip = (await request('POST', `/v1/trip-drafts/${activeDraft.id}/confirm`, {confirmed: true, contactGrantIds: [grant]})).id;
    const activeIncident = (await request('POST', `/v1/trips/${activeTrip}/sos`, {})).id;
    await request('GET', `/v1/trips/${activeTrip}/snapshot`, undefined, contact);
    await request('GET', `/v1/incidents/${activeIncident}`, undefined, contact);
    await request('POST', `/v1/trips/${activeTrip}/contacts/${grant}/revoke`, {}, contact, {bindings: [['revocation', 0]]});
    await request('GET', `/v1/trips/${activeTrip}/snapshot`, undefined, contact, {status: 403, bindings: [['revocation', 1]]});
    await request('GET', `/v1/incidents/${activeIncident}`, undefined, contact, {status: 403, bindings: [['revocation', 2]]});
    await request('POST', `/v1/contacts/${grant}/revoke`, {});
    const next = await request('POST', '/v1/trip-drafts', {text: 'SYNTHETIC next trip', fields: {
      truckId: truck, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}});
    await request('POST', `/v1/trip-drafts/${next.id}/confirm`, {confirmed: true, contactGrantIds: [grant]}, driver, {status: 409});
    await stop(api); await startApi();
    await request('GET', `/v1/incidents/${activeIncident}`, undefined, contact, {status: 403});
    const persisted = await request('GET', `/v1/trips/${trip}`);
    assert.equal(persisted.status, 'arrived'); assert.equal(persisted.map_active, false);
  });
});
