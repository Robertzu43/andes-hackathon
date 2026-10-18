// Lifecycle v2: L11 timer-unavailable and L12 ambiguous code1 unknown; v1 preserved.
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

// Independent synthetic cases. No device APIs, real timers, network or DB.
const {createTripPhoneObservations} = await import(pathToFileURL(`${root}/src/phone-observations/trip-sharing.mjs`));
const results = [];
async function check(id, expected, run) {
  let actual, passed = false;
  try { actual = await run(); assert.deepEqual(actual, expected); passed = true; }
  catch (error) { if (actual === undefined) actual = {unexpectedError: error.name}; }
  results.push({id, passed, actual, expected});
}
const precise = {granted:true,purpose:'review-only',reference:'review-consent'};
const preciseCount = s => s.events.filter(e => e.data?.coordinates?.latitude != null).length;
function tripFixture() {
  const f = setup();
  f.c = createTripPhoneObservations({...f.options,
    trip:{tripId:'review-trip',sessionId:'review-session',revision:'review-4aca76c'},
    reviewedContext:{key:f.options.contextKey,qualification:f.options.qualification,budget:f.options.budget},
    locationConsent:{granted:true,tripId:'review-trip',reference:'review-consent'}});
  return f;
}
async function beginTrip(f) {
  const start = f.c.startSharing(); await start.wakeLock; await settle();
  f.locations[0].success(fix());
}
function suspend(f) {f.doc.visibilityState='hidden';f.doc.fire('visibilitychange');f.doc.visibilityState='visible';}

await check('L01 reserved terminal slot at event cap', {state:'stopped',stops:1,emitted:3,nativeCalls:0,timers:0}, () => {
  const f=setup({budget:{maxEvents:2}});f.start();f.a.acquireLocation();const s=f.a.snapshot();
  const actual={state:s.state,stops:s.events.filter(e=>e.type==='session-stop').length,emitted:s.summary.emitted,nativeCalls:f.locations.length,timers:f.timers.size};clean(f);return actual;
});
await check('L02 reentrant sink stop delivers once without nested sink', {stops:1,maxDepth:1,nativeCalls:0}, () => {
  let depth=0,maxDepth=0;
  const f=setup({sink(e,f){depth++;maxDepth=Math.max(maxDepth,depth);if(e.type==='acquisition-request')f.a.stop();depth--;}});
  f.start();f.a.acquireLocation();const actual={stops:f.events.filter(e=>e.type==='session-stop').length,maxDepth,nativeCalls:f.locations.length};clean(f);return actual;
});
await check('L03 explicit resume with retained trip consent; stale callbacks stay inert', {ok:true,calls:2,staleIgnored:true,newPrecise:1}, async () => {
  const f=tripFixture();await beginTrip(f);const old=f.locations[0];suspend(f);const result=await f.c.resumeSharing();
  const n=f.events.length;old.success(fix());const staleIgnored=f.events.length===n;f.locations[1]?.success(fix());
  const actual={ok:result.ok,calls:f.locations.length,staleIgnored,newPrecise:preciseCount(f.c.snapshot())};f.c.stopSharing();return actual;
});
await check('L04 withdrawal while suspended must prevent precise resume', {ok:false,calls:1,newPrecise:0}, async () => {
  const f=tripFixture();await beginTrip(f);suspend(f);f.c.revokeConsent();const result=await f.c.resumeSharing();
  f.locations[1]?.success(fix());const actual={ok:result.ok,calls:f.locations.length,newPrecise:f.locations.length>1?preciseCount(f.c.snapshot()):0};f.c.stopSharing();return actual;
});
await check('L05 active withdrawal purges adapter-owned precise buffer', {before:1,after:0,state:'stopped'}, () => {
  const f=setup();f.start();f.a.acquireLocation({watch:true,preciseConsent:precise});f.locations[0].success(fix());
  const before=preciseCount(f.a.snapshot());f.a.revokeConsent();const s=f.a.snapshot();const actual={before,after:preciseCount(s),state:s.state};clean(f);return actual;
});
await check('L06 withdrawal after explicit stop still purges precise buffer', {before:1,after:0}, async () => {
  const f=tripFixture();await beginTrip(f);f.c.stopSharing();const before=preciseCount(f.c.snapshot());f.c.revokeConsent();return {before,after:preciseCount(f.c.snapshot())};
});
await check('L07 inherited global alias cannot enable synthetic hardware with default clock', {nativeCalls:0,accepted:false}, () => {
  const f=setup();const values={document:f.doc,navigator:f.p.navigator,isSecureContext:true,DeviceMotionEvent:f.p.DeviceMotionEvent,
    addEventListener:f.p.addEventListener.bind(f.p),removeEventListener:f.p.removeEventListener.bind(f.p),setTimeout:f.p.setTimeout,clearTimeout:f.p.clearTimeout};
  const saved=new Map(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let a,accepted=false;
  try {
    // Node-only fake browser globals: all acquisition functions are inert spies.
    for(const [k,v] of Object.entries(values))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
    const options={...f.options,platform:Object.create(globalThis)};delete options.clock;
    try {a=create(options);a.start({sessionId:'alias-review',tripId:'review-trip',revision:'review-4aca76c'});accepted=a.acquireLocation().ok;}catch{}
    return {nativeCalls:f.locations.length,accepted};
  } finally {a?.stop();for(const [k,v] of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}}
});
await check('L08 transient error flood is throttled; useful fix survives', {errors:1,suppressed:999,fixes:1,state:'started'}, () => {
  const f=setup();f.start();f.a.acquireLocation({watch:true});for(let i=0;i<1000;i++)f.locations[0].error({code:2});
  f.advance(1000);f.locations[0].success(fix());const s=f.a.snapshot();const actual={errors:f.events.filter(e=>e.type==='geolocation-error').length,suppressed:s.summary.suppressedErrors,fixes:f.events.filter(e=>e.type==='geolocation').length,state:s.state};clean(f);return actual;
});
await check('L09 blocked diagnostic flood must not exhaust active GPS ordinary budget', {state:'started',watches:1}, async () => {
  const f=setup({budget:{maxEvents:10}});f.options.qualification.streams.motion=false;f.a=create(f.options);f.start();f.a.acquireLocation({watch:true});
  for(let i=0;i<50;i++)await f.a.acquireMotion();const actual={state:f.a.snapshot().state,watches:f.nativeWatches.size};clean(f);return actual;
});
await check('L10 default motion stays subscribed for simulated30s at60Hz', {state:'started',listeners:1,callbacks:1800}, async () => {
  const f=setup();f.start();await enableMotion(f);for(let i=0;i<1800;i++){f.advance(1000/60);f.p.fire('devicemotion',{timeStamp:i*1000/60,acceleration:{x:1,y:2,z:3}});}
  const actual={state:f.a.snapshot().state,listeners:f.p.count('devicemotion'),callbacks:f.a.snapshot().summary.callbacks.motion};clean(f);return actual;
});
await check('L11 throwing motion timer must return attributed failure without sync throw', {threw:false,reason:'timer-unavailable'}, async () => {
  const f=setup();f.start();f.p.setTimeout=()=>{throw new Error('synthetic-timer-fault');};let threw=false,answer;
  try {answer=await f.a.acquireMotion();}catch{threw=true;}const actual={threw,reason:answer?.reason??null};clean(f);return actual;
});
await check('L12 synchronous GPS denial must not report successful acquisition', {ok:false,permission:'unknown'}, () => {
  const f=setup();f.geo.getCurrentPosition=(_ok,fail)=>fail({code:1});f.start();const result=f.a.acquireLocation();
  const actual={ok:result.ok,permission:f.a.snapshot().permission.geolocation.state};clean(f);return actual;
});
await check('L13 permission monitor fulfilment fault must not become unhandled rejection', {unhandled:0}, async () => {
  const f=setup();let unhandled=0;const handler=()=>{unhandled++;};process.on('unhandledRejection',handler);
  f.statuses.geolocation.addEventListener=()=>{throw new Error('synthetic-monitor-fault');};
  try{f.start();f.a.acquireLocation();await settle();await settle();return {unhandled};}
  finally{clean(f);process.removeListener('unhandledRejection',handler);}
});
await check('L14 wake-lock grant after stop is released', {ok:false,released:1,timers:0}, async () => {
  const f=setup(),d=deferred();let released=0;const sentinel=Object.assign(new Target(),{released:false,release(){released++;}});
  f.p.navigator.wakeLock={request:()=>d.promise};f.start();const p=f.a.requestWakeLock();f.a.stop();d.resolve(sentinel);const result=await p;await settle();
  const actual={ok:result.ok,released,timers:f.timers.size};clean(f);return actual;
});
await check('L15 delayed wake-lock answer at inclusive request deadline is released', {ok:false,released:1}, async () => {
  const f=setup(),d=deferred();let released=0;const sentinel=Object.assign(new Target(),{released:false,release(){released++;}});
  f.p.navigator.wakeLock={request:()=>d.promise};f.start();const p=f.a.requestWakeLock();f.advance(B.requestTimeoutMs);d.resolve(sentinel);const result=await p;await settle();
  const actual={ok:result.ok,released};clean(f);return actual;
});
await check('L16 legacy gesture bridge stays synchronous and rejects fabricated dispatch', {without:'user-gesture-required',sync:true,async:'user-gesture-required',untrusted:'trusted-dispatch-required'}, async () => {
  const f=setup();delete f.p.navigator.userActivation;f.p.navigator.permissions.query=()=>new Promise(()=>{});class SyntheticEvent{};f.p.Event=SyntheticEvent;
  const event=Object.assign(new SyntheticEvent(),{type:'click',isTrusted:true,currentTarget:{},eventPhase:2});
  f.start();const without=f.a.acquireLocation().reason;const sync=f.a.withUserGesture(event,()=>f.a.acquireLocation()).ok;f.a.stopLocation();
  const asyncResult=await f.a.withUserGesture(event,()=>Promise.resolve().then(()=>f.a.acquireLocation()));
  const untrusted=f.a.withUserGesture({...event,isTrusted:false},()=>f.a.acquireLocation()).reason;
  const actual={without,sync,async:asyncResult.reason,untrusted};clean(f);return actual;
});
console.log(JSON.stringify({candidate:'9f87e2c08be8ac9e9324136fd0c4401ad8823bc6',kind:'synthetic-review-controls',results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length},null,2));
process.exitCode=results.some(r=>!r.passed)?1:0;
