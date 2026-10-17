// Independent controller cases; all source responses/identities are synthetic.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDS, NOW, REGIONAL_FIELDS, snapshot } from './fixtures.mjs';
import { deferred } from './scripted-transport.mjs';

const root = process.env.ANDES_REVIEW_DRIVER_ROOT;
if (!root) throw new TypeError('An exact archived driver candidate is required');
const { createDriverJourney } = await import(pathToFileURL(resolve(root, 'web/src/features/driver/controller.mjs')).href);
const fields = { ...REGIONAL_FIELDS };
const fieldNames = Object.keys(fields);
const originalIncident = '00000000-0000-4000-8000-000000000009';
const newIncident = IDS.incident;
const settle = () => new Promise(setImmediate);

function fixture() {
  const calls = [];
  const overrides = {};
  let nextKey = 0, clock = NOW;
  function response(request) {
    const { operation, params, body } = request;
    if (operation === 'createDraft') return { id: IDS.otherTrip, status: 'draft', rawText: body.text,
      fields: structuredClone(body.fields), missingFields: fieldNames.filter(name => !body.fields[name]) };
    if (operation === 'confirmDraft') return { id: params.id, status: 'active', fields: structuredClone(body.fields) };
    if (operation === 'readTrip') return { id: params.id, driver_id: IDS.driver, truck_id: IDS.truck,
      status: 'active', paused: false, map_active: true, checkins_active: true, version: 1,
      origin: 'SYNTHETIC origin', destination: 'SYNTHETIC destination', country: 'BR', locale: 'pt-BR',
      time_zone: 'America/Sao_Paulo', created_at: new Date(NOW).toISOString(), closed_at: null };
    if (operation === 'readSnapshot') return { ...snapshot(), tripId: params.id };
    if (operation === 'readIncident') return { id: params.id, tripId: params.id === originalIncident ? IDS.trip : IDS.otherTrip,
      status: 'active', createdAt: new Date(NOW).toISOString(), resolvedAt: null, groupCapability: 'unavailable' };
    if (operation === 'sos') return { id: params.id === IDS.trip ? originalIncident : newIncident,
      tripId: params.id, status: 'active', groupCapability: 'unavailable' };
    if (operation === 'command') return { id: params.id, command: body.type, automaticEscalation: false };
    throw new Error('Unexpected synthetic operation');
  }
  const journey = createDriverJourney({
    transport: async request => {
      calls.push(structuredClone(request));
      return overrides[request.operation] ? overrides[request.operation](request) : { kind: 'ok', data: response(request) };
    }, clock: () => clock, keyFactory: () => `q47-driver-intent-${++nextKey}`,
  });
  journey.setSession(IDS.driver);
  journey.setInteractionMode('stationary'); journey.setNetwork('online');
  const catalog = { actorId: IDS.driver, source: 'authenticated-server-read', readAt: new Date(NOW).toISOString(),
    trucks: [{ id: IDS.truck, label: 'SYNTHETIC truck' }],
    contacts: [{ id: IDS.grant, status: 'accepted', map: true, incident: true }] };
  journey.provideSelectionEvidence(catalog);
  return { journey, calls, overrides, response, catalog,
    advance(ms) { clock += ms; },
    async draft() {
      journey.editForm({ text: 'SYNTHETIC freight draft', fields });
      journey.selectContacts([IDS.grant]);
      return journey.saveDraft();
    },
  };
}

const probes = [
  { id: 'positive:explicit-draft-confirm-help', async run(f) {
    assert.equal((await f.draft()).kind, 'ok');
    assert.equal(f.journey.snapshot().activation, null);
    assert.equal((await f.journey.confirmTrip({ confirmed: true })).kind, 'ok');
    const help = await f.journey.requestHelp();
    assert.equal(help.data.tripId, IDS.otherTrip);
    assert.equal(f.calls.filter(c => c.operation === 'sos').length, 1);
  } },
  { id: 'ambiguity:rejected-replay-cannot-clear-earlier-unknown', async run(f) {
    await f.draft();
    f.overrides.confirmDraft = () => { throw new Error('SYNTHETIC lost committed response'); };
    assert.equal((await f.journey.confirmTrip({ confirmed: true })).kind, 'unknown');
    const request = f.calls.at(-1);
    f.overrides.confirmDraft = () => ({ kind: 'rejected', status: 403, code: 'forbidden' });
    assert.equal((await f.journey.retryUnknown('confirm', { confirmed: true })).kind, 'unknown');
    assert.deepEqual(f.calls.at(-1), request);
    assert.equal((await f.journey.confirmTrip({ confirmed: true })).code, 'unresolved-submission');
    assert.equal(f.journey.snapshot().activation, null);
  } },
  { id: 'intent:duplicate-pending-confirm-makes-one-request', async run(f) {
    await f.draft();
    const wait = deferred(); f.overrides.confirmDraft = () => wait.promise;
    const first = f.journey.confirmTrip({ confirmed: true });
    const duplicate = f.journey.confirmTrip({ confirmed: true });
    assert.equal(first, duplicate);
    await settle();
    assert.equal(f.calls.filter(c => c.operation === 'confirmDraft').length, 1);
    wait.resolve({ kind: 'ok', data: f.response(f.calls.at(-1)) });
    assert.equal((await first).kind, 'ok');
  } },
  { id: 'session:retired-response-cannot-repopulate-memory', async run(f) {
    await f.draft(); const wait = deferred();
    f.overrides.confirmDraft = () => wait.promise;
    const pending = f.journey.confirmTrip({ confirmed: true }); await settle();
    const request = f.calls.at(-1);
    f.journey.setSession(IDS.otherDriver);
    assert.equal((await pending).kind, 'unknown');
    wait.resolve({ kind: 'ok', data: f.response(request) }); await settle();
    const current = f.journey.snapshot();
    assert.equal(current.activation, null); assert.equal(current.draft, null);
    assert.equal(current.auth.actorId, IDS.otherDriver); assert.deepEqual(current.operations, {});
    assert.equal(current.form.text, '');
  } },
  { id: 'evidence:foreign-owner-and-revoked-contact-not-selectable', async run(f) {
    const foreign = structuredClone(f.catalog); foreign.actorId = IDS.otherDriver;
    assert.equal(f.journey.provideSelectionEvidence(foreign).kind, 'blocked');
    const revoked = structuredClone(f.catalog); revoked.contacts[0].status = 'revoked';
    f.journey.provideSelectionEvidence(revoked);
    assert.equal(f.journey.selectContacts([IDS.grant]).kind, 'blocked');
    assert.equal(f.calls.length, 0);
  } },
  { id: 'source:receipt-and-local-tick-do-not-refresh-old-fix', async run(f) {
    await f.journey.openTrip(IDS.trip); await f.journey.refreshLocation();
    const before = f.journey.snapshot().location;
    assert.equal(before.data.freshness, 'stale'); assert.equal(before.data.ageMs, 300_000);
    f.advance(600_000);
    assert.deepEqual(f.journey.snapshot().location, before);
    assert.equal(f.journey.snapshot().monitoring.state, 'unavailable');
  } },
  { id: 'scope:new-draft-cannot-reuse-an-opened-trip-incident', async run(f) {
    await f.journey.openTrip(IDS.trip);
    await f.journey.refreshLocation(); await f.journey.refreshIncident(originalIncident);
    const saved = await f.draft();
    if (saved.kind === 'blocked') return; // Rejecting a second journey is valid.
    const confirmation = await f.journey.confirmTrip({ confirmed: true });
    if (confirmation.kind === 'blocked') return;
    assert.equal(confirmation.kind, 'ok');
    const current = f.journey.snapshot();
    const help = await f.journey.requestHelp();
    f.actual = { boundTrip: current.tripId, cachedLocationTrip: current.location.data?.tripId,
      cachedIncidentTrip: current.incident.data?.tripId, returnedHelpTrip: help.data?.tripId,
      sosCallsForBoundTrip: f.calls.filter(c => c.operation === 'sos' && c.params.id === current.tripId).length };
    assert.equal(help.kind, 'ok');
    assert.equal(help.data.tripId, current.tripId, 'help returned an incident belonging to a different trip');
    if (current.location.data) assert.equal(current.location.data.tripId, current.tripId);
    if (current.incident.data) assert.equal(current.incident.data.tripId, current.tripId);
  } },
];

const results = [];
for (const probe of probes) {
  const f = fixture();
  try { await probe.run(f); results.push({ id: probe.id, passed: true }); }
  catch { results.push({ id: probe.id, passed: false, ...(f.actual ? { actual: f.actual } : {}) }); }
  finally { f.journey.dispose(); }
}
const passed = results.every(r => r.passed);
console.log(JSON.stringify({ passed, checks: results, limitation: 'Frozen controller source with independent synthetic transport; no UI/device/provider qualification.' }, null, 2));
process.exitCode = passed ? 0 : 1;
