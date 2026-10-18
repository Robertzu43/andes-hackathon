// Actual pinned SDK + signed API/SQL; test-owned fetch adapter calls Fastify injection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { fixture } from '../../../tests/helpers/runtime.mjs';
import { MemorySession, createApiClient, createDriverTransport, decodeDriverResponse, bindJourneySession } from '../../src/lib/api/index.ts';

// Preserve the original Q50 counterexample with its actual published controller.
const driverRoot = mkdtempSync(join(tmpdir(), 'andes-api-shared-sdk-'));
after(() => rmSync(driverRoot, { recursive: true, force: true }));
for (const name of ['controller.mjs', 'validation.mjs']) {
  writeFileSync(join(driverRoot, name), execFileSync('git', ['show',
    `20c08faad67fddbe27eebac7585c63b3366f31a8:web/src/features/driver/${name}`], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  }));
}
const { createDriverJourney } = await import(pathToFileURL(join(driverRoot, 'controller.mjs')));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('published shared SDK decoder and transport retain real SOS/OK facts across credential refresh', { timeout: 10000 }, async t => {
  const f = await fixture(t, { channelSupport: [] });
  const session = new MemorySession(); let holdSos = null, sosCommitted = null, decoded = 0;
  const counts = new Map();
  t.after(() => { holdSos?.resolve(); });
  const api = createApiClient({ baseUrl: 'https://synthetic.test/', session, fetch: async (url, options) => {
    const path = new URL(url).pathname, method = options.method ?? 'GET';
    counts.set(`${method} ${path}`, (counts.get(`${method} ${path}`) ?? 0) + 1);
    const reply = await f.app.inject({ method, url: path, headers: options.headers, payload: options.body });
    if (path.endsWith('/sos') && holdSos) { sosCommitted.resolve(); await holdSos.promise; }
    return new Response(reply.body, { status: reply.statusCode, headers: { 'Content-Type': 'application/json' } });
  } });
  const transport = createDriverTransport(api);
  const journey = createDriverJourney({ transport, keyFactory: randomUUID,
    decodeResponse: (request, data) => { decoded += 1; return decodeDriverResponse(request, data); } });
  const binding = bindJourneySession(session, api, actor => journey.setSession(actor));
  t.after(() => { binding.dispose(); journey.dispose(); session.clear(); });
  session.setCredentials({ issuer: 'https://synthetic.test', subject: 'driver', accessToken: f.driver, expiresAt: Date.now() + 3600000 });
  await binding.activate(); assert.equal(journey.snapshot().auth.actorId, f.me.id);
  journey.setInteractionMode('stationary');
  journey.provideSelectionEvidence({ actorId: f.me.id, source: 'authenticated-server-read',
    readAt: f.ctx.clock().toISOString(), trucks: [], contacts: [] });
  const truck = await journey.registerTruck('SYNTHETIC SDK truck'); assert.equal(truck.kind, 'ok');
  journey.editForm({ text: 'SYNTHETIC SDK trip', fields: { truckId: truck.data.id, origin: 'A', destination: 'B',
    country: 'PE', locale: 'es-pe', timeZone: 'America/Lima' } });
  assert.equal((await journey.saveDraft()).kind, 'ok');
  assert.equal((await journey.confirmTrip({ confirmed: true })).kind, 'ok');
  const tripId = journey.snapshot().tripId;
  assert.equal((await journey.openTrip(tripId)).kind, 'ok');
  assert.equal((await journey.refreshLocation()).kind, 'ok');
  assert.equal(journey.snapshot().trip.data.locale, 'es-PE');
  for (let n = 0; n < 2; n += 1) assert.equal((await journey.sendCommand('checkin_ok')).kind, 'ok');
  assert.equal((await f.ctx.pool.query("SELECT count(*) FROM trip_events WHERE kind='checkin_ok'")).rows[0].count, '2');
  journey.setInteractionMode('moving'); holdSos = deferred(); sosCommitted = deferred();
  const pending = journey.requestHelp(); await sosCommitted.promise;
  session.setCredentials({ issuer: 'https://synthetic.test', subject: 'driver',
    accessToken: await f.token('driver', { jti: randomUUID() }), expiresAt: Date.now() + 3600000 });
  await binding.activate();
  assert.equal(journey.snapshot().tripId, tripId); assert.equal(journey.snapshot().operations.sos.state, 'pending');
  holdSos.resolve(); assert.equal((await pending).kind, 'ok'); holdSos = null;
  const incidentId = journey.snapshot().incident.data.id;
  assert.equal((await journey.refreshIncident()).kind, 'ok');
  assert.equal((await f.req('POST', `/v1/incidents/${incidentId}/resolve`, {})).status, 200);
  // Status selects the newest persisted incident by created_at; avoid a fixture-clock tie.
  f.advance(1000);
  const again = await journey.requestHelp(); assert.equal(again.kind, 'ok'); assert.notEqual(again.data.id, incidentId);
  assert.equal(counts.get(`POST /v1/trips/${tripId}/sos`), 2);
  assert.equal(decoded >= 10, true, 'Real published shared SDK decoder was used');
  // The current shared SDK decodes real status for the historical pinned controller.
  const status = await journey.refreshStatus();
  assert.deepEqual(status, { kind: 'ok', data: {
    trip: { status: 'active', paused: false, expectedArrivalAt: null },
    check: null,
    incident: { id: again.data.id, trigger: 'sos', checkReason: null, status: 'active',
      createdAt: '2026-10-17T12:00:01.000Z', label: null },
    deliveries: [{ role: 'group', channel: 'group', status: 'unavailable', unavailableReason: 'group_support_unverified' }],
    location: { freshness: 'unavailable', ageMs: null, capturedAt: null, accuracy: null },
  } });
  assert.equal(counts.get(`GET /v1/trips/${tripId}/status`), 1);
  assert.equal(journey.snapshot().status.state, 'available');
  assert.deepEqual(journey.snapshot().status.data, status.data);
  assert.deepEqual(journey.snapshot().incident.data, { ...status.data.incident, tripId });
  // Unknown descriptors still fail locally in the actual SDK transport, without HTTP.
  const beforeUnsupported = new Map(counts);
  assert.deepEqual(await transport({ operation: 'unsupportedOperation', params: { id: tripId } },
    { signal: new AbortController().signal }), { kind: 'not_sent', code: 'unsupported_operation' });
  assert.deepEqual(counts, beforeUnsupported);
  journey.setInteractionMode('stationary'); await journey.sendCommand('arrived');
  assert.equal(journey.snapshot().activation, null); assert.equal(journey.snapshot().incident.data.status, 'active');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '0');
  session.clear(); assert.equal(journey.snapshot().tripId, null); assert.equal(journey.snapshot().incident.data, null);
});
