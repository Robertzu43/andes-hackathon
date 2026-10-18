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


test('V01 older passive grant cannot promote ambiguous code1 while fresh query is pending', async () => {
 const old=deferred(), fresh=deferred();let queries=0;
 const f=setup({prepare(f){f.p.navigator.permissions.query=()=>++queries===1?old.promise:fresh.promise;}});
 f.start();f.a.acquireLocation();f.locations[0].error({code:1});old.resolve(f.statuses.geolocation);await settle();
 assert.equal(f.a.snapshot().permission.geolocation.state,'unknown');
 fresh.resolve({state:'prompt'});await settle();assert.equal(f.a.snapshot().permission.geolocation.state,'prompt');
 f.a.acquireLocation();assert.equal(f.locations.length,2);clean(f);
});
test('V02 fresh grant starts inclusive acquisition deadline; delayed timers cannot accept late result', async()=>{
 const f=setup();f.start();f.a.acquireLocation();await settle();
 f.advance(B.requestTimeoutMs);f.locations[0].success(fix());
 assert.equal(f.last('geolocation'),undefined);assert.equal(f.last('acquisition-timeout').data.reason,'acquisition-timeout');clean(f);
});
test('V03 delayed timers cannot accept result at prompt deadline',()=>{
 const f=setup({prepare(f){f.p.navigator.permissions.query=()=>new Promise(()=>{});}});
 f.start();f.a.acquireLocation();f.advance(B.permissionPromptTimeoutMs);f.locations[0].success(fix());
 assert.equal(f.last('geolocation'),undefined);assert.equal(f.last('acquisition-timeout').data.reason,'permission-prompt-timeout');clean(f);
});
test('V04 prompt longer than acquisition budget remains useful before grant',()=>{
 const f=setup({prepare(f){f.p.navigator.permissions.query=()=>new Promise(()=>{});}});
 f.start();f.a.acquireLocation();f.advance(B.requestTimeoutMs+1);f.locations[0].success(fix());
 assert.equal(f.last('geolocation').data.accuracyM,8);clean(f);
});
test('V05 withdrawal purges queued precise callbacks even after buffer eviction',()=>{
 let received=0; const f=setup({budget:{bufferCapacity:1}, prepare(f){
   f.geo.watchPosition=(success)=>{ for(let i=0;i<3;i++){f.advance(1000);success(fix());} return 99; };
 },sink(e,f){if(e.type==='geolocation'&&++received===1)f.a.revokeConsent();}});
 f.start();f.a.acquireLocation({watch:true,preciseConsent:{granted:true,purpose:'review',reference:'review-consent'}});
 const after=f.events.filter(e=>e.type==='geolocation').slice(1);
 console.log('V05 delivery-after-withdrawal',JSON.stringify(after.map(e=>({coordinates:e.data.coordinates,redaction:e.data.redaction}))));
 assert.equal(after.length,2);assert.ok(after.every(e=>e.data.coordinates===null),'queued callbacks after withdrawal must contain no precise coordinates');
 clean(f);
});
