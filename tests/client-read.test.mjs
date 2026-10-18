import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/runtime.mjs';

// Client reads are authenticated identity reads; no body can supply another owner.
test('client reads require a signed identity and return only the authenticated profile', async t => {
  const f = await fixture(t);
  for (const path of ['/v1/profile', '/v1/bootstrap', '/v1/trucks', '/v1/contacts', '/v1/trips']) {
    assert.equal((await f.app.inject({ method: 'GET', url: path })).statusCode, 401);
  }
  const profile = await f.req('GET', '/v1/profile');
  assert.deepEqual(profile.body, { id: f.me.id, phone: '+5511999990000', phoneVerified: true, readAt: '2026-10-17T12:00:00.000Z' });
  const stranger = await f.req('GET', '/v1/profile', undefined, f.stranger);
  assert.equal(stranger.status, 200);
  assert.notEqual(stranger.body.id, f.me.id);
});

// readAt is the server clock at request time, never a client-derived value.
test('every read response carries the server as-of timestamp', async t => {
  const f = await fixture(t);
  for (const path of ['/v1/profile', '/v1/trucks', '/v1/contacts', '/v1/trips', '/v1/bootstrap']) {
    const response = await f.req('GET', path);
    assert.equal(response.status, 200);
    assert.equal(response.body.readAt, '2026-10-17T12:00:00.000Z', path);
  }
});

// Q43 FIX 5560657565: one response must be one snapshot, not five read-committed peeks.
test('readTransaction is a repeatable read-only snapshot', async t => {
  const f = await fixture(t);
  const { readTransaction } = await import('../dist/db.js');
  const isolation = await readTransaction(f.ctx.pool, async client =>
    (await client.query(`SELECT current_setting('transaction_isolation') AS level`)).rows[0].level);
  assert.equal(isolation, 'repeatable read');
  await readTransaction(f.ctx.pool, async client => {
    const before = (await client.query('SELECT count(*)::int AS n FROM trucks')).rows[0].n;
    // A concurrent committed write must not become visible mid-transaction.
    await f.ctx.pool.query(`INSERT INTO trucks VALUES (gen_random_uuid(), $1, 'concurrent')`, [f.me.id]);
    const after = (await client.query('SELECT count(*)::int AS n FROM trucks')).rows[0].n;
    assert.equal(after, before);
  });
  await assert.rejects(
    readTransaction(f.ctx.pool, client => client.query(`INSERT INTO trucks VALUES (gen_random_uuid(), $1, 'forbidden')`, [f.me.id])),
    /read-only/i);
});

// Ownership filters stop another driver's trucks appearing in the web bootstrap list.
test('truck list returns only owned trucks in stable bounded order', async t => {
  const f = await fixture(t);
  await f.req('POST', '/v1/trucks', { label: 'B truck' });
  await f.req('POST', '/v1/trucks', { label: 'A truck' });
  await f.req('POST', '/v1/trucks', { label: 'STRANGER truck' }, f.stranger);
  const response = await f.req('GET', '/v1/trucks');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.trucks.map(truck => truck.label), ['A truck', 'B truck']);
  assert.deepEqual(response.body.trucks.map(truck => Object.keys(truck).sort()), [['id', 'label'], ['id', 'label']]);
  const stranger = await f.req('GET', '/v1/trucks', undefined, f.stranger);
  assert.deepEqual(stranger.body.trucks.map(truck => truck.label), ['STRANGER truck']);
  await f.ctx.pool.query(`INSERT INTO trucks SELECT gen_random_uuid(), $1, 'bulk ' || g FROM generate_series(1, 101) g`, [f.me.id]);
  const capped = await f.req('GET', '/v1/trucks');
  assert.equal(capped.body.trucks.length, 100);
  assert.equal(capped.body.limit, 100);
  assert.equal(capped.body.hasMore, true);
});

// Standing contact state must remain truthful after acceptance and revocation.
test('standing contact list shows driver-owned pending, accepted and revoked states only', async t => {
  const f = await fixture(t);
  const pending = await f.req('POST', '/v1/contacts', { contactId: f.contactIdentity.id, phone: '+5511999990000', map: true, incident: false });
  assert.equal(pending.status, 200);
  const contact2 = await f.token('contact-2');
  const contact2Id = (await f.req('GET', '/v1/me', undefined, contact2)).body.id;
  const accepted = await f.req('POST', '/v1/contacts', { contactId: contact2Id, phone: '+5511999990000', map: false, incident: true });
  assert.equal(accepted.status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${accepted.body.id}/accept`, { map: false, incident: true }, contact2)).status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${accepted.body.id}/revoke`, {}, contact2)).status, 200);
  const strangerInvite = await f.req('POST', '/v1/contacts', { contactId: f.contactIdentity.id, phone: '+5511999990000', map: true, incident: true }, f.stranger);
  assert.equal(strangerInvite.status, 200);
  const response = await f.req('GET', '/v1/contacts');
  assert.equal(response.status, 200);
  assert.equal(response.body.contacts.length, 2);
  const byId = new Map(response.body.contacts.map(contact => [contact.id, contact]));
  const pendingRow = byId.get(pending.body.id);
  assert.equal(pendingRow.status, 'pending');
  assert.deepEqual(pendingRow.map, { requested: true, accepted: false });
  assert.deepEqual(pendingRow.incident, { requested: false, accepted: false });
  assert.equal(pendingRow.acceptedAt, null);
  assert.equal(pendingRow.revokedAt, null);
  assert.equal(pendingRow.revokedBy, null);
  const revokedRow = byId.get(accepted.body.id);
  assert.equal(revokedRow.status, 'revoked');
  assert.equal(revokedRow.contactId, contact2Id);
  assert.equal(revokedRow.phone, '+5511999990000');
  assert.deepEqual(revokedRow.map, { requested: false, accepted: false });
  assert.deepEqual(revokedRow.incident, { requested: true, accepted: true });
  assert.ok(revokedRow.acceptedAt);
  assert.ok(revokedRow.revokedAt);
  assert.equal(revokedRow.revokedBy, 'contact');
  assert.ok(!response.body.contacts.some(contact => contact.id === strangerInvite.body.id));
});

// Active and recent lists expose the persisted trip summary without draft text or coordinates.
test('trip list returns active and recent owned trips without raw text or coordinates', async t => {
  const f = await fixture(t);
  const grant = await f.grant();
  const active = await f.trip([grant]);
  const closed = await f.trip([]);
  assert.equal((await f.req('POST', `/v1/trips/${closed}/commands`, { type: 'arrived' })).status, 200);
  const strangerDraft = await f.draft({}, f.stranger);
  assert.equal(strangerDraft.status, 200);
  const strangerTrip = await f.req('POST', `/v1/trip-drafts/${strangerDraft.body.id}/confirm`, { confirmed: true, contactGrantIds: [] }, f.stranger);
  assert.equal(strangerTrip.status, 200);
  const response = await f.req('GET', '/v1/trips');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.limits, { active: 50, recent: 20 });
  assert.deepEqual(response.body.hasMore, { active: false, recent: false });
  const activeTrip = response.body.active.find(trip => trip.id === active);
  const recentTrip = response.body.recent.find(trip => trip.id === closed);
  assert.ok(activeTrip);
  assert.ok(recentTrip);
  assert.equal(activeTrip.status, 'active');
  assert.equal(activeTrip.mapActive, true);
  assert.equal(activeTrip.checkinsActive, true);
  assert.equal(activeTrip.paused, false);
  assert.equal(activeTrip.origin, 'A');
  assert.equal(activeTrip.destination, 'B');
  assert.equal(activeTrip.country, 'BR');
  assert.equal(activeTrip.locale, 'pt-BR');
  assert.equal(activeTrip.timeZone, 'America/Sao_Paulo');
  assert.deepEqual(activeTrip.contactGrantIds, [grant]);
  assert.equal(recentTrip.status, 'arrived');
  assert.ok(recentTrip.closedAt);
  assert.ok(!response.body.active.some(trip => trip.id === strangerTrip.body.id));
  assert.ok(!response.body.recent.some(trip => trip.id === strangerTrip.body.id));
  for (const key of ['rawText', 'latitude', 'longitude', 'location', 'phone']) assert.ok(!(key in activeTrip));
});

// Bootstrap returns the same owner-scoped persisted records in one reload-safe read.
test('bootstrap bundles profile and owner lists with explicit bounds', async t => {
  const f = await fixture(t);
  const grant = await f.grant();
  const trip = await f.trip([grant]);
  const response = await f.req('GET', '/v1/bootstrap');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.profile, { id: f.me.id, phone: '+5511999990000', phoneVerified: true });
  assert.equal(response.body.trucks.length, 1);
  assert.equal(response.body.contacts.length, 1);
  assert.equal(response.body.contacts[0].id, grant);
  assert.equal(response.body.trips.active.length, 1);
  assert.equal(response.body.trips.active[0].id, trip);
  assert.deepEqual(response.body.trips.active[0].contactGrantIds, [grant]);
  assert.deepEqual(response.body.limits, { trucks: 100, contacts: 100, activeTrips: 50, recentTrips: 20 });
  assert.deepEqual(response.body.hasMore, { trucks: false, contacts: false, activeTrips: false, recentTrips: false });
  const stranger = await f.req('GET', '/v1/bootstrap', undefined, f.stranger);
  assert.equal(stranger.status, 200);
  assert.notEqual(stranger.body.profile.id, f.me.id);
  assert.equal(stranger.body.trucks.length, 0);
  assert.equal(stranger.body.contacts.length, 0);
  assert.equal(stranger.body.trips.active.length, 0);
  assert.equal(stranger.body.trips.recent.length, 0);
});
