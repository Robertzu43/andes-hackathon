// Independent controls from PR63 gatekeeper review5560841617 and the demo brief.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDS, NOW, REGIONAL_FIELDS } from './fixtures.mjs';
import { deferred } from './scripted-transport.mjs';

const root = process.env.ANDES_REVIEW_DRIVER_ROOT;
if (!root) throw TypeError('A verified frozen driver archive is required');
const { createDriverJourney } = await import(pathToFileURL(resolve(root, 'web/src/features/driver/controller.mjs')));
const oldIncident = '00000000-0000-4000-8000-000000000009';
const settle = () => new Promise(setImmediate);
function fixture() {
  const calls = [], behavior = {};
  let key = 0, clock = NOW;
  const response = request => {
    if (request.operation === 'readTrip') return { id: request.params.id, driver_id: IDS.driver, truck_id: IDS.truck,
      status: 'active', paused: false, map_active: true, checkins_active: true, version: 1,
      origin: REGIONAL_FIELDS.origin, destination: REGIONAL_FIELDS.destination, country: 'BR', locale: 'pt-BR',
      time_zone: 'America/Sao_Paulo', created_at: new Date(NOW).toISOString(), closed_at: null };
    if (request.operation === 'readIncident') return { id: oldIncident, tripId: IDS.trip, status: 'active',
      createdAt: new Date(NOW).toISOString(), resolvedAt: null, groupCapability: 'unavailable' };
    if (request.operation === 'sos') return { id: IDS.incident, tripId: request.params.id,
      status: 'active', groupCapability: 'unavailable' };
    if (request.operation === 'command') return { id: request.params.id, command: request.body.type, automaticEscalation: false };
    throw Error('Unexpected synthetic operation');
  };
  const journey = createDriverJourney({ clock: () => clock, keyFactory: () => `synthetic-driver-intent-${++key}`,
    transport: async (request, options) => {
      calls.push(structuredClone(request));
      return behavior[request.operation] ? behavior[request.operation](request, options)
        : { kind: 'ok', data: response(request) };
    } });
  journey.setSession(IDS.driver); journey.setInteractionMode('stationary'); journey.setNetwork('online');
  return { journey, calls, behavior, response, advance(delta) { clock += delta; },
    count(operation) { return calls.filter(c => c.operation === operation).length; } };
}
const checks = [];
async function probe(id, run) {
  const f = fixture(); let timer;
  try {
    await Promise.race([run(f), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Reviewer timeout')), 2000); })]);
    checks.push({ id, passed: true, ...(f.actual ? { actual: f.actual } : {}) });
  } catch { checks.push({ id, passed: false, ...(f.actual ? { actual: f.actual } : {}) }); }
  finally { clearTimeout(timer); f.journey.dispose(); }
}
await probe('control:ordinary-command-remains-behind-the-moving-interaction-gate', async f => {
  await f.journey.openTrip(IDS.trip); f.journey.setInteractionMode('moving');
  assert.equal((await f.journey.sendCommand('checkin_ok')).kind, 'blocked'); assert.equal(f.count('command'), 0);
});
for (const mode of ['unknown', 'moving']) {
  await probe(`sos:${mode}-interaction-does-not-block-help`, async f => {
    await f.journey.openTrip(IDS.trip); f.journey.setInteractionMode(mode);
    const result = await f.journey.requestHelp();
    f.actual = { result: result.kind, code: result.code, requests: f.count('sos') };
    assert.equal(result.kind, 'ok'); assert.equal(f.count('sos'), 1);
  });
}
await probe('sos:cached-active-incident-cannot-swallow-a-new-press', async f => {
  await f.journey.openTrip(IDS.trip); await f.journey.refreshIncident(oldIncident);
  // The earlier read is now stale; only a fresh request can learn server state.
  const result = await f.journey.requestHelp();
  f.actual = { result: result.kind, requests: f.count('sos'), returnedOldCache: result.data?.id === oldIncident };
  assert.equal(f.count('sos'), 1); assert.equal(result.kind, 'ok'); assert.equal(result.data.id, IDS.incident);
});
await probe('sos:explicit-new-press-after-unknown-can-reach-the-server', async f => {
  await f.journey.openTrip(IDS.trip);
  f.behavior.sos = async () => ({ kind: 'unknown', code: 'synthetic-response-lost' });
  assert.equal((await f.journey.requestHelp()).kind, 'unknown');
  f.behavior.sos = async request => ({ kind: 'ok', data: f.response(request) });
  const result = await f.journey.requestHelp();
  f.actual = { result: result.kind, code: result.code, requests: f.count('sos') };
  assert.equal(result.kind, 'ok'); assert.equal(f.count('sos'), 2);
});
for (const delta of [20_000, -1]) {
  await probe(`sos:known-receipt-survives-wall-clock-shift-${delta}`, async f => {
    await f.journey.openTrip(IDS.trip);
    f.behavior.sos = async request => { f.advance(delta); return { kind: 'ok', data: f.response(request) }; };
    const result = await f.journey.requestHelp();
    f.actual = { result: result.kind, code: result.code, requests: f.count('sos') };
    assert.equal(result.kind, 'ok'); assert.equal(f.journey.snapshot().incident.data.id, IDS.incident);
    assert.equal(f.count('sos'), 1);
  });
}
await probe('checkin:each-sequential-explicit-OK-has-a-new-request-and-key', async f => {
  await f.journey.openTrip(IDS.trip);
  assert.equal((await f.journey.sendCommand('checkin_ok')).kind, 'ok');
  const result = await f.journey.sendCommand('checkin_ok');
  const requests = f.calls.filter(c => c.operation === 'command');
  f.actual = { result: result.kind, requests: requests.length, distinctKeys: new Set(requests.map(r => r.idempotencyKey)).size };
  assert.equal(result.kind, 'ok'); assert.equal(requests.length, 2); assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
});
await probe('session:same-verified-actor-preserves-bound-trip-and-unknown-SOS', async f => {
  await f.journey.openTrip(IDS.trip);
  f.behavior.sos = async () => ({ kind: 'unknown', code: 'synthetic-response-lost' });
  await f.journey.requestHelp(); f.journey.setSession(IDS.driver);
  const state = f.journey.snapshot();
  f.actual = { tripStillBound: state.tripId === IDS.trip, sosState: state.operations.sos?.state ?? null };
  assert.equal(state.tripId, IDS.trip); assert.equal(state.operations.sos.state, 'unknown');
});
await probe('control:overlapping-SOS-presses-share-one-pending-request', async f => {
  await f.journey.openTrip(IDS.trip);
  const reply = deferred(); f.behavior.sos = () => reply.promise;
  const first = f.journey.requestHelp(), second = f.journey.requestHelp();
  await settle(); assert.equal(f.count('sos'), 1);
  reply.resolve({ kind: 'ok', data: f.response(f.calls.at(-1)) });
  assert.equal((await first).kind, 'ok'); assert.equal((await second).kind, 'ok');
});
await probe('control:another-actor-still-retires-private-trip-and-SOS', async f => {
  await f.journey.openTrip(IDS.trip); await f.journey.requestHelp(); f.journey.setSession(IDS.otherDriver);
  const state = f.journey.snapshot();
  assert.equal(state.tripId, null); assert.equal(state.incident.data, null); assert.deepEqual(state.operations, {});
});
const passed = checks.every(c => c.passed);
console.log(JSON.stringify({ passed, checks,
  limitation: 'Frozen nonvisual driver controller and synthetic transport scheduling; no API/backend/browser/device/provider qualification.' }, null, 2));
process.exitCode = passed ? 0 : 1;
