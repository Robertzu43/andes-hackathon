// Version3: preserves v2 except P15 separate permission-prompt deadline and F3 browser-confirmed denial. Original/v2 remain unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = process.env.ANDES_CANDIDATE_DIR;
assert.ok(root, 'Set ANDES_CANDIDATE_DIR to the exact candidate archive');
const { createPhoneObservationAdapter: create, PROVISIONAL_BUDGET: B, QUALIFICATION_SCHEMA: Q } =
  await import(pathToFileURL(`${root}/src/phone-observations/adapter.mjs`));
const EPOCH = 1800000000000;
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class Target {
  handlers = new Map();
  addEventListener(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  fire(name, data = {}) { for (const fn of [...(this.handlers.get(name) ?? [])]) fn(data); }
  count(name) { return name ? this.handlers.get(name)?.size ?? 0 : [...this.handlers.values()].reduce((n, x) => n + x.size, 0); }
}
function setup({ config = {}, budget = {}, sink, prepare } = {}) {
  let wallMs = EPOCH, monoMs = 100, next = 0;
  const p = new Target(), doc = Object.assign(new Target(), { visibilityState: 'visible' });
  const events = [], locations = [], motions = [], queries = [], cleared = [], timers = new Map();
  const statuses = Object.fromEntries(['geolocation', 'accelerometer', 'gyroscope'].map(name =>
    [name, Object.assign(new Target(), { state: 'granted' })]));
  const nativeWatches = new Map();
  const geo = {
    getCurrentPosition(success, error, options) { locations.push({ success, error, options: { ...options }, kind: 'sample' }); },
    watchPosition(success, error, options) {
      const id = ++next;
      const item = { success, error, options: { ...options }, kind: 'watch', id };
      locations.push(item); nativeWatches.set(id, item); return id;
    },
    clearWatch(id) { cleared.push(id); nativeWatches.delete(id); },
  };
  Object.assign(p, {
    document: doc, isSecureContext: true,
    navigator: { geolocation: geo, userActivation: { isActive: true },
      permissions: { query({ name }) { queries.push(name); return Promise.resolve(statuses[name]); } } },
    DeviceMotionEvent: { requestPermission() { const item = deferred(); motions.push(item); return item.promise; } },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const qualification = { schema: Q, kind: 'synthetic-fixture', disposition: 'qualified',
    evidenceRef: 'review-only:synthetic', contextKey: 'review-visible', budgetRevision: B.revision,
    streams: { geolocation: true, motion: true } };
  const f = { p, doc, geo, events, locations, motions, queries, statuses, nativeWatches, timers, cleared,
    advance(ms, wall = ms) { wallMs += wall; monoMs += ms; },
    clock(w, m) { wallMs = w; monoMs = m; },
    flush(ms) { for (const [id, t] of [...timers]) if (ms === undefined || ms === t.ms) { timers.delete(id); t.fn(); } },
    last(type) { return events.filter(e => e.type === type).at(-1); },
    start(sessionId = 'review-session') { return f.a.start({ sessionId, tripId: 'review-trip', revision: 'frozen-cc4dc5d2' }); },
  };
  prepare?.(f);
  f.options = { platform: p, clock: { now: () => ({ wallMs, monoMs }) }, mode: 'synthetic-test',
    contextKey: 'review-visible', qualification, budget: { ...B, freshnessMs: 1000, ...budget },
    sink(event) { events.push(event); return sink?.(event, f); }, ...config };
  f.a = create(f.options);
  return f;
}
const fix = (timestamp = EPOCH, accuracy = 8) => ({ timestamp,
  coords: { latitude: 12.3456789, longitude: -65.4321987, accuracy, altitude: 7654.321, heading: 91, speed: 17 } });
async function enableMotion(f) {
  const pending = f.a.acquireMotion();
  f.motions.at(-1).resolve('granted');
  assert.equal((await pending).ok, true);
  await settle();
}
const clean = f => {
  f.a.stop();
  assert.equal(f.timers.size + f.nativeWatches.size + f.p.count() + f.doc.count() +
    Object.values(f.statuses).reduce((n, status) => n + status.count(), 0), 0);
};

test('P01 import/construction/idle stop are inert; start is explicit and passive', () => {
  const f = setup(); f.a.stop();
  assert.equal(f.timers.size + f.p.count() + f.doc.count() + f.queries.length + f.locations.length + f.motions.length, 0);
  f.start(); assert.equal(f.locations.length + f.motions.length + f.queries.length, 0); clean(f);
});
test('P02 all APIs exposed cannot unlock missing/mismatched/unsupported qualification', async () => {
  const patches = [null, {}, { disposition: 'not-run' }, { disposition: 'inconclusive' },
    { disposition: 'unsupported' }, { contextKey: 'other-device' }, { budgetRevision: 'other-budget' },
    { kind: 'physical-device-review' }, { streams: { geolocation: false, motion: false } }];
  for (const patch of patches) {
    const f = setup();
    f.a = create({ ...f.options, qualification: patch === null ? null : { ...f.options.qualification, ...patch } });
    if (patch && Object.keys(patch).length === 0) f.a = create({ ...f.options, qualification: {} });
    f.start(); assert.equal(f.a.acquireLocation().reason, 'unqualified');
    assert.equal((await f.a.acquireMotion()).reason, 'unqualified');
    assert.equal(f.locations.length + f.motions.length + f.queries.length, 0); clean(f);
  }
  const f = setup(); f.a = create({ ...f.options, mode: 'device' }); f.start();
  assert.equal(f.a.acquireLocation().reason, 'unqualified'); clean(f);
});
test('P03 positive GPS control retains source/receipt, safe options and useful quality', async () => {
  const f = setup(); f.start(); const req = f.a.acquireLocation(); await settle();
  f.advance(400); f.locations[0].success(fix(EPOCH - 100));
  const e = f.last('geolocation'); assert.ok(e);
  assert.equal(e.sourceTime.value, EPOCH - 100);
  assert.deepEqual(e.clientReceiptTime, { wallMs: EPOCH + 400, monoMs: 500 });
  assert.equal(e.data.ageMs, 500); assert.equal(e.data.freshness, 'within-provisional-budget');
  assert.equal(e.data.accuracyM, 8); assert.equal(e.data.requestId, req.requestId);
  assert.deepEqual(e.data.options, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  assert.equal(e.data.coordinates, null); assert.equal(e.serverReceiptTime, null); clean(f);
});
test('P04 denial/revocation retires watch and queued callbacks; denied initial monitor stays explicit', async () => {
  const f = setup(); f.start(); f.a.acquireLocation({ watch: true }); await settle();
  const old = f.locations[0]; f.statuses.geolocation.state = 'denied'; f.statuses.geolocation.fire('change');
  assert.equal(f.nativeWatches.size, 0); assert.equal(f.a.snapshot().permission.geolocation.state, 'revoked');
  const n = f.events.length; old.success(fix()); old.error({ code: 1 }); assert.equal(f.events.length, n); clean(f);
  const g = setup(); g.statuses.geolocation.state = 'denied'; g.start(); g.a.acquireLocation(); await settle();
  assert.equal(g.a.snapshot().permission.geolocation.state, 'denied');
  assert.equal(g.a.acquireLocation().reason, 'permission-denied-or-revoked'); clean(g);
});
test('P05 unavailable/throwing platform and rejected permission query are attributed without secrets', async () => {
  const f = setup(); f.p.navigator.permissions.query = () => Promise.reject(new Error('secret-query'));
  f.geo.getCurrentPosition = () => { throw new Error('secret-native'); };
  f.start(); assert.equal(f.a.acquireLocation().reason, 'platform-error'); await settle();
  assert.equal(f.last('acquisition-error').data.stream, 'geolocation');
  assert.equal(f.a.snapshot().permission.geolocation.state, 'unknown');
  assert.equal(JSON.stringify(f.events).includes('secret'), false); clean(f);
  for (const state of [false, undefined]) {
    const g = setup(); g.p.isSecureContext = state; g.start();
    assert.equal(g.a.acquireLocation().reason, 'insecure-or-unknown-context'); clean(g);
  }
});
test('P06 no automatic motion prompt; missing activation stays blocked; browser-managed permission stays unknown', async () => {
  const f = setup(); f.start(); f.doc.fire('visibilitychange'); assert.equal(f.motions.length, 0);
  f.p.navigator.userActivation.isActive = false;
  assert.equal((await f.a.acquireMotion()).reason, 'user-gesture-required'); assert.equal(f.motions.length, 0);
  f.p.navigator.userActivation.isActive = true; delete f.p.DeviceMotionEvent.requestPermission;
  assert.equal((await f.a.acquireMotion()).ok, true);
  assert.equal(f.a.snapshot().permission.motion.state, 'unknown');
  assert.equal(f.p.count('devicemotion'), 1); clean(f);
});
test('P07 positive motion control needs explicit grant and retains unresolved DOM clock', async () => {
  const f = setup(); f.start(); const pending = f.a.acquireMotion();
  assert.equal(f.motions.length, 1); assert.equal(f.p.count('devicemotion'), 0);
  f.motions[0].resolve('granted'); assert.equal((await pending).ok, true);
  f.p.fire('devicemotion', { timeStamp: 77, acceleration: { x: 1, y: 2, z: 3 }, interval: 16 });
  const e = f.last('motion'); assert.deepEqual(e.data.acceleration, { x: 1, y: 2, z: 3 });
  assert.equal(e.sourceTime.basis, 'dom-event-ms-unreconciled'); assert.equal(e.data.freshness, 'unknown');
  assert.equal(e.data.candidateMotionChange, 'unclassified'); clean(f);
});
test('P08 request IDs/options survive eviction; concurrent GPS request rejected; copies detached', () => {
  const f = setup({ budget: { bufferCapacity: 1 } }); f.start(); const a = f.a.acquireLocation();
  assert.equal(f.a.acquireLocation().reason, 'already-acquiring'); f.locations[0].success(fix());
  const b = f.a.acquireLocation({ watch: true }); assert.notEqual(a.requestId, b.requestId);
  f.locations[0].success(fix()); f.locations[1].success(fix());
  const event = f.a.snapshot().events[0]; assert.equal(event.data.requestId, b.requestId);
  assert.deepEqual(event.data.options, f.locations[1].options); event.data.options.timeout = 1;
  assert.equal(f.a.snapshot().events[0].data.options.timeout, 10000); clean(f);
});
test('P09 replaced watch ignores previous success/error while replacement still works', () => {
  const f = setup(); f.start(); f.a.acquireLocation({ watch: true }); const old = f.locations[0];
  f.a.stopLocation(); f.a.acquireLocation({ watch: true }); const n = f.events.length;
  old.success(fix()); old.error({ code: 1 }); assert.equal(f.events.length, n);
  f.locations[1].success(fix()); assert.ok(f.last('geolocation')); clean(f);
});
test('P10 delayed old query/sample/motion answers cannot alter a replacement session', async () => {
  const f = setup(), query = deferred(); f.p.navigator.permissions.query = () => query.promise;
  f.start(); f.a.acquireLocation(); const pending = f.a.acquireMotion();
  f.a.stop(); f.start('review-new-session');
  query.resolve(f.statuses.geolocation); f.motions[0].resolve('granted');
  f.locations[0].success(fix()); f.locations[0].error({ code: 1 }); await pending; await settle();
  assert.equal(f.p.count('devicemotion'), 0); assert.equal(f.statuses.geolocation.count(), 0);
  assert.equal(f.last('geolocation'), undefined); assert.equal(f.a.snapshot().permission.geolocation.state, 'unknown'); clean(f);
});
test('P11 local sink throw/stop is separate from sensor failure; reentrant acquisition blocked', () => {
  const f = setup({ sink(e, f) {
    assert.equal(f.a.acquireLocation().reason, e.type === 'acquisition-request' ? 'already-acquiring' : 'sink-reentrancy');
    if (e.type === 'geolocation') throw new Error('consumer-only');
  } });
  f.start(); f.a.acquireLocation(); f.locations[0].success(fix());
  assert.equal(f.a.snapshot().summary.sinkErrors, 1); assert.equal(f.last('geolocation-error'), undefined); clean(f);
  const g = setup({ sink(e, f) { if (e.type === 'acquisition-request') f.a.stop(); } });
  g.start(); assert.equal(g.a.acquireLocation().reason, 'session-stopped'); assert.equal(g.locations.length, 0); clean(g);
});
test('P12 expiry boundary, stale, duplicate and reordered source timestamps stay explicit', () => {
  const f = setup(); f.start(); f.a.acquireLocation({ watch: true }); const w = f.locations[0];
  w.success(fix(EPOCH - 1000)); assert.equal(f.last('geolocation').data.freshness, 'within-provisional-budget');
  f.advance(1000); w.success(fix(EPOCH - 1)); assert.equal(f.last('geolocation').data.freshness, 'stale');
  f.advance(1000); w.success(fix(EPOCH - 2)); assert.equal(f.last('geolocation').data.sourceOrder, 'reordered');
  f.advance(1000); w.success(fix(EPOCH - 2)); assert.equal(f.last('geolocation').data.sourceOrder, 'reordered'); clean(f);
});
test('P13 unknown/future/nonfinite source times and diverged clocks never imply fresh', () => {
  for (const source of [undefined, NaN, Infinity, EPOCH + 5000]) {
    const f = setup(); f.start(); f.a.acquireLocation();
    f.locations[0].success({ ...fix(), timestamp: source });
    assert.equal(f.last('geolocation').data.freshness, 'unknown'); clean(f);
  }
  const f = setup(); f.start(); f.a.acquireLocation(); f.advance(1000, -5000); f.locations[0].success(fix());
  assert.equal(f.last('geolocation').provenance.clockUncertain, true);
  assert.equal(f.last('geolocation').data.freshness, 'unknown'); clean(f);
});
test('P14 hidden page retires resources and cannot auto-resume or emit cached fix', () => {
  const f = setup(); f.start(); f.a.acquireLocation({ watch: true }); const old = f.locations[0];
  f.doc.visibilityState = 'hidden'; f.doc.fire('visibilitychange');
  const n = f.events.length; f.doc.visibilityState = 'visible'; f.doc.fire('visibilitychange'); old.success(fix());
  assert.equal(f.events.length, n); assert.equal(f.a.snapshot().state, 'stopped'); clean(f);
});
test('P15 burst callbacks, outstanding requests, buffers, event/deadline caps and invalid budgets are bounded', () => {
  const f = setup({ budget: { maxCallbacksPerStream: 3, bufferCapacity: 1, maxRequests: 1 } });
  f.start(); f.a.acquireLocation({ watch: true });
  for (let i = 0; i < 200; i++) f.locations[0].success(fix());
  assert.equal(f.a.snapshot().summary.callbacks.geo, 4); assert.equal(f.nativeWatches.size, 0);
  assert.equal(f.a.snapshot().events.length, 1); assert.equal(f.a.acquireLocation().reason, 'request-budget'); clean(f);
  const g = setup({ budget: { maxEvents: 2 } }); g.start(); g.a.acquireLocation();
  assert.equal(g.a.snapshot().stopReason, 'event-budget'); assert.equal(g.locations.length, 0); clean(g);
  const h = setup(); h.start(); h.a.acquireLocation(); h.flush(B.permissionPromptTimeoutMs); h.locations[0].success(fix());
  assert.equal(h.last('geolocation'), undefined); h.flush(B.maxSessionMs); clean(h);
  for (const patch of [{ maxRequests: Infinity }, { maxEvents: 0 }, { bufferCapacity: NaN }, { requestTimeoutMs: -1 }]) {
    assert.throws(() => setup({ budget: patch }), RangeError);
  }
});
test('P16 precise data absent by default/incomplete consent; explicit consent works and withdrawal suppresses late payload', () => {
  const f = setup(); f.start();
  for (const preciseConsent of [null, { granted: true }, { granted: true, purpose: 'review-purpose' }]) {
    f.a.acquireLocation({ preciseConsent }); f.locations.at(-1).success(fix());
  }
  const json = JSON.stringify({ events: f.events, snapshot: f.a.snapshot() });
  for (const sensitive of ['12.3456789', '-65.4321987', '7654.321', 'latitude', 'longitude', 'altitude']) assert.equal(json.includes(sensitive), false);
  const consent = { granted: true, purpose: 'review-purpose', reference: 'review-consent' };
  f.a.acquireLocation({ watch: true, preciseConsent: consent }); consent.purpose = 'changed'; f.locations.at(-1).success(fix());
  assert.deepEqual(f.last('geolocation').data.coordinates, { latitude: 12.3456789, longitude: -65.4321987 });
  assert.equal(f.last('geolocation').data.purpose, 'review-purpose');
  f.a.revokeConsent(); const n = f.events.length; f.locations.at(-1).success(fix()); assert.equal(f.events.length, n); clean(f);
});
test('P17 handling/drop/pothole/passenger fixtures remain observations with unknown independent outcomes', async () => {
  const fixture = JSON.parse(await readFile(`${root}/tests/phone-observations/confounders.synthetic.json`, 'utf8'));
  const f = setup(); f.start(); await enableMotion(f);
  for (const item of fixture.cases) {
    f.advance(1000); f.p.fire('devicemotion', { acceleration: item.acceleration, timeStamp: 12 });
    assert.deepEqual(f.last('motion').data.acceleration, item.acceleration);
    assert.equal(f.last('motion').data.candidateMotionChange, 'unclassified'); assert.equal(item.independentOutcome, 'unknown');
    assert.equal(JSON.stringify(f.last('motion')).includes(item.id), false);
  }
  assert.equal(f.last('motion').interpretation, 'observation-only'); clean(f);
});
test('P18 provisional local boundary retains unknowns and distinct sessions/sequences', () => {
  const f = setup(); f.start(); f.a.acquireLocation(); f.locations[0].success(fix());
  const a = f.last('geolocation');
  for (const key of ['policyVersion', 'serverReceiptTime', 'utcOffsetMinutes', 'truckId']) assert.equal(a[key], null);
  assert.deepEqual(a.country, { value: null, provenance: 'unknown' }); assert.equal(a.timeZone.value, null);
  f.a.stop(); f.start('review-other-session'); f.a.acquireLocation(); f.locations[1].success(fix());
  const b = f.last('geolocation'); assert.notEqual(a.eventId, b.eventId); assert.ok(b.sequence > a.sequence); clean(f);
});

test('F1 P11 stopLocation from acquisition-request sink must prevent the native call and timeout', () => {
  const f = setup({ sink(e, f) { if (e.type === 'acquisition-request') f.a.stopLocation(); } });
  f.start(); const result = f.a.acquireLocation();
  const timersBeforeStop = f.timers.size;
  f.a.stop();
  console.log('F1 actual', JSON.stringify({ result, nativeCalls: f.locations.length, timersBeforeStop, timersAfterStop: f.timers.size }));
  assert.equal(f.locations.length, 0, 'stopLocation during request delivery must prevent sensor acquisition');
  assert.equal(f.timers.size, 0, 'stop must release every adapter timer');
});
test('F2 P10/P15 expired motion permission answer must not attach a listener when deadline timer is delayed', async () => {
  const f = setup(); f.start(); const pending = f.a.acquireMotion();
  f.advance(B.maxSessionMs + 1); f.motions[0].resolve('granted');
  const result = await pending;
  console.log('F2 actual', JSON.stringify({ result, state: f.a.snapshot().state, listeners: f.p.count('devicemotion') }));
  const count = f.p.count('devicemotion'); clean(f);
  assert.equal(count, 0, 'an expired motion permission request must not subscribe');
  assert.equal(result.ok, false);
});
test('F3 v3 browser-confirmed denial cannot be reopened by an older passive grant', async () => {
  const f = setup(), pending = deferred(); let queries = 0;
  f.p.navigator.permissions.query = () => ++queries === 1 ? pending.promise : Promise.resolve({ state: 'denied' });
  f.start(); f.a.acquireLocation(); f.locations[0].error({ code: 1 }); await settle();
  assert.equal(f.a.snapshot().permission.geolocation.state, 'denied');
  pending.resolve(f.statuses.geolocation); await settle();
  assert.equal(f.a.snapshot().permission.geolocation.state, 'denied');
  assert.equal(f.a.acquireLocation().ok, false); assert.equal(f.locations.length, 1); clean(f);
});
test('F4 P08 failed location callback must retain original acquisition options after request-event eviction', () => {
  const f = setup({ budget: { bufferCapacity: 1, maximumAgeMs: 12345, requestTimeoutMs: 23456 } });
  f.start(); const request = f.a.acquireLocation({ watch: true }); f.locations[0].error({ code: 2 });
  const e = f.a.snapshot().events[0];
  console.log('F4 actual', JSON.stringify(e.data)); clean(f);
  assert.equal(e.type, 'geolocation-error'); assert.equal(e.data.requestId, request.requestId);
  assert.deepEqual(e.data.options, { enableHighAccuracy: true, maximumAge: 12345, timeout: 23456 });
});
