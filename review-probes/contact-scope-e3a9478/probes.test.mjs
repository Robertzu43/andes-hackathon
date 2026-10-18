// Independent public-export controls; detached synthetic replies, no live backend or app acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.ANDES_CONTACT_REVIEW_ROOT;assert.ok(root);
const {createContactJourney}=await import(pathToFileURL(`${root}/web/src/features/contacts/journey.ts`));
const id=n=>`77777777-7777-4777-8777-${String(n).padStart(12,'0')}`;
const ids={driver:id(1),contact:id(2),trip:id(3),incident:id(4),grant:id(5),other:id(6)};
const incident=()=>({id:ids.incident,tripId:ids.trip,status:'active',createdAt:'2026-10-17T12:00:00.000Z',resolvedAt:null,groupCapability:'unavailable'});
const point=()=>({tripId:ids.trip,readAt:'2026-10-17T12:05:00.000Z',freshness:'stale',ageMs:300000,location:{capturedAt:'2026-10-17T12:00:00.000Z',receivedAt:'2026-10-17T12:01:00.000Z',latitude:0,longitude:0,accuracy:5}});
const fail=status=>Object.assign(new Error('synthetic denial'),{status});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};}
function setup(overrides={}){const calls=[];let key=0;const impl={getTripSnapshot:point,getIncident:incident,acknowledgeIncident:()=>({id:ids.incident,status:'active',recorded:'acknowledged'}),reportIncidentAction:()=>({id:ids.incident,status:'active',recorded:'action'}),revokeContact:()=>({id:ids.grant,revoked:true}),revokeTripContact:()=>({id:ids.grant,tripId:ids.trip,revoked:true}),...overrides};
 const api=Object.fromEntries(Object.entries(impl).map(([name,fn])=>[name,async(...args)=>{calls.push({name,args});return fn(...args);} ]));
 const j=createContactJourney(api,()=>`q52-key-${++key}`);j.setSession({actorId:ids.contact,view:'contact'});j.selectTrip({id:ids.trip,driverId:ids.driver});return{j,calls};}
test('Q52 CS01 denied map preserves authorized SOS, recorded acknowledgement and response utility',async()=>{
 const f=setup({getTripSnapshot:()=>{throw fail(403);}});await f.j.loadIncident(ids.incident);await f.j.acknowledge();await f.j.loadLocation();
 assert.equal(f.j.getState().location.status,'denied');assert.equal(f.j.getState().incident.data?.status,'active');assert.equal(f.j.getState().receipts.length,1);
 assert.equal(await f.j.reportAction('SYNTHETIC: response only, not verified assistance'),'recorded');assert.equal(f.j.getState().receipts.length,2);
});
test('Q52 CS02 denied incident cannot discard separately authorized map',async()=>{
 for(const code of [403,404]){const f=setup({getIncident:()=>{throw fail(code);}});await f.j.loadLocation();await f.j.loadIncident(ids.incident);assert.deepEqual(f.j.getState().location.data,point());assert.equal(f.j.getState().incident.status,'denied');}
});
test('Q52 CS03 map denial does not cancel a pending acknowledgement that commits',async()=>{
 const d=deferred(),f=setup({acknowledgeIncident:()=>d.promise,getTripSnapshot:()=>{throw fail(403);}});await f.j.loadIncident(ids.incident);const ack=f.j.acknowledge();await f.j.loadLocation();
 const signal=f.calls.find(c=>c.name==='acknowledgeIncident').args.at(-1).signal;d.resolve({id:ids.incident,status:'active',recorded:'acknowledged'});
 assert.equal(await ack,'recorded');assert.equal(signal.aborted,false);assert.equal(f.j.getState().receipts.length,1);
});
test('Q52 CS04 another revoke press cannot replace an uncertain command; retry retains key',async()=>{
 for(const scope of ['standing','trip']){let attempt=0;const method=scope==='trip'?'revokeTripContact':'revokeContact';const f=setup({[method]:()=>{if(!attempt++)throw new TypeError('synthetic lost committed response');return {id:ids.grant,revoked:true,...(scope==='trip'?{tripId:ids.trip}:{})};}});const revoke=()=>scope==='trip'?f.j.revokeTrip(ids.grant):f.j.revokeStanding(ids.grant);
 assert.equal(await revoke(),'uncertain');await assert.rejects(revoke());assert.equal(f.calls.length,1);assert.equal(f.j.getState().operation.status,'uncertain');assert.equal(await f.j.retryUncertainCommand(),'recorded');assert.equal(f.calls.length,2);assert.equal(f.calls[0].args.at(-1).idempotencyKey,f.calls[1].args.at(-1).idempotencyKey);}
});
test('Q52 CS05 refreshing unchanged incident retains this contact acknowledgement',async()=>{
 const f=setup();await f.j.loadIncident(ids.incident);await f.j.acknowledge();await f.j.loadIncident(ids.incident);assert.equal(f.j.getState().receipts.length,1);
});
test('Q52 CC01 authentication failure still clears all private state and retry context',async()=>{
 const f=setup({getTripSnapshot:()=>{throw fail(401);}});await f.j.loadIncident(ids.incident);await f.j.acknowledge();await f.j.loadLocation();const s=f.j.getState();assert.equal(s.session,null);assert.equal(s.trip,null);assert.equal(s.incident.data,null);assert.equal(s.receipts.length,0);assert.throws(()=>f.j.retryUncertainCommand());
});
test('Q52 CC02 replacement identity discards late acknowledgement and private cached facts',async()=>{
 const d=deferred(),f=setup({acknowledgeIncident:()=>d.promise});await f.j.loadLocation();await f.j.loadIncident(ids.incident);const pending=f.j.acknowledge();f.j.setSession({actorId:ids.other,view:'contact'});d.resolve({id:ids.incident,status:'active',recorded:'acknowledged'});assert.equal(await pending,'superseded');const s=f.j.getState();assert.equal(s.location.data,null);assert.equal(s.incident.data,null);assert.equal(s.receipts.length,0);
});
