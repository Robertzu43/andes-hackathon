import assert from 'node:assert/strict';
import test from 'node:test';
import * as demo from '../../src/lib/api/demo.ts';
import { createApiClient, MemorySession } from '../../src/lib/api/index.ts';
const world='11111111-1111-4111-8111-111111111111', grant='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333';
const claims=()=>({iss:'https://demo.andes.invalid',aud:'andes-demo',sub:`${world}:family`,exp:Math.floor(Date.now()/1000)+7200});
const token=(c=claims())=>`eyJhbGciOiJFZERTQSJ9.${Buffer.from(JSON.stringify(c)).toString('base64url')}.c3ludGhldGlj`;
function setup(t,{hash=`#t=${token()}`,pathname=`/contact/invitations/${grant}`,fetch=async()=>Response.json({id})}={}) {
  const session=new MemorySession(), events=[];
  const location={pathname,search:'?language=es&from=invite',hash};
  const state={existing:'state'};
  const history={state,replaceState(...args){events.push(['erase',...args]);location.hash='';}};
  const api=createApiClient({baseUrl:'https://api.example.invalid',session,fetch:async(url,init)=>{
    events.push(['fetch',url.pathname,init]); assert.equal(location.hash,'','fragment gone before every request'); return fetch(url,init);
  }});
  const gateway=demo.createInvitationSession({api,session,location,history});
  t.after(()=>gateway.dispose()); return {session,gateway,events,location,state,api};
}
// Catches delaying erasure until begin, minting a contact world, or treating metadata as authentication.
test('fragment_erased_before_first_async',async t=>{
  const f=setup(t);
  assert.deepEqual(f.events,[['erase',f.state,'',`/contact/invitations/${grant}?language=es&from=invite`]]);
  assert.equal(f.session.snapshot().status,'anonymous');
  assert.equal(JSON.stringify(f.gateway.getSnapshot()).includes('eyJ'),false);
  await f.gateway.begin(); assert.equal(f.gateway.getSnapshot().state,'authenticated');
  assert.deepEqual(f.events.filter(e=>e[0]==='fetch').map(e=>e[1]),['/v1/me']);
  assert.equal(f.events[1][2].referrerPolicy,'no-referrer');
  assert.equal(f.events[1][2].credentials,'omit');
  assert.equal(f.session.snapshot().subject,`${world}:family`);
});
for(const [name,hash,pathname] of [
  ['missing',''],['malformed','#t=bad'],['duplicate',`#t=${token()}&t=${token()}`],
  ['unknown fragment field',`#t=${token()}&debug=true`],['oversized',`#t=${'a'.repeat(17000)}`],
  ['expired',`#t=${token({...claims(),exp:1})}`],
  ['beyond demo lifetime',`#t=${token({...claims(),exp:Math.floor(Date.now()/1000)+7201})}`], ['nonfamily',`#t=${token({...claims(),sub:`${world}:driver`})}`],
  ['foreign issuer',`#t=${token({...claims(),iss:'https://foreign.invalid'})}`],
  ['foreign audience',`#t=${token({...claims(),aud:'foreign'})}`],
  ['bad world subject',`#t=${token({...claims(),sub:'foreign:family'})}`],
  ['bad grant route',`#t=${token()}`,'/contact/invitations/not-a-uuid'],
]) test(`invitation erases and refuses ${name} before dispatch`,async t=>{
  const f=setup(t,{hash,pathname}); assert.equal(f.location.hash,'');
  await f.gateway.begin(); assert.equal(f.gateway.getSnapshot().state,'error');
  assert.equal(f.session.snapshot().status,'anonymous'); assert.equal(f.events.length,1);
});
test('foreign credentials require backend authentication; decoded metadata grants no membership',async t=>{
  const refused=setup(t,{fetch:async()=>Response.json({code:'forbidden'},{status:403})});
  await refused.gateway.begin(); assert.equal(refused.gateway.getSnapshot().state,'error');
  assert.equal(refused.session.snapshot().status,'anonymous');
  // A random grant UUID is not a world UUID. /me can authenticate without proving this grant belongs to it.
  const f=setup(t,{fetch:async url=>url.pathname==='/v1/me'?Response.json({id}):Response.json({readAt:'2026-10-18T09:00:00Z',invitations:[],limit:100,hasMore:false})});
  await f.gateway.begin(); assert.equal(f.gateway.getSnapshot().state,'authenticated');
  const catalog=await f.api.listContactInvitations(); assert.deepEqual(catalog.invitations,[]);
  assert.equal(f.events.some(e=>e[1]==='/v1/demo/session'),false);
});
for(const action of ['end','dispose','logout','expiry']) test(`invitation ${action} retires credentials and ignores late authentication`,async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  let finish; const f=setup(t,{hash:`#t=${token({...claims(),exp:Math.floor(Date.now()/1000)+2})}`,
    fetch:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=f.gateway.begin(); await Promise.resolve(); await Promise.resolve();
  assert.equal(typeof finish,'function');
  if(action==='logout')f.session.clear(); else if(action==='expiry')t.mock.timers.tick(2100); else f.gateway[action]();
  finish(Response.json({id})); await pending;
  assert.notEqual(f.gateway.getSnapshot().state,'authenticated'); assert.notEqual(f.session.snapshot().status,'authenticated');
  await f.gateway.begin(); assert.notEqual(f.gateway.getSnapshot().state,'authenticated');
  assert.equal(f.events.filter(e=>e[0]==='fetch').length,1,'raw token cannot be reused');
});
test('unused invitation expires in memory and end before begin cannot recover token',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const f=setup(t,{hash:`#t=${token({...claims(),exp:Math.floor(Date.now()/1000)+2})}`});
  t.mock.timers.tick(2100); await f.gateway.begin(); assert.equal(f.events.length,1);
  const g=setup(t); g.gateway.end(); await g.gateway.begin(); assert.equal(g.events.length,1);
});
test('invitation touches no persistence or console and never inherits driver credentials',async t=>{
  const descriptors=new Map();
  for(const name of ['localStorage','sessionStorage']) {
    descriptors.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{configurable:true,get(){assert.fail(`invitation accessed ${name}`);}});
  }
  t.after(()=>{for(const [name,descriptor]of descriptors) {if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  const logged=[];for(const method of ['log','info','warn','error','debug'])t.mock.method(console,method,(...args)=>logged.push(args));
  const session=new MemorySession();session.setCredentials({issuer:'driver-world',subject:'driver',accessToken:'driver-token',expiresAt:Date.now()+60000});
  const seen=[];const api=createApiClient({baseUrl:'https://api.example.invalid',session,fetch:async(url,init)=>{seen.push([url.pathname,init.headers.Authorization]);return Response.json({id});}});
  const invitationToken=token();
  const gateway=demo.createInvitationSession({api,session,location:{pathname:`/contact/invitations/${grant}`,search:'',hash:`#t=${invitationToken}`},history:{state:null,replaceState(){}}});
  t.after(()=>gateway.dispose());assert.equal(session.snapshot().status,'anonymous');assert.deepEqual(seen,[]);
  await gateway.begin();assert.deepEqual(seen,[['/v1/me',`Bearer ${invitationToken}`]]);assert.deepEqual(logged,[]);
});
