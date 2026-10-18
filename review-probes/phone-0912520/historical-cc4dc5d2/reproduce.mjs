// Run from an immutable cc4dc5d2 archive; synthetic platform only, no device APIs.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = process.env.ANDES_CANDIDATE_DIR ?? process.cwd();
const { createPhoneObservationAdapter: create, PROVISIONAL_BUDGET: B, QUALIFICATION_SCHEMA: Q } =
  await import(pathToFileURL(`${root}/src/phone-observations/adapter.mjs`));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture({ sink, budget = {} } = {}) {
  let mono = 100, next = 0, listenerCount = 0;
  const calls = [], events = [], timers = new Set(), query = deferred(), motion = deferred();
  const p = {
    isSecureContext: true, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    navigator: { userActivation: { isActive: true }, permissions: { query: () => query.promise }, geolocation: {
      getCurrentPosition(ok, fail, opts) { calls.push({ ok, fail, opts }); },
      watchPosition(ok, fail, opts) { calls.push({ ok, fail, opts }); return 42; }, clearWatch() {},
    } },
    DeviceMotionEvent: { requestPermission: () => motion.promise },
    addEventListener(name) { if (name === 'devicemotion') listenerCount++; },
    removeEventListener(name) { if (name === 'devicemotion') listenerCount--; },
    setTimeout() { const id = ++next; timers.add(id); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  const f = { calls, events, timers, query, motion, advance(ms) { mono += ms; }, listeners: () => listenerCount };
  f.a = create({ platform: p, clock: { now: () => ({ wallMs: 1800000000000 + mono, monoMs: mono }) },
    sink(event) { events.push(event); sink?.(event, f); }, mode: 'synthetic-test', contextKey: 'synthetic',
    qualification: { schema: Q, kind: 'synthetic-fixture', disposition: 'qualified', evidenceRef: 'review-only',
      contextKey: 'synthetic', budgetRevision: B.revision, streams: { geolocation: true, motion: true } },
    budget: { ...B, ...budget } });
  f.a.start({ sessionId: 'synthetic-session', tripId: 'synthetic-trip', revision: 'cc4dc5d2' });
  return f;
}
const results = [];
function check(id, actual, expected) {
  let passed = true;
  try { assert.deepEqual(actual, expected); } catch { passed = false; }
  results.push({ id, passed, actual, expected });
}
const f1 = fixture({ sink(e, f) { if (e.type === 'acquisition-request') f.a.stopLocation(); } });
f1.a.acquireLocation(); f1.a.stop();
check('F1', { nativeCalls: f1.calls.length, timersAfterStop: f1.timers.size }, { nativeCalls: 0, timersAfterStop: 0 });
const f2 = fixture(); const pending = f2.a.acquireMotion();
f2.advance(B.maxSessionMs + 1); f2.motion.resolve('granted'); const answer = await pending;
check('F2', { ok: answer.ok, listeners: f2.listeners() }, { ok: false, listeners: 0 }); f2.a.stop();
const f3 = fixture(); f3.a.acquireLocation(); f3.calls[0].fail({ code: 1 });
f3.query.resolve({ state: 'granted' }); await new Promise(r => setImmediate(r));
check('F3', { permission: f3.a.snapshot().permission.geolocation.state, retry: f3.a.acquireLocation().ok },
  { permission: 'denied', retry: false }); f3.a.stop();
const f4 = fixture({ budget: { bufferCapacity: 1, maximumAgeMs: 12345, requestTimeoutMs: 23456 } });
f4.a.acquireLocation({ watch: true }); f4.calls[0].fail({ code: 2 });
check('F4', f4.a.snapshot().events[0].data.options ?? null,
  { enableHighAccuracy: false, maximumAge: 12345, timeout: 23456 }); f4.a.stop();
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
