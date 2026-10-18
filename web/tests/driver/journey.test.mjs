// Synthetic controller/contract tests. Not physical, provider or persisted-backend evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriverJourney } from '../../src/features/driver/controller.mjs';
import { FIELD_NAMES } from '../../src/features/driver/validation.mjs';

const ids = Object.fromEntries(['actor', 'other', 'truck', 'truck2', 'truck3', 'draft', 'grant', 'pending', 'revoked', 'incident', 'elsewhere']
  .map((name, n) => [name, `a0000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`]));
const WALL = Date.parse('2026-10-17T12:00:00Z');
const fields = { truckId: ids.truck, origin: 'Lima', destination: 'Cusco', country: 'PE', locale: 'es-PE', timeZone: 'America/Lima' };
const ok = (data) => ({ kind: 'ok', data });
const rejected = (status, code) => ({ kind: 'rejected', status, code });
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(options = {}) {
  let wall = WALL;
  let nextTimer = 0;
  let nextKey = 0;
  const timers = new Map();
  const calls = [];
  const handlers = {};
  const server = {
    draft: null, trip: null, incident: null,
    snapshot: { tripId: ids.draft, location: {
      capturedAt: '2026-10-17T11:55:00Z', receivedAt: '2026-10-17T11:56:00Z',
      latitude: -12, longitude: -77, accuracy: 40 },
    freshness: 'stale', ageMs: 300_000, readAt: '2026-10-17T12:00:00Z' },
  };
  const defaultReply = (request) => {
    const { operation, params, body } = request;
    if (operation === 'createTruck') return ok({ id: ids.truck2 });
    if (operation === 'createDraft') {
      server.draft = { id: ids.draft, status: 'draft', rawText: body.text, fields: structuredClone(body.fields),
        missingFields: FIELD_NAMES.filter((key) => !body.fields[key]) };
      return ok(structuredClone(server.draft));
    }
    if (operation === 'confirmDraft') {
      server.trip = { id: params.id, driver_id: ids.actor, truck_id: body.fields.truckId,
        ...body.fields, time_zone: body.fields.timeZone, status: 'active', paused: false,
        map_active: true, checkins_active: true, version: 1, created_at: '2026-10-17T12:00:00Z', closed_at: null };
      return ok({ id: params.id, status: 'active', fields: structuredClone(body.fields) });
    }
    if (operation === 'command') {
      if (body.type === 'arrived' || body.type === 'cancel') Object.assign(server.trip, {
        status: body.type === 'arrived' ? 'arrived' : 'cancelled', map_active: false, checkins_active: false,
        closed_at: '2026-10-17T12:30:00Z', version: server.trip.version + 1 });
      if (body.type === 'pause' || body.type === 'resume') Object.assign(server.trip, {
        paused: body.type === 'pause', checkins_active: body.type === 'resume', version: server.trip.version + 1 });
      return ok({ id: params.id, command: body.type, automaticEscalation: false });
    }
    if (operation === 'sos') {
      server.incident ??= { id: ids.incident, tripId: params.id, status: 'active', groupCapability: 'unavailable' };
      return ok(structuredClone(server.incident));
    }
    if (operation === 'readTrip') return server.trip ? ok(structuredClone(server.trip)) : rejected(404, 'trip_not_found');
    if (operation === 'readSnapshot') return server.trip?.map_active ? ok(structuredClone(server.snapshot)) : rejected(403, 'map_inactive');
    if (operation === 'readIncident') return ok({ ...server.incident, createdAt: '2026-10-17T12:05:00Z', resolvedAt: null });
    throw new Error('No synthetic response for operation');
  };
  const config = {
    transport: async (request, { signal }) => {
      calls.push({ request: structuredClone(request), signal });
      return handlers[request.operation] ? handlers[request.operation](request, signal) : defaultReply(request);
    }, clock: () => wall, keyFactory: () => `synthetic-intent-${++nextKey}`,
    timers: { setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); } }, ...options,
  };
  const journey = createDriverJourney(config);
  function ready() {
    journey.setSession(ids.actor); journey.setInteractionMode('stationary');
    journey.provideSelectionEvidence({ actorId: ids.actor, source: 'authenticated-server-read', readAt: '2026-10-17T12:00:00Z',
      trucks: [{ id: ids.truck, label: 'Camión 1' }], contacts: [
        { id: ids.grant, status: 'accepted', map: true, incident: true },
        { id: ids.pending, status: 'pending', map: true, incident: true },
        { id: ids.revoked, status: 'revoked', map: true, incident: true },
      ] });
  }
  return { journey, config, calls, handlers, server, timers, ready,
    async draft(full = true) { ready(); journey.editForm({ text: 'Viaje de carga', fields: full ? fields : {} }); return journey.saveDraft(); },
    async active() { await this.draft(); return journey.confirmTrip({ confirmed: true }); },
    tick() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } },
    advance(ms) { wall += ms; },
  };
}

test('construction is inert; ordinary actions require auth/transport and explicit interaction', async () => {
  const b = fixture();
  assert.equal(b.calls.length + b.timers.size, 0);
  assert.equal(b.journey.snapshot().activation, null);
  assert.equal((await b.journey.saveDraft()).code, 'authentication-required');
  b.journey.setSession(ids.actor);
  assert.equal(b.journey.editForm({ text: 'test' }).code, 'interaction-not-allowed');
  b.journey.setInteractionMode('moving'); assert.equal((await b.journey.sendCommand('checkin_ok')).code, 'interaction-not-allowed');
  assert.equal(b.calls.length, 0);
  const c = fixture({ transport: null }); c.ready(); c.journey.editForm({ text: 'offline planning' });
  assert.equal((await c.journey.saveDraft()).code, 'transport-unavailable');
  assert.equal(c.journey.snapshot().form.text, 'offline planning');
});

test('partial text draft does not extract fields, infer region or activate a trip', async () => {
  const b = fixture(); assert.equal((await b.draft(false)).kind, 'ok');
  const state = b.journey.snapshot();
  assert.equal(state.draft.status, 'draft'); assert.equal(state.activation, null); assert.equal(state.tripId, null);
  assert.deepEqual(state.draft.missingFields, FIELD_NAMES);
  assert.deepEqual(b.calls[0].request.body, { text: 'Viaje de carga', fields: {} });
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).code, 'incomplete-or-invalid-fields');
  assert.equal(b.calls.length, 1);
});

test('explicit country, supported language and zone remain independent; invalid input never sends', async () => {
  for (const patch of [{ country: 'pe' }, { locale: 'en' }, { locale: 'pt-PT' }, { timeZone: 'Not/AZone' }, { truckId: ids.truck3 }]) {
    const b = fixture(); b.ready(); b.journey.editForm({ text: 'carga', fields: { ...fields, ...patch } });
    assert.equal((await b.journey.saveDraft()).kind, 'blocked'); assert.equal(b.calls.length, 0);
  }
  const b = fixture(); b.ready();
  const explicit = { ...fields, country: 'BR', locale: 'pt-BR', timeZone: 'America/Lima' };
  b.journey.editForm({ text: 'Viagem de carga', fields: explicit }); await b.journey.saveDraft();
  assert.deepEqual(b.calls[0].request.body.fields, explicit);
  await b.journey.confirmTrip({ confirmed: true });
  assert.deepEqual(b.journey.snapshot().activation.data.fields, explicit);
});

test('one/two owned trucks require read evidence, bind current actor and never accept a fleet/foreign truck', async () => {
  const b = fixture(); b.journey.setSession(ids.actor); b.journey.setInteractionMode('stationary');
  assert.equal((await b.journey.registerTruck('Camión')).code, 'ownership-read-required');
  b.ready(); assert.equal((await b.journey.registerTruck('Camión 2')).kind, 'ok');
  assert.equal(b.journey.snapshot().selection.trucks.length, 2);
  assert.equal((await b.journey.registerTruck('Camión 3')).code, 'two-truck-scope');
  const evidence = b.journey.snapshot().selection;
  evidence.actorId = ids.other;
  assert.equal(b.journey.provideSelectionEvidence(evidence).code, 'invalid-selection-evidence');
  assert.equal(b.calls.length, 1);
});

test('only accepted scoped unrevoked contacts can be selected; case-alias duplicates are blocked', async () => {
  const b = fixture(); await b.draft();
  for (const idsToSelect of [[ids.pending], [ids.revoked], [ids.other], [ids.grant, ids.grant.toUpperCase()]]) {
    assert.equal(b.journey.selectContacts(idsToSelect).code, 'contacts-not-accepted');
  }
  assert.equal(b.journey.selectContacts([ids.grant.toUpperCase()]).kind, 'local-state');
  assert.equal((await b.journey.confirmTrip()).code, 'explicit-confirm-required');
  const evidence = b.journey.snapshot().selection; evidence.contacts[0].status = 'revoked';
  b.journey.provideSelectionEvidence(evidence);
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).code, 'contacts-not-accepted');
  b.journey.selectContacts([]); assert.equal((await b.journey.confirmTrip({ confirmed: true })).kind, 'ok');
  assert.deepEqual(b.calls.at(-1).request.body.contactGrantIds, []);
});

test('field corrections are explicit; duplicate confirmation shares one immutable request/key', async () => {
  const b = fixture(); await b.draft(false);
  b.journey.editForm({ fields }); b.journey.selectContacts([ids.grant]);
  const answer = deferred(); b.handlers.confirmDraft = () => answer.promise;
  const first = b.journey.confirmTrip({ confirmed: true }); const second = b.journey.confirmTrip({ confirmed: true });
  assert.equal(first, second); await settle();
  assert.equal(b.calls.filter(({ request }) => request.operation === 'confirmDraft').length, 1);
  assert.equal(b.journey.editForm({ fields: { destination: 'Arequipa' } }).code, 'form-locked');
  const request = b.calls.at(-1).request;
  answer.resolve(ok({ id: ids.draft, status: 'active', fields: request.body.fields }));
  assert.equal((await first).kind, 'ok'); assert.equal((await second).kind, 'ok');
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).kind, 'ok');
  assert.equal(b.calls.length, 2); assert.equal(b.journey.snapshot().trip.state, 'not-loaded');
});

test('unknown confirm cannot activate, edit or automatically replay; explicit retry reuses exact intent', async () => {
  const b = fixture(); await b.draft(); let first = true;
  b.handlers.confirmDraft = (request) => {
    if (first) { first = false; throw new Error('lost response after a possible commit'); }
    return ok({ id: ids.draft, status: 'active', fields: request.body.fields });
  };
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).kind, 'unknown');
  assert.equal(b.journey.snapshot().activation, null);
  assert.equal(b.journey.editForm({ fields: { country: 'BR' } }).code, 'form-locked');
  b.journey.setNetwork('offline'); b.journey.setNetwork('online'); await settle(); assert.equal(b.calls.length, 2);
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).code, 'unresolved-submission');
  assert.equal((await b.journey.retryUnknown('confirm')).code, 'explicit-retry-required');
  const request = b.calls[1].request;
  assert.equal((await b.journey.retryUnknown('confirm', { confirmed: true })).kind, 'ok');
  assert.deepEqual(b.calls[2].request, request);
});

test('timeout returns unknown promptly, aborts local wait and ignores late success', async () => {
  const b = fixture(); await b.draft(); const answer = deferred(); b.handlers.confirmDraft = () => answer.promise;
  const pending = b.journey.confirmTrip({ confirmed: true }); await settle(); b.tick();
  assert.equal((await pending).kind, 'unknown'); assert.equal(b.calls.at(-1).signal.aborted, true);
  answer.resolve(ok({ id: ids.draft, status: 'active', fields })); await settle();
  assert.equal(b.journey.snapshot().activation, null); assert.equal(b.timers.size, 0);
});

test('HTTP validation/auth/consent/conflict/audio errors stay distinct and no raw exception is retained', async () => {
  for (const [status, code] of [[400, 'validation_error'], [401, 'unauthorized'], [403, 'forbidden'],
    [404, 'draft_not_found'], [409, 'contact_not_accepted'], [422, 'unsupported_audio']]) {
    const b = fixture(); await b.draft(); b.handlers.confirmDraft = () => ({ ...rejected(status, code), detail: 'secret-body' });
    const result = await b.journey.confirmTrip({ confirmed: true });
    assert.deepEqual(result, rejected(status, code));
    assert.equal(JSON.stringify(b.journey.snapshot()).includes('secret-body'), false);
    assert.equal(b.journey.snapshot().activation, null);
    assert.equal(b.journey.snapshot().auth.state, status === 401 ? 'expired' : 'authenticated');
  }
});

test('5xx, malformed success or wrong-trip response never become a successful activation', async () => {
  for (const result of [rejected(500, 'internal_error'), ok({ id: ids.other, status: 'active', fields }),
    ok({ id: ids.draft, status: 'active' }), { arbitrary: 'success' }]) {
    const b = fixture(); await b.draft(); b.handlers.confirmDraft = () => result;
    assert.equal((await b.journey.confirmTrip({ confirmed: true })).kind, 'unknown');
    assert.equal(b.journey.snapshot().activation, null);
  }
});

test('local permission and network changes never prompt, capture, schedule alarms or autosubmit', async () => {
  const b = fixture(); b.ready(); b.journey.setNetwork('offline');
  assert.equal(b.journey.editForm({ text: 'Preparar sin conexión', fields }).kind, 'local-state');
  for (const state of ['granted', 'denied', 'revoked', 'unknown']) b.journey.setPermission('geolocation', state);
  assert.equal((await b.journey.saveDraft()).code, 'offline');
  b.journey.setNetwork('online'); await settle(); assert.equal(b.calls.length + b.timers.size, 0);
  assert.equal((await b.journey.saveDraft()).kind, 'ok');
});

test('command acknowledgements do not fabricate refreshed state, wellbeing or incident resolution', async () => {
  const b = fixture(); await b.active(); await b.journey.openTrip(ids.draft);
  await b.journey.requestHelp();
  assert.equal((await b.journey.sendCommand('pause')).kind, 'ok');
  assert.equal(b.journey.snapshot().trip.data.paused, false); assert.equal(b.journey.snapshot().trip.invalidated, true);
  await b.journey.openTrip(ids.draft); assert.equal(b.journey.snapshot().trip.data.paused, true);
  await b.journey.sendCommand('checkin_ok'); await b.journey.sendCommand('arrived');
  assert.equal(b.journey.snapshot().trip.data.status, 'active');
  assert.equal(b.journey.snapshot().incident.data.status, 'active');
  await b.journey.openTrip(ids.draft); assert.equal(b.journey.snapshot().trip.data.status, 'arrived');
  assert.equal(b.journey.snapshot().incident.data.status, 'active');
  assert.equal((await b.journey.sendCommand('resume')).code, 'trip-closed');
  assert.equal(JSON.stringify(b.journey.snapshot()).includes('wellbeing'), false);
});

test('an ambiguous ordinary command does not occupy SOS; repeated help has one active episode', async () => {
  const b = fixture(); await b.active(); b.handlers.command = () => { throw new Error('lost'); };
  assert.equal((await b.journey.sendCommand('pause')).kind, 'unknown');
  assert.equal((await b.journey.requestHelp()).kind, 'ok');
  assert.equal((await b.journey.requestHelp()).kind, 'ok');
  assert.equal(b.calls.filter(({ request }) => request.operation === 'sos').length, 2);
  assert.equal(b.journey.snapshot().incident.data.groupCapability, 'unavailable');
  for (const invented of ['delivered', 'help-arrived', 'resolved', 'driver-safe']) assert.equal(JSON.stringify(b.journey.snapshot()).includes(invented), false);
});

test('pending commands coalesce only identical intents and never acknowledge a different command', async () => {
  const b = fixture(); await b.active(); const answer = deferred(); b.handlers.command = () => answer.promise;
  const first = b.journey.sendCommand('pause'); const duplicate = b.journey.sendCommand('pause');
  assert.equal(first, duplicate);
  assert.equal((await b.journey.sendCommand('arrived')).code, 'operation-in-progress');
  await settle(); answer.resolve(ok({ id: ids.draft, command: 'pause', automaticEscalation: false })); await first;
  assert.equal((await b.journey.sendCommand('pause')).kind, 'ok');
  assert.equal(b.calls.filter(({ request }) => request.operation === 'command').length, 1);
});

test('SOS unknowns preserve intent and no arrival command silently resolves the episode', async () => {
  const b = fixture(); await b.active(); b.handlers.sos = () => { throw new Error('lost'); };
  assert.equal((await b.journey.requestHelp()).kind, 'unknown');
  assert.equal(b.journey.snapshot().incident.data, null);
  delete b.handlers.sos;
  assert.equal((await b.journey.retryUnknown('sos', { confirmed: true })).kind, 'ok');
  const attempts = b.calls.filter(({ request }) => request.operation === 'sos');
  assert.deepEqual(attempts[0].request, attempts[1].request);
  await b.journey.sendCommand('arrived'); assert.equal(b.journey.snapshot().incident.data.status, 'active');
});

test('snapshot capture, server receipt/read and client receipt stay separate and do not become live', async () => {
  const b = fixture(); await b.active(); await b.journey.refreshLocation();
  const fact = b.journey.snapshot().location;
  assert.deepEqual(fact.data, b.server.snapshot); assert.equal(fact.clientReceivedAtMs, WALL);
  b.advance(3600_000);
  assert.deepEqual(b.journey.snapshot().location, fact);
  assert.equal(b.journey.snapshot().monitoring.state, 'unavailable');
  b.handlers.readSnapshot = () => rejected(403, 'forbidden'); await b.journey.refreshLocation();
  assert.equal(b.journey.snapshot().location.data, null);
  assert.equal(b.journey.snapshot().location.error.status, 403);
});

test('newer read wins and old late responses cannot overwrite it', async () => {
  const b = fixture(); await b.active(); const old = deferred(); let count = 0;
  b.handlers.readSnapshot = () => ++count === 1 ? old.promise : ok({ ...b.server.snapshot, ageMs: 301000 });
  const first = b.journey.refreshLocation(); await settle();
  const second = b.journey.refreshLocation(); assert.equal((await first).kind, 'unknown'); await second;
  old.resolve(ok(b.server.snapshot)); await settle();
  assert.equal(b.journey.snapshot().location.data.ageMs, 301000);
});

test('logout aborts waits, purges memory and ignores late facts from the original actor', async () => {
  const b = fixture(); await b.draft(); const answer = deferred(); b.handlers.confirmDraft = () => answer.promise;
  const pending = b.journey.confirmTrip({ confirmed: true }); await settle(); b.journey.setSession(ids.other);
  assert.equal((await pending).kind, 'unknown'); assert.equal(b.calls.at(-1).signal.aborted, true);
  answer.resolve(ok({ id: ids.draft, status: 'active', fields })); await settle();
  const state = b.journey.snapshot(); assert.equal(state.auth.actorId, ids.other);
  assert.equal(state.activation, null); assert.equal(state.draft, null); assert.equal(state.form.text, '');
  assert.deepEqual(state.operations, {}); assert.equal(b.timers.size, 0);
});

test('401 on one read cancels other outstanding reads before their late private data can return', async () => {
  const b = fixture(); await b.active(); const answer = deferred(); b.handlers.readSnapshot = () => answer.promise;
  const pending = b.journey.refreshLocation(); await settle(); b.handlers.readTrip = () => rejected(401, 'unauthorized');
  await b.journey.openTrip(ids.draft); assert.equal((await pending).kind, 'unknown');
  answer.resolve(ok(b.server.snapshot)); await settle();
  assert.equal(b.journey.snapshot().location.data, null); assert.equal(b.journey.snapshot().auth.state, 'expired');
  assert.equal(b.timers.size, 0);
});

test('dispose and reentrant view stop are idempotent and never begin a native request after disposal', async () => {
  const b = fixture(); b.ready(); b.journey.editForm({ text: 'carga', fields });
  const unsubscribe = b.journey.subscribe(() => b.journey.dispose());
  const pending = b.journey.saveDraft(); assert.equal((await pending).kind, 'unknown'); await settle();
  unsubscribe(); unsubscribe(); b.journey.dispose();
  assert.equal(b.calls.length + b.timers.size, 0); assert.equal(b.journey.snapshot().disposed, true);
  assert.equal((await b.journey.saveDraft()).code, 'disposed');
});

test('data and requests are detached; model consumes an injected projection without copying its rules', async () => {
  const received = [];
  const b = fixture({ monitoringProjection(facts, at) { received.push({ facts, at }); return { state: 'synthetic-projection', receivedAt: at }; } });
  await b.active(); await b.journey.openTrip(ids.draft); const state = b.journey.snapshot();
  state.form.fields.country = 'XX'; state.operations.confirm.request.body.fields.country = 'XX';
  received.at(-1).facts.trip.data.status = 'arrived';
  assert.equal(b.journey.snapshot().form.fields.country, 'PE');
  assert.equal(b.journey.snapshot().trip.data.status, 'active');
  assert.equal(b.journey.snapshot().monitoring.state, 'synthetic-projection');
});

test('wrong actor/trip incident reads and unsupported commands cannot become current facts', async () => {
  const b = fixture(); await b.active();
  b.handlers.readTrip = () => ok({ ...b.server.trip, driver_id: ids.other });
  assert.equal((await b.journey.openTrip(ids.draft)).kind, 'unknown');
  assert.equal(b.journey.snapshot().trip.data, null);
  await b.journey.requestHelp(); b.handlers.readIncident = () => ok({ ...b.server.incident, tripId: ids.elsewhere,
    createdAt: '2026-10-17T12:00:00Z', resolvedAt: null });
  assert.equal((await b.journey.refreshIncident()).kind, 'unknown');
  assert.equal(b.journey.snapshot().incident.data.tripId, ids.draft);
  assert.equal((await b.journey.sendCommand('confirm_safe')).code, 'unsupported-command');
});

test('invalid resource/key inputs fail closed without submission or hanging timers', async () => {
  for (const requestTimeoutMs of [0, Infinity, 60001]) assert.throws(() => fixture({ requestTimeoutMs }), TypeError);
  const b = fixture({ keyFactory: () => 'invalid key' }); b.ready(); b.journey.editForm({ text: 'carga' });
  assert.equal((await b.journey.saveDraft()).code, 'idempotency-unavailable'); assert.equal(b.calls.length + b.timers.size, 0);
});

test('received confirmation is authoritative when the timeout callback has not fired', async () => {
  const b = fixture(); await b.draft(); const answer = deferred(); b.handlers.confirmDraft = () => answer.promise;
  const pending = b.journey.confirmTrip({ confirmed: true }); await settle();
  b.advance(15_000); answer.resolve(ok({ id: ids.draft, status: 'active', fields }));
  assert.equal((await pending).kind, 'ok');
  assert.equal(b.journey.snapshot().activation.data.id, ids.draft); assert.equal(b.timers.size, 0);
});

test('response receipt is local evidence and never invented as command/report source time', async () => {
  const b = fixture(); await b.active(); b.advance(1000); await b.journey.sendCommand('checkin_ok');
  const operation = b.journey.snapshot().operations.command;
  assert.equal(operation.clientReceivedAtMs, WALL + 1000); assert.equal(operation.sourceTime, null);
  assert.deepEqual(operation.result, ok({ id: ids.draft, command: 'checkin_ok', automaticEscalation: false }));
});

test('rejection of an explicit retry cannot erase an earlier unknown submission or enable a new key', async () => {
  const b = fixture(); await b.draft(); b.handlers.confirmDraft = () => { throw new Error('lost'); };
  await b.journey.confirmTrip({ confirmed: true }); b.handlers.confirmDraft = () => rejected(403, 'forbidden');
  const result = await b.journey.retryUnknown('confirm', { confirmed: true });
  assert.equal(result.kind, 'unknown'); assert.equal(result.responseCode, 'forbidden');
  assert.equal(b.journey.editForm({ fields: { country: 'BR' } }).code, 'form-locked');
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).code, 'unresolved-submission');
  assert.deepEqual(b.calls[1].request, b.calls[2].request);
});

test('an opened trip prevents another draft and retains only that trip location and help', async () => {
  const b = fixture(); b.ready();
  b.server.trip = { id: ids.elsewhere, driver_id: ids.actor, truck_id: ids.truck,
    status: 'active', paused: false, map_active: true, checkins_active: true, version: 1 };
  b.server.snapshot.tripId = ids.elsewhere;
  b.server.incident = { id: ids.incident, tripId: ids.elsewhere, status: 'active', groupCapability: 'unavailable' };
  await b.journey.openTrip(ids.elsewhere); await b.journey.refreshLocation(); await b.journey.refreshIncident(ids.incident);
  const before = b.journey.snapshot();
  assert.equal(b.journey.editForm({ text: 'Another trip', fields }).code, 'form-locked');
  assert.equal(b.journey.selectContacts([ids.grant]).code, 'form-locked');
  assert.equal((await b.journey.saveDraft()).code, 'journey-already-bound');
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).code, 'journey-already-bound');
  assert.equal((await b.journey.openTrip(ids.draft)).code, 'journey-already-bound');
  assert.equal((await b.journey.requestHelp()).data.tripId, ids.elsewhere);
  const after = b.journey.snapshot();
  assert.equal(after.tripId, ids.elsewhere); assert.deepEqual(after.location, before.location);
  assert.equal(after.incident.data.tripId, ids.elsewhere);
  assert.equal(b.calls.some(({ request }) => ['createDraft', 'confirmDraft'].includes(request.operation)), false);
  assert.equal(b.calls.filter(({ request }) => request.operation === 'sos').length, 1);
});

test('pending, unknown or saved draft cannot be crossed by openTrip or lose its original intent', async () => {
  for (const state of ['pending', 'unknown', 'saved']) {
    const b = fixture(); b.ready(); b.journey.editForm({ text: 'Current draft', fields });
    const answer = deferred(); b.handlers.createDraft = () => answer.promise;
    const pending = b.journey.saveDraft(); await settle();
    const request = b.calls[0].request;
    if (state === 'unknown') { answer.reject(new Error('lost')); await pending; }
    if (state === 'saved') { answer.resolve(ok({ id: ids.draft, status: 'draft', rawText: request.body.text,
      fields: request.body.fields, missingFields: [] })); await pending; }
    const before = b.journey.snapshot().operations.draft;
    assert.equal((await b.journey.openTrip(ids.elsewhere)).code, 'journey-already-bound');
    assert.equal(b.journey.snapshot().tripId, null);
    assert.deepEqual(b.journey.snapshot().operations.draft, before);
    assert.equal(b.calls.length, 1);
    if (state === 'pending') { answer.resolve(ok({ id: ids.draft, status: 'draft', rawText: request.body.text,
      fields: request.body.fields, missingFields: [] })); await pending; }
    if (state === 'unknown') {
      b.handlers.createDraft = () => ok({ id: ids.draft, status: 'draft', rawText: request.body.text,
        fields: request.body.fields, missingFields: [] });
      assert.equal((await b.journey.retryUnknown('draft', { confirmed: true })).kind, 'ok');
      assert.deepEqual(b.calls[1].request, request);
    }
    assert.equal((await b.journey.confirmTrip({ confirmed: true })).kind, 'ok');
    assert.equal((await b.journey.requestHelp()).data.tripId, ids.draft);
    assert.equal(b.calls.filter(({ request }) => request.operation === 'sos').length, 1);
    b.journey.dispose();
  }
});

// Gatekeeper5560841617: additional controls captured before the repair.
test('gatekeeper: locale is canonical in both draft and confirmation descriptors', async () => {
  for (const [raw, canonical] of [['es-pe', 'es-PE'], ['pt-br', 'pt-BR']]) {
    const b = fixture(); b.ready(); b.journey.editForm({ text: 'Carga', fields: { ...fields, locale: raw } });
    await b.journey.saveDraft(); await b.journey.confirmTrip({ confirmed: true });
    assert.equal(b.calls[0].request.body.fields.locale, canonical);
    assert.equal(b.calls[1].request.body.fields.locale, canonical);
  }
});
test('gatekeeper: failed initial trip reads do not bind or trap a foreign trip', async () => {
  for (const status of [403, 404]) {
    const b = fixture(); b.ready(); b.handlers.readTrip = () => rejected(status, 'trip_not_found');
    await b.journey.openTrip(ids.elsewhere); assert.equal(b.journey.snapshot().tripId, null);
    delete b.handlers.readTrip; await b.active();
    assert.equal(b.journey.snapshot().tripId, ids.draft);
  }
});
test('gatekeeper: committed unknown confirmation can reconcile by the same draft trip read and send SOS', async () => {
  const b = fixture(); await b.draft();
  b.handlers.confirmDraft = request => {
    b.server.trip = { id: ids.draft, driver_id: ids.actor, truck_id: ids.truck, status: 'active',
      paused: false, map_active: true, checkins_active: true, version: 1 };
    return { kind: 'unknown' };
  };
  await b.journey.confirmTrip({ confirmed: true });
  assert.equal((await b.journey.openTrip(ids.elsewhere)).kind, 'blocked');
  assert.equal((await b.journey.openTrip(ids.draft)).kind, 'ok');
  assert.equal(b.journey.snapshot().tripId, ids.draft);
  assert.equal((await b.journey.requestHelp()).kind, 'ok');
});
test('gatekeeper: known not_sent never becomes an unresolved submission and 429 remains rejection', async () => {
  const b = fixture(); await b.active(); b.handlers.sos = () => ({ kind: 'not_sent', code: 'no_session' });
  assert.equal((await b.journey.requestHelp()).kind, 'not_sent');
  assert.equal(b.journey.snapshot().operations.sos.state, 'not_sent');
  b.handlers.sos = () => rejected(429, 'rate_limited');
  assert.equal((await b.journey.requestHelp()).kind, 'rejected');
  delete b.handlers.sos; assert.equal((await b.journey.requestHelp()).kind, 'ok');
});
test('gatekeeper: acknowledged closure invalidates historical activation without resolving SOS', async () => {
  const b = fixture(); await b.active(); await b.journey.requestHelp();
  await b.journey.sendCommand('arrived');
  assert.equal(b.journey.snapshot().activation, null);
  assert.equal(b.journey.snapshot().incident.data.status, 'active');
});
test('gatekeeper: repeated registration of the same completed intent does not create another truck', async () => {
  const b = fixture(); b.ready();
  const evidence = b.journey.snapshot().selection; evidence.trucks = [];
  b.journey.provideSelectionEvidence(evidence);
  await b.journey.registerTruck('Camión'); await b.journey.registerTruck('Camión');
  assert.equal(b.calls.filter(c => c.request.operation === 'createTruck').length, 1);
});

test('gatekeeper: SOS bypasses motion gate, ignores stale cache and repeats after uncertainty', async () => {
  const b = fixture(); await b.active();
  for (const mode of ['unknown', 'moving']) {
    b.journey.setInteractionMode(mode); assert.equal((await b.journey.requestHelp()).kind, 'ok');
    assert.equal((await b.journey.sendCommand('checkin_ok')).code, 'interaction-not-allowed');
  }
  b.handlers.sos = () => ({ kind: 'unknown' }); await b.journey.requestHelp();
  const original = b.calls.at(-1).request;
  delete b.handlers.sos; assert.equal((await b.journey.requestHelp()).kind, 'ok');
  assert.deepEqual(b.calls.at(-1).request, original);
  assert.equal(b.calls.filter(c => c.request.operation === 'sos').length, 4);
});
test('gatekeeper: overlapping SOS is one wait, sequential OK/rest are distinct user intents', async () => {
  const b = fixture(); await b.active(); const reply = deferred(); b.handlers.sos = () => reply.promise;
  const first = b.journey.requestHelp(), second = b.journey.requestHelp(); await settle();
  assert.equal(first, second); assert.equal(b.calls.filter(c => c.request.operation === 'sos').length, 1);
  reply.resolve(ok({ id: ids.incident, tripId: ids.draft, status: 'active', groupCapability: 'unavailable' })); await first;
  for (const type of ['checkin_ok', 'rest_report']) {
    await b.journey.sendCommand(type); const earlier = b.calls.at(-1).request.idempotencyKey;
    await b.journey.sendCommand(type); assert.notEqual(b.calls.at(-1).request.idempotencyKey, earlier);
  }
});
test('gatekeeper: same actor preserves pending SOS; account change still clears private state', async () => {
  const b = fixture(); await b.active(); const reply = deferred(); b.handlers.sos = () => reply.promise;
  const pending = b.journey.requestHelp(); await settle(); b.journey.setSession(ids.actor.toUpperCase());
  assert.equal(b.journey.snapshot().tripId, ids.draft); assert.equal(b.journey.snapshot().operations.sos.state, 'pending');
  reply.resolve(ok({ id: ids.incident, tripId: ids.draft, status: 'active', groupCapability: 'unavailable' }));
  assert.equal((await pending).kind, 'ok'); b.journey.setSession(ids.other);
  assert.equal(b.journey.snapshot().tripId, null); assert.equal(b.journey.snapshot().incident.data, null);
});
test('gatekeeper: wall-clock changes do not turn received SOS acknowledgements into unknowns', async () => {
  for (const delta of [20_000, -1]) {
    const b = fixture(); await b.active(); b.handlers.sos = request => {
      b.advance(delta); return ok({ id: ids.incident, tripId: request.params.id, status: 'active', groupCapability: 'unavailable' });
    };
    assert.equal((await b.journey.requestHelp()).kind, 'ok');
  }
});
test('gatekeeper: same-key confirmation rejection after receipt lookup can unlock corrections', async () => {
  for (const [status, code] of [[409, 'contact_not_accepted'], [409, 'draft_incomplete'], [403, 'truck_not_owned']]) {
    const b = fixture(); await b.draft(); b.handlers.confirmDraft = () => ({ kind: 'unknown' });
    await b.journey.confirmTrip({ confirmed: true }); const request = b.calls.at(-1).request;
    b.handlers.confirmDraft = () => rejected(status, code);
    assert.equal((await b.journey.retryUnknown('confirm', { confirmed: true })).kind, 'rejected');
    assert.deepEqual(b.calls.at(-1).request, request);
    assert.equal(b.journey.editForm({ fields: { destination: 'Arequipa' } }).kind, 'local-state');
  }
});
test('gatekeeper: subscribers receive one detached immutable notification snapshot', () => {
  const b = fixture(); const seen = [];
  b.journey.subscribe(view => { seen.push(view); assert.throws(() => { view.auth.state = 'expired'; }); });
  b.journey.subscribe(view => seen.push(view)); b.journey.setSession(ids.actor);
  assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]);
  assert.equal(b.journey.snapshot().auth.state, 'authenticated');
});

test('gatekeeper: expected arrival is optional explicit input, retained on draft and confirmation', async () => {
  const b = fixture(); b.ready();
  const expectedArrivalAt = '2026-10-18T10:30:00-05:00';
  assert.equal(b.journey.editForm({ text: 'Carga', fields: { ...fields, expectedArrivalAt } }).kind, 'local-state');
  assert.equal((await b.journey.saveDraft()).kind, 'ok');
  assert.equal((await b.journey.confirmTrip({ confirmed: true })).kind, 'ok');
  assert.equal(b.calls[0].request.body.fields.expectedArrivalAt, new Date(expectedArrivalAt).toISOString());
  assert.equal(b.calls[1].request.body.fields.expectedArrivalAt, new Date(expectedArrivalAt).toISOString());
});
test('gatekeeper: status discovers server checks and incidents without inventing source or delivery', async () => {
  const b = fixture(); await b.active();
  const status = { trip: { status: 'active', paused: false, expectedArrivalAt: null },
    check: { status: 'asking', reason: 'silence', askUntil: '2026-10-17T12:05:00Z' },
    incident: { id: ids.incident, trigger: 'missed_check', checkReason: 'silence', status: 'active', createdAt: '2026-10-17T12:00:00Z' },
    deliveries: [{ role: 'family', channel: 'sms', status: 'unknown', unavailableReason: null }],
    location: { freshness: 'stale', ageMs: 300000, capturedAt: '2026-10-17T11:55:00Z', accuracy: 40 } };
  b.handlers.readStatus = () => ok(status);
  assert.equal((await b.journey.refreshStatus()).kind, 'ok');
  const source = b.journey.snapshot().status;
  assert.deepEqual(source.data, status); assert.equal(source.clientReceivedAtMs, WALL);
  assert.equal(b.journey.snapshot().incident.data.id, ids.incident);
  b.handlers.readStatus = () => rejected(403, 'forbidden'); await b.journey.refreshStatus();
  assert.equal(b.journey.snapshot().status.data, null);
  assert.equal(b.journey.snapshot().incident.data.id, ids.incident);
});

test('gatekeeper: injected SDK decoder handles wire validation and semantic owner correlation remains', async () => {
  let decoded = 0; const b = fixture({ decodeResponse(request, data) { decoded += 1; return structuredClone(data); } });
  await b.active(); assert.equal(decoded, 2);
  const c = fixture({ decodeResponse() { throw Error('SDK rejected response'); } });
  assert.equal((await c.draft()).kind, 'unknown'); assert.equal(c.journey.snapshot().draft, null);
  const d = fixture({ decodeResponse(request, data) {
    return request.operation === 'readTrip' ? { ...data, driver_id: ids.other } : data;
  } });
  await d.active(); assert.equal((await d.journey.openTrip(ids.draft)).kind, 'unknown');
  assert.equal(d.journey.snapshot().trip.data, null);
});
test('gatekeeper: closure removes the active activation view while preserving the original receipt', async () => {
  const b = fixture(); await b.active(); await b.journey.sendCommand('arrived');
  assert.equal(b.journey.snapshot().activation, null);
  assert.equal(b.journey.snapshot().operations.confirm.result.data.status, 'active');
});

test('gatekeeper: equivalent expected-arrival offsets use the SDK canonical instant without changing local input', async () => {
  const b = fixture(); b.ready(); const raw = '2026-10-18T10:30:00-05:00';
  b.journey.editForm({ text: 'Carga', fields: { ...fields, expectedArrivalAt: raw } });
  await b.journey.saveDraft();
  assert.equal(b.calls.at(-1).request.body.fields.expectedArrivalAt, '2026-10-18T15:30:00.000Z');
  assert.equal(b.journey.snapshot().form.fields.expectedArrivalAt, raw);
});

// Fix pass (R8): nobody in the cab calls openTrip before pressing SOS.
const committedTrip = () => ({ id: ids.draft, driver_id: ids.actor, truck_id: ids.truck, status: 'active',
  paused: false, map_active: true, checkins_active: true, version: 1 });
test('R8: SOS right after a lost confirmation response reconciles on its own and sends', async () => {
  const b = fixture(); await b.draft();
  b.handlers.confirmDraft = () => { b.server.trip = committedTrip(); return { kind: 'unknown' }; };
  await b.journey.confirmTrip({ confirmed: true }); b.journey.setInteractionMode('moving');
  const help = await b.journey.requestHelp();
  assert.equal(help.kind, 'ok'); assert.equal(help.data.tripId, ids.draft);
  assert.deepEqual(b.calls.slice(-2).map(c => c.request.operation), ['readTrip', 'sos']);
  assert.equal(b.journey.snapshot().tripId, ids.draft);
});
test('R8: trip-required only when the reconciling read proves there is no trip', async () => {
  const b = fixture(); await b.draft(); b.handlers.confirmDraft = () => ({ kind: 'unknown' });
  await b.journey.confirmTrip({ confirmed: true });
  assert.deepEqual(await b.journey.requestHelp(), { kind: 'blocked', code: 'trip-required' });
  const c = fixture(); await c.draft(); c.handlers.confirmDraft = () => ({ kind: 'unknown' });
  c.handlers.readTrip = () => { throw Error('SYNTHETIC network failure'); };
  await c.journey.confirmTrip({ confirmed: true });
  const help = await c.journey.requestHelp();
  assert.notEqual(help.code, 'trip-required'); assert.equal(help.kind, 'unknown');
  for (const f of [b, c]) assert.equal(f.calls.filter(x => x.request.operation === 'sos').length, 0);
});
test('R8: SOS pressed while the confirmation is in flight waits for it, then sends', async () => {
  const b = fixture(); await b.draft(); const answer = deferred(); b.handlers.confirmDraft = () => answer.promise;
  b.journey.confirmTrip({ confirmed: true }); await settle();
  const help = b.journey.requestHelp(); await settle();
  assert.equal(b.calls.filter(c => c.request.operation === 'sos').length, 0);
  answer.resolve(ok({ id: ids.draft, status: 'active', fields: b.calls.at(-1).request.body.fields }));
  assert.equal((await help).kind, 'ok');
  assert.equal(b.calls.filter(c => c.request.operation === 'sos').length, 1);
});

