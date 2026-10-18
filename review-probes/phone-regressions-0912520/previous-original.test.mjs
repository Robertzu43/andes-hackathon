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

test('Q52 R01 factory explicit stop while suspended prevents a trusted resume',async()=>{
 const f=setup(),c=tripCapture(options(f));assert.equal(c.startSharing().ok,true);
 f.doc.visibilityState='hidden';f.doc.fire('visibilitychange');c.stopSharing();f.doc.visibilityState='visible';
 const before=f.locations.length;const resume=await c.resumeSharing(event(f));assert.equal(resume.ok,false);assert.equal(f.locations.length,before);assert.equal(c.snapshot().stopReason,'explicit-stop');c.stopSharing();
});
test('Q52 R02 revocation during wake-lock delivery cannot report successful gesture start or retain late lock',async()=>{
 const f=setup(),pending=deferred();let c,released=0;
 delete f.p.navigator.userActivation;
 f.p.navigator.wakeLock={request:()=>pending.promise};
 f.geo.watchPosition=(success)=>{success(fix());return 99;};
 c=tripCapture({...options(f),sink(e){if(e.type==='wake-lock'&&e.data.state==='requested')c.revokeConsent();}});
 const result=c.startSharing(event(f));assert.equal(result.ok,false);assert.equal(c.snapshot().state,'stopped');
 assert.ok(c.snapshot().events.filter(e=>e.type==='geolocation').every(e=>e.data.coordinates===null));
 const sentinel=Object.assign(new Target(),{released:false,release(){released++;return Promise.resolve();}});
 pending.resolve(sentinel);assert.equal((await result.wakeLock).ok,false);await settle();assert.equal(released,1);assert.equal((await c.resumeSharing(event(f))).ok,false);c.stopSharing();
});
test('Q52 R03 site grant does not permit passive retry after native code1; explicit useful retry releases the latch',async()=>{
 const f=setup();let calls=0;
 f.geo.getCurrentPosition=(ok,fail)=>{calls++;if(calls===1)fail({code:1});else ok(fix());};
 f.start();assert.equal(f.a.acquireLocation().ok,false);await settle();f.p.navigator.userActivation.isActive=false;
 for(let n=0;n<100;n++)assert.equal(f.a.acquireLocation().ok,false);
 assert.equal(calls,1);assert.equal(f.a.snapshot().summary.requests,1);
 const motion=f.a.withUserGesture(event(f),()=>f.a.acquireMotion());f.motions[0].resolve('granted');assert.equal((await motion).ok,true);
 assert.equal(f.a.withUserGesture(event(f),()=>f.a.acquireLocation()).ok,true);assert.equal(f.a.snapshot().locationNeedsGesture,false);
 assert.equal(f.a.acquireLocation().ok,true);assert.equal(calls,3);assert.equal(f.a.snapshot().summary.requests,4);clean(f);
});
test('Q52 R04 optional motion denial permits useful GPS resume while host withdrawal remains terminal',async()=>{
 const f=setup();f.start();f.a.acquireLocation({watch:true});const m=f.a.acquireMotion();f.motions[0].resolve('denied');await m;
 f.p.fire('pagehide');const resumed=await f.a.resume();assert.equal(resumed.ok,true);assert.equal(resumed.location.ok,true);assert.equal(resumed.motion.ok,false);assert.equal(f.motions.length,1);
 f.locations.at(-1).success(fix());assert.equal(f.last('geolocation').data.accuracyM,8);
 f.p.fire('pagehide');f.a.revokeConsent();const before=f.locations.length;assert.equal((await f.a.resume()).ok,false);assert.equal(f.locations.length,before);clean(f);
});
test('Q52 R05 no drain or flush delegation survives pending, failed or completed withdrawal',async()=>{
 const f=setup(),deleting=deferred();let drains=0,flushes=0;
 const pipeline={sink(){},drain(){drains++;return Promise.resolve();},flush(){flushes++;return Promise.resolve();},revokeTrip(){return deleting.promise;},tripStatus(){return Promise.resolve({});}};
 const c=queuedCapture({...options(f),pipeline});await c.drain();await c.flush();assert.deepEqual([drains,flushes],[1,1]);
 c.startSharing();const result=c.revokeConsent();assert.equal((await c.drain()).ok,false);assert.equal((await c.flush()).ok,false);
 deleting.reject(new Error('synthetic-deletion-failure'));await result;assert.equal((await c.drain()).ok,false);assert.equal(c.snapshot().queueWithdrawal,'failed');
 pipeline.revokeTrip=()=>({ok:true});await c.revokeConsent();assert.equal(c.snapshot().queueWithdrawal,'complete');assert.equal((await c.drain()).ok,false);assert.equal((await c.flush()).ok,false);
 assert.equal(c.startSharing().ok,false);assert.equal((await c.resumeSharing()).ok,false);assert.deepEqual([drains,flushes],[1,1]);
});
test('Q52 R06 identical trip templates recreate and resume with independent session/event identities',async()=>{
 const sessions=new Set(),events=new Set();
 for(let n=0;n<4;n++){
  const f=setup(),c=tripCapture(options(f));assert.equal(c.startSharing().ok,true);let s=c.snapshot();assert.notEqual(s.sessionId,trip.sessionId);assert.equal(s.events[0].tripId,trip.tripId);
  assert.equal(sessions.has(s.sessionId),false);sessions.add(s.sessionId);const id=s.events[0].eventId;assert.equal(events.has(id),false);events.add(id);
  f.p.fire('pagehide');assert.equal((await c.resumeSharing()).ok,true);s=c.snapshot();assert.equal(sessions.has(s.sessionId),false);sessions.add(s.sessionId);assert.equal(events.has(s.events[0].eventId),false);events.add(s.events[0].eventId);assert.equal(s.events[0].tripId,trip.tripId);c.stopSharing();
 }
 assert.equal(sessions.size,8);assert.equal(events.size,8);
});
