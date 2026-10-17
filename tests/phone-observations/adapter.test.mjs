// Synthetic logic checks only. These fixtures never qualify a device or driver state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPhoneObservationAdapter, PROVISIONAL_BUDGET, QUALIFICATION_SCHEMA, EVENT_SCHEMA } from '../../src/phone-observations/adapter.mjs';

const WALL = Date.UTC(2026, 9, 17, 15);
const context = (sessionId = 'synthetic-session-a') => ({ sessionId, tripId: 'synthetic-trip', revision: 'test-revision' });
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise((resolve) => setImmediate(resolve));

class Target {
  handlers = new Map();
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  dispatch(name, event = {}) { for (const fn of [...(this.handlers.get(name) ?? [])]) fn(event); }
  count(name) { return name ? this.handlers.get(name)?.size ?? 0 : [...this.handlers.values()].reduce((n, set) => n + set.size, 0); }
}

function fixture(options = {}) {
  const platform = new Target();
  const document = Object.assign(new Target(), { visibilityState: 'visible' });
  const statuses = Object.fromEntries(['geolocation', 'accelerometer', 'gyroscope'].map((name) =>
    [name, Object.assign(new Target(), { state: 'granted' })]));
  let wallMs = WALL;
  let monoMs = 500;
  let timerId = 0;
  let watchId = 0;
  const timers = new Map();
  const requests = [];
  const watches = new Map();
  const cleared = [];
  const queries = [];
  const motionRequests = [];
  const events = [];
  const geo = {
    getCurrentPosition(success, failure, args) { requests.push({ success, failure, args }); },
    watchPosition(success, failure, args) { const id = ++watchId; watches.set(id, { success, failure, args }); return id; },
    clearWatch(id) { cleared.push(id); watches.delete(id); },
  };
  Object.assign(platform, {
    document, isSecureContext: true,
    navigator: {
      geolocation: geo, userActivation: { isActive: true },
      permissions: { query({ name }) { queries.push(name); return Promise.resolve(statuses[name]); } },
    },
    DeviceMotionEvent: { requestPermission() { const d = deferred(); motionRequests.push(d); return d.promise; } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const qualification = {
    schema: QUALIFICATION_SCHEMA, kind: 'synthetic-fixture', disposition: 'qualified',
    evidenceRef: 'tests-only:not-device-evidence', contextKey: 'synthetic-visible',
    budgetRevision: 'engineering-only/1', streams: { geolocation: true, motion: true },
  };
  const config = {
    platform, clock: { now: () => ({ wallMs, monoMs }) }, sink: (event) => events.push(event),
    mode: 'synthetic-test', contextKey: 'synthetic-visible', qualification,
    budget: { ...PROVISIONAL_BUDGET, freshnessMs: 5000 }, ...options,
  };
  const adapter = createPhoneObservationAdapter(config);
  return {
    platform, document, statuses, timers, requests, watches, cleared, queries, motionRequests, events, geo, config, adapter,
    advance(ms, wall = ms) { monoMs += ms; wallMs += wall; },
    clocks(wall, mono) { wallMs = wall; monoMs = mono; },
    latestWatch: () => [...watches.values()].at(-1),
    last(type) { return events.filter((e) => e.type === type).at(-1); },
    fireTimers(ms) { for (const [id, timer] of [...timers]) if (ms === undefined || timer.ms === ms) { timers.delete(id); timer.fn(); } },
  };
}
const fix = (timestamp = WALL, accuracy = 20) => ({
  timestamp, coords: { latitude: -12.04318, longitude: -77.02824, accuracy, altitude: 3871.25, speed: 12, heading: 90 },
});

test('construction and start never acquire, query, prompt or upload', () => {
  const b = fixture();
  assert.equal(b.timers.size + b.platform.count() + b.document.count(), 0);
  assert.deepEqual(b.adapter.snapshot(), { state: 'idle', events: [] });
  b.adapter.start(context());
  assert.equal(b.timers.size, 1);
  assert.equal(b.requests.length + b.watches.size + b.motionRequests.length + b.queries.length, 0);
  assert.deepEqual(b.events.map((e) => e.type), ['session-start']);
  assert.equal(b.adapter.acquireLocation().ok, true);
  assert.equal(b.requests.length, 1);
});

test('device mode rejects synthetic qualification; no qualification or mismatched context/budget can acquire', async () => {
  for (const options of [
    { qualification: null }, { mode: 'device' }, { contextKey: 'unreviewed-context' },
    { budget: { ...PROVISIONAL_BUDGET, revision: 'not-reviewed' } },
    { qualification: { schema: QUALIFICATION_SCHEMA, disposition: 'qualified', kind: 'physical-device-review' } },
  ]) {
    const b = fixture(options); b.adapter.start(context());
    assert.equal(b.adapter.acquireLocation().reason, 'unqualified');
    assert.equal((await b.adapter.acquireMotion()).reason, 'unqualified');
    assert.equal(b.requests.length + b.watches.size + b.motionRequests.length + b.queries.length, 0);
  }
  assert.throws(() => createPhoneObservationAdapter({ mode: 'synthetic-test' }), /injected/);
});

test('explicit physical review configuration must match stream, context and budget', () => {
  const b = fixture();
  const reviewed = { ...b.config.qualification, kind: 'physical-device-review', streams: { geolocation: true, motion: false } };
  const adapter = createPhoneObservationAdapter({ ...b.config, qualification: reviewed, mode: 'device' });
  reviewed.streams.geolocation = false; // The caller cannot mutate the reviewed configuration in flight.
  adapter.start(context());
  assert.equal(adapter.acquireLocation().ok, true);
  assert.equal(b.requests.length, 1);
});

test('explicit acquisition requires secure visible context and supported active user gesture', async () => {
  for (const mutate of [
    (b) => { b.platform.isSecureContext = false; },
    (b) => { b.document.visibilityState = 'hidden'; },
    (b) => { b.platform.navigator.userActivation.isActive = false; },
    (b) => { delete b.platform.navigator.userActivation; },
  ]) {
    const b = fixture(); b.adapter.start(context()); mutate(b);
    assert.equal(b.adapter.acquireLocation().ok, false);
    assert.equal((await b.adapter.acquireMotion()).ok, false);
    assert.equal(b.requests.length + b.motionRequests.length + b.queries.length, 0);
  }
});

test('location source/receipt time, unknowns, privacy and request attribution survive cached fixes', async () => {
  const b = fixture(); b.adapter.start(context());
  const request = b.adapter.acquireLocation(); await settle();
  b.advance(2000); b.requests[0].success(fix(WALL - 10_000));
  const event = b.last('geolocation');
  assert.equal(event.schema, EVENT_SCHEMA);
  assert.equal(event.data.requestId, request.requestId);
  assert.equal(event.sourceTime.value, WALL - 10_000);
  assert.deepEqual(event.clientReceiptTime, { wallMs: WALL + 2000, monoMs: 2500 });
  assert.equal(event.serverReceiptTime, null);
  assert.equal(event.data.ageMs, 12_000);
  assert.equal(event.data.freshness, 'stale');
  assert.equal(event.data.accuracyM, 20);
  assert.equal(event.data.routeProgress, 'unknown');
  assert.deepEqual(event.country, { value: null, provenance: 'unknown' });
  assert.equal(event.timeZone.value, null);
  assert.equal(event.policyVersion, null);
  assert.equal(event.data.coordinates, null);
  for (const sensitive of ['-12.04318', '-77.02824', '3871.25', 'latitude', 'longitude', 'heading']) {
    assert.equal(JSON.stringify(b.adapter.snapshot()).includes(sensitive), false, sensitive);
  }
  assert.deepEqual(b.requests[0].args, { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 });
});

test('precise coordinates require consent plus bounded purpose and reference; withdrawal cancels streams', () => {
  const b = fixture(); b.adapter.start(context());
  for (const preciseConsent of [null, { granted: true }, { granted: true, purpose: 'test' }]) {
    b.adapter.acquireLocation({ preciseConsent }); b.requests.at(-1).success(fix());
    assert.equal(b.last('geolocation').data.coordinates, null);
  }
  b.adapter.acquireLocation({ watch: true, preciseConsent: { granted: true, purpose: 'synthetic-purpose', reference: 'synthetic-consent' } });
  const watch = b.latestWatch(); watch.success(fix());
  assert.deepEqual(b.last('geolocation').data.coordinates, { latitude: -12.04318, longitude: -77.02824 });
  b.adapter.revokeConsent();
  const count = b.events.length; watch.success(fix());
  assert.equal(b.events.length, count);
  assert.equal(b.adapter.snapshot().permission.geolocation.state, 'revoked');
  assert.equal(b.watches.size, 0);
});

test('watch cancellation and permission loss ignore callbacks before and after restart', async () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
  const oldWatch = b.latestWatch(); await settle();
  b.statuses.geolocation.state = 'denied'; b.statuses.geolocation.dispatch('change');
  assert.equal(b.adapter.snapshot().permission.geolocation.state, 'revoked');
  assert.equal(b.watches.size, 0);
  const count = b.events.length; oldWatch.success(fix()); oldWatch.failure({ code: 2 });
  assert.equal(b.events.length, count);
  assert.equal(b.adapter.acquireLocation().reason, 'permission-denied-or-revoked');
  b.adapter.stop(); b.adapter.start(context('synthetic-session-b'));
  oldWatch.success(fix());
  assert.equal(b.last('geolocation'), undefined);
  b.adapter.acquireLocation({ watch: true }); b.latestWatch().success(fix());
  assert.equal(b.last('geolocation').sessionId, 'synthetic-session-b');
});

test('sample callbacks after stop and permission answers from old sessions are ignored', async () => {
  const b = fixture(); const answer = deferred();
  b.platform.navigator.permissions.query = () => answer.promise;
  b.adapter.start(context()); b.adapter.acquireLocation(); const sample = b.requests[0];
  b.adapter.stop(); b.adapter.start(context('synthetic-session-b'));
  answer.resolve(b.statuses.geolocation); sample.success(fix()); sample.failure({ code: 1 }); await settle();
  assert.equal(b.statuses.geolocation.count(), 0);
  assert.equal(b.last('geolocation'), undefined);
  assert.equal(b.adapter.snapshot().permission.geolocation.state, 'unknown');
});

test('one-shot callback settles once; stopped-watch callbacks cannot enter a replacement watch', () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation();
  const sample = b.requests[0]; sample.success(fix()); sample.success(fix()); sample.failure({ code: 1 });
  assert.equal(b.events.filter((e) => e.type === 'geolocation').length, 1);
  b.adapter.acquireLocation({ watch: true }); const old = b.latestWatch();
  b.adapter.stopLocation(); b.adapter.stopLocation(); b.adapter.acquireLocation({ watch: true });
  const count = b.events.length; old.success(fix()); assert.equal(b.events.length, count);
  b.latestWatch().success(fix()); assert.equal(b.events.filter((e) => e.type === 'geolocation').length, 2);
});

test('reordered fixes retain source order and negative/missing/uncertain ages remain unknown', () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
  const watch = b.latestWatch();
  watch.success(fix(WALL)); b.advance(1000); watch.success(fix(WALL - 100));
  assert.equal(b.last('geolocation').data.sourceOrder, 'reordered');
  b.advance(1000); watch.success(fix(WALL + 9000));
  assert.equal(b.last('geolocation').data.ageMs, -7000);
  assert.equal(b.last('geolocation').data.freshness, 'unknown');
  b.advance(1000); watch.success(fix(NaN, -1));
  assert.equal(b.last('geolocation').data.ageMs, null);
  assert.equal(b.last('geolocation').data.accuracyM, null);
  b.advance(1000, -5000); watch.success(fix(WALL));
  assert.equal(b.last('geolocation').provenance.clockUncertain, true);
  assert.equal(b.last('geolocation').data.freshness, 'unknown');
});

test('unreconciled clocks and unset freshness never assert fresh', () => {
  const b = fixture({ budget: { ...PROVISIONAL_BUDGET } });
  b.adapter.start(context()); b.adapter.acquireLocation(); b.requests[0].success(fix());
  assert.equal(b.last('geolocation').data.freshness, 'unknown');
  assert.equal(b.last('geolocation').provenance.serverLatency, 'unknown');
});

test('motion requests permission synchronously from the gesture and subscribes only after grant', async () => {
  const b = fixture(); b.adapter.start(context());
  const pending = b.adapter.acquireMotion();
  assert.equal(b.motionRequests.length, 1);
  assert.equal(b.platform.count('devicemotion'), 0);
  b.motionRequests[0].resolve('granted'); assert.equal((await pending).ok, true);
  b.platform.dispatch('devicemotion', { timeStamp: 600, acceleration: { x: 1, y: null, z: NaN }, interval: 16 });
  const event = b.last('motion');
  assert.deepEqual(event.data.acceleration, { x: 1, y: null, z: null });
  assert.deepEqual(event.data.rotationRate, { alpha: null, beta: null, gamma: null });
  assert.equal(event.sourceTime.basis, 'dom-event-ms-unreconciled');
  assert.equal(event.data.candidateMotionChange, 'unclassified');
  assert.equal(event.data.freshness, 'unknown');
  b.adapter.stop(); assert.equal(b.platform.count(), 0);
});

test('motion denies unsupported gesture route and retains denied/unknown/rejected answers', async () => {
  const b = fixture(); b.adapter.start(context()); delete b.platform.DeviceMotionEvent.requestPermission;
  assert.equal((await b.adapter.acquireMotion()).reason, 'unsupported-permission-route');
  for (const answer of ['denied', 'unknown']) {
    const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
    b.motionRequests[0].resolve(answer); assert.equal((await pending).ok, false);
    assert.equal(b.adapter.snapshot().permission.motion.state, answer);
    assert.equal(b.platform.count('devicemotion'), 0);
  }
  const c = fixture(); c.adapter.start(context()); const pending = c.adapter.acquireMotion();
  c.motionRequests[0].reject(new Error('do not persist sensitive error context'));
  assert.equal((await pending).reason, 'permission-request-failed');
  assert.equal(c.adapter.snapshot().permission.motion.state, 'unknown');
});

test('late motion grant cannot subscribe after stop, replacement request or timeout', async () => {
  for (const stop of [
    (b) => b.adapter.stop(), (b) => b.adapter.stopMotion(), (b) => b.fireTimers(10_000),
  ]) {
    const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
    stop(b); b.motionRequests[0].resolve('granted');
    assert.equal((await pending).reason, 'obsolete-request');
    assert.equal(b.platform.count('devicemotion'), 0);
  }
});

test('motion permission change revokes subscription and obsolete queued handler is inert', async () => {
  const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
  b.motionRequests[0].resolve('granted'); await pending; await settle();
  const handler = [...b.platform.handlers.get('devicemotion')][0];
  b.statuses.accelerometer.state = 'denied'; b.statuses.accelerometer.dispatch('change');
  assert.equal(b.platform.count('devicemotion'), 0);
  assert.equal(b.adapter.snapshot().permission.motion.state, 'revoked');
  const count = b.events.length; handler({ timeStamp: 2 }); assert.equal(b.events.length, count);
});

test('stop is idempotent and removes every listener, watch and timer; hidden pages never auto-resume', async () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
  const pending = b.adapter.acquireMotion(); b.motionRequests[0].resolve('granted'); await pending; await settle();
  b.adapter.stop(); b.adapter.stop();
  assert.equal(b.document.count() + b.platform.count() + b.timers.size + b.watches.size, 0);
  assert.equal(Object.values(b.statuses).reduce((n, status) => n + status.count(), 0), 0);
  b.adapter.start(context('synthetic-session-b')); b.adapter.acquireLocation({ watch: true });
  b.document.visibilityState = 'hidden'; b.document.dispatch('visibilitychange');
  assert.equal(b.adapter.snapshot().stopReason, 'visibility-lost');
  b.document.visibilityState = 'visible'; b.document.dispatch('visibilitychange');
  assert.equal(b.watches.size + b.timers.size, 0);
});

test('request, callback, rate, buffer, event and duration budgets bound work', () => {
  const b = fixture({ budget: { ...PROVISIONAL_BUDGET, maxCallbacksPerStream: 4, bufferCapacity: 2 } });
  b.adapter.start(context()); b.adapter.acquireLocation({ watch: true }); const watch = b.latestWatch();
  for (let n = 0; n < 100; n += 1) watch.success(fix());
  assert.equal(b.events.filter((e) => e.type === 'geolocation').length, 1);
  assert.equal(b.adapter.snapshot().summary.callbacks.geo, 5);
  assert.equal(b.watches.size, 0);
  assert.equal(b.adapter.snapshot().events.length, 2);
  assert.ok(b.adapter.snapshot().summary.dropped > 0);
  const c = fixture({ budget: { ...PROVISIONAL_BUDGET, maxRequests: 1 } });
  c.adapter.start(context()); c.adapter.acquireLocation(); c.requests[0].success(fix());
  assert.equal(c.adapter.acquireLocation().reason, 'request-budget');
  const d = fixture({ budget: { ...PROVISIONAL_BUDGET, maxEvents: 3 } });
  d.adapter.start(context()); d.adapter.acquireLocation({ watch: true }); d.latestWatch().success(fix());
  assert.equal(d.adapter.snapshot().stopReason, 'event-budget'); assert.equal(d.watches.size + d.timers.size, 0);
  const e = fixture(); e.adapter.start(context()); e.adapter.acquireLocation({ watch: true });
  e.fireTimers(300_000); assert.equal(e.adapter.snapshot().stopReason, 'duration-budget');
  assert.equal(e.watches.size + e.timers.size, 0);
});

test('timeouts retire one-shot tokens; raw API errors are redacted and denial is explicit', () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation(); const old = b.requests[0];
  b.fireTimers(10_000); old.success(fix()); assert.equal(b.last('geolocation'), undefined);
  b.adapter.acquireLocation(); b.requests[1].failure({ code: 1, message: '-12.04318 private context' });
  assert.equal(b.adapter.snapshot().permission.geolocation.state, 'denied');
  assert.equal(JSON.stringify(b.events).includes('private context'), false);
  assert.equal(b.last('geolocation-error').data.code, 1);
});

test('synchronous watch errors and stop during sink delivery clear the returned watch ID', () => {
  const b = fixture(); b.geo.watchPosition = (success, failure) => { failure({ code: 1 }); return 99; };
  b.adapter.start(context()); b.adapter.acquireLocation({ watch: true }); assert.deepEqual(b.cleared, [99]);
  const c = fixture(); const adapter = createPhoneObservationAdapter({ ...c.config, sink(event) {
    if (event.type === 'geolocation') adapter.stop();
  } });
  c.geo.watchPosition = (success) => { success(fix()); return 100; };
  adapter.start(context()); adapter.acquireLocation({ watch: true });
  assert.deepEqual(c.cleared, [100]); assert.equal(adapter.snapshot().state, 'stopped');
});

test('throwing APIs and sink failures remain local, bounded and cleanable', async () => {
  const b = fixture({ sink() { throw new Error('sensitive'); } });
  b.adapter.start(context()); b.geo.getCurrentPosition = () => { throw new Error('secret'); };
  assert.equal(b.adapter.acquireLocation().reason, 'platform-error');
  assert.ok(b.adapter.snapshot().summary.sinkErrors > 0);
  b.adapter.stop(); assert.equal(b.timers.size, 0);
  const c = fixture(); c.platform.navigator.permissions.query = () => Promise.reject(new TypeError('unsupported'));
  c.adapter.start(context()); c.adapter.acquireLocation(); await settle();
  assert.equal(c.adapter.snapshot().permission.geolocation.state, 'unknown');
  c.adapter.stop();
});

test('snapshot and sink data are detached, serializable and sequence is monotonic across sessions', () => {
  const b = fixture(); b.adapter.start(context()); b.events[0].permission.motion.state = 'fake';
  const snapshot = b.adapter.snapshot(); snapshot.events[0].tripId = 'fake';
  assert.equal(b.adapter.snapshot().events[0].tripId, 'synthetic-trip');
  assert.equal(b.adapter.snapshot().permission.motion.state, 'unknown');
  const previous = b.adapter.snapshot().events.at(-1).sequence;
  b.adapter.stop(); b.adapter.start(context('synthetic-session-b'));
  assert.ok(b.adapter.snapshot().events[0].sequence > previous);
  assert.deepEqual(JSON.parse(JSON.stringify(b.adapter.snapshot())), b.adapter.snapshot());
});

test('invalid budgets and contexts fail before resource use', () => {
  for (const patch of [{ bufferCapacity: Infinity }, { maxEvents: 0 }, { maxRequests: 101 },
    { freshnessMs: -1 }, { maxSessionMs: 3_600_001 }, { minEmitIntervalMs: 0 }]) {
    assert.throws(() => fixture({ budget: { ...PROVISIONAL_BUDGET, ...patch } }), RangeError);
  }
  const b = fixture(); assert.throws(() => b.adapter.start({ sessionId: 'only-id' }), TypeError);
  assert.equal(b.timers.size, 0);
  assert.equal(b.adapter.acquireLocation().reason, 'not-started');
});

test('a sensor grant cannot undo a different sensor revocation', async () => {
  const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
  b.motionRequests[0].resolve('granted'); await pending; await settle();
  b.statuses.accelerometer.state = 'denied'; b.statuses.accelerometer.dispatch('change');
  b.statuses.gyroscope.dispatch('change');
  assert.equal(b.adapter.snapshot().permission.motion.state, 'revoked');
  assert.equal(b.platform.count('devicemotion'), 0);
});

test('deadline is checked before new acquisition even when a browser has delayed its timer', async () => {
  const b = fixture(); b.adapter.start(context()); b.advance(300_000);
  assert.equal(b.adapter.acquireLocation().reason, 'duration-or-clock-budget');
  assert.equal((await b.adapter.acquireMotion()).reason, 'not-started');
  assert.equal(b.requests.length + b.motionRequests.length + b.queries.length, 0);
  assert.equal(b.timers.size, 0);
});

test('consent metadata is snapshotted and synchronous sink withdrawal cannot recurse', () => {
  const b = fixture(); b.adapter.start(context());
  const consent = { granted: true, reference: 'original-reference', purpose: 'original-purpose' };
  b.adapter.acquireLocation({ preciseConsent: consent });
  consent.reference = 'mutated'; consent.purpose = 'mutated'; b.requests[0].success(fix());
  assert.equal(b.last('geolocation').data.consentReference, 'original-reference');
  const c = fixture(); let calls = 0;
  const adapter = createPhoneObservationAdapter({ ...c.config, sink() { calls += 1; adapter.revokeConsent(); } });
  adapter.start(context());
  assert.equal(calls, 1); assert.equal(adapter.snapshot().state, 'stopped');
  assert.equal(c.timers.size + c.document.count() + c.platform.count(), 0);
});

test('permission monitor count stays fixed across repeated requests', async () => {
  const b = fixture(); b.adapter.start(context());
  for (let n = 0; n < 8; n += 1) {
    b.adapter.acquireLocation(); b.requests[n].success(fix()); await settle();
  }
  assert.deepEqual(b.queries, ['geolocation']);
  assert.equal(b.statuses.geolocation.count(), 1);
  b.adapter.stop(); assert.equal(b.statuses.geolocation.count(), 0);
});

test('phone handling, drop, pothole and passenger fixtures remain unclassified observations', async () => {
  const scenarios = JSON.parse(await readFile(new URL('./confounders.synthetic.json', import.meta.url), 'utf8'));
  assert.equal(scenarios.evidenceKind, 'synthetic-only-not-device-qualification');
  const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
  b.motionRequests[0].resolve('granted'); await pending;
  for (const scenario of scenarios.cases) {
    b.advance(1000);
    b.platform.dispatch('devicemotion', { acceleration: scenario.acceleration, timeStamp: 700 });
    assert.deepEqual(b.last('motion').data.acceleration, scenario.acceleration);
    assert.equal(b.last('motion').interpretation, 'observation-only');
    assert.equal(b.last('motion').data.candidateMotionChange, 'unclassified');
    assert.equal(scenario.independentOutcome, 'unknown');
    assert.equal(JSON.stringify(b.last('motion')).includes(scenario.id), false);
  }
  for (const invented of ['crash', 'assault', 'sleep', 'fatigue', 'robbery', 'wellbeing']) {
    assert.equal(JSON.stringify(b.events).includes(invented), false);
  }
});

test('motion permission result keeps its original request ID and synchronous throws stay unknown', async () => {
  const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
  const request = b.last('acquisition-request'); b.motionRequests[0].resolve('denied'); await pending;
  assert.equal(b.last('permission').data.requestId, request.data.requestId);
  const c = fixture(); c.platform.DeviceMotionEvent.requestPermission = () => { throw new TypeError('sensitive'); };
  c.adapter.start(context());
  assert.equal((await c.adapter.acquireMotion()).reason, 'permission-request-failed');
  assert.deepEqual(c.adapter.snapshot().permission.motion, {
    state: 'unknown', browserState: 'unknown', source: 'requestPermission-threw',
  });
  assert.equal(c.platform.count('devicemotion'), 0);
});

test('missing clocks, backwards monotonic clock and missing GPS never imply usable streams', () => {
  const b = fixture(); b.clocks(NaN, NaN); b.adapter.start(context());
  assert.equal(b.adapter.acquireLocation().reason, 'duration-or-clock-budget');
  assert.equal(b.requests.length, 0);
  const c = fixture(); c.adapter.start(context()); c.adapter.acquireLocation({ watch: true });
  const watch = c.latestWatch(); c.clocks(WALL + 100, 499); watch.success(fix());
  assert.equal(c.adapter.snapshot().stopReason, 'duration-or-clock-budget');
  assert.equal(c.watches.size, 0);
  const d = fixture(); delete d.platform.navigator.geolocation; d.adapter.start(context());
  assert.equal(d.adapter.acquireLocation().reason, 'api-unavailable');
  assert.equal(d.adapter.snapshot().permission.geolocation.state, 'unknown');
});
