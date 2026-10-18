// All acquisition here uses the real adapter with a detached synthetic platform.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createTripPhoneObservations } from '../../../src/phone-observations/trip-sharing.mjs';
import { tokenFor } from '../observations/memory-store.mjs';
import { createMemoryStores } from '../observations/memory-store.mjs';
import { openObservationQueue } from '../../src/lib/observations/queue.mjs';

const TRIP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = 'synthetic-oidc-sub'; // Deliberately not a /me UUID.
const SOURCE = Date.now() - 4000;
const packet = () => ({ key: 'detached-fixture', qualification: {
  schema: 'andes.phone-observations.qualification/1', kind: 'synthetic-fixture',
  disposition: 'qualified', evidenceRef: 'in-process-synthetic-only', contextKey: 'detached-fixture',
  budgetRevision: 'engineering-only/5', streams: { geolocation: true },
} });
let vite, createTripObservationHost, MemorySession, createApiClient;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), envDir: false,
    server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' });
  ({ createTripObservationHost } = await vite.ssrLoadModule('/src/features/driver/observations.ts'));
  ({ MemorySession, createApiClient } = await vite.ssrLoadModule('/src/lib/api/index.ts'));
});
after(async () => { await vite?.close(); });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await tick(); }
  assert.fail('finite fixture did not reach the expected state');
}
function target() {
  const listeners = new Map();
  return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    fire(name) { for (const fn of [...listeners.get(name) ?? []]) fn(); } };
}
function platformFixture({ wakeDenied = false, gpsThrows = false, syncFailure = null, onGps = () => {} } = {}) {
  let success, failure, gpsCalls = 0, clears = 0, releases = 0;
  const scheduled = new Map(); let id = 0;
  class FixtureEvent {
    type = 'click'; isTrusted = true; currentTarget = {}; eventPhase = 2;
  }
  const permission = { ...target(), state: 'granted' };
  const document = { ...target(), visibilityState: 'visible' };
  const platform = { ...target(), Event: FixtureEvent, document, isSecureContext: true,
    setTimeout(fn) { scheduled.set(++id, fn); return id; }, clearTimeout(n) { scheduled.delete(n); },
    navigator: { userActivation: { isActive: false }, permissions: { query: async () => permission },
      geolocation: { watchPosition(ok, fail) { gpsCalls++; onGps(); success = ok; failure = fail;
        if (gpsThrows) throw Error('fixture'); if (syncFailure !== null) fail({ code: syncFailure }); return 17; },
        clearWatch(n) { assert.equal(n, 17); clears++; } },
      wakeLock: { async request() { if (wakeDenied) throw Error('fixture'); return { ...target(), released: false, release() { releases++; } }; } } } };
  return { platform, clock: { now: () => ({ wallMs: Date.now(), monoMs: performance.now() }) },
    event: () => new FixtureEvent(), get gpsCalls() { return gpsCalls; }, get clears() { return clears; }, get releases() { return releases; },
    sample() { success?.({ timestamp: SOURCE, coords: { latitude: -12.05, longitude: -77.04, accuracy: 14 } }); },
    fail(code) { failure?.({ code, message: 'must never escape' }); },
    deny() { permission.state = 'denied'; permission.fire('change'); },
    hide() { document.visibilityState = 'hidden'; document.fire('visibilitychange'); } };
}
// Only the browser storage boundary is replaced. The real IDB collections,
// durable queue, pipeline, uploader, MemorySession, SDK and adapter all execute.
function idbFixture({ holdOpen = false } = {}) {
  const maps = { queue: new Map(), meta: new Map() };
  let writeFailure = false, closed = false;
  const request = action => {
    const req = {};
    queueMicrotask(() => { try { req.result = action(); req.onsuccess?.(); } catch (error) { req.error = error; req.onerror?.(); } });
    return req;
  };
  const db = { close() { closed = true; }, objectStoreNames: { contains: () => true },
    transaction(name) {
      if (closed) throw Error('IndexedDB connection is closed');
      const tx = { objectStore() {
        const map = maps[name];
        const mutate = fn => queueMicrotask(() => {
          if (writeFailure) { tx.error = Error('fixture storage unavailable'); tx.onerror?.(); }
          else { fn(); tx.oncomplete?.(); }
        });
        return { get: key => request(() => structuredClone(map.get(key))), getAll: () => request(() => structuredClone([...map.values()])),
          count: () => request(() => map.size), put(value) { mutate(() => map.set(value.queueId ?? value.id, structuredClone(value))); },
          delete(key) { mutate(() => map.delete(key)); }, clear() { mutate(() => map.clear()); } };
      } }; return tx;
    } };
  let releaseOpen = () => {};
  return { factory: { open() {
    if (!holdOpen) return request(() => db);
    const req = {};
    releaseOpen = () => queueMicrotask(() => { req.result = db; req.onsuccess?.(); });
    return req;
  } }, releaseOpen() { releaseOpen(); }, maps, failWrites() { writeFailure = true; }, get closed() { return closed; } };
}
async function fixture(t, options = {}) {
  const capture = platformFixture(options), idb = idbFixture(options), calls = [];
  const session = new MemorySession(options.sessionClock);
  session.setCredentials({ issuer: 'https://identity.example.invalid', subject: OWNER,
    accessToken: tokenFor(OWNER), expiresAt: Date.now() + 60000 });
  const fetch = async (url, init) => {
    const path = new URL(url).pathname, body = JSON.parse(init.body);
    calls.push({ path, body, init });
    if (path.endsWith('/sharing')) {
      if (options.sharing) return options.sharing(body, init);
      return Response.json({ id: TRIP, sharing: body.state });
    }
    if (options.upload) return options.upload(body, init);
    return Response.json({ id: TRIP, received: body.observations.length });
  };
  const saved = { idb: Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), fetch: globalThis.fetch };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: options.noStorage ? undefined : idb.factory });
  globalThis.fetch = fetch;
  const api = createApiClient({ session, baseUrl: 'http://127.0.0.1:43210', fetch });
  const host = createTripObservationHost({ tripId: TRIP, revision: 'task2', session, api,
    baseUrl: 'http://127.0.0.1:43210', reviewedContext: options.noPacket ? null : packet(),
    captureOptions: { ...(options.deviceDefault ? {} : { mode: 'synthetic-test' }),
      platform: capture.platform, clock: capture.clock } });
  t.after(async () => { await host.dispose(); session.clear(); globalThis.fetch = saved.fetch;
    if (saved.idb) Object.defineProperty(globalThis, 'indexedDB', saved.idb); else delete globalThis.indexedDB; });
  const prepared = () => until(() => host.getSnapshot().storage !== 'preparing');
  const start = () => { const event = capture.event(); const result = host.startSharing(event);
    event.currentTarget = null; event.eventPhase = 0; return result; };
  return { host, session, api, capture, idb, calls, prepared, start, shares: () => calls.filter(c => c.path.endsWith('/sharing')) };
}

// Catches bypassing the source gate or inferring consent from permission.
test('capture still requires the reviewed packet and exact-trip consent', async t => {
  const f = await fixture(t, { noPacket: true }); await f.prepared(); await f.start();
  assert.equal(f.host.getSnapshot().reason, 'unqualified'); assert.equal(f.capture.gpsCalls, 0);
  assert.equal(f.shares().length, 0);
  const capture = platformFixture();
  for (const locationConsent of [null, { granted: true, tripId: OTHER, reference: 'foreign' }]) {
    const adapter = createTripPhoneObservations({ trip: { tripId: TRIP, revision: 'task2' }, reviewedContext: packet(),
      locationConsent, mode: 'synthetic-test', platform: capture.platform, clock: capture.clock });
    assert.equal(adapter.startSharing(capture.event()).reason, 'trip-location-consent-required');
  }
  assert.equal(capture.gpsCalls, 0);
});

// Catches awaiting preparation then replaying an expired user event.
test('preparation needs a fresh gesture; capture starts before dispatch ends', async t => {
  const f = await fixture(t);
  await f.start(); assert.equal(f.capture.gpsCalls, 0);
  await f.prepared(); assert.equal(f.capture.gpsCalls, 0);
  assert.equal(f.host.getSnapshot().ready, true);
  const event = f.capture.event(); const starting = f.host.startSharing(event);
  assert.equal(f.capture.gpsCalls, 1, 'native watch is invoked before the first await');
  event.currentTarget = null; event.eventPhase = 0; await starting;
  assert.equal(f.host.getSnapshot().acquisition, 'acquiring');
});

// Catches treating a missing/plain/untrusted/stale event as retained consent.
test('missing untrusted and stale events never retain consent or start GPS', async t => {
  const f = await fixture(t); await f.prepared();
  const untrusted = Object.assign(f.capture.event(), { isTrusted: false });
  const stale = Object.assign(f.capture.event(), { currentTarget: null, eventPhase: 0 });
  for (const event of [undefined, {}, untrusted, stale]) {
    await f.host.startSharing(event);
    assert.equal(f.capture.gpsCalls, 0); assert.equal(f.shares().length, 0);
  }
  await f.host.startSharing(); assert.equal(f.capture.gpsCalls, 0);
  await f.start(); assert.equal(f.capture.gpsCalls, 1);
});

// Catches a substituted /me ID, receipt timestamps or dropped accuracy.
test('real adapter persists the OIDC owner and preserves the source sample to upload', async t => {
  let release;
  const f = await fixture(t, { upload: () => new Promise(resolve => { release = resolve; }) });
  await f.prepared(); await f.start(); f.capture.sample();
  await until(() => release);
  const queued = [...f.idb.maps.queue.values()][0];
  assert.equal(queued.userId, f.session.snapshot().subject);
  const upload = f.calls.find(c => c.path.endsWith('/locations'));
  assert.deepEqual(upload.body.observations, [{ capturedAt: new Date(SOURCE).toISOString(), latitude: -12.05, longitude: -77.04, accuracy: 14 }]);
  assert.equal(upload.init.headers.Authorization, `Bearer ${tokenFor(OWNER)}`);
  release(Response.json({ id: TRIP, received: 1 }));
  await until(() => f.idb.maps.queue.size === 0);
  assert.equal(JSON.stringify([...f.idb.maps.meta.values()]).includes(tokenFor(OWNER)), false);
  assert.equal(JSON.stringify(f.host.getSnapshot()).includes(tokenFor(OWNER)), false);
  assert.deepEqual(f.host.getSnapshot().sharing, { outcome: 'receipt', state: 'resumed', reason: 'user' });
});

for (const [action, reason] of [['hide', 'page_hidden'], ['deny', 'permission_denied'], ['fail', 'error'], ['stop', 'user']]) {
  // Catches missing lifecycle wiring, wrong reason, or reentrant duplicate writes.
  test(`${action} stops capture immediately and records a separate sharing receipt`, async t => {
    const f = await fixture(t); await f.prepared(); await f.start(); await tick();
    const result = action === 'stop' ? f.host.stopSharing() : action === 'fail' ? f.capture.fail(2) : f.capture[action]();
    assert.ok(f.capture.clears > 0, 'capture stops before async server work');
    assert.equal(f.host.getSnapshot().acquisition, 'stopped');
    await result; await until(() => f.host.getSnapshot().sharing.state === 'stopped' && f.host.getSnapshot().sharing.outcome === 'receipt');
    assert.deepEqual(f.shares().at(-1).body, { state: 'stopped', reason });
    assert.ok(f.shares().at(-1).init.headers['Idempotency-Key']);
    await f.host.stopSharing(); assert.equal(f.shares().length, 2);
    const count = f.calls.length; f.capture.sample(); await tick(); assert.equal(f.calls.length, count);
  });
}

test('GPS code 1 is reported as permission_denied without leaking the native message', async t => {
  const f = await fixture(t); await f.prepared(); await f.start(); f.capture.fail(1);
  await until(() => f.shares().length === 2);
  assert.deepEqual(f.shares()[1].body, { state: 'stopped', reason: 'permission_denied' });
  assert.equal(JSON.stringify(f.host.getSnapshot()).includes('must never escape'), false);
});

test('wake-lock refusal limits availability but leaves acquisition running', async t => {
  const f = await fixture(t, { wakeDenied: true }); await f.prepared(); await f.start();
  await until(() => f.host.getSnapshot().wakeLock === 'unavailable');
  assert.equal(f.host.getSnapshot().acquisition, 'acquiring'); assert.equal(f.capture.clears, 0);
});

test('missing storage prevents GPS; write failure stops it and exposes unavailable', async t => {
  const f = await fixture(t, { noStorage: true }); await f.prepared(); await f.start();
  assert.equal(f.host.getSnapshot().storage, 'unavailable'); assert.equal(f.capture.gpsCalls, 0);
});

test('storage failure after acquisition retires capture and uploader', async t => {
  const f = await fixture(t); await f.prepared(); await f.start(); f.idb.failWrites(); f.capture.sample();
  await until(() => f.host.getSnapshot().storage === 'unavailable');
  assert.ok(f.capture.clears > 0); assert.equal(f.host.getSnapshot().ready, false);
  assert.equal(f.calls.some(c => c.path.endsWith('/locations')), false);
});

test('ambiguous sharing writes remain unknown without automatic replay', async t => {
  const f = await fixture(t, { sharing: async () => { throw Error('lost synthetic response'); } });
  await f.prepared(); await f.start();
  assert.equal(f.host.getSnapshot().sharing.outcome, 'unknown');
  await tick(); await tick(); assert.equal(f.shares().length, 1);
  assert.equal(f.host.getSnapshot().acquisition, 'acquiring');
});

test('wrong sharing receipt ID confirms nothing', async t => {
  const f = await fixture(t, { sharing: async body => Response.json({ id: OTHER, sharing: body.state }) });
  await f.prepared(); await f.start(); assert.equal(f.host.getSnapshot().sharing.outcome, 'unknown');
});

test('logout aborts uploads, wipes all same-owner trips, and ignores late callbacks', async t => {
  let release;
  const f = await fixture(t, { upload: () => new Promise(resolve => { release = resolve; }) });
  await f.prepared(); await f.start(); f.capture.sample(); await until(() => release);
  const record = [...f.idb.maps.queue.values()][0];
  f.idb.maps.queue.set('sister-trip', { ...record, queueId: 'sister-trip', tripId: OTHER });
  f.idb.maps.queue.set('other-owner', { ...record, queueId: 'other-owner', userId: 'other-owner' });
  f.session.clear(); const dispatched = f.calls.length;
  assert.ok(f.capture.clears > 0);
  assert.equal(f.calls.find(c => c.path.endsWith('/locations')).init.signal.aborted, true);
  const snapshot = f.host.getSnapshot();
  f.capture.sample(); release(Response.json({ id: TRIP, received: 1 }));
  await until(() => [...f.idb.maps.queue.values()].every(r => r.userId !== OWNER));
  await tick(); assert.equal(f.calls.length - dispatched, 0);
  assert.deepEqual(f.host.getSnapshot(), snapshot, 'late callbacks cannot apply');
  assert.equal(f.idb.maps.queue.size, 1, 'other owners are not wiped');
});

test('dispose during preparation closes stores without retaining a gesture', async t => {
  const f = await fixture(t); await f.host.dispose(); await f.start();
  assert.equal(f.capture.gpsCalls, 0); assert.equal(f.idb.closed, true);
  assert.equal(f.host.getSnapshot().ready, false);
});

// Catches an enabled/idle production presentation before any qualification exists.
test('null reviewed packet is already unavailable before the first gesture', async t => {
  const f = await fixture(t, { noPacket: true, deviceDefault: true }); await f.prepared();
  assert.equal(f.host.getSnapshot().acquisition, 'unavailable');
  assert.equal(f.host.getSnapshot().reason, 'unqualified');
  assert.equal(f.host.getSnapshot().ready, false);
  assert.equal(f.capture.gpsCalls, 0); assert.equal(f.calls.length, 0);
});

// Catches returning from preparation on retirement without wiping existing owner records.
test('logout during preparation wipes the owner queue before closing storage', async t => {
  const f = await fixture(t, { holdOpen: true });
  const stores = createMemoryStores();
  const queue = await openObservationQueue(stores);
  for (const [tripId, userId, offset] of [[TRIP, OWNER, 0], [OTHER, OWNER, 1000], [OTHER, 'other-owner', 2000]]) {
    await queue.enqueue({ scope: { tripId, userId }, sample: {
      capturedAt: new Date(SOURCE + offset).toISOString(), latitude: -12.05, longitude: -77.04, accuracy: 14,
    } });
  }
  for (const r of await stores.records.getAll()) f.idb.maps.queue.set(r.queueId, r);
  assert.equal(f.idb.maps.queue.size, 3);
  f.session.clear(); f.idb.releaseOpen();
  await until(() => f.idb.closed);
  assert.deepEqual([...f.idb.maps.queue.values()].map(r => r.userId), ['other-owner']);
  assert.equal(f.calls.length, 0); assert.equal(f.capture.gpsCalls, 0);
});

// Catches a synchronous denial being overwritten by a generic start failure.
test('synchronous acquisition denial preserves the terminal permission state', async t => {
  const f = await fixture(t, { syncFailure: 1 }); await f.prepared(); await f.start();
  assert.equal(f.host.getSnapshot().acquisition, 'stopped');
  assert.equal(f.host.getSnapshot().reason, 'permission_denied');
  await until(() => f.host.getSnapshot().sharing.outcome === 'receipt');
  assert.deepEqual(f.shares().map(c => c.body), [{ state: 'stopped', reason: 'permission_denied' }]);
});

// Catches calling native GPS after a snapshot subscriber has retired the session.
test('subscriber retirement cannot dispatch acquisition after account invalidation', async t => {
  let retired = false, callsAfterRetirement = 0;
  const f = await fixture(t, { onGps() { if (retired) callsAfterRetirement++; } }); await f.prepared();
  const detach = f.host.subscribe(() => {
    if (f.host.getSnapshot().acquisition === 'acquiring') { retired = true; f.session.clear(); }
  });
  await f.start(); detach();
  assert.equal(retired, true); assert.equal(callsAfterRetirement, 0);
  assert.equal(f.host.getSnapshot().reason, 'session-retired');
  assert.equal(f.calls.length, 0);
});

// Catches starting an SDK write after a synchronous subscriber disposed the host.
test('dispose from the pending-sharing notification prevents dispatch', async t => {
  const f = await fixture(t); await f.prepared();
  let disposing;
  f.host.subscribe(() => {
    if (f.host.getSnapshot().sharing.outcome === 'pending') disposing ??= f.host.dispose();
  });
  await f.start(); await disposing;
  assert.equal(f.calls.length, 0); assert.ok(f.capture.clears > 0);
  assert.equal(f.host.getSnapshot().sharing.outcome, 'not_sent');
});

// Catches sending resumed after a newer stop intent was dispatched reentrantly.
test('a newer stop intent cancels a resumed write before it reaches the SDK', async t => {
  const f = await fixture(t); await f.prepared();
  let stopping;
  const detach = f.host.subscribe(() => {
    const s = f.host.getSnapshot();
    if (s.sharing.state === 'resumed' && s.sharing.outcome === 'pending') stopping = f.host.stopSharing();
  });
  await f.start(); await stopping; detach();
  assert.deepEqual(f.shares().map(c => c.body), [{ state: 'stopped', reason: 'user' }]);
});

// Exercises SDK no-send and HTTP rejection separately from ambiguous dispatch.
test('sharing snapshots distinguish zero dispatch and a received HTTP refusal', async t => {
  const f = await fixture(t); await f.prepared();
  const setSharing = f.api.setSharing;
  f.api.setSharing = (id, body, options) => setSharing(id, body, { ...options, signal: AbortSignal.abort() });
  await f.start();
  assert.equal(f.calls.length, 0); assert.equal(f.host.getSnapshot().sharing.outcome, 'not_sent');
  assert.equal(f.host.getSnapshot().acquisition, 'acquiring');
});

test('sharing HTTP refusal is rejected without automatic replay', async t => {
  const f = await fixture(t, { sharing: async () => Response.json({ code: 'forbidden' }, { status: 403 }) });
  await f.prepared(); await f.start(); await tick();
  assert.equal(f.host.getSnapshot().sharing.outcome, 'rejected'); assert.equal(f.shares().length, 1);
});

test('the host defaults to device mode and cannot qualify a synthetic fixture', async t => {
  const f = await fixture(t, { deviceDefault: true }); await f.prepared(); await f.start();
  assert.equal(f.host.getSnapshot().reason, 'unqualified'); assert.equal(f.capture.gpsCalls, 0);
});

test('the real adapter still rejects synthetic inputs that wrap native timers', async t => {
  const f = await fixture(t); await f.prepared();
  f.capture.platform.setTimeout = globalThis.setTimeout;
  f.capture.platform.clearTimeout = globalThis.clearTimeout;
  await assert.rejects(f.start(), /Synthetic mode requires detached injected platform and clock/);
  assert.equal(f.capture.gpsCalls, 0); assert.equal(f.calls.length, 0);
});

test('same-account credential refresh uses the current lease for uploads', async t => {
  const f = await fixture(t); await f.prepared(); await f.start();
  const refreshed = tokenFor(OWNER).replace('unsigned', 'refreshed');
  f.session.setCredentials({ issuer: 'https://identity.example.invalid', subject: OWNER,
    accessToken: refreshed, expiresAt: Date.now() + 60000 });
  f.capture.sample(); await until(() => f.calls.some(c => c.path.endsWith('/locations')));
  assert.equal(f.calls.find(c => c.path.endsWith('/locations')).init.headers.Authorization, `Bearer ${refreshed}`);
  assert.equal(f.host.getSnapshot().acquisition, 'acquiring');
});

for (const change of ['expiry', 'replacement']) {
  test(`${change} retires capture and rejects late sharing receipts`, async t => {
    let now = Date.now(), release;
    const f = await fixture(t, { sessionClock: () => now,
      sharing: () => new Promise(resolve => { release = resolve; }) });
    await f.prepared(); const starting = f.start(); await until(() => release);
    if (change === 'expiry') { now += 120000; f.session.snapshot(); }
    else f.session.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'new-owner',
      accessToken: tokenFor('new-owner'), expiresAt: now + 60000 });
    const snapshot = f.host.getSnapshot();
    assert.equal(snapshot.reason, 'session-retired'); assert.ok(f.capture.clears > 0);
    release(Response.json({ id: TRIP, sharing: 'resumed' })); await starting; await tick();
    assert.deepEqual(f.host.getSnapshot(), snapshot); assert.equal(f.shares().length, 1);
  });
}

// Catches losing the newer in-flight stop promise when an older start unwinds.
test('repeated stop awaits the current stop receipt after a reentrant start cancellation', async t => {
  let release;
  const f = await fixture(t, { sharing: body => {
    assert.equal(body.state, 'stopped');
    return new Promise(resolve => { release = resolve; });
  } });
  await f.prepared();
  f.host.subscribe(() => {
    const s = f.host.getSnapshot();
    if (s.sharing.state === 'resumed' && s.sharing.outcome === 'pending') void f.host.stopSharing();
  });
  await f.start(); await until(() => release);
  let settled = false;
  const stopping = f.host.stopSharing().then(() => { settled = true; });
  try { await tick(); assert.equal(settled, false); }
  finally { release(Response.json({ id: TRIP, sharing: 'stopped' })); }
  await stopping;
  assert.equal(f.host.getSnapshot().sharing.outcome, 'receipt'); assert.equal(f.shares().length, 1);
});

// Catches a repeated dispose resolving while preparation still owns live resources.
test('every dispose caller waits for preparation and resource closure', async t => {
  const f = await fixture(t, { holdOpen: true });
  const first = f.host.dispose();
  let settled = false;
  const repeated = f.host.dispose().then(() => { settled = true; });
  try { await tick(); assert.equal(settled, false); }
  finally { f.idb.releaseOpen(); await first; }
  await repeated; assert.equal(f.idb.closed, true);
});

// Catches reporting a pending request forever after local disposal loses its receipt.
test('disposal after dispatch preserves unknown sharing instead of claiming no send', async t => {
  let release;
  const f = await fixture(t, { sharing: () => new Promise(resolve => { release = resolve; }) });
  await f.prepared(); const starting = f.start(); await until(() => release);
  try {
    await f.host.dispose();
    assert.equal(f.host.getSnapshot().sharing.outcome, 'unknown');
    assert.equal(f.shares().length, 1);
  } finally { release(Response.json({ id: TRIP, sharing: 'resumed' })); await starting; }
  assert.equal(f.host.getSnapshot().sharing.outcome, 'unknown');
});

test('a throwing geolocation API stops with error and never dispatches resumed', async t => {
  const f = await fixture(t, { gpsThrows: true }); await f.prepared(); await f.start();
  await until(() => f.host.getSnapshot().sharing.outcome === 'receipt');
  assert.equal(f.host.getSnapshot().acquisition, 'stopped'); assert.equal(f.host.getSnapshot().reason, 'error');
  assert.deepEqual(f.shares().map(c => c.body), [{ state: 'stopped', reason: 'error' }]);
});

// Catches expiry in MemorySession.subscribe before its listener is registered.
test('expiry between lease capture and subscription never enables a retired host', async t => {
  const now = Date.now(); let reads = 0;
  const f = await fixture(t, { sessionClock: () => ++reads >= 4 ? now + 120000 : now });
  await f.prepared();
  assert.equal(f.session.snapshot().status, 'expired');
  assert.equal(f.host.getSnapshot().ready, false);
  assert.equal(f.host.getSnapshot().reason, 'session-retired');
  assert.equal(f.calls.length, 0); assert.equal(f.capture.gpsCalls, 0);
});
