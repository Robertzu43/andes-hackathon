// Independent synthetic controls for Robert reviews 5560453602/5560599386.
// Never imports a browser, opens a socket, or calls real device APIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const root = process.env.ANDES_CANDIDATE_DIR ?? process.cwd();
const { createPhoneObservationAdapter: create, PROVISIONAL_BUDGET: B, QUALIFICATION_SCHEMA: Q } =
  await import(pathToFileURL(`${root}/src/phone-observations/adapter.mjs`));
const EPOCH = 1_800_000_000_000;
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class Target {
  handlers = new Map();
  addEventListener(name, handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(handler);
  }
  removeEventListener(name, handler) { this.handlers.get(name)?.delete(handler); }
  fire(name, event = {}) { for (const handler of [...(this.handlers.get(name) ?? [])]) handler(event); }
  count(name) { return this.handlers.get(name)?.size ?? 0; }
}
function setup({ budget = {}, sink, prepare, motion = true } = {}) {
  let monoMs = 100, nextId = 0;
  const platform = new Target(), document = Object.assign(new Target(), { visibilityState: 'visible' });
  const calls = [], events = [], prompts = [], timers = new Map(), watches = new Set();
  const statuses = Object.fromEntries(['geolocation', 'accelerometer', 'gyroscope'].map(name =>
    [name, Object.assign(new Target(), { state: 'granted' })]));
  const geo = {
    getCurrentPosition(success, failure, options) { calls.push({ success, failure, options }); },
    watchPosition(success, failure, options) {
      const id = ++nextId; calls.push({ success, failure, options }); watches.add(id); return id;
    },
    clearWatch(id) { watches.delete(id); },
  };
  Object.assign(platform, {
    document, isSecureContext: true,
    navigator: { userActivation: { isActive: true }, geolocation: geo,
      permissions: { query: ({ name }) => Promise.resolve(statuses[name]) } },
    DeviceMotionEvent: { requestPermission() { const answer = deferred(); prompts.push(answer); return answer.promise; } },
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const f = { platform, document, calls, events, prompts, timers, watches, statuses, geo,
    advance(ms) { monoMs += ms; },
    fireTimers(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms === ms) { timers.delete(id); timer.fn(); }
      }
    },
    last(type) { return events.filter(event => event.type === type).at(-1); },
    start() { f.a.start({ sessionId: 'review-synthetic', tripId: 'review-trip', revision: 'review-only' }); },
  };
  prepare?.(f);
  f.a = create({ platform, clock: { now: () => ({ monoMs, wallMs: EPOCH + monoMs }) },
    mode: 'synthetic-test', contextKey: 'review-visible', budget: { ...B, ...budget },
    qualification: { schema: Q, kind: 'synthetic-fixture', disposition: 'qualified',
      evidenceRef: 'synthetic-review-only', contextKey: 'review-visible', budgetRevision: B.revision,
      streams: { geolocation: true, motion } },
    sink(event) { events.push(event); return sink?.(event, f); },
  });
  return f;
}
const fix = () => ({ timestamp: EPOCH, coords: { latitude: 12, longitude: -65, accuracy: 8 } });

test('B1 throttled 60Hz motion does not spend the useful-work callback budget', async t => {
  const f = setup({ budget: { maxCallbacksPerStream: 8 } }); t.after(() => f.a.stop());
  f.start(); const pending = f.a.acquireMotion(); f.prompts[0].resolve('granted');
  assert.equal((await pending).ok, true);
  for (let i = 0; i < 120; i++) { f.advance(1000 / 60); f.platform.fire('devicemotion', { timeStamp: i }); }
  assert.equal(f.platform.count('devicemotion'), 1);
  assert.ok(f.events.filter(e => e.type === 'motion').length >= 2);
});

test('B3 repeated blocked requests leave useful GPS alive under a small valid cap', async t => {
  const f = setup({ budget: { maxEvents: 10 }, motion: false }); t.after(() => f.a.stop());
  f.start(); assert.equal(f.a.acquireLocation({ watch: true }).ok, true);
  for (let i = 0; i < 100; i++) assert.equal((await f.a.acquireMotion()).ok, false);
  assert.equal(f.a.snapshot().state, 'started');
  f.calls[0].success(fix()); assert.equal(f.last('geolocation').data.accuracyM, 8);
});

test('S2 code1 plus a fresh prompt status permits an explicit retry without inventing a grant', async t => {
  const f = setup(); t.after(() => f.a.stop()); f.statuses.geolocation.state = 'prompt';
  f.start(); f.a.acquireLocation(); await settle(); f.calls[0].failure({ code: 1 }); await settle();
  assert.notEqual(f.a.snapshot().permission.geolocation.state, 'granted');
  assert.equal(f.a.acquireLocation().ok, true);
});

test('S2 positive control: browser-confirmed denial remains blocked', async t => {
  const f = setup(); t.after(() => f.a.stop()); f.start(); f.a.acquireLocation(); await settle();
  f.statuses.geolocation.state = 'denied'; f.statuses.geolocation.fire('change');
  assert.equal(f.a.acquireLocation().ok, false);
  assert.equal(f.a.snapshot().permission.geolocation.state, 'revoked');
});

test('S3 GPS permission wait is excluded from the acquisition timeout', t => {
  const f = setup(); t.after(() => f.a.stop()); f.statuses.geolocation.state = 'prompt';
  f.start(); f.a.acquireLocation(); f.advance(B.requestTimeoutMs + 1); f.fireTimers(B.requestTimeoutMs);
  f.calls[0].success(fix());
  assert.equal(f.last('geolocation')?.data.accuracyM, 8);
  assert.equal(f.a.snapshot().summary.requests, 1);
});

test('S3 motion grant after the acquisition timeout still attaches within the session', async t => {
  const f = setup(); t.after(() => f.a.stop()); f.start(); const pending = f.a.acquireMotion();
  f.advance(B.requestTimeoutMs + 1); f.fireTimers(B.requestTimeoutMs); f.prompts[0].resolve('granted');
  assert.equal((await pending).ok, true);
  assert.equal(f.platform.count('devicemotion'), 1);
});

test('S3 positive control: session expiry still rejects a pending motion grant', async t => {
  const f = setup(); t.after(() => f.a.stop()); f.start(); const pending = f.a.acquireMotion();
  f.advance(B.maxSessionMs); f.prompts[0].resolve('granted');
  assert.equal((await pending).ok, false);
  assert.equal(f.platform.count('devicemotion'), 0);
});

test('S4 GPS budget-stop stream uses public geolocation spelling', t => {
  const f = setup({ budget: { maxCallbacksPerStream: 1 } }); t.after(() => f.a.stop());
  f.start(); f.a.acquireLocation({ watch: true }); f.calls[0].success(fix());
  f.advance(B.minEmitIntervalMs); f.calls[0].success(fix());
  assert.equal(f.last('stream-stopped').data.stream, 'geolocation');
});

test('S5 synchronous denial returns failed acquisition', t => {
  const f = setup({ prepare(f) { f.geo.getCurrentPosition = (_ok, fail) => fail({ code: 1 }); } });
  t.after(() => f.a.stop()); f.start(); assert.equal(f.a.acquireLocation().ok, false);
});

test('S8 sink cancellation is attributed to cancellation rather than a stopped session', async t => {
  const f = setup({ sink(event, f) { if (event.type === 'acquisition-request') f.a.stopMotion(); } });
  t.after(() => f.a.stop()); f.start(); const answer = await f.a.acquireMotion();
  assert.equal(f.a.snapshot().state, 'started');
  assert.equal(answer.ok, false); assert.match(answer.reason, /cancel|obsolete/);
  assert.equal(f.prompts.length, 0);
});

test('S8 a regressed request clock is attributed to clock uncertainty rather than timeout', async t => {
  const f = setup(); t.after(() => f.a.stop()); f.start(); f.advance(900);
  const pending = f.a.acquireMotion(); f.advance(-1); f.prompts[0].resolve('granted');
  const answer = await pending;
  assert.equal(answer.ok, false); assert.equal(f.platform.count('devicemotion'), 0);
  const reasons = [answer.reason, f.a.snapshot().stopReason,
    f.last('acquisition-error')?.data.reason, f.last('acquisition-timeout')?.data.reason].join(' ');
  assert.match(reasons, /clock/);
});

test('S9 synchronous native callbacks flush the sink after native watch assignment settles', t => {
  let inNative = false, observedInsideNative = false;
  const f = setup({ prepare(f) {
    f.geo.watchPosition = (success) => { inNative = true; success(fix()); inNative = false; return 42; };
  }, sink(event) { if (event.type === 'geolocation') observedInsideNative ||= inNative; } });
  t.after(() => f.a.stop()); f.start(); assert.equal(f.a.acquireLocation({ watch: true }).ok, true);
  assert.equal(f.last('geolocation').data.accuracyM, 8);
  assert.equal(observedInsideNative, false);
});
