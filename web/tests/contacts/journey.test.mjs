import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactJourney, locationAge } from '../../src/features/contacts/journey.ts';
import { ids, hint, point, incident, deferred, httpError, apiFixture } from './fixtures.mjs';

function setup(view = 'contact', overrides) {
  const transport = apiFixture(overrides);
  let key = 0;
  const journey = createContactJourney(transport.api, () => `synthetic-key-${++key}`);
  journey.setSession({ actorId: ids[view], view });
  journey.selectTrip({ id: ids.trip, driverId: ids.driver });
  return { journey, ...transport };
}

test('a contact route needs no invented driver identity and cannot acquire owner resolution', async () => {
  const { journey, calls } = setup();
  journey.selectContactTrip(ids.trip);
  assert.equal(journey.getState().trip.driverId, null);
  await journey.loadLocation();
  await journey.loadIncident(ids.incident);
  await journey.acknowledge();
  assert.throws(() => journey.resolve());
  assert.equal(calls.some(call => call.method === 'resolveIncident'), false);
  journey.setSession({ actorId: ids.driver, view: 'driver' });
  assert.throws(() => journey.selectContactTrip(ids.trip));
  assert.equal(journey.getState().trip, null);
});

test('invitation is only pending after an API receipt and sends no participant notification', async () => {
  const { journey, calls } = setup('driver');
  assert.equal(await journey.inviteContact({ contactId: ids.contact, phone: '+5511000000000', map: true, incident: true }), 'recorded');
  assert.equal(journey.getState().invitation.status, 'pending');
  assert.equal(journey.getState().invitation.accepted, null);
  assert.deepEqual(calls.map(call => call.method), ['inviteContact']);
  assert.equal(calls[0].args[1].idempotencyKey, 'synthetic-key-1');
});

test('acceptance narrows scopes and is never an authorization for a protected cached view', async () => {
  const { journey, calls } = setup();
  assert.equal(await journey.acceptInvitation(hint(), { map: false, incident: true }), 'recorded');
  assert.deepEqual(calls[0].args[1], { map: false, incident: true });
  assert.deepEqual(journey.getState().invitation.accepted, { map: false, incident: true });
  assert.equal(journey.getState().privacy.currentAuthorization, 'requires-server-check');
  assert.throws(() => journey.acceptInvitation({ ...hint(), requested: { map: false, incident: true } }, { map: true, incident: true }));
  assert.equal(calls.length, 1);
});

test('wrong identity, self invitation and missing scope cannot issue a command', () => {
  const { journey, calls } = setup('driver');
  assert.throws(() => journey.inviteContact({ contactId: ids.driver, phone: '+5511000000000', map: true, incident: true }));
  assert.throws(() => journey.inviteContact({ contactId: ids.contact, phone: '123', map: true, incident: true }));
  assert.throws(() => journey.acceptInvitation(hint(), { map: true, incident: true }));
  assert.equal(calls.length, 0);
});

test('unverified phone conflict is rejected without manufacturing an acceptance', async () => {
  const { journey } = setup('contact', { acceptContact: () => { throw httpError(409); } });
  assert.equal(await journey.acceptInvitation(hint(), { map: true, incident: false }), 'rejected');
  assert.equal(journey.getState().operation.failure, 'conflict');
  assert.equal(journey.getState().invitation, null);
});

test('protected location keeps source, receipt, read instant and old age separately', async () => {
  const { journey } = setup();
  await journey.loadLocation();
  const snapshot = journey.getState().location.data;
  assert.deepEqual(snapshot, point());
  const asOfRead = locationAge(snapshot);
  assert.equal(asOfRead.ageMs, 180_000);
  assert.equal(asOfRead.asOf, 'server-read');
  assert.equal(asOfRead.serverFreshnessAtRead, 'stale');
  assert.equal(asOfRead.live, false);
});

test('absent location is explicitly unavailable, malformed and cross-trip snapshots never render', async () => {
  const absent = setup('contact', { getTripSnapshot: () => ({ tripId: ids.trip, location: null, freshness: 'unavailable', ageMs: null, readAt: point().readAt }) });
  assert.equal(await absent.journey.loadLocation(), 'recorded');
  assert.equal(locationAge(absent.journey.getState().location.data).ageMs, null);
  for (const response of [{ ...point(), tripId: ids.other }, { ...point(), ageMs: -1 }, { ...point(), location: { ...point().location, latitude: 100 } }]) {
    const { journey } = setup('contact', { getTripSnapshot: () => response });
    assert.equal(await journey.loadLocation(), 'unavailable');
    assert.equal(journey.getState().location.data, null);
  }
});

test('auth/consent denial clears all protected data and preserves error distinctions', async () => {
  for (const [status, category] of [[401, 'authentication'], [403, 'forbidden'], [404, 'missing'], [409, 'conflict'], [422, 'unsupported'], [500, 'server']]) {
    let denied = false;
    const { journey } = setup('contact', { acknowledgeIncident: () => { throw httpError(status); },
      getTripSnapshot: () => { if (denied) throw httpError(status); return point(); } });
    await journey.loadIncident(ids.incident);
    await journey.loadLocation();
    await journey.acknowledge();
    assert.equal(journey.getState().operation.failure, category);
    if ([401, 403, 404].includes(status)) {
      assert.equal(journey.getState().location.data, null);
      assert.equal(journey.getState().incident.data, null);
    }
    if (status === 401) assert.equal(journey.getState().session, null);
    else {
      denied = true;
      await journey.loadLocation();
      assert.equal(journey.getState().location.data, null);
    }
  }
});

test('role, identity and trip changes discard protected caches and late responses', async () => {
  for (const change of [
    j => j.setSession(null),
    j => j.setSession({ actorId: ids.other, view: 'contact' }),
    j => j.setSession({ actorId: ids.driver, view: 'driver' }),
    j => j.selectTrip({ id: ids.other, driverId: ids.driver }),
  ]) {
    const pending = deferred();
    const { journey, calls } = setup('contact', { getTripSnapshot: () => pending.promise });
    const read = journey.loadLocation();
    change(journey);
    assert.equal(calls[0].args[1].signal.aborted, true);
    pending.resolve(point());
    assert.equal(await read, 'superseded');
    assert.equal(journey.getState().location.data, null);
    assert.deepEqual(journey.getState().receipts, []);
  }
});

test('a slower previous read cannot overwrite the newer protected snapshot', async () => {
  const delayed = deferred(); let count = 0;
  const { journey } = setup('contact', { getTripSnapshot: () => ++count === 1 ? delayed.promise : { ...point(), ageMs: 181_000 } });
  const old = journey.loadLocation();
  await journey.loadLocation();
  delayed.resolve(point());
  assert.equal(await old, 'superseded');
  assert.equal(journey.getState().location.data.ageMs, 181_000);
});

test('standing and trip revoke conceal data before the write and invalidate previous reads', async () => {
  for (const scope of ['standing', 'trip']) {
    const pending = deferred(); const revoke = deferred();
    const { journey } = setup('contact', { getTripSnapshot: () => pending.promise,
      revokeContact: () => revoke.promise, revokeTripContact: () => revoke.promise });
    await journey.acceptInvitation(hint(), { map: true, incident: true });
    const read = journey.loadLocation();
    const write = scope === 'standing' ? journey.revokeStanding(ids.grant) : journey.revokeTrip(ids.grant);
    assert.equal(journey.getState().location.data, null);
    await assert.rejects(journey.loadLocation(), /revocation/);
    pending.resolve(point());
    assert.equal(await read, 'superseded');
    revoke.resolve({ id: ids.grant, revoked: true, ...(scope === 'trip' ? { tripId: ids.trip } : {}) });
    assert.equal(await write, 'recorded');
    const state = journey.getState();
    assert.equal(state.location.data, null);
    if (scope === 'standing') assert.equal(state.invitation.status, 'revoked');
    else assert.equal(state.privacy.tripReceipt, 'revoked');
    assert.equal(state.privacy.previouslyAuthorizedWork, 'may-still-complete');
  }
});

test('a denied command invalidates an in-flight protected read before it can reveal data', async () => {
  const pending = deferred();
  const { journey } = setup('contact', { getTripSnapshot: () => pending.promise, acknowledgeIncident: () => { throw httpError(403); } });
  await journey.loadIncident(ids.incident);
  const read = journey.loadLocation();
  await journey.acknowledge();
  pending.resolve(point());
  assert.equal(await read, 'superseded');
  assert.equal(journey.getState().location.data, null);
});

test('ambiguous writes never auto-replay; explicit retry reuses the exact key and body', async () => {
  let count = 0;
  const { journey, calls } = setup('contact', { reportIncidentAction: () => {
    if (++count === 1) throw new TypeError('network lost after possible commit');
    return { id: ids.incident, status: 'active', recorded: 'action' };
  } });
  await journey.loadIncident(ids.incident);
  assert.equal(await journey.reportAction('SYNTHETIC: cannot assist; reported availability only'), 'uncertain');
  assert.equal(calls.filter(call => call.method === 'reportIncidentAction').length, 1);
  await assert.rejects(journey.reportAction('different action'), /unchanged command/);
  assert.equal(await journey.retryUncertainCommand(), 'recorded');
  const writes = calls.filter(call => call.method === 'reportIncidentAction');
  assert.equal(writes[0].args[2].idempotencyKey, writes[1].args[2].idempotencyKey);
  assert.deepEqual(writes[0].args[1], writes[1].args[1]);
  assert.equal(journey.getState().receipts.length, 1);
  assert.equal(journey.getState().incident.data.status, 'active');
});

test('contact acknowledgement and contradictory reported actions never resolve the incident', async () => {
  const { journey, calls } = setup();
  await journey.loadIncident(ids.incident);
  await journey.acknowledge();
  await journey.reportAction('SYNTHETIC: unable to assist');
  await journey.reportAction('SYNTHETIC: later reports calling support; not verified help');
  assert.equal(journey.getState().incident.data.status, 'active');
  assert.deepEqual(journey.getState().receipts.map(value => value.recorded), ['acknowledged', 'action', 'action']);
  assert.equal(calls.some(call => call.method === 'resolveIncident'), false);
  assert.throws(() => journey.resolve());
  assert.throws(() => journey.reportAction('  '));
  assert.throws(() => journey.reportAction('x'.repeat(301)));
});

test('driver-only resolution requires a new read and invalidates pre-resolution protected reads', async () => {
  const delayed = deferred();
  const { journey } = setup('driver', { getTripSnapshot: () => delayed.promise });
  await journey.loadIncident(ids.incident);
  const read = journey.loadLocation();
  assert.equal(await journey.resolve(), 'recorded');
  assert.equal(journey.getState().incident.data, null);
  delayed.resolve(point());
  assert.equal(await read, 'superseded');
  assert.equal(journey.getState().location.data, null);
  journey.setSession({ actorId: ids.contact, view: 'driver' });
  journey.selectTrip({ id: ids.trip, driverId: ids.driver });
  await journey.loadIncident(ids.incident);
  assert.throws(() => journey.resolve(), /Only the driver/);
});

test('a late acknowledged write cannot add another identity’s receipt after role switch', async () => {
  const delayed = deferred();
  const { journey } = setup('contact', { acknowledgeIncident: () => delayed.promise });
  await journey.loadIncident(ids.incident);
  const pending = journey.acknowledge();
  journey.setSession({ actorId: ids.driver, view: 'driver' });
  delayed.resolve({ id: ids.incident, status: 'active', recorded: 'acknowledged' });
  assert.equal(await pending, 'superseded');
  assert.deepEqual(journey.getState().receipts, []);
  assert.throws(() => journey.retryUncertainCommand());
});

test('uncertain revoke conceals data until explicit same-key retry confirms the receipt', async () => {
  let attempts = 0;
  const { journey, calls } = setup('contact', { revokeContact: id => {
    if (++attempts === 1) throw new TypeError('possible committed revoke');
    return { id, revoked: true };
  } });
  await journey.loadLocation();
  assert.equal(await journey.revokeStanding(ids.grant), 'uncertain');
  await assert.rejects(journey.loadLocation(), /revocation/);
  assert.equal(journey.getState().location.data, null);
  assert.equal(await journey.retryUncertainCommand(), 'recorded');
  const writes = calls.filter(call => call.method === 'revokeContact');
  assert.equal(writes[0].args[1].idempotencyKey, writes[1].args[1].idempotencyKey);
});

test('a refused retry cannot erase the original unknown revoke outcome or reopen protected reads', async () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    let attempts = 0;
    const { journey, calls } = setup('contact', { revokeContact: id => {
      if (++attempts === 1) throw new TypeError('response lost after possible commit');
      if (attempts === 2) throw httpError(status);
      return { id, revoked: true };
    } });
    assert.equal(await journey.revokeStanding(ids.grant), 'uncertain');
    assert.equal(await journey.retryUncertainCommand(), 'uncertain');
    assert.equal(journey.getState().operation.status, 'uncertain');
    assert.equal(journey.getState().location.data, null);
    const writes = calls.filter(call => call.method === 'revokeContact');
    assert.equal(writes.length, 2);
    assert.equal(writes[0].args[1].idempotencyKey, writes[1].args[1].idempotencyKey);
    if (status === 401) {
      assert.equal(journey.getState().session, null);
      assert.throws(() => journey.retryUncertainCommand());
    } else {
      await assert.rejects(journey.loadLocation(), /revocation/);
      assert.equal(await journey.retryUncertainCommand(), 'recorded');
    }
  }
});

test('a known first-attempt conflict remains rejected; an unknown action survives a later read denial', async () => {
  const known = setup('contact', { revokeContact: () => { throw httpError(409); } });
  assert.equal(await known.journey.revokeStanding(ids.grant), 'rejected');
  assert.equal(known.journey.getState().operation.status, 'rejected');
  assert.throws(() => known.journey.retryUncertainCommand());
  let attempts = 0;
  const { journey } = setup('contact', { reportIncidentAction: () => {
    if (++attempts === 1) throw new TypeError('response lost');
    throw httpError(409);
  }, getTripSnapshot: () => { throw httpError(403); } });
  await journey.loadIncident(ids.incident);
  assert.equal(await journey.reportAction('SYNTHETIC: reports requesting support'), 'uncertain');
  await journey.loadLocation();
  assert.equal(journey.getState().operation.status, 'uncertain');
  assert.equal(await journey.retryUncertainCommand(), 'uncertain');
  assert.equal(journey.getState().operation.failure, 'conflict');
  assert.deepEqual(journey.getState().receipts, []);
});

test('malformed command responses remain uncertain and never create reassuring receipts', async () => {
  const { journey } = setup('contact', { acknowledgeIncident: () => ({ id: ids.other, status: 'resolved', recorded: 'acknowledged' }) });
  await journey.loadIncident(ids.incident);
  assert.equal(await journey.acknowledge(), 'uncertain');
  assert.deepEqual(journey.getState().receipts, []);
  assert.equal(journey.getState().incident.data.status, 'active');
  const state = journey.getState(); state.incident.data.status = 'resolved';
  assert.equal(journey.getState().incident.data.status, 'active');
});
