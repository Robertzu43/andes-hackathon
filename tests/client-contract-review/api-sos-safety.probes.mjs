// Independent controls from PR59 gatekeeper review5560836622 and the demo brief.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDS, REGIONAL_FIELDS } from './fixtures.mjs';
import { deferred } from './scripted-transport.mjs';

const apiRoot = process.env.ANDES_REVIEW_API_ROOT;
const driverRoot = process.env.ANDES_REVIEW_DRIVER_ROOT;
if (!apiRoot || !driverRoot) throw TypeError('Verified frozen API and driver archives are required');
const { MemorySession, createApiClient, createDriverTransport, bindJourneySession } =
  await import(pathToFileURL(resolve(apiRoot, 'web/src/lib/api/index.ts')));
const { createDriverJourney } = await import(pathToFileURL(resolve(driverRoot, 'web/src/features/driver/controller.mjs')));
const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
const settle = () => new Promise(setImmediate);
const credentials = (token = 'synthetic.tokenA', subject = 'synthetic-owner-A') => ({
  issuer: 'https://identity.synthetic.invalid', subject, accessToken: token, expiresAt: Date.now() + 60_000,
});
const sos = () => ({ id: IDS.incident, tripId: IDS.trip, status: 'active', groupCapability: 'unavailable' });
const trip = () => ({ id: IDS.trip, driver_id: IDS.driver, truck_id: IDS.truck, status: 'active',
  paused: false, map_active: true, checkins_active: true, version: 1,
  origin: REGIONAL_FIELDS.origin, destination: REGIONAL_FIELDS.destination, country: 'BR', locale: 'pt-BR',
  time_zone: 'America/Sao_Paulo', created_at: '2026-10-17T12:00:00.000Z', closed_at: null });

function fixture() {
  const session = new MemorySession(); session.setCredentials(credentials());
  const calls = [];
  const behavior = { async fetch(url) {
    if (url.pathname === '/v1/me') return Response.json({ id: IDS.driver });
    if (url.pathname === `/v1/trips/${IDS.trip}`) return Response.json(trip());
    if (url.pathname === `/v1/trips/${IDS.trip}/sos`) return Response.json(sos());
    throw Error('Unexpected synthetic route');
  } };
  const api = createApiClient({ session, baseUrl: 'https://andes.synthetic.invalid', timeoutMs: 500,
    fetch: async (url, init) => { calls.push({ path: url.pathname, method: init.method }); return behavior.fetch(url, init); } });
  const transport = createDriverTransport(api);
  let binding, journey;
  return { session, api, calls, behavior, transport,
    sosCalls: () => calls.filter(c => c.path.endsWith('/sos')).length,
    async driver() {
      journey = createDriverJourney({ transport, keyFactory: () => 'synthetic-original-sos-intent' });
      binding = bindJourneySession(session, api, actor => journey.setSession(actor));
      await binding.activate(); journey.setInteractionMode('stationary'); journey.setNetwork('online');
      assert.equal((await journey.openTrip(IDS.trip)).kind, 'ok');
      return journey;
    },
    dispose() { binding?.dispose(); journey?.dispose(); session.clear(); },
  };
}
const descriptor = (overrides = {}) => ({ operation: 'sos', params: { id: IDS.trip }, body: {},
  idempotencyKey: 'synthetic-original-sos-intent', ...overrides });
const checks = [];
async function probe(id, run) {
  const f = fixture(); let timer;
  try {
    await Promise.race([run(f), new Promise((_, reject) => {
      timer = nativeSetTimeout(() => reject(Error('Reviewer timeout')), 2000);
    })]);
    checks.push({ id, passed: true, ...(f.actual ? { actual: f.actual } : {}) });
  } catch { checks.push({ id, passed: false, ...(f.actual ? { actual: f.actual } : {}) }); }
  finally { nativeClearTimeout(timer); f.dispose(); }
}

await probe('control:accepted-sos-is-a-single-request-and-an-incident', async f => {
  const result = await f.transport(descriptor(), { signal: new AbortController().signal });
  assert.equal(result.kind, 'ok'); assert.equal(result.data.id, IDS.incident); assert.equal(f.sosCalls(), 1);
});
for (const when of ['body-pending', 'already-accepted']) {
  await probe(`refresh:${when}-sos-survives-same-identity-token-rotation`, async f => {
    const journey = await f.driver();
    const reached = deferred(), body = deferred();
    if (when === 'body-pending') f.behavior.fetch = async url => {
      assert.ok(url.pathname.endsWith('/sos'));
      const response = Response.json(sos());
      response.json = async () => { reached.resolve(); return body.promise; };
      return response;
    };
    const pending = journey.requestHelp();
    let result;
    if (when === 'body-pending') await reached.promise;
    else result = await pending;
    f.session.setCredentials(credentials('synthetic.tokenB'));
    body.resolve(sos());
    result ??= await pending;
    await settle();
    const state = journey.snapshot();
    f.actual = { result: result.kind, sosRequests: f.sosCalls(), tripStillBound: state.tripId === IDS.trip,
      incidentStillRecorded: state.incident.data?.id === IDS.incident, sosState: state.operations.sos?.state ?? null };
    assert.equal(result.kind, 'ok'); assert.equal(f.sosCalls(), 1);
    assert.equal(state.tripId, IDS.trip); assert.equal(state.incident.data.id, IDS.incident);
    assert.equal(state.operations.sos.state, 'accepted');
  });
}
for (const condition of ['signed-out', 'invalid-key', 'invalid-resource', 'pre-aborted']) {
  await probe(`not-sent:${condition}-cannot-become-unknown`, async f => {
    const abort = new AbortController(); let request = descriptor();
    if (condition === 'signed-out') f.session.clear();
    if (condition === 'invalid-key') request.idempotencyKey = '';
    if (condition === 'invalid-resource') request.params.id = 'synthetic-invalid-resource';
    if (condition === 'pre-aborted') abort.abort();
    const result = await f.transport(request, { signal: abort.signal });
    f.actual = { result: result.kind, code: result.code, fetches: f.calls.length };
    assert.equal(f.calls.length, 0); assert.equal(result.kind, 'not_sent');
  });
}
await probe('rejection:429-is-a-definite-server-rejection', async f => {
  f.behavior.fetch = async () => Response.json({ code: 'rate_limited' }, { status: 429 });
  const result = await f.transport(descriptor(), { signal: new AbortController().signal });
  f.actual = { result: result.kind, status: result.status, fetches: f.sosCalls() };
  assert.equal(f.sosCalls(), 1); assert.equal(result.kind, 'rejected'); assert.equal(result.status, 429);
});
await probe('compatibility:missing-AbortSignal-any-still-sends-and-cleans-its-timer', async f => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  const liveTimers = new Set(); let result, outstanding;
  try {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, writable: true, configurable: true });
    globalThis.setTimeout = (...args) => { const timer = nativeSetTimeout(...args); liveTimers.add(timer); return timer; };
    globalThis.clearTimeout = timer => { liveTimers.delete(timer); return nativeClearTimeout(timer); };
    result = await f.transport(descriptor(), { signal: new AbortController().signal });
    outstanding = liveTimers.size;
  } finally {
    if (original) Object.defineProperty(AbortSignal, 'any', original); else delete AbortSignal.any;
    globalThis.setTimeout = nativeSetTimeout; globalThis.clearTimeout = nativeClearTimeout;
    for (const timer of liveTimers) nativeClearTimeout(timer);
  }
  f.actual = { result: result.kind, fetches: f.sosCalls(), outstandingRequestTimers: outstanding };
  assert.equal(result.kind, 'ok'); assert.equal(f.sosCalls(), 1); assert.equal(outstanding, 0);
});
await probe('control:failure-after-dispatch-stays-unknown-with-no-retry', async f => {
  f.behavior.fetch = async () => { throw TypeError('SYNTHETIC response lost after dispatch'); };
  const result = await f.transport(descriptor(), { signal: new AbortController().signal });
  f.actual = { result: result.kind, fetches: f.sosCalls() };
  assert.equal(result.kind, 'unknown'); assert.equal(f.sosCalls(), 1);
});
await probe('control:caller-abort-after-dispatch-stays-unknown-with-no-retry', async f => {
  const reached = deferred(), abort = new AbortController();
  f.behavior.fetch = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Error('SYNTHETIC aborted after dispatch')), { once: true });
    reached.resolve();
  });
  const pending = f.transport(descriptor(), { signal: abort.signal });
  await reached.promise; abort.abort(); const result = await pending;
  f.actual = { result: result.kind, fetches: f.sosCalls() };
  assert.equal(result.kind, 'unknown'); assert.equal(f.sosCalls(), 1);
});
const passed = checks.every(c => c.passed);
console.log(JSON.stringify({ passed, checks,
  limitation: 'Frozen client and driver exports with synthetic HTTP scheduling; no backend, browser, physical iOS or provider qualification.' }, null, 2));
process.exitCode = passed ? 0 : 1;
