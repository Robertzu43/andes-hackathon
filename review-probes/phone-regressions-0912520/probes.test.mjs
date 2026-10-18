// Independent Q52 public-export counterexamples for Robert5560875615; original six probes retained separately.
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


// Every fixture is detached and synthetic. No real qualification, stream or provider is enabled.
test('Q52 N01 late after-error prompt cannot cancel an explicitly retried native watch',async()=>{
 const f=setup(),late=deferred();let queries=0;
 f.p.navigator.permissions.query=()=>++queries===1?Promise.resolve(f.statuses.geolocation):late.promise;
 f.start();f.a.acquireLocation();await settle();f.locations[0].error({code:1});
 const retried=f.a.withUserGesture(event(f),()=>f.a.acquireLocation({watch:true}));assert.equal(retried.ok,true);assert.equal(f.nativeWatches.size,1);
 late.resolve(Object.assign(new Target(),{state:'prompt'}));await settle();
 const watch=f.locations.at(-1);watch.success(fix());
 assert.equal(f.nativeWatches.size,1,'successful explicit retry lost native watch after stale query');
 assert.equal(f.events.filter(e=>e.type==='geolocation').length,1,'retried watch must deliver its fix');clean(f);
});
test('Q52 N02 stopping location intent before suspension cannot forget revoked permission',async()=>{
 const f=setup();f.start();f.a.acquireLocation({watch:true});await settle();
 f.statuses.geolocation.state='denied';f.statuses.geolocation.fire('change');
 assert.equal(f.a.snapshot().permission.geolocation.state,'revoked');f.a.stopLocation();f.p.fire('pagehide');
 const before=f.locations.length;await f.a.resume();const result=f.a.acquireLocation({watch:true});
 assert.equal(result.ok,false,'new acquisition bypassed revoked permission after location-only stop');
 assert.equal(f.locations.length,before,'revoked stream reached native GPS');clean(f);
});
test('Q52 N03 unavailable wake-lock requests preserve useful GPS evidence with bounded diagnostics',async()=>{
 const f=setup();f.start();f.a.acquireLocation({watch:true});f.locations.at(-1).success(fix());
 const before=f.a.snapshot().summary.emitted;
 for(let i=0;i<1000;i++)assert.equal((await f.a.requestWakeLock()).ok,false);
 const s=f.a.snapshot();assert.equal(s.events.filter(e=>e.type==='geolocation').length,1,'unsupported wake lock evicted GPS fix');
 assert.ok(s.summary.emitted-before<=B.maxRequests+2,'one unavailable API created unbounded diagnostic work');clean(f);
});
test('Q52 N04 explicit stop publishes a terminal update after a resumable suspension',()=>{
 const f=setup();f.start();f.a.acquireLocation({watch:true});f.p.fire('pagehide');
 assert.equal(f.last('session-stop').data.resumable,true);f.a.stop();
 assert.equal(f.a.snapshot().stopReason,'explicit-stop');assert.equal(f.last('session-stop').data.resumable,false,'sink still advertises resumability after user stop');
 assert.equal(f.last('session-stop').data.reason,'explicit-stop');clean(f);
});
test('Q52 N05 factory start reported failed during wake-lock callback cannot remain resumable',async()=>{
 const f=setup();let c,suspended=false;
 c=tripCapture({...options(f),sink(e){f.events.push(e);if(!suspended&&e.type==='wake-lock'&&e.data.state==='unavailable'){suspended=true;f.p.fire('pagehide');}}});
 const started=c.startSharing(event(f));assert.equal(started.ok,false);assert.equal(started.reason,'session-stopped');
 const before=f.locations.length;const resumed=await c.resumeSharing(event(f));
 assert.equal(resumed.ok,false,'failed start remained resumable');assert.equal(f.locations.length,before,'failed start resumed native GPS');c.stopSharing();
});
test('Q52 N06 GPS code1 retry latch does not block independent visible-screen wake lock',async()=>{
 const f=setup();let calls=0;const lock=Object.assign(new Target(),{released:false,release(){return Promise.resolve();}});
 f.p.navigator.wakeLock={request(){calls++;return Promise.resolve(lock);}};
 f.start();f.a.acquireLocation();await settle();f.locations[0].error({code:1});await settle();
 f.p.navigator.userActivation.isActive=false;const result=await f.a.requestWakeLock();
 assert.equal(calls,1,'geolocation gesture latch incorrectly blocks wake-lock API');assert.equal(result.ok,true);clean(f);
});
test('Q52 N07 suspended host withdrawal updates terminal reason and sink resumability',()=>{
 const f=setup();f.start();f.a.acquireLocation({watch:true});f.p.fire('pagehide');f.a.revokeConsent();
 assert.equal(f.a.snapshot().stopReason,'consent-revoked','suspended revocation retained resumable reason');
 assert.equal(f.last('session-stop').data.resumable,false,'sink still advertises resumability after consent withdrawal');clean(f);
});

test('Q52 C01 ordinary qualified synthetic watch emits one fix and live revocation blocks GPS',async()=>{
 const f=setup();f.start();assert.equal(f.a.acquireLocation({watch:true}).ok,true);await settle();
 f.locations.at(-1).success(fix());assert.equal(f.nativeWatches.size,1);assert.equal(f.events.filter(e=>e.type==='geolocation').length,1);
 f.statuses.geolocation.state='denied';f.statuses.geolocation.fire('change');assert.equal(f.nativeWatches.size,0);
 assert.equal(f.a.acquireLocation({watch:true}).ok,false);assert.equal(f.locations.length,1);clean(f);
});
test('Q52 C02 unavailable geolocation already coalesces diagnostic-only work without spending native budget',()=>{
 const f=setup();delete f.p.navigator.geolocation;f.start();const before=f.a.snapshot().summary.emitted;
 for(let i=0;i<1000;i++)assert.equal(f.a.acquireLocation().ok,false);
 const s=f.a.snapshot();assert.ok(s.summary.emitted-before<=2);assert.equal(s.summary.requests,0);clean(f);
});
test('Q52 C03 explicit stop while active publishes nonresumable terminal evidence',async()=>{
 const f=setup();f.start();f.a.acquireLocation({watch:true});f.a.stop();
 assert.equal(f.last('session-stop').data.resumable,false);assert.equal(f.last('session-stop').data.reason,'explicit-stop');
 assert.equal((await f.a.resume()).ok,false);assert.equal(f.nativeWatches.size,0);clean(f);
});
test('Q52 C04 active host withdrawal purges precise coordinates and blocks resume',async()=>{
 const f=setup();f.start();f.a.acquireLocation({watch:true,preciseConsent:{granted:true,purpose:'review',reference:'synthetic-consent'}});f.locations.at(-1).success(fix());
 assert.ok(f.a.snapshot().events.find(e=>e.type==='geolocation').data.coordinates);f.a.revokeConsent();
 assert.equal(f.a.snapshot().events.find(e=>e.type==='geolocation').data.coordinates,null);
 assert.equal(f.last('session-stop').data.resumable,false);assert.equal(f.a.snapshot().stopReason,'consent-revoked');
 assert.equal((await f.a.resume()).ok,false);clean(f);
});
