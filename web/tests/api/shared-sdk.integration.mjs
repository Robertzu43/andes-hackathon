// Shared SDK + driver controller against the signed API/SQL; test-owned fetch adapter calls Fastify injection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from '../../../tests/helpers/runtime.mjs';
import { MemorySession, createApiClient, createDriverTransport, decodeDriverResponse, bindJourneySession } from '../../src/lib/api/index.ts';
import { createDriverJourney } from '../../src/features/driver/controller.mjs';
const deferred = () => Promise.withResolvers();

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
  const journey = createDriverJourney({ transport: createDriverTransport(api), keyFactory: randomUUID,
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
  const again = await journey.requestHelp(); assert.equal(again.kind, 'ok'); assert.notEqual(again.data.id, incidentId);
  assert.equal(counts.get(`POST /v1/trips/${tripId}/sos`), 2);
  assert.equal(decoded >= 10, true, 'Real published shared SDK decoder was used');
  const status = await journey.refreshStatus();
  assert.equal(status.kind, 'ok');
  assert.equal(journey.snapshot().status.data.incident.trigger, 'sos');
  // Same-clock UUIDs do not order incidents. Reload the SOS this call created before arrival.
  assert.equal((await journey.refreshIncident(again.data.id)).kind, 'ok');
  assert.equal(journey.snapshot().incident.data.status, 'active');
  journey.setInteractionMode('stationary'); await journey.sendCommand('arrived');
  assert.equal(journey.snapshot().activation, null); assert.equal(journey.snapshot().incident.data.status, 'active');
  assert.equal((await f.ctx.pool.query('SELECT count(*) FROM outbox')).rows[0].count, '0');
  session.clear(); assert.equal(journey.snapshot().tripId, null); assert.equal(journey.snapshot().incident.data, null);
});
