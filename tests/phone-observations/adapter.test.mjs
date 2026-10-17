// Synthetic logic checks only. These fixtures never qualify a device or driver state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPhoneObservationAdapter, PROVISIONAL_BUDGET, QUALIFICATION_SCHEMA, EVENT_SCHEMA } from '../../src/phone-observations/adapter.mjs';
import { createTripPhoneObservations, createQueuedTripPhoneObservations } from '../../src/phone-observations/trip-sharing.mjs';

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
    budgetRevision: PROVISIONAL_BUDGET.revision, streams: { geolocation: true, motion: true },
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

test('B1 motion work cap applies after throttle while raw callback accounting remains observable', async () => {
  const b = fixture({ budget: { ...PROVISIONAL_BUDGET, maxCallbacksPerStream: 8 } });
  b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
  const pending = b.adapter.acquireMotion(); b.motionRequests[0].resolve('granted'); await pending;
  for (let n = 0; n < 120; n += 1) {
    b.advance(1000 / 60); b.platform.dispatch('devicemotion', { timeStamp: n });
  }
  const summary = b.adapter.snapshot().summary;
  assert.equal(b.platform.count('devicemotion'), 1);
  assert.equal(summary.callbacks.motion, 120);
  assert.ok(summary.processedCallbacks.motion < 8);
  assert.equal(summary.suppressedMotion, 120 - summary.processedCallbacks.motion);
  for (let n = 0; n < 9; n += 1) { b.advance(1000); b.platform.dispatch('devicemotion'); }
  assert.equal(b.platform.count('devicemotion'), 0);
  assert.equal(b.last('stream-stopped').data.reason, 'callback-budget');
  assert.equal(b.adapter.snapshot().summary.processedCallbacks.motion, 9);
  b.latestWatch().success(fix()); assert.equal(b.last('geolocation').data.accuracyM, 20);
  b.adapter.stop();
});

test('B1 raw callback guard independently retires a motion flood without stopping GPS', async () => {
  const b = fixture({ budget: { ...PROVISIONAL_BUDGET, maxCallbacksPerStream: 100, maxRawCallbacksPerStream: 4 } });
  b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
  const pending = b.adapter.acquireMotion(); b.motionRequests[0].resolve('granted'); await pending;
  for (let n = 0; n < 100; n += 1) b.platform.dispatch('devicemotion');
  assert.deepEqual(b.last('stream-stopped').data, { stream: 'motion', reason: 'raw-callback-budget' });
  assert.equal(b.adapter.snapshot().summary.callbacks.motion, 5);
  assert.equal(b.adapter.snapshot().summary.processedCallbacks.motion, 1);
  assert.equal(b.events.filter(event => event.type === 'motion').length, 1);
  assert.equal(b.watches.size, 1); assert.equal(b.adapter.snapshot().state, 'started');
  b.adapter.stop();
});

test('B1 raw callback budget requires its own positive finite bounded value', () => {
  for (const maxRawCallbacksPerStream of [0, Infinity, NaN, 100_000_001]) {
    assert.throws(() => fixture({ budget: { ...PROVISIONAL_BUDGET, maxRawCallbacksPerStream } }), RangeError);
  }
});

function queuedTripFixture(pipelineOverrides = {}) {
  const b = fixture();
  const trace = [], pending = deferred();
  const pipeline = {
    sink(event) { b.events.push(event); trace.push(event.type); },
    drain() { trace.push('drain'); return Promise.resolve(); },
    flush() { trace.push('flush'); return Promise.resolve({ receipt: 'queue-owned' }); },
    revokeTrip(tripId) { trace.push(`wipe:${tripId}`); return pending.promise; },
    tripStatus(tripId) { return Promise.resolve({ tripId, queue: { unsent: 1 }, lifecycle: { intent: 'active' } }); },
    ...pipelineOverrides,
  };
  const controller = createQueuedTripPhoneObservations({ ...b.config, pipeline,
    trip: context(), reviewedContext: { key: b.config.contextKey,
      qualification: b.config.qualification, budget: b.config.budget },
    locationConsent: { granted: true, tripId: context().tripId, reference: 'synthetic-consent' },
  });
  return { ...b, controller, pipeline, trace, pending };
}

test('queued trip composes the supplied sink and upload API while acquiring GPS only', async () => {
  const b = queuedTripFixture();
  const started = b.controller.startSharing(); assert.equal(started.ok, true); await started.wakeLock;
  b.latestWatch().success(fix());
  assert.equal(b.last('geolocation').data.coordinates.latitude, -12.04318);
  assert.equal(b.motionRequests.length + b.platform.count('devicemotion'), 0);
  await b.controller.drain(); assert.deepEqual(await b.controller.flush(), { receipt: 'queue-owned' });
  const status = await b.controller.status();
  assert.equal(status.queue.queue.unsent, 1); assert.equal(status.queueWithdrawal, 'not-requested');
  assert.equal(status.capture.state, 'started');
  b.controller.stopSharing(); assert.equal(b.watches.size, 0);
  assert.ok(b.trace.includes('session-stop'));
});

test('queued withdrawal stops and purges synchronously before asynchronous trip deletion', async () => {
  const b = queuedTripFixture(); b.controller.startSharing(); const old = b.latestWatch(); old.success(fix());
  const pending = b.controller.revokeConsent();
  assert.equal(b.watches.size, 0); assert.equal(b.controller.snapshot().queueWithdrawal, 'pending');
  assert.equal(b.controller.snapshot().events.some(event => event.data.coordinates?.latitude != null), false);
  assert.equal(b.trace.some(value => value.startsWith('wipe:')), false);
  old.success(fix()); assert.equal(b.controller.snapshot().events.some(event => event.data.coordinates?.latitude != null), false);
  assert.equal(b.controller.startSharing().ok, false);
  assert.equal((await b.controller.resumeSharing()).ok, false);
  assert.equal((await b.controller.flush()).ok, false);
  assert.equal(b.trace.filter(value => value === 'flush').length, 0);
  await settle(); assert.ok(b.trace.includes(`wipe:${context().tripId}`));
  b.pending.resolve(1); assert.deepEqual(await pending, { ok: true });
  assert.equal(b.controller.snapshot().queueWithdrawal, 'complete');
  await b.controller.revokeConsent(); assert.equal(b.trace.filter(value => value.startsWith('wipe:')).length, 1);
});

test('queued withdrawal exposes deletion failures and allows deletion retry without reopening consent', async () => {
  let attempts = 0;
  const b = queuedTripFixture({ revokeTrip() {
    attempts += 1; if (attempts === 1) throw new Error('synthetic-storage-fault'); return 0;
  } });
  b.controller.startSharing();
  assert.deepEqual(await b.controller.revokeConsent(), { ok: false, reason: 'queue-revocation-failed' });
  assert.equal((await b.controller.status()).queueWithdrawal, 'failed');
  assert.equal(b.controller.startSharing().ok, false);
  assert.deepEqual(await b.controller.revokeConsent(), { ok: true });
  assert.equal(attempts, 2); assert.equal(b.controller.snapshot().queueWithdrawal, 'complete');
  assert.equal(b.controller.startSharing().ok, false);
});

test('queued status failure is explicit and a pipeline with missing capabilities is rejected', async () => {
  const b = queuedTripFixture({ tripStatus() { throw new Error('synthetic-status-fault'); } });
  assert.equal((await b.controller.status()).reason, 'queue-status-unavailable');
  for (const method of ['sink', 'drain', 'flush', 'revokeTrip', 'tripStatus']) {
    assert.throws(() => createQueuedTripPhoneObservations({ pipeline: { ...b.pipeline, [method]: null } }), TypeError);
  }
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
  assert.deepEqual(b.requests[0].args, { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 });
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

test('motion denies missing API and retains denied/unknown/rejected explicit answers', async () => {
  const b = fixture(); b.adapter.start(context()); delete b.platform.DeviceMotionEvent;
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

test('R1 every terminal path emits exactly one stop beyond an exhausted ordinary budget', () => {
  for (const reason of ['event-budget', 'duration-budget', 'visibility-lost', 'pagehide', 'freeze', 'explicit-stop', 'consent-revoked']) {
    const b = fixture({ budget: { ...PROVISIONAL_BUDGET, maxEvents: reason === 'event-budget' ? 3 : 10 } });
    b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
    const old = b.latestWatch();
    if (reason === 'event-budget') old.success(fix());
    if (reason === 'duration-budget') b.fireTimers(PROVISIONAL_BUDGET.maxSessionMs);
    if (reason === 'visibility-lost') { b.document.visibilityState = 'hidden'; b.document.dispatch('visibilitychange'); }
    if (reason === 'pagehide') b.platform.dispatch('pagehide');
    if (reason === 'freeze') b.document.dispatch('freeze');
    if (reason === 'explicit-stop') b.adapter.stop();
    if (reason === 'consent-revoked') b.adapter.revokeConsent();
    assert.equal(b.last('session-stop').data.reason, reason);
    assert.equal(b.last('session-stop').data.sharingState, 'stopped');
    assert.equal(b.last('session-stop').serverReceiptTime, null);
    const count = b.events.length;
    old.success(fix()); old.failure({ code: 2 }); b.adapter.stop(); b.adapter.revokeConsent();
    assert.equal(b.events.length, count);
    assert.equal(b.events.filter((e) => e.type === 'session-stop').length, 1);
    assert.equal(b.timers.size + b.watches.size + b.document.count() + b.platform.count(), 0);
    assert.ok(count <= b.config.budget.maxEvents + 1);
  }
});

test('R1 reentrant sink stop is delivered after the current event with no recursive sink', () => {
  const b = fixture(); let depth = 0; let maximum = 0;
  const adapter = createPhoneObservationAdapter({ ...b.config, sink(event) {
    depth += 1; maximum = Math.max(maximum, depth); b.events.push(event);
    adapter.revokeConsent(); depth -= 1;
  } });
  adapter.start(context());
  assert.deepEqual(b.events.map((e) => e.type), ['session-start', 'session-stop']);
  assert.equal(maximum, 1); assert.equal(b.events.at(-1).data.reason, 'consent-revoked');
});

test('R1 default bounded session supports ten foreground hours at one GPS fix per second', () => {
  const b = fixture(); let fixes = 0; let stops = 0;
  const adapter = createPhoneObservationAdapter({ ...b.config, sink(event) {
    if (event.type === 'geolocation') fixes += 1;
    if (event.type === 'session-stop') stops += 1;
  } });
  adapter.start(context()); adapter.acquireLocation({ watch: true }); const watch = b.latestWatch();
  for (let n = 0; n < 36_000; n += 1) { b.advance(1000); watch.success(fix(WALL + (n + 1) * 1000)); }
  assert.equal(fixes, 36_000); assert.equal(stops, 0);
  assert.equal(adapter.snapshot().state, 'started');
  assert.equal(adapter.snapshot().events.length, PROVISIONAL_BUDGET.bufferCapacity);
  adapter.stop(); assert.equal(stops, 1);
});

test('R2 an already granted GPS stream can be explicitly reacquired without prompting', async () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation();
  b.requests[0].success(fix()); await settle();
  b.platform.navigator.userActivation.isActive = false;
  assert.equal(b.adapter.acquireLocation({ watch: true }).ok, true);
  b.adapter.stop();
});

class GestureEvent {
  constructor(patch = {}) { Object.assign(this, { type: 'click', isTrusted: true, currentTarget: {}, eventPhase: 2 }, patch); }
}

test('R2 legacy gesture bridge accepts only synchronous trusted native dispatch', async () => {
  const b = fixture(); b.platform.Event = GestureEvent; delete b.platform.navigator.userActivation;
  b.adapter.start(context());
  for (const event of [{ isTrusted: true }, new GestureEvent({ isTrusted: false }),
    new GestureEvent({ eventPhase: 0 }), new GestureEvent({ currentTarget: null }),
    new GestureEvent({ type: 'change' }), new GestureEvent({ type: 'keydown', key: 'a' })]) {
    assert.equal(b.adapter.withUserGesture(event, () => b.adapter.acquireLocation()).ok, false);
  }
  assert.equal(b.requests.length, 0);
  const later = b.adapter.withUserGesture(new GestureEvent(), () => Promise.resolve().then(() => b.adapter.acquireLocation()));
  assert.equal((await later).reason, 'user-gesture-required');
  assert.equal(b.adapter.withUserGesture(new GestureEvent({ type: 'keydown', key: 'Enter' }),
    () => b.adapter.acquireLocation({ watch: true })).ok, true);
  b.adapter.stop();
});

test('R2 explicit resume restores the watch under a new generation and ignores old callbacks', async () => {
  const b = fixture(); b.adapter.start(context());
  b.adapter.acquireLocation({ watch: true, preciseConsent: { granted: true, purpose: 'trip', reference: 'consent' } });
  const old = b.latestWatch(); old.success(fix()); const oldId = b.last('geolocation').eventId;
  b.document.visibilityState = 'hidden'; b.document.dispatch('visibilitychange');
  assert.equal((await b.adapter.resume()).reason, 'not-visible');
  b.document.visibilityState = 'visible'; b.document.dispatch('visibilitychange');
  assert.equal(b.watches.size, 0);
  b.platform.navigator.userActivation.isActive = false;
  assert.equal((await b.adapter.resume()).reason, 'user-gesture-required');
  b.platform.navigator.userActivation.isActive = true;
  assert.equal((await b.adapter.resume()).ok, true);
  old.success(fix()); const count = b.events.length;
  b.latestWatch().success(fix());
  assert.equal(b.events.length, count + 1); assert.notEqual(b.last('geolocation').eventId, oldId);
  assert.equal(b.last('geolocation').data.consentReference, 'consent');
  b.adapter.revokeConsent(); assert.equal((await b.adapter.resume()).reason, 'not-resumable');
});

test('R2 denied permission cannot be bypassed by suspension and resume', async () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
  b.statuses.geolocation.state = 'denied'; b.latestWatch().failure({ code: 1 }); await settle();
  b.platform.dispatch('pagehide');
  assert.equal((await b.adapter.resume()).reason, 'permission-denied-or-revoked');
  assert.equal(b.watches.size, 0);
});

const sentinel = () => Object.assign(new Target(), {
  released: false, releaseCount: 0,
  release() { this.released = true; this.releaseCount += 1; this.dispatch('release'); return Promise.resolve(); },
});

test('R2 wake lock is best effort, releases on stop, and late grants release without reviving a session', async () => {
  for (const late of [false, true]) {
    const b = fixture(); const answer = deferred(); const lock = sentinel();
    b.platform.navigator.wakeLock = { request(type) { assert.equal(type, 'screen'); return answer.promise; } };
    b.adapter.start(context()); const pending = b.adapter.requestWakeLock();
    if (late) b.adapter.stop();
    answer.resolve(lock); const result = await pending; await settle();
    assert.equal(result.ok, !late);
    if (!late) {
      assert.equal(b.last('wake-lock').data.scope, 'visible-screen-only');
      b.adapter.stop();
    }
    assert.equal(lock.releaseCount, 1); assert.equal(lock.count(), 0);
    assert.equal(b.adapter.snapshot().state, 'stopped');
  }
});

test('R2 unsupported, rejected, timed-out and browser-released wake locks are explicit', async () => {
  const b = fixture(); b.adapter.start(context());
  assert.equal((await b.adapter.requestWakeLock()).reason, 'api-unavailable');
  b.platform.navigator.wakeLock = { request() { return Promise.reject(new Error('private')); } };
  assert.equal((await b.adapter.requestWakeLock()).reason, 'request-failed');
  const answer = deferred(); b.platform.navigator.wakeLock.request = () => answer.promise;
  const pending = b.adapter.requestWakeLock(); b.fireTimers(PROVISIONAL_BUDGET.requestTimeoutMs);
  assert.equal((await pending).reason, 'request-timeout');
  const lateLock = sentinel(); answer.resolve(lateLock); await settle(); assert.equal(lateLock.releaseCount, 1);
  const lock = sentinel(); b.platform.navigator.wakeLock.request = () => Promise.resolve(lock);
  assert.equal((await b.adapter.requestWakeLock()).ok, true);
  await lock.release(); assert.equal(b.last('wake-lock').data.reason, 'browser-release');
  b.adapter.stop(); assert.equal(b.timers.size + lock.count(), 0);
});

test('R2 delayed wake grant rechecks its deadline without timer execution', async () => {
  const b = fixture(); const answer = deferred(); const lock = sentinel();
  b.platform.navigator.wakeLock = { request: () => answer.promise };
  b.adapter.start(context()); const pending = b.adapter.requestWakeLock();
  b.advance(PROVISIONAL_BUDGET.requestTimeoutMs); answer.resolve(lock);
  assert.equal((await pending).reason, 'request-timeout');
  assert.equal(lock.releaseCount, 1);
  assert.equal(b.last('wake-lock').data.state, 'unavailable');
  b.adapter.stop(); assert.equal(b.timers.size, 0);
});

test('R2 resume reacquires motion and wake lock only from the new explicit action', async () => {
  const b = fixture(); const locks = []; b.platform.navigator.wakeLock = { request() {
    const lock = sentinel(); locks.push(lock); return Promise.resolve(lock);
  } };
  b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
  const motion = b.adapter.acquireMotion(); b.motionRequests[0].resolve('granted'); await motion;
  await b.adapter.requestWakeLock();
  const oldHandler = [...b.platform.handlers.get('devicemotion')][0];
  b.platform.dispatch('pagehide'); assert.equal(locks[0].releaseCount, 1);
  const pending = b.adapter.resume();
  assert.equal(b.motionRequests.length, 2); b.motionRequests[1].resolve('granted');
  assert.equal((await pending).ok, true); assert.equal(locks.length, 2);
  const count = b.events.length; oldHandler({}); assert.equal(b.events.length, count);
  b.platform.dispatch('devicemotion', { acceleration: { x: 2, y: 3, z: 4 } });
  assert.deepEqual(b.last('motion').data.acceleration, { x: 2, y: 3, z: 4 });
  b.adapter.stop(); assert.equal(locks[1].releaseCount, 1);
});

test('R3 high accuracy is a default hint with an explicit observable override', () => {
  const b = fixture(); b.adapter.start(context());
  b.adapter.acquireLocation({ enableHighAccuracy: false }); b.requests[0].success(fix(WALL, 5000));
  assert.equal(b.last('geolocation').data.options.enableHighAccuracy, false);
  assert.equal(b.last('geolocation').data.accuracyM, 5000);
  assert.match(b.last('geolocation').data.locationSource, /unknown/);
  b.adapter.acquireLocation(); assert.equal(b.requests[1].args.enableHighAccuracy, true);
  assert.throws(() => b.adapter.acquireLocation({ enableHighAccuracy: 'true' }), TypeError);
  b.adapter.stop();
});

test('R4 trip factory binds reviewed context and trip consent without enabling unqualified devices', async () => {
  const b = fixture(); const trip = context();
  const options = { ...b.config, trip, reviewedContext: {
    key: b.config.contextKey, qualification: b.config.qualification, budget: b.config.budget,
  }, locationConsent: { granted: true, tripId: trip.tripId, reference: 'consent-for-trip' } };
  for (const patch of [{ reviewedContext: null }, { mode: 'device' },
    { locationConsent: null }, { locationConsent: { granted: true, tripId: 'other-trip', reference: 'wrong-trip' } }]) {
    const controller = createTripPhoneObservations({ ...options, ...patch });
    assert.equal(controller.startSharing().ok, false);
    assert.equal(b.watches.size, 0); controller.stopSharing();
  }
  const controller = createTripPhoneObservations(options); const started = controller.startSharing();
  assert.equal(started.ok, true); await started.wakeLock;
  assert.equal(controller.startSharing().reason, 'already-acquiring');
  b.latestWatch().success(fix());
  assert.deepEqual(b.last('geolocation').data.coordinates, { latitude: -12.04318, longitude: -77.02824 });
  assert.equal(b.last('geolocation').data.purpose, 'active-trip-location-sharing');
  controller.revokeConsent();
  assert.equal(controller.startSharing().reason, 'trip-location-consent-required');
});

test('R5 browser-managed motion needs qualification and gesture and never fabricates a permission grant', async () => {
  const b = fixture(); delete b.platform.DeviceMotionEvent.requestPermission;
  b.adapter.start(context()); b.platform.navigator.userActivation.isActive = false;
  assert.equal((await b.adapter.acquireMotion()).reason, 'user-gesture-required');
  b.platform.navigator.userActivation.isActive = true;
  assert.equal((await b.adapter.acquireMotion()).ok, true);
  assert.equal(b.motionRequests.length, 0);
  assert.equal(b.adapter.snapshot().permission.motion.state, 'unknown');
  b.platform.dispatch('devicemotion', { acceleration: { x: 1, y: 2, z: 3 } });
  assert.deepEqual(b.last('motion').data.acceleration, { x: 1, y: 2, z: 3 });
  b.adapter.stop(); assert.equal(b.platform.count(), 0);
});

test('R6 transient errors are throttled separately while denial and later valid fixes remain observable', () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation({ watch: true }); const watch = b.latestWatch();
  for (let n = 0; n < 1000; n += 1) watch.failure({ code: n % 2 ? 2 : 3 });
  assert.equal(b.events.filter((e) => e.type === 'geolocation-error').length, 1);
  assert.equal(b.adapter.snapshot().summary.suppressedErrors, 999);
  watch.success(fix()); assert.equal(b.last('geolocation').data.accuracyM, 20);
  b.advance(1000); watch.failure({ code: 2 });
  assert.equal(b.events.filter((e) => e.type === 'geolocation-error').length, 2);
  watch.failure({ code: 1 });
  assert.equal(b.events.filter((e) => e.type === 'geolocation-error').length, 3);
  assert.equal(b.last('geolocation-error').data.code, 1); assert.equal(b.watches.size, 0);
  b.adapter.stop();
});

test('late motion grant cannot subscribe after stop, replacement request or timeout', async () => {
  for (const [stop, reason] of [
    [(b) => b.adapter.stop(), 'session-stopped'], [(b) => b.adapter.stopMotion(), 'obsolete-request'],
    [(b) => b.fireTimers(PROVISIONAL_BUDGET.permissionPromptTimeoutMs), 'permission-prompt-timeout'],
  ]) {
    const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
    stop(b); b.motionRequests[0].resolve('granted');
    assert.equal((await pending).reason, reason);
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
  e.fireTimers(PROVISIONAL_BUDGET.maxSessionMs); assert.equal(e.adapter.snapshot().stopReason, 'duration-budget');
  assert.equal(e.watches.size + e.timers.size, 0);
});

test('timeouts retire one-shot tokens; raw API errors are redacted and verified denial is explicit', async () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation(); const old = b.requests[0];
  await settle(); b.fireTimers(10_000); old.success(fix()); assert.equal(b.last('geolocation'), undefined);
  b.adapter.acquireLocation(); b.statuses.geolocation.state = 'denied';
  b.requests[1].failure({ code: 1, message: '-12.04318 private context' });
  assert.equal(b.adapter.snapshot().permission.geolocation.state, 'revoked');
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
  for (const patch of [{ bufferCapacity: Infinity }, { maxEvents: 0 }, { maxRequests: 1001 },
    { freshnessMs: -1 }, { maxSessionMs: 604_800_001 }, { minEmitIntervalMs: 0 }]) {
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
  const b = fixture(); b.adapter.start(context()); b.advance(PROVISIONAL_BUDGET.maxSessionMs);
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
  assert.equal(calls, 2); assert.equal(adapter.snapshot().state, 'stopped');
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

test('F1 stream cancellation during request delivery prevents GPS calls, permission queries and orphan timers', () => {
  for (const watch of [false, true]) {
    const b = fixture(); let cancelRequest = true;
    const adapter = createPhoneObservationAdapter({ ...b.config, sink(event) {
      b.events.push(event);
      if (cancelRequest && event.type === 'acquisition-request') adapter.stopLocation();
    } });
    adapter.start(context());
    assert.equal(adapter.acquireLocation({ watch }).ok, false);
    assert.equal(b.requests.length + b.watches.size + b.queries.length, 0);
    assert.equal(b.timers.size, 1); // Only the still-live session deadline.
    adapter.stop(); assert.equal(b.timers.size, 0);

    cancelRequest = false; adapter.start(context('replacement'));
    assert.equal(adapter.acquireLocation({ watch }).ok, true);
    (watch ? b.latestWatch() : b.requests[0]).success(fix());
    assert.equal(b.last('geolocation').sessionId, 'replacement');
    adapter.stop(); assert.equal(b.timers.size + b.watches.size, 0);
  }
});

test('F2 delayed motion grants recheck inclusive session and permission-prompt deadlines without timer execution', async () => {
  for (const [maxSessionMs, permissionPromptTimeoutMs, elapsed, expected] of [
    [1000, 2000, 999, true], [1000, 2000, 1000, false], [1000, 2000, 1001, false],
    [3000, 1000, 999, true], [3000, 1000, 1000, false], [3000, 1000, 1001, false],
  ]) {
    const b = fixture({ budget: { ...PROVISIONAL_BUDGET, maxSessionMs, permissionPromptTimeoutMs } });
    b.adapter.start(context()); const pending = b.adapter.acquireMotion();
    b.advance(elapsed); b.motionRequests[0].resolve('granted');
    assert.equal((await pending).ok, expected, `session=${maxSessionMs}, prompt=${permissionPromptTimeoutMs}, elapsed=${elapsed}`);
    assert.equal(b.platform.count('devicemotion'), expected ? 1 : 0);
    if (expected) {
      b.platform.dispatch('devicemotion', { acceleration: { x: 1, y: 2, z: 3 } });
      assert.deepEqual(b.last('motion').data.acceleration, { x: 1, y: 2, z: 3 });
    } else {
      assert.equal(b.adapter.snapshot().permission.motion.state, 'unknown');
      assert.equal(b.queries.length, 0);
    }
    b.adapter.stop(); assert.equal(b.platform.count() + b.document.count() + b.timers.size, 0);
  }
});

test('F2 motion grants recheck visibility and clocks before applying the answer', async () => {
  for (const mutate of [
    (b) => { b.document.visibilityState = 'hidden'; },
    (b) => b.clocks(WALL, NaN),
    (b) => b.clocks(WALL, 499),
  ]) {
    const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
    mutate(b); b.motionRequests[0].resolve('granted');
    assert.equal((await pending).ok, false);
    assert.equal(b.platform.count('devicemotion') + b.timers.size, 0);
    assert.equal(b.adapter.snapshot().permission.motion.state, 'unknown');
  }
});

test('F2 permission-event sink cannot delay or hide the page and then attach a motion listener', async () => {
  for (const mutate of [
    (b) => b.advance(PROVISIONAL_BUDGET.maxSessionMs),
    (b) => b.advance(PROVISIONAL_BUDGET.permissionPromptTimeoutMs),
    (b) => { b.document.visibilityState = 'hidden'; },
  ]) {
    const b = fixture();
    const adapter = createPhoneObservationAdapter({ ...b.config, sink(event) {
      if (event.type === 'permission' && event.data.source === 'requestPermission') mutate(b);
    } });
    adapter.start(context()); const pending = adapter.acquireMotion(); b.motionRequests[0].resolve('granted');
    assert.equal((await pending).ok, false);
    assert.equal(b.platform.count('devicemotion'), 0);
    adapter.stop(); assert.equal(b.timers.size, 0);
  }
});

test('F3 conflicting passive grants and changes cannot reopen denied or revoked session permission', async () => {
  for (const initiallyGranted of [false, true]) {
    const b = fixture(); const answer = deferred(); let queries = 0;
    const provenDenied = Object.assign(new Target(), { state: 'denied' });
    b.platform.navigator.permissions.query = () => ++queries === 1 ? answer.promise : Promise.resolve(provenDenied);
    b.adapter.start(context()); b.adapter.acquireLocation({ watch: true });
    if (initiallyGranted) { answer.resolve(b.statuses.geolocation); await settle(); }
    if (initiallyGranted) b.statuses.geolocation.state = 'denied';
    b.latestWatch().failure({ code: 1 }); await settle();
    const denied = b.adapter.snapshot().permission.geolocation;
    assert.equal(denied.state, initiallyGranted ? 'revoked' : 'denied');
    answer.resolve(b.statuses.geolocation); await settle();
    assert.deepEqual(b.adapter.snapshot().permission.geolocation, denied);
    for (const state of ['prompt', 'unknown', 'granted']) {
      b.statuses.geolocation.state = state; b.statuses.geolocation.dispatch('change');
      assert.deepEqual(b.adapter.snapshot().permission.geolocation, denied);
      assert.equal(b.adapter.acquireLocation().reason, 'permission-denied-or-revoked');
    }
    assert.equal(b.watches.size + b.requests.length, 0);
    b.adapter.stop(); b.statuses.geolocation.state = 'granted';
    b.platform.navigator.permissions.query = () => Promise.resolve(b.statuses.geolocation);
    b.adapter.start(context('replacement')); assert.equal(b.adapter.acquireLocation().ok, true);
    await settle(); b.requests[0].success(fix());
    assert.equal(b.last('geolocation').sessionId, 'replacement');
    b.adapter.stop(); assert.equal(b.statuses.geolocation.count(), 0);
  }
});

test('F4 failed GPS events keep original per-request options after request eviction', () => {
  const budget = { ...PROVISIONAL_BUDGET, bufferCapacity: 1, maximumAgeMs: 12345, requestTimeoutMs: 23456 };
  for (const watch of [false, true]) for (const code of [1, 2, 3, 42]) {
    const b = fixture({ budget }); b.adapter.start(context());
    const request = b.adapter.acquireLocation({ watch });
    (watch ? b.latestWatch() : b.requests[0]).failure({ code, message: 'private platform detail' });
    const event = b.adapter.snapshot().events[0];
    assert.equal(event.type, 'geolocation-error'); assert.equal(event.data.requestId, request.requestId);
    assert.equal(event.data.watch, watch);
    assert.deepEqual(event.data.options, { enableHighAccuracy: true, maximumAge: 12345, timeout: 23456 });
    b.last('geolocation-error').data.options.timeout = 1;
    assert.equal(b.adapter.snapshot().events[0].data.options.timeout, 23456);
    assert.equal(JSON.stringify(event).includes('private platform detail'), false);
    if (watch && code !== 1) {
      b.latestWatch().success(fix());
      assert.deepEqual(b.last('geolocation').data.options, event.data.options);
    }
    b.adapter.stop(); assert.equal(b.timers.size + b.watches.size, 0);
  }
});

test('F4 local GPS timeout and platform failure also retain their request options', async () => {
  const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation(); await settle(); b.fireTimers(10_000);
  assert.deepEqual(b.last('acquisition-timeout').data.options, b.requests[0].args);
  b.geo.getCurrentPosition = () => { throw new Error('private'); };
  b.adapter.acquireLocation();
  assert.deepEqual(b.last('acquisition-error').data.options, b.requests[0].args);
  b.adapter.stop(); assert.equal(b.timers.size, 0);
});


test('N1 sixty-hertz motion remains subscribed for thirty seconds with default raw callback guard', async () => {
  const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
  b.motionRequests[0].resolve('granted'); await pending;
  for (let n = 0; n < 1800; n += 1) {
    b.advance(1000 / 60); b.platform.dispatch('devicemotion', { acceleration: { x: 1, y: 2, z: 3 } });
  }
  assert.equal(b.platform.count('devicemotion'), 1);
  assert.ok(b.events.filter((e) => e.type === 'motion').length >= 29);
  assert.equal(b.adapter.snapshot().summary.callbacks.motion, 1800);
  b.adapter.stop();
});

test('N3 repeated blocked GPS acquisition cannot terminate another active stream', async () => {
  const b = fixture({ budget: { ...PROVISIONAL_BUDGET, maxEvents: 20 } });
  const qualification = { ...b.config.qualification, streams: { geolocation: false, motion: true } };
  const adapter = createPhoneObservationAdapter({ ...b.config, qualification });
  adapter.start(context()); const pending = adapter.acquireMotion(); b.motionRequests[0].resolve('granted'); await pending;
  for (let n = 0; n < 1000; n += 1) assert.equal(adapter.acquireLocation().reason, 'unqualified');
  assert.equal(adapter.snapshot().state, 'started'); assert.equal(b.platform.count('devicemotion'), 1);
  assert.equal(adapter.snapshot().summary.suppressedBlocked, 999);
  assert.equal(b.events.filter((e) => e.type === 'acquisition-blocked').length, 1);
  adapter.stop();
});

test('N4 withdrawal purges buffered precise coordinates even after a prior stop', () => {
  for (const stopped of [false, true]) {
    const b = fixture(); b.adapter.start(context()); b.adapter.acquireLocation({ watch: true,
      preciseConsent: { granted: true, purpose: 'trip', reference: 'consent' } });
    b.latestWatch().success(fix()); assert.match(JSON.stringify(b.adapter.snapshot()), /-12.04318/);
    if (stopped) b.adapter.stop();
    b.adapter.revokeConsent(); b.adapter.revokeConsent();
    assert.equal(JSON.stringify(b.adapter.snapshot()).includes('-12.04318'), false);
    assert.equal(JSON.stringify(b.adapter.snapshot()).includes('-77.02824'), false);
    assert.equal(b.adapter.snapshot().permission.geolocation.state, 'revoked');
    assert.equal(b.adapter.snapshot().events.find((e) => e.type === 'geolocation').data.coordinates, null);
  }
});

test('N5 synthetic mode rejects inherited globals/platform and the default real clock', () => {
  const b = fixture();
  for (const platform of [globalThis, Object.create(globalThis), Object.create(b.platform)]) {
    assert.throws(() => createPhoneObservationAdapter({ ...b.config, platform }), /detached injected/);
  }
  const { clock, ...withoutClock } = b.config;
  assert.throws(() => createPhoneObservationAdapter(withoutClock), /detached injected/);
  assert.equal(b.requests.length + b.motionRequests.length + b.queries.length, 0);
});

test('N8 GPS callback budget stop uses the public geolocation stream name', () => {
  const b = fixture({ budget: { ...PROVISIONAL_BUDGET, maxCallbacksPerStream: 1 } });
  b.adapter.start(context()); b.adapter.acquireLocation({ watch: true }); const watch = b.latestWatch();
  watch.success(fix()); b.advance(1000); watch.success(fix());
  assert.equal(b.last('stream-stopped').data.stream, 'geolocation'); b.adapter.stop();
});


test('N6 code1 prompt dismissal remains explicit and retryable; verified denial stays terminal', async () => {
  const b = fixture(); b.statuses.geolocation.state = 'prompt'; b.adapter.start(context());
  b.adapter.acquireLocation(); b.requests[0].failure({ code: 1 }); await settle();
  assert.equal(b.adapter.snapshot().permission.geolocation.state, 'prompt');
  assert.equal(b.adapter.acquireLocation().ok, true);
  b.requests[1].success(fix()); assert.equal(b.last('geolocation').data.accuracyM, 20);
  b.adapter.stop();
  const c = fixture(); c.statuses.geolocation.state = 'denied'; c.adapter.start(context());
  c.adapter.acquireLocation(); c.requests[0].failure({ code: 1 }); await settle();
  assert.equal(c.adapter.snapshot().permission.geolocation.state, 'denied');
  c.statuses.geolocation.state = 'granted'; c.statuses.geolocation.dispatch('change');
  assert.equal(c.adapter.acquireLocation().reason, 'permission-denied-or-revoked'); c.adapter.stop();
});

test('N7 a thirty-second prompt does not discard the first GPS or motion grant', async () => {
  const b = fixture(); const permission = deferred();
  b.platform.navigator.permissions.query = () => permission.promise;
  b.adapter.start(context()); b.adapter.acquireLocation(); const motion = b.adapter.acquireMotion();
  b.advance(30_000); b.requests[0].success(fix(WALL + 30_000)); b.motionRequests[0].resolve('granted');
  assert.equal((await motion).ok, true); assert.equal(b.last('geolocation').sourceTime.value, WALL + 30_000);
  assert.equal(b.adapter.snapshot().summary.requests, 2);
  assert.equal(b.requests[0].args.timeout, PROVISIONAL_BUDGET.requestTimeoutMs);
  b.adapter.stop(); permission.resolve(b.statuses.geolocation); await settle(); assert.equal(b.timers.size, 0);
});

test('N7 permission-prompt deadline remains inclusive when browser timers are delayed', async () => {
  for (const [elapsed, expected] of [[119999, true], [120000, false], [120001, false]]) {
    const b = fixture(); b.adapter.start(context()); const pending = b.adapter.acquireMotion();
    b.advance(elapsed); b.motionRequests[0].resolve('granted');
    const result = await pending; assert.equal(result.ok, expected);
    if (!expected) assert.equal(result.reason, 'permission-prompt-timeout');
    b.adapter.stop(); assert.equal(b.platform.count() + b.timers.size, 0);
  }
});

test('N9 synchronous GPS denial or sink stop cannot report a successful acquisition', () => {
  const b = fixture(); b.geo.watchPosition = (success, failure) => { failure({ code: 1 }); return 991; };
  b.adapter.start(context());
  assert.equal(b.adapter.acquireLocation({ watch: true }).reason, 'permission-not-granted');
  assert.deepEqual(b.cleared, [991]); b.adapter.stop();
  const c = fixture(); let adapter;
  adapter = createPhoneObservationAdapter({ ...c.config, sink(event) {
    if (event.type === 'geolocation') adapter.stop();
  } });
  c.geo.watchPosition = (success) => { success(fix()); return 992; };
  adapter.start(context()); assert.equal(adapter.acquireLocation({ watch: true }).reason, 'session-stopped');
  assert.deepEqual(c.cleared, [992]);
});

test('N10 observer fulfil-path exceptions are caught and normal notifications follow listener setup', async () => {
  const b = fixture(); b.statuses.geolocation.addEventListener = () => { throw new Error('private status failure'); };
  b.adapter.start(context()); b.adapter.acquireLocation(); await settle();
  assert.equal(b.adapter.snapshot().summary.permissionObserverErrors, 1);
  assert.equal(JSON.stringify(b.events).includes('private status failure'), false); b.adapter.stop();
  const c = fixture(); const counts = [];
  const adapter = createPhoneObservationAdapter({ ...c.config, sink(event) {
    if (event.type === 'permission' && event.data.source === 'permissions:geolocation') counts.push(c.statuses.geolocation.count());
  } });
  adapter.start(context()); adapter.acquireLocation(); await settle(); assert.deepEqual(counts, [1]); adapter.stop();
});

test('N11 a throwing motion timer settles explicitly, retires the token and handles its later rejected promise', async () => {
  const b = fixture(); const original = b.platform.setTimeout; b.adapter.start(context());
  b.platform.setTimeout = () => { throw new Error('private timer failure'); };
  assert.equal((await b.adapter.acquireMotion()).reason, 'timer-unavailable');
  b.motionRequests[0].reject(new Error('private late rejection')); await settle();
  assert.equal(b.platform.count('devicemotion'), 0);
  b.platform.setTimeout = original;
  const next = b.adapter.acquireMotion(); b.motionRequests[1].resolve('granted'); assert.equal((await next).ok, true);
  b.adapter.stop(); assert.equal(b.timers.size, 0);
});

test('N12 sink stream cancellation and backward motion clock retain distinct reasons', async () => {
  const b = fixture(); let adapter;
  adapter = createPhoneObservationAdapter({ ...b.config, sink(event) {
    if (event.type === 'acquisition-request') adapter.stopMotion();
  } });
  adapter.start(context()); assert.equal((await adapter.acquireMotion()).reason, 'obsolete-request');
  assert.equal(b.motionRequests.length, 0); adapter.stop();
  const c = fixture(); c.adapter.start(context()); c.advance(1000);
  const pending = c.adapter.acquireMotion(); c.clocks(WALL + 500, 1000); c.motionRequests[0].resolve('granted');
  assert.equal((await pending).reason, 'clock-regressed');
  assert.equal(c.last('acquisition-error').data.reason, 'clock-regressed');
  assert.equal(c.last('acquisition-timeout'), undefined); c.adapter.stop();
});

test('N13 queued location events are redacted on sink withdrawal before subsequent delivery', () => {
  const b = fixture(); let adapter; let first = true;
  adapter = createPhoneObservationAdapter({ ...b.config, sink(event) {
    b.events.push(event);
    if (event.type === 'geolocation' && first) { first = false; adapter.revokeConsent(); }
  } });
  b.geo.watchPosition = (success) => { success(fix()); b.advance(1000); success(fix(WALL + 1000)); return 993; };
  adapter.start(context());
  assert.equal(adapter.acquireLocation({ watch: true,
    preciseConsent: { granted: true, purpose: 'trip', reference: 'consent' } }).ok, false);
  const fixes = b.events.filter((e) => e.type === 'geolocation');
  assert.equal(fixes.length, 2); assert.notEqual(fixes[0].data.coordinates, null);
  assert.equal(fixes[1].data.coordinates, null); assert.equal(fixes[1].data.redaction, 'consent-withdrawn');
  assert.equal(JSON.stringify(adapter.snapshot()).includes('-12.04318'), false);
  assert.deepEqual(b.cleared, [993]); assert.equal(adapter.snapshot().summary.sinkErrors, 0);
});
