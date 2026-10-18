import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient, MemorySession } from '../../src/lib/api/index.ts';
const grant='11111111-1111-4111-8111-111111111111', driver='22222222-2222-4222-8222-222222222222';
const trip='33333333-3333-4333-8333-333333333333', incident='44444444-4444-4444-8444-444444444444';
const at='2026-10-18T09:00:00.000Z';
const row={id:grant,driverId:driver,requested:{map:true,incident:true},accepted:{map:false,incident:true},status:'accepted',acceptedAt:at,revokedAt:null};
const shared={tripId:trip,grantId:grant,driverId:driver,status:'arrived',scopes:{map:false,incident:true},activeIncidentId:incident};
function setup(t, fetch) {
  const session=new MemorySession(); session.setCredentials({issuer:'test',subject:'family',accessToken:'synthetic',expiresAt:Date.now()+60000});
  t.after(()=>session.clear()); return createApiClient({baseUrl:'https://api.example.invalid',session,fetch});
}
// Catches treating catalogs as owner endpoints, dropping arrived incidents or projecting phone values.
test('recipient_catalogs_are_authoritative',async t=>{
  const calls=[]; const api=setup(t,async(url,init)=>{
    calls.push(url.pathname); assert.equal(init.method,'GET'); assert.equal(init.headers.Authorization,'Bearer synthetic');
    assert.equal(init.headers['Idempotency-Key'],undefined);
    return Response.json({readAt:at,limit:100,hasMore:true,phone:'PRIVATE',
      invitations:[{...row,phone:'PRIVATE',requested:{...row.requested,phone:'PRIVATE'}}],trips:[{...shared,phone:'PRIVATE'}]});
  });
  assert.deepEqual(await api.listContactInvitations(),{readAt:at,limit:100,hasMore:true,invitations:[row]});
  assert.deepEqual(await api.listContactTrips(),{readAt:at,limit:100,hasMore:true,trips:[shared]});
  assert.deepEqual(calls,['/v1/contact/invitations','/v1/contact/trips']);
});
for(const [method,key] of [['listContactInvitations','invitations'],['listContactTrips','trips']]) {
  test(`${method} distinguishes empty, truncated, denied and unsupported`,async t=>{
    let reply=Response.json({readAt:at,limit:100,hasMore:false,[key]:[]});
    const api=setup(t,async()=>reply);
    assert.deepEqual(await api[method](),{readAt:at,limit:100,hasMore:false,[key]:[]});
    reply=Response.json({readAt:at,limit:100,hasMore:true,[key]:[]}); assert.equal((await api[method]()).hasMore,true);
    reply=Response.json({code:'forbidden'},{status:403}); await assert.rejects(api[method](),{kind:'forbidden'});
    reply=Response.json({},{status:404}); await assert.rejects(api[method](),{kind:'unsupported',code:'endpoint_unavailable'});
  });
  for(const [label,patch] of [
    ['oversized',{[key]:Array.from({length:101},()=>key==='invitations'?row:shared)}],
    ['duplicates',{[key]:[key==='invitations'?row:shared,key==='invitations'?row:shared]}],
    ['bad limit',{limit:99}],['bad date',{readAt:'2026-02-30T09:00:00Z'}],
    ['invalid id',{[key]:[{...(key==='invitations'?row:shared),driverId:'bad'}]}],
    ['missing field',{[key]:[{}]}],
  ]) test(`${method} rejects ${label}`,async t=>{
    const api=setup(t,async()=>Response.json({readAt:at,limit:100,hasMore:false,[key]:[],...patch}));
    await assert.rejects(api[method](),{kind:'invalid_response'});
  });
}
test('recipient invitations preserve pending/revoked and trips preserve active scope/null metadata',async t=>{
  const pending={...row,status:'pending',accepted:{map:false,incident:false},acceptedAt:null};
  const revoked={...row,id:driver,status:'revoked',revokedAt:at};
  const active={...shared,status:'active',scopes:{map:true,incident:false},activeIncidentId:null};
  const api=setup(t,async url=>Response.json({readAt:at,limit:100,hasMore:false,...(url.pathname.endsWith('invitations')?{invitations:[pending,revoked]}:{trips:[active]})}));
  assert.deepEqual((await api.listContactInvitations()).invitations,[pending,revoked]);
  assert.deepEqual((await api.listContactTrips()).trips,[active]);
});
test('recipient accepts distinct grants for the same trip but rejects a repeated trip/grant pair',async t=>{
  const other={...shared,grantId:driver};
  const api=setup(t,async()=>Response.json({readAt:at,limit:100,hasMore:false,trips:[shared,other]}));
  assert.deepEqual((await api.listContactTrips()).trips,[shared,other]);
});
