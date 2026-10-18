import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './helpers/runtime.mjs';

test('recipient discovery lists own invitations by scope', async t => {
  const f = await fixture(t);
    const pending = await f.req('POST', '/v1/contacts', { contactId: f.contactIdentity.id, phone: '+5511999990000', map: true, incident: false });
    assert.equal(pending.status, 200);
    const empty = await f.req('GET', '/v1/contact/trips', undefined, f.contact);
    assert.equal(empty.status, 200); assert.deepEqual(empty.body.trips, []); assert.equal(empty.body.hasMore, false); assert.equal(empty.body.limit, 100); assert.equal(typeof empty.body.readAt, 'string');

    const inbox = await f.req('GET', '/v1/contact/invitations', undefined, f.contact);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.invitations.length, 1); assert.equal(inbox.body.limit, 100); assert.equal(inbox.body.hasMore, false); assert.equal(typeof inbox.body.readAt, 'string');
    const row = inbox.body.invitations[0];
    assert.equal(row.id, pending.body.id); assert.equal(row.driverId, f.me.id);
    assert.deepEqual(row.requested, { map: true, incident: false });
    assert.deepEqual(row.accepted, { map: false, incident: false });
    assert.equal(row.status, 'pending'); assert.equal(row.acceptedAt, null); assert.equal(row.revokedAt, null);

    const badAccept = await f.req('POST', `/v1/contacts/${pending.body.id}/accept`, { map: true, incident: true }, f.contact);
    assert.equal(badAccept.status, 400);
    assert.equal((await f.req('POST', `/v1/contacts/${pending.body.id}/accept`, { map: true, incident: false }, f.contact)).status, 200);
    const accepted = (await f.req('GET', '/v1/contact/invitations', undefined, f.contact)).body.invitations[0];
    assert.equal(accepted.status, 'accepted'); assert.equal(typeof accepted.acceptedAt, 'string');
    assert.deepEqual(accepted.accepted, { map: true, incident: false });

    assert.equal((await f.req('GET', '/v1/contact/trips', undefined, f.contact)).body.trips.length, 0);

    const trip = await f.trip([pending.body.id]);
    const shared = await f.req('GET', '/v1/contact/trips', undefined, f.contact);
    assert.equal(shared.body.trips.length, 1);
    const tripRow = shared.body.trips[0];
    assert.equal(tripRow.tripId, trip); assert.equal(tripRow.grantId, pending.body.id); assert.equal(tripRow.driverId, f.me.id);
    assert.equal(tripRow.status, 'active');
    assert.deepEqual(tripRow.scopes, { map: true, incident: false });
    assert.equal(tripRow.activeIncidentId, null);

    const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {});
    assert.equal(sos.status, 200);
    const duringIncident = await f.req('GET', '/v1/contact/trips', undefined, f.contact);
    assert.equal(duringIncident.body.trips[0].activeIncidentId, null);

    assert.equal((await f.req('POST', `/v1/contacts/${pending.body.id}/revoke`, {})).status, 200);
    const revokedInbox = (await f.req('GET', '/v1/contact/invitations', undefined, f.contact)).body.invitations[0];
    assert.equal(revokedInbox.status, 'revoked'); assert.equal(typeof revokedInbox.revokedAt, 'string');
    assert.deepEqual(revokedInbox.accepted, { map: true, incident: false });
    assert.deepEqual((await f.req('GET', '/v1/contact/trips', undefined, f.contact)).body.trips, []);
});

test('recipient trip discovery exposes active incident only to incident consent and survives arrival', async t => {
  const f = await fixture(t);

    const grant = await f.grant();
    const trip = await f.trip([grant]);
    const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {});
    assert.equal(sos.status, 200);

    const open = await f.req('GET', '/v1/contact/trips', undefined, f.contact);
    assert.equal(open.body.trips.length, 1);
    assert.equal(open.body.trips[0].activeIncidentId, sos.body.id);
    assert.deepEqual(open.body.trips[0].scopes, { map: true, incident: true });

    assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, { type: 'arrived' })).status, 200);
    const closed = await f.req('GET', '/v1/contact/trips', undefined, f.contact);
    assert.equal(closed.body.trips.length, 1);
    assert.equal(closed.body.trips[0].status, 'arrived');
    assert.equal(closed.body.trips[0].activeIncidentId, sos.body.id);
    assert.equal(closed.body.trips[0].scopes.map, false);

    assert.equal((await f.req('POST', `/v1/incidents/${sos.body.id}/resolve`, {})).status, 200);
    assert.deepEqual((await f.req('GET', '/v1/contact/trips', undefined, f.contact)).body.trips, []);
});

test('per-trip revocation removes the shared reference; other trips stay', async t => {
  const f = await fixture(t);

    const grant = await f.grant();
    const first = await f.trip([grant]); const second = await f.trip([grant]);
    assert.equal((await f.req('POST', `/v1/trips/${first}/contacts/${grant}/revoke`, {})).status, 200);
    const shared = await f.req('GET', '/v1/contact/trips', undefined, f.contact);
    assert.equal(shared.body.trips.length, 1); assert.equal(shared.body.trips[0].tripId, second);
    const inbox = (await f.req('GET', '/v1/contact/invitations', undefined, f.contact)).body.invitations;
    assert.equal(inbox.length, 1); assert.equal(inbox[0].status, 'accepted');
});

test('recipient lists are actor-bound, hide other identities, and stay read-only', async t => {
  const f = await fixture(t);

    await f.grant();
    const strangerInvite = await f.req('POST', '/v1/contacts', { contactId: f.contactIdentity.id, phone: '+5511999990000', map: true, incident: true }, f.stranger);
    assert.equal(strangerInvite.status, 200);

    const inbox = await f.req('GET', '/v1/contact/invitations', undefined, f.contact);
    assert.equal(inbox.body.invitations.length, 2);
    assert.deepEqual(inbox.body.invitations.map(row => row.driverId).sort(), [f.me.id, (await f.req('GET', '/v1/me', undefined, f.stranger)).body.id].sort());

    const strangerInbox = await f.req('GET', '/v1/contact/invitations', undefined, f.stranger);
    assert.equal(strangerInbox.status, 200); assert.deepEqual(strangerInbox.body.invitations, []);
    assert.deepEqual((await f.req('GET', '/v1/contact/trips', undefined, f.stranger)).body.trips, []);

    const anonymous = await f.app.inject({ method: 'GET', url: '/v1/contact/invitations' });
    assert.equal(anonymous.statusCode, 401); assert.equal(anonymous.headers['cache-control'], 'no-store');
    const anonymousTrips = await f.app.inject({ method: 'GET', url: '/v1/contact/trips' });
    assert.equal(anonymousTrips.statusCode, 401); assert.equal(anonymousTrips.headers['cache-control'], 'no-store');
});

test('recipient lists are bounded at 100 with truthful hasMore', async t => {
  const f = await fixture(t);

    for (let i = 0; i < 101; i++) {
      await f.ctx.pool.query('INSERT INTO identities(id,issuer,subject,phone,phone_verified) VALUES($1,$2,$3,$4,true)', [randomUUID(), 'synthetic', `bound-${i}`, `+55110000${String(i).padStart(4, '0')}`]);
    }
    const drivers = (await f.ctx.pool.query("SELECT id FROM identities WHERE issuer='synthetic' AND subject LIKE 'bound-%'")).rows.map(row => row.id);
    for (const driverId of drivers) {
      await f.ctx.pool.query('INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested) VALUES($1,$2,$3,$4,true,false)', [randomUUID(), driverId, f.contactIdentity.id, '+5511999990000']);
    }
    const inbox = await f.req('GET', '/v1/contact/invitations', undefined, f.contact);
    assert.equal(inbox.status, 200); assert.equal(inbox.body.invitations.length, 100); assert.equal(inbox.body.hasMore, true); assert.equal(inbox.body.limit, 100);
    const ids = inbox.body.invitations.map(row => row.id);
    assert.deepEqual(ids, [...ids].sort());
});
