// Independent Q52 review controls for Robert5560757444; prior fixtures retained.
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


const {createTripPhoneObservations: tripCapture,createQueuedTripPhoneObservations: queuedCapture}=await import(pathToFileURL(`${root}/src/phone-observations/trip-sharing.mjs`));
const trip={sessionId:'legacy-template',tripId:'review-trip',revision:'review-091'};
function event(f){class TrustedFixtureEvent{};f.p.Event=TrustedFixtureEvent;return Object.assign(new TrustedFixtureEvent(),{type:'click',isTrusted:true,currentTarget:{},eventPhase:2});}
function options(f){return {...f.options,trip,reviewedContext:{key:f.options.contextKey,qualification:f.options.qualification,budget:f.options.budget},locationConsent:{granted:true,tripId:trip.tripId,reference:'review-consent'}};}


// Versioned independent additions. Original R05 and its current red output are retained unchanged.
test('Q52 D01 completed withdrawal permits global drain but never this trip capture or flush',async()=>{
 const f=setup(),deleting=deferred();let drains=0,flushes=0;
 const pipeline={sink(){},drain(){drains++;return Promise.resolve({ok:true,scope:'global'});},flush(){flushes++;return Promise.resolve({ok:true});},revokeTrip(){return deleting.promise;},tripStatus(){return Promise.resolve({});}};
 const c=queuedCapture({...options(f),pipeline});assert.equal((await c.drain()).ok,true);await c.flush();assert.equal(c.startSharing().ok,true);
 const revoked=c.revokeConsent();assert.equal((await c.drain()).ok,false);assert.equal((await c.flush()).ok,false);assert.deepEqual([drains,flushes],[1,1]);
 deleting.reject(new Error('synthetic-wipe-failure'));await revoked;assert.equal(c.snapshot().queueWithdrawal,'failed');assert.equal((await c.drain()).ok,false);
 pipeline.revokeTrip=()=>({ok:true});assert.equal((await c.revokeConsent()).ok,true);assert.equal(c.snapshot().queueWithdrawal,'complete');
 assert.deepEqual(await c.drain(),{ok:true,scope:'global'});assert.equal((await c.flush()).ok,false);assert.equal(c.startSharing().ok,false);assert.equal((await c.resumeSharing()).ok,false);assert.deepEqual([drains,flushes],[2,1]);
});
test('Q52 D02 resumed location result settles after a sink stops the synchronously successful watch',async()=>{
 let onResume=false;const f=setup({sink(e,f){if(onResume&&e.type==='geolocation')f.a.stop();}});
 const native=f.geo.watchPosition;
 f.geo.watchPosition=(success,error,options)=>{const id=native(success,error,options);success(fix());return id;};
 f.start();assert.equal(f.a.acquireLocation({watch:true}).ok,true);f.p.fire('pagehide');onResume=true;
 const result=await f.a.resume();assert.equal(result.ok,false);assert.equal(result.location.ok,false,'per-stream result must not claim a live watch after sink stop');assert.equal(f.nativeWatches.size,0);clean(f);
});
test('Q52 D03 complete exported budget constructs; old incomplete copies fail explicitly',()=>{
 const f=setup();assert.equal(f.a.snapshot().state,'idle');
 for(const key of ['permissionPromptTimeoutMs','maxRawCallbacksPerStream']){const budget={...B};delete budget[key];assert.throws(()=>create({...f.options,budget}),RangeError);}
 clean(f);
});
