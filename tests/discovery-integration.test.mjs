import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/runtime.mjs';
import { createApiClient, MemorySession } from '../web/src/lib/api/index.ts';

const intent = () => ({ idempotencyKey: randomUUID() });
const readPaths = ['/v1/profile', '/v1/trucks', '/v1/contacts', '/v1/trips', '/v1/bootstrap'];

async function connection(t) {
  const f = await fixture(t);
  const baseUrl = await f.app.listen({ host: '127.0.0.1', port: 0 });
  function client(subject, accessToken) {
    const session = new MemorySession();
    session.setCredentials({ issuer: 'https://synthetic.test', subject, accessToken, expiresAt: Date.now() + 60_000 });
    return createApiClient({ baseUrl, session });
  }
  async function read(path, token = f.driver) {
    const response = await fetch(new URL(path, baseUrl), {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store', redirect: 'error',
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, body: await response.json() };
  }
  return { f, read, driver: client('driver', f.driver), contact: client('contact', f.contact),
    stranger: client('stranger', f.stranger) };
}

test('mounted discovery reads enforce signed authentication over native HTTP', async t => {
  const { f, read } = await connection(t);
  for (const path of readPaths) {
    assert.equal((await read(path, null)).status, 401);
    assert.equal((await read(path, 'synthetic.invalid.signature')).status, 401);
    assert.equal((await read(path)).status, 200);
  }
  assert.equal((await read('/v1/profile')).body.id, f.me.id);
});

test('native discovery reloads persisted typed-client writes without crossing ownership or revocation boundaries', async t => {
  const { f, read, driver, contact, stranger } = await connection(t);
  const truck = await driver.createTruck({ label: 'SYNTHETIC driver truck' }, intent());
  const otherTruck = await stranger.createTruck({ label: 'SYNTHETIC other owner truck' }, intent());
  const otherIdentity = await stranger.getIdentity();
  const invitation = await driver.inviteContact({ contactId: f.contactIdentity.id,
    phone: '+5511999990000', map: true, incident: true }, intent());
  await contact.acceptContact(invitation.id, { map: true, incident: true }, intent());
  const draft = await driver.createDraft({ text: 'SYNTHETIC_PRIVATE draft text', fields: {
    truckId: truck.id, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo',
  } }, intent());
  const trip = await driver.confirmTrip(draft.id, { confirmed: true, contactGrantIds: [invitation.id] }, intent());
  await driver.uploadLocations(trip.id, [{ capturedAt: f.ctx.clock().toISOString(),
    latitude: -12.345678, longitude: -77.654321, accuracy: 8 }], intent());
  const incident = await driver.reportSos(trip.id, intent());

  const loaded = await read('/v1/bootstrap');
  assert.equal(loaded.status, 200);
  const initial = loaded.body;
  assert.deepEqual(initial.profile, { id: f.me.id, phone: '+5511999990000', phoneVerified: true });
  assert.deepEqual(initial.trucks, [{ id: truck.id, label: 'SYNTHETIC driver truck' }]);
  assert.equal(initial.contacts[0].id, invitation.id);
  assert.equal(initial.contacts[0].status, 'accepted');
  assert.equal(initial.trips.active.length, 1);
  assert.equal(initial.trips.active[0].id, trip.id);
  assert.deepEqual(initial.trips.active[0].contactGrantIds, [invitation.id]);
  assert.deepEqual(Object.keys(initial.trips.active[0]).sort(), ['id', 'truckId', 'origin', 'destination',
    'country', 'locale', 'timeZone', 'status', 'mapActive', 'checkinsActive', 'paused', 'version',
    'createdAt', 'closedAt', 'contactGrantIds'].sort());
  const serialized = JSON.stringify(initial);
  for (const privateValue of ['SYNTHETIC_PRIVATE', '-12.345678', '-77.654321', incident.id, otherTruck.id]) {
    assert.ok(!serialized.includes(privateValue));
  }
  assert.deepEqual((await read('/v1/trucks')).body.trucks, initial.trucks);
  assert.deepEqual((await read('/v1/contacts')).body.contacts, initial.contacts);
  assert.deepEqual((await read('/v1/trips')).body.active, initial.trips.active);

  // A caller-supplied owner hint cannot replace the identity from the signed JWT.
  const other = (await read(`/v1/bootstrap?driverId=${f.me.id}`, f.stranger)).body;
  assert.equal(other.profile.id, otherIdentity.id);
  assert.deepEqual(other.trucks, [{ id: otherTruck.id, label: 'SYNTHETIC other owner truck' }]);
  assert.deepEqual(other.contacts, []);
  assert.deepEqual(other.trips, { active: [], recent: [] });
  assert.equal(JSON.stringify(other).includes(trip.id), false);

  await contact.revokeContact(invitation.id, intent());
  await driver.commandTrip(trip.id, 'arrived', intent());
  const reloaded = (await read('/v1/bootstrap')).body;
  assert.equal(reloaded.contacts[0].status, 'revoked');
  assert.equal(reloaded.contacts[0].revokedBy, 'contact');
  assert.ok(reloaded.contacts[0].revokedAt);
  assert.deepEqual(reloaded.trips.active, []);
  assert.equal(reloaded.trips.recent[0].id, trip.id);
  assert.equal(reloaded.trips.recent[0].status, 'arrived');
  assert.ok(reloaded.trips.recent[0].closedAt);
  assert.equal(reloaded.trips.recent[0].mapActive, false);
  assert.equal(reloaded.trips.recent[0].checkinsActive, false);
  assert.equal((await driver.getIncident(incident.id)).status, 'active');
  await assert.rejects(contact.getSnapshot(trip.id), error => error.status === 403);
});
