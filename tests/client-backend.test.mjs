import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers/runtime.mjs';
import { createApiClient, MemorySession, ApiError } from '../web/src/lib/api/index.ts';

const intent = () => ({ idempotencyKey: randomUUID() });
const rejected = (kind, status) => error => error instanceof ApiError && error.kind === kind && error.status === status;

async function clients(t) {
  const f = await fixture(t);
  const baseUrl = await f.app.listen({ host: '127.0.0.1', port: 0 });
  function client(subject, token) {
    const session = new MemorySession();
    session.setCredentials({ issuer: 'https://synthetic.test', subject, accessToken: token, expiresAt: Date.now() + 60_000 });
    return { api: createApiClient({ baseUrl, session }), session };
  }
  return { f, driver: client('driver', f.driver), contact: client('contact', f.contact), stranger: client('stranger', f.stranger) };
}

async function confirmed(api, contactGrantIds = []) {
  const truck = await api.createTruck({ label: 'SYNTHETIC client contract truck' }, intent());
  const draft = await api.createDraft({ text: 'SYNTHETIC freight trip', fields: {
    truckId: truck.id, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo',
  } }, intent());
  return api.confirmTrip(draft.id, { confirmed: true, contactGrantIds }, intent());
}

test('typed client decodes real persisted drafts/trips and preserves explicit idempotency and JWT errors', async t => {
  const { f, driver, stranger } = await clients(t);
  assert.deepEqual(await driver.api.getIdentity(), f.me);
  const key = intent();
  const truck = await driver.api.createTruck({ label: 'SYNTHETIC same intent' }, key);
  assert.deepEqual(await driver.api.createTruck({ label: 'SYNTHETIC same intent' }, key), truck);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM trucks')).rows[0].n, 1);
  await assert.rejects(driver.api.createTruck({ label: 'SYNTHETIC changed content' }, key), rejected('conflict', 409));
  const draft = await driver.api.createDraft({ text: 'SYNTHETIC incomplete draft', fields: { truckId: truck.id } }, intent());
  assert.ok(draft.missingFields.includes('origin'));
  await assert.rejects(driver.api.confirmTrip(draft.id, { confirmed: true, contactGrantIds: [] }, intent()), rejected('conflict', 409));
  const trip = await driver.api.confirmTrip(draft.id, { confirmed: true, contactGrantIds: [], fields: {
    origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo',
  } }, intent());
  const row = await driver.api.getTrip(trip.id);
  assert.equal(row.driver_id, f.me.id);
  assert.equal(row.time_zone, 'America/Sao_Paulo');
  assert.equal(row.status, 'active');
  await assert.rejects(stranger.api.getTrip(trip.id), rejected('forbidden', 403));
  driver.session.setCredentials({ issuer: 'https://synthetic.test', subject: 'invalid',
    accessToken: 'synthetic.invalid.signature', expiresAt: Date.now() + 60_000 });
  await assert.rejects(driver.api.getIdentity(), rejected('unauthenticated', 401));
  assert.equal(driver.session.snapshot().status, 'anonymous');
});

test('typed snapshot decoding preserves source age and observes real backend consent revocation', async t => {
  const { f, driver, contact } = await clients(t);
  const invitation = await driver.api.inviteContact({ contactId: f.contactIdentity.id, phone: '+5511999990000', map: true, incident: true }, intent());
  assert.equal((await contact.api.acceptContact(invitation.id, { map: true, incident: true }, intent())).status, 'accepted');
  const trip = await confirmed(driver.api, [invitation.id]);
  const empty = await contact.api.getSnapshot(trip.id);
  assert.equal(empty.freshness, 'unavailable');
  assert.equal(empty.location, null);
  const capturedAt = f.ctx.clock().toISOString();
  await driver.api.uploadLocations(trip.id, [{ capturedAt, latitude: -12, longitude: -77, accuracy: 8 }], intent());
  const fresh = await contact.api.getSnapshot(trip.id);
  assert.equal(fresh.freshness, 'fresh');
  assert.equal(fresh.ageMs, 0);
  assert.equal(fresh.location.capturedAt, capturedAt);
  f.advance(121000);
  const stale = await contact.api.getSnapshot(trip.id);
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.ageMs, 121000);
  assert.deepEqual(stale.location, fresh.location);
  assert.notEqual(stale.readAt, fresh.readAt);
  await driver.api.revokeTripContact(trip.id, invitation.id, intent());
  await assert.rejects(contact.api.getSnapshot(trip.id), rejected('forbidden', 403));
  assert.equal(contact.session.snapshot().status, 'authenticated');
});

test('typed incident receipts stay separate from reported action, arrival and explicit driver resolution', async t => {
  const { f, driver, contact } = await clients(t);
  const grant = await f.grant();
  const trip = await confirmed(driver.api, [grant]);
  const incident = await driver.api.reportSos(trip.id, intent());
  assert.equal(incident.groupCapability, 'unavailable');
  assert.equal((await contact.api.getIncident(incident.id)).status, 'active');
  assert.equal((await contact.api.acknowledgeIncident(incident.id, intent())).recorded, 'acknowledged');
  assert.equal((await contact.api.reportAction(incident.id, 'SYNTHETIC reported call', intent())).recorded, 'action');
  assert.equal((await driver.api.commandTrip(trip.id, 'arrived', intent())).automaticEscalation, false);
  assert.equal((await contact.api.getIncident(incident.id)).status, 'active');
  await assert.rejects(contact.api.getSnapshot(trip.id), rejected('forbidden', 403));
  assert.equal((await driver.api.resolveIncident(incident.id, intent())).status, 'resolved');
  assert.equal((await driver.api.getIncident(incident.id)).status, 'resolved');
});
