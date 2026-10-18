import assert from 'node:assert/strict';
import test from 'node:test';
import { startContactPresence } from '../../src/features/contacts/presence.ts';
import { createApiClient, MemorySession } from '../../src/lib/api/index.ts';
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
class Page extends EventTarget {
  visibilityState='visible';
  listeners=0;
  addEventListener(...args){this.listeners++;super.addEventListener(...args);}
  removeEventListener(...args){this.listeners--;super.removeEventListener(...args);}
  hide(){this.visibilityState='hidden';this.dispatchEvent(new Event('visibilitychange'));}
  show(){this.visibilityState='visible';this.dispatchEvent(new Event('visibilitychange'));}
}
function setup(t,refreshStatus,navigator={}) {
  t.mock.timers.enable({apis:['setTimeout']}); const document=new Page(); let suspends=0;
  const stop=startContactPresence({refreshStatus,suspend(){suspends++;},document,navigator}); t.after(stop);
  return {document,stop,suspends:()=>suspends};
}
// Catches delayed first read, drift from 5000ms, overlap, and issuing writes from a presence loop.
test('presence_polls_and_retires',async t=>{
  const session=new MemorySession(); session.setCredentials({issuer:'test',subject:'family',accessToken:'synthetic',expiresAt:Date.now()+60000});
  t.after(()=>session.clear()); let requests=0;
  const api=createApiClient({baseUrl:'https://api.example.invalid',session,fetch:async(url,init)=>{
    assert.equal(url.pathname,'/v1/me');assert.equal(init.method,'GET'); assert.equal(init.headers.Authorization,'Bearer synthetic');
    assert.equal(init.headers['Idempotency-Key'],undefined); requests++;return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  }});
  const f=setup(t,async()=>{await api.getIdentity();});await flush();assert.equal(requests,1);
  t.mock.timers.tick(4999);await flush();assert.equal(requests,1);
  t.mock.timers.tick(1);await flush();assert.equal(requests,2);
  t.mock.timers.tick(5000);await flush();assert.equal(requests,3);
  f.stop();assert.equal(f.suspends(),1);assert.equal(f.document.listeners,0);
  t.mock.timers.tick(20000);f.document.show();await flush();assert.equal(requests,3);
});
test('presence has one in-flight read through hide/resume and ignores completion after stop',async t=>{
  const pending=[];let reads=0;
  const f=setup(t,()=>{reads++;return new Promise(resolve=>pending.push(resolve));});
  await flush();assert.equal(reads,1);t.mock.timers.tick(15000);await flush();assert.equal(reads,1);
  f.document.hide();assert.equal(f.suspends(),1);f.document.show();await flush();assert.equal(reads,1,'old callback must settle before resuming');
  pending.shift()();await flush();assert.equal(reads,2,'resume schedules exactly one immediate cycle');
  f.stop();pending.shift()();await flush();t.mock.timers.tick(20000);await flush();assert.equal(reads,2);
});
test('presence stays suspended when hidden and wake-lock refusal is nonfatal',async t=>{
  let reads=0,locks=0;const f=setup(t,async()=>{reads++;},{wakeLock:{async request(type){assert.equal(type,'screen');locks++;throw new Error('not supported');}}});
  await flush();assert.equal(reads,1);assert.equal(locks,1);
  f.document.hide();t.mock.timers.tick(20000);await flush();assert.equal(reads,1);
  f.document.show();await flush();assert.equal(reads,2);assert.equal(locks,2);
});
test('late wake lock is released after hidden or stopped, with no leaked listener',async t=>{
  const pending=[];let released=0;
  const f=setup(t,async()=>{},{wakeLock:{request(){return new Promise(resolve=>pending.push(resolve));}}});
  await flush();f.document.hide();pending.shift()({release:async()=>{released++;}});await flush();assert.equal(released,1);
  f.document.show();await flush();f.stop();pending.shift()({release:async()=>{released++;}});await flush();assert.equal(released,2);
  assert.equal(f.document.listeners,0);
});
for(const reason of ['logout','expiry','revocation'])test(`owner ${reason} stops presence, conceals reads and releases wake lock`,async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  const document=new Page(),session=new MemorySession();
  session.setCredentials({issuer:'test',subject:'family',accessToken:'synthetic',expiresAt:Date.now()+2000});
  let reads=0,released=0,concealed=0;
  const api=createApiClient({baseUrl:'https://api.example.invalid',session,fetch:async()=>{
    reads++;return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  }});
  const stop=startContactPresence({document,navigator:{wakeLock:{async request(){return {async release(){released++;}};}}},
    refreshStatus:async()=>{await api.getIdentity();},suspend(){concealed++;}});
  const unsubscribe=session.subscribe(()=>{if(session.snapshot().status!=='authenticated')stop();});
  t.after(()=>{unsubscribe();stop();session.clear();});
  await flush();const lease=session.capture();
  if(reason==='expiry')t.mock.timers.tick(2000);
  else if(reason==='revocation')session.invalidate(lease);
  else session.clear();
  await flush();assert.equal(concealed,1);assert.equal(released,1);assert.equal(document.listeners,0);
  t.mock.timers.tick(15000);document.show();await flush();assert.equal(reads,1);
});
test('initial hidden page performs no read; a rejected read does not strand scheduling',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const document=new Page();document.visibilityState='hidden';let reads=0,suspends=0;
  const stop=startContactPresence({document,navigator:{},refreshStatus:async()=>{reads++;throw new Error('view handled read failure');},suspend(){suspends++;}});t.after(stop);
  await flush();assert.equal(reads,0);document.show();await flush();assert.equal(reads,1);
  t.mock.timers.tick(5000);await flush();assert.equal(reads,2);document.hide();assert.ok(suspends>0);
});
