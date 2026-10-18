// Real SQL + signed synthetic JWT integration. No provider transport or real identities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactJourney } from '../../src/features/contacts/journey.ts';

// Keep the standalone state suite dependency-free when no disposable DB is supplied.
const fixture = async t => (await import('../../../tests/helpers/runtime.mjs')).fixture(t);

const persisted = (name, run) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'run the isolated persisted scenario runner' }, run);

// Test-only transport: uses real backend routes and real signed tokens, not a login bypass.
function browser(f, getToken) {
  async function request(method, path, body, options) {
    const token = getToken(); // Capture the authenticated context at request start.
    const response = await f.req(method, path, body, token, options.idempotencyKey);
    if (response.status !== 200) throw Object.assign(new Error(response.body.code), { status: response.status });
    return response.body;
  }
  return createContactJourney({
    inviteContact: (body, o) => request('POST', '/v1/contacts', body, o),
    acceptContact: (id, body, o) => request('POST', `/v1/contacts/${id}/accept`, body, o),
    revokeContact: (id, o) => request('POST', `/v1/contacts/${id}/revoke`, {}, o),
    revokeTripContact: (tripId, id, o) => request('POST', `/v1/trips/${tripId}/contacts/${id}/revoke`, {}, o),
    getTripSnapshot: (id, o) => request('GET', `/v1/trips/${id}/snapshot`, undefined, o),
    getIncident: (id, o) => request('GET', `/v1/incidents/${id}`, undefined, o),
    acknowledgeIncident: (id, o) => request('POST', `/v1/incidents/${id}/acknowledgements`, {}, o),
    reportIncidentAction: (id, body, o) => request('POST', `/v1/incidents/${id}/actions`, body, o),
    resolveIncident: (id, o) => request('POST', `/v1/incidents/${id}/resolve`, {}, o),
  });
}
function signIn(journey, actorId, view, tripId, driverId) {
  journey.setSession({ actorId, view });
  if (tripId) journey.selectTrip({ id: tripId, driverId });
}
async function invite(f, journey) {
  signIn(journey, f.me.id, 'driver');
  assert.equal(await journey.inviteContact({ contactId: f.contactIdentity.id, phone: '+15555550100', map: true, incident: true }), 'recorded');
  return journey.getState().invitation;
}
async function sos(f, tripId) {
  const response = await f.req('POST', `/v1/trips/${tripId}/sos`, {});
  assert.equal(response.status, 200);
  return response.body.id;
}

persisted('persisted: narrowed consent denies maps while incident response survives arrival', async t => {
  const f = await fixture(t);
  let token = f.driver;
  const journey = browser(f, () => token);
  const invitation = await invite(f, journey);
  token = await f.token('contact', { phone_number_verified: false });
  signIn(journey, f.contactIdentity.id, 'contact');
  assert.equal(await journey.acceptInvitation(invitation, { map: false, incident: true }), 'rejected');
  assert.equal(journey.getState().operation.failure, 'conflict');
  token = f.contact;
  signIn(journey, f.contactIdentity.id, 'contact');
  assert.equal(await journey.acceptInvitation(invitation, { map: false, incident: true }), 'recorded');
  const tripId = await f.trip([invitation.id]);
  const incidentId = await sos(f, tripId);
  journey.selectTrip({ id: tripId, driverId: f.me.id });
  assert.equal(await journey.loadLocation(), 'unavailable');
  assert.equal(journey.getState().location.status, 'denied');
  assert.equal(await journey.loadIncident(incidentId), 'recorded');
  assert.equal(await journey.acknowledge(), 'recorded');
  assert.equal(await journey.reportAction('SYNTHETIC: cannot assist at present'), 'recorded');
  assert.equal(await journey.reportAction('SYNTHETIC: later reports calling support; not independently corroborated'), 'recorded');
  assert.equal((await f.ctx.pool.query('SELECT status FROM incidents WHERE id=$1', [incidentId])).rows[0].status, 'active');
  const count = await f.ctx.pool.query('SELECT count(*)::int AS count FROM incident_events WHERE incident_id=$1', [incidentId]);
  assert.equal(count.rows[0].count, 4); // SOS + acknowledgement + two separate action reports.
  assert.equal((await f.req('POST', `/v1/trips/${tripId}/commands`, { type: 'arrived' })).status, 200);
  assert.equal(await journey.loadIncident(incidentId), 'recorded');
  assert.equal(journey.getState().incident.data.status, 'active');
  assert.equal(await journey.acknowledge(), 'recorded');
  assert.throws(() => journey.resolve());
});

persisted('persisted: fresh browser instances observe trip revoke and standing revoke independently', async t => {
  const f = await fixture(t);
  let token = f.driver;
  let journey = browser(f, () => token);
  const invitation = await invite(f, journey);
  token = f.contact;
  signIn(journey, f.contactIdentity.id, 'contact');
  await journey.acceptInvitation(invitation, { map: true, incident: true });
  const tripId = await f.trip([invitation.id]);
  const incidentId = await sos(f, tripId);
  assert.equal((await f.req('POST', `/v1/trips/${tripId}/locations`, { observations: [{ capturedAt: f.ctx.clock().toISOString(), latitude: 0, longitude: 0, accuracy: 15 }] })).status, 200);
  f.advance(121_000);
  journey.selectTrip({ id: tripId, driverId: f.me.id });
  assert.equal(await journey.loadLocation(), 'recorded');
  assert.equal(journey.getState().location.data.freshness, 'stale');
  assert.equal(journey.getState().location.data.ageMs, 121_000);
  const lateRead = journey.loadLocation();
  assert.equal(await journey.revokeTrip(invitation.id), 'recorded');
  assert.equal(await lateRead, 'superseded');
  assert.equal(journey.getState().location.data, null);
  // Recreate the browser journey: denial comes from persisted SQL, not local flags.
  journey = browser(f, () => token);
  signIn(journey, f.contactIdentity.id, 'contact', tripId, f.me.id);
  assert.equal(await journey.loadLocation(), 'unavailable');
  assert.equal(await journey.loadIncident(incidentId), 'unavailable');
  // Standing consent still permits a distinct trip after only a trip-level revoke.
  const nextTrip = await f.trip([invitation.id]);
  journey.selectTrip({ id: nextTrip, driverId: f.me.id });
  assert.equal(await journey.loadLocation(), 'recorded');
  assert.equal(journey.getState().location.data.freshness, 'unavailable');
  assert.equal(await journey.revokeStanding(invitation.id), 'recorded');
  journey = browser(f, () => token);
  signIn(journey, f.contactIdentity.id, 'contact', nextTrip, f.me.id);
  assert.equal(await journey.loadLocation(), 'unavailable');
  const draft = await f.draft();
  assert.equal((await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, { confirmed: true, contactGrantIds: [invitation.id] })).status, 409);
});

persisted('persisted: local role/identity claims never replace authenticated credentials or driver resolution', async t => {
  const f = await fixture(t);
  const grant = await f.grant();
  const tripId = await f.trip([grant]);
  const incidentId = await sos(f, tripId);
  let token = f.contact;
  const journey = browser(f, () => token);
  signIn(journey, f.contactIdentity.id, 'contact', tripId, f.me.id);
  assert.equal(await journey.loadIncident(incidentId), 'recorded');
  await journey.acknowledge();
  // A forged local driver view still holds the contact JWT: backend refuses resolve.
  signIn(journey, f.me.id, 'driver', tripId, f.me.id);
  assert.equal(await journey.loadIncident(incidentId), 'recorded');
  assert.equal(await journey.resolve(), 'rejected');
  assert.equal(journey.getState().operation.failure, 'forbidden');
  assert.equal((await f.ctx.pool.query('SELECT status FROM incidents WHERE id=$1', [incidentId])).rows[0].status, 'active');
  token = f.stranger;
  signIn(journey, f.contactIdentity.id, 'contact', tripId, f.me.id);
  assert.equal(await journey.loadIncident(incidentId), 'unavailable');
  assert.equal(journey.getState().incident.data, null);
  assert.deepEqual(journey.getState().receipts, []);
  token = f.driver;
  signIn(journey, f.me.id, 'driver', tripId, f.me.id);
  assert.equal(await journey.loadIncident(incidentId), 'recorded');
  assert.equal(await journey.resolve(), 'recorded');
  assert.equal(journey.getState().incident.data, null); // Resolve response supplies no timestamp.
  assert.equal(await journey.loadIncident(incidentId), 'recorded');
  assert.equal(journey.getState().incident.data.status, 'resolved');
  token = f.contact;
  const reloaded = browser(f, () => token);
  signIn(reloaded, f.contactIdentity.id, 'contact', tripId, f.me.id);
  await reloaded.loadIncident(incidentId);
  assert.equal(reloaded.getState().incident.data.status, 'resolved');
  assert.throws(() => reloaded.acknowledge());
});
