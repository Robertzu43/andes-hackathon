import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/runtime.mjs';
import { createApiClient, MemorySession } from '../web/src/lib/api/index.ts';

const intent = () => ({ idempotencyKey: randomUUID() });

async function connection(t) {
  const f = await fixture(t);
  const baseUrl = await f.app.listen({ host: '127.0.0.1', port: 0 });
  function client(subject, accessToken) {
    const session = new MemorySession();
    session.setCredentials({ issuer: 'https://synthetic.test', subject, accessToken, expiresAt: Date.now() + 60_000 });
    return createApiClient({ baseUrl, session });
  }
  async function request(method, path, { token = f.driver, body, key = randomUUID() } = {}) {
    const response = await fetch(new URL(path, baseUrl), { method, redirect: 'error', cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() };
  }
  const driver = client('driver', f.driver), contact = client('contact', f.contact);
  const invitation = await driver.inviteContact({ contactId: f.contactIdentity.id,
    phone: '+5511999990000', map: true, incident: true }, intent());
  await contact.acceptContact(invitation.id, { map: true, incident: true }, intent());
  const truck = await driver.createTruck({ label: 'SYNTHETIC integration truck' }, intent());
  const draft = await driver.createDraft({ text: 'SYNTHETIC private trip text', fields: {
    truckId: truck.id, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo',
  } }, intent());
  const trip = await driver.confirmTrip(draft.id, { confirmed: true, contactGrantIds: [invitation.id] }, intent());
  return { f, request, driver, contact, trip };
}

test('new sharing report is idempotent and remains separate from capture, consent and closure', async t => {
  const { f, request, driver, contact, trip } = await connection(t);
  const path = `/v1/trips/${trip.id}/sharing`;
  const stopped = { state: 'stopped', reason: 'page_hidden' }, key = randomUUID();
  assert.equal((await request('POST', path, { token: f.stranger, body: stopped })).status, 403);
  const first = await request('POST', path, { body: stopped, key });
  assert.deepEqual(first, { status: 200, body: { id: trip.id, sharing: 'stopped' } });
  assert.deepEqual(await request('POST', path, { body: stopped, key }), first);
  assert.equal((await f.ctx.pool.query("SELECT count(*)::int AS n FROM trip_events WHERE trip_id=$1 AND kind='sharing_stopped:page_hidden'", [trip.id])).rows[0].n, 1);
  assert.equal((await request('POST', path, { body: { state: 'resumed', reason: 'user' }, key })).status, 409);

  // A sharing report alone neither revokes consent nor stops server ingestion.
  await driver.uploadLocations(trip.id, [{ capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 8 }], intent());
  assert.equal((await contact.getSnapshot(trip.id)).freshness, 'fresh');
  const status = await request('GET', `/v1/trips/${trip.id}/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.trip, { status: 'active', paused: false, expectedArrivalAt: null });
  assert.deepEqual(status.body.location, { freshness: 'fresh', ageMs: 0, capturedAt: f.ctx.clock().toISOString(), accuracy: 8 });
  assert.equal(status.body.check, null);
  assert.equal(status.body.incident, null);
  assert.ok(!('readAt' in status.body));
  assert.ok(!('latitude' in status.body.location));
  assert.equal((await request('GET', `/v1/trips/${trip.id}/status`, { token: f.stranger })).status, 403);

  await driver.commandTrip(trip.id, 'arrived', intent());
  assert.equal((await request('POST', path, { body: { state: 'resumed', reason: 'user' } })).status, 409);
  const closed = (await request('GET', `/v1/trips/${trip.id}/status`)).body;
  assert.equal(closed.trip.status, 'arrived');
  assert.ok(!('location' in closed));
});

test('accepted typed SOS and resolution operations agree with the new native status projection', async t => {
  const { f, request, driver, contact, trip } = await connection(t);
  const incident = await driver.reportSos(trip.id, intent());
  await driver.commandTrip(trip.id, 'pause', intent());
  await driver.commandTrip(trip.id, 'checkin_ok', intent());
  const before = (await request('GET', `/v1/trips/${trip.id}/status`, { token: f.contact })).body;
  assert.equal(before.trip.paused, true);
  assert.equal(before.incident.id, incident.id);
  assert.equal(before.incident.trigger, 'sos');
  assert.equal(before.incident.status, 'active');
  assert.equal(before.check, null);
  assert.deepEqual(before.deliveries.filter(d => d.role === 'family').map(d => d.channel).sort(), ['sms', 'voice', 'whatsapp']);
  assert.equal(before.deliveries.find(d => d.role === 'group').status, 'unavailable');
  assert.ok(!JSON.stringify(before).includes('+5511999990000'));
  assert.ok(!JSON.stringify(before).includes(f.contactIdentity.id));
  assert.equal((await contact.acknowledgeIncident(incident.id, intent())).recorded, 'acknowledged');
  await driver.commandTrip(trip.id, 'arrived', intent());
  const arrived = (await request('GET', `/v1/trips/${trip.id}/status`, { token: f.contact })).body;
  assert.equal(arrived.incident.status, 'active');
  assert.ok(!('location' in arrived));
  assert.equal((await driver.resolveIncident(incident.id, intent())).status, 'resolved');
  const resolved = (await request('GET', `/v1/trips/${trip.id}/status`, { token: f.contact })).body;
  assert.equal(resolved.incident.id, incident.id);
  assert.equal(resolved.incident.status, 'resolved');
});
