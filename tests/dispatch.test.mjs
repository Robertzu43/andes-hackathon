import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/runtime.mjs';
import {runtime,sos,provider,qualification,deferred} from './helpers/dispatch.mjs';

test('recipient discovers incident from frozen alerts and can read and respond after arrival without stopping SOS channels', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs,trip,grant}=await sos(f);const p=provider();
  await f.req('POST',`/v1/trips/${trip}/locations`,{observations:[{capturedAt:f.ctx.clock().toISOString(),latitude:-12,longitude:-77,accuracy:7}]});
  const sms=jobs.find(j=>j.channel==='sms');
  await d.authorizeJob(f.ctx,await d.claimJob(f.ctx,sms,'recipient-alert'),p);
  const frozen=(await f.ctx.pool.query('SELECT payload FROM dispatch_attempts WHERE job_id=$1',[sms.id])).rows[0].payload;
  const match=frozen.text.match(/Incidente ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12});/);
  assert.ok(match,'recipient-facing summary must identify the exact incident');
  const id=match[1];const path=`/v1/incidents/${id}`;
  const expected={id,tripId:trip,status:'active',createdAt:'2026-10-17T12:00:00.000Z',resolvedAt:null,groupCapability:'unavailable'};
  assert.deepEqual(await f.req('GET',path,undefined,f.contact),{status:200,body:expected});
  assert.deepEqual(await f.req('GET',path),{status:200,body:expected});
  assert.equal((await f.req('GET',path,undefined,f.stranger)).status,403);
  assert.equal((await f.app.inject({method:'GET',url:path})).statusCode,401);
  const response=await f.app.inject({method:'GET',url:path,headers:{authorization:`Bearer ${f.contact}`}});
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal((await f.req('GET',`/v1/incidents/${randomUUID()}`,undefined,f.contact)).status,404);
  assert.equal((await f.req('GET','/v1/incidents/invalid',undefined,f.contact)).status,400);
  const before=(await f.ctx.pool.query('SELECT id,status,version FROM jobs ORDER BY id')).rows;
  assert.equal((await f.req('POST',`${path}/acknowledgements`,{},f.contact)).status,200);
  assert.equal((await f.req('POST',`${path}/actions`,{action:'called trusted support'},f.contact)).status,200);
  assert.deepEqual((await f.ctx.pool.query('SELECT id,status,version FROM jobs ORDER BY id')).rows,before);
  assert.deepEqual((await f.ctx.pool.query("SELECT kind,actor_id FROM incident_events WHERE kind IN ('acknowledged','action') ORDER BY kind")).rows,
    [{kind:'acknowledged',actor_id:f.contactIdentity.id},{kind:'action',actor_id:f.contactIdentity.id}]);
  assert.equal((await f.req('POST',`/v1/trips/${trip}/commands`,{type:'arrived'})).status,200);
  assert.equal((await f.req('GET',`/v1/trips/${trip}/snapshot`,undefined,f.contact)).status,403);
  assert.deepEqual(await f.req('GET',path,undefined,f.contact),{status:200,body:expected});
  for(const job of jobs.filter(j=>j.channel!=='sms')) {
    const attempt=await d.authorizeJob(f.ctx,await d.claimJob(f.ctx,job,'after-arrival'),p);assert.ok(attempt);
    const payload=(await f.ctx.pool.query('SELECT payload FROM dispatch_attempts WHERE id=$1',[attempt.id])).rows[0].payload;
    const summary=payload.text ?? payload.content.templateVariables['1'];
    assert.ok(summary.includes(`Incidente ${id};`));assert.match(summary,/ubicación no disponible/);assert.doesNotMatch(summary,/última ubicación/);
  }
  assert.deepEqual((await f.ctx.pool.query('SELECT payload FROM dispatch_attempts WHERE job_id=$1',[sms.id])).rows[0].payload,frozen);
  assert.equal((await f.req('POST',`${path}/acknowledgements`,{},f.contact)).status,200);
  assert.equal((await f.req('POST',`/v1/trips/${trip}/contacts/${grant}/revoke`,{},f.contact)).status,200);
  assert.equal((await f.req('GET',path,undefined,f.contact)).status,403);
  assert.equal((await f.req('POST',`${path}/acknowledgements`,{},f.contact)).status,403);
  assert.equal((await f.req('POST',`${path}/actions`,{action:'called again'},f.contact)).status,403);
  assert.deepEqual(await f.req('GET',path),{status:200,body:expected});
  f.advance(1000);assert.equal((await f.req('POST',`${path}/resolve`,{})).status,200);
  assert.deepEqual((await f.req('GET',path)).body,{...expected,status:'resolved',resolvedAt:'2026-10-17T12:00:01.000Z'});
});
test('incident reads and acknowledgements recheck both consent grants and accepted incident scope', async t => {
  for(const change of ["UPDATE contact_grants SET revoked_at=now()", "UPDATE trip_grants SET revoked_at=now()", "UPDATE contact_grants SET incident_accepted=false", "UPDATE contact_grants SET accepted_at=NULL"]) {
    const f=await fixture(t);const {incident}=await sos(f);const path=`/v1/incidents/${incident}`;
    assert.equal((await f.req('GET',path,undefined,f.contact)).status,200);
    await f.ctx.pool.query(change);
    assert.equal((await f.req('GET',path,undefined,f.contact)).status,403,change);
    assert.equal((await f.req('POST',`${path}/acknowledgements`,{},f.contact)).status,403,change);
    assert.equal((await f.req('GET',path)).status,200);
  }
});

test('outbox rollback publishes nothing, lost publish acknowledgement retries only transport with bounded backoff', async t => {
  const d=await runtime(); const f=await fixture(t); const {jobs}=await sos(f); let count=0;
  const c=await f.ctx.pool.connect(); await c.query('BEGIN');
  await c.query('DELETE FROM outbox'); await c.query('ROLLBACK'); c.release();
  const transport={async publish(message){assert.deepEqual(Object.keys(message).sort(),['class','jobId','version']);count++;throw Error('ack lost');}};
  await d.relayOnce(f.ctx,transport,'relay'); assert.equal(count,1);
  await d.relayOnce(f.ctx,transport,'relay'); assert.equal(count,2); // another channel remains independently eligible
  const attempts=(await f.ctx.pool.query('SELECT max(publish_attempts) n FROM outbox')).rows[0].n;assert.equal(attempts,1);
  assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM dispatch_attempts')).rows[0].n,'0');
  assert.equal(jobs.length,3);
});
test('duplicate SQS and expired authorization leases never create a second external attempt', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);let calls=0;const p=provider({async send(){calls++;throw Error('accepted then timeout');}});
  await Promise.all([d.runJob(f.ctx,jobs[0],p,'a'),d.runJob(f.ctx,jobs[0],p,'b')]);
  f.advance(120000);await d.recoverWork(f.ctx);await d.runJob(f.ctx,jobs[0],p,'c');
  assert.equal(calls,1);assert.equal((await f.ctx.pool.query('SELECT state FROM dispatch_attempts')).rows[0].state,'unknown');
  await d.reconcileOnce(f.ctx,p);assert.equal(calls,1);
});
test('stale claim cannot authorize, stop-first denies and authorize-first survives resolve/revoke', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs,incident,trip,grant}=await sos(f);const p=provider();
  const stale=await d.claimJob(f.ctx,jobs[0],'old');f.advance(31000);
  assert.equal(await d.authorizeJob(f.ctx,stale,p),null);
  const claim=await d.claimJob(f.ctx,jobs[0],'new');const authorized=await d.authorizeJob(f.ctx,claim,p);assert.ok(authorized);
  await f.req('POST',`/v1/incidents/${incident}/resolve`,{});await f.req('POST',`/v1/trips/${trip}/contacts/${grant}/revoke`,{},f.contact);
  assert.equal(await d.claimJob(f.ctx,jobs[1],'late'),null);
  await d.finishAttempt(f.ctx,authorized,{state:'accepted',messageId:'msg_after_stop',status:'queued'});
  assert.equal((await f.ctx.pool.query('SELECT state FROM dispatch_attempts')).rows[0].state,'accepted');
});
test('authorization rechecks standing scope, trip scope, phone and incident; arrival keeps SOS without coordinates', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs,trip}=await sos(f);const p=provider();
  await f.req('POST',`/v1/trips/${trip}/locations`,{observations:[{capturedAt:f.ctx.clock().toISOString(),latitude:-12,longitude:-77,accuracy:7}]});
  const first=await d.authorizeJob(f.ctx,await d.claimJob(f.ctx,jobs[0],'a'),p);assert.match(JSON.stringify(first.payload),/-12/);assert.match(JSON.stringify(first.payload),/2026-10-17/);
  await f.req('POST',`/v1/trips/${trip}/commands`,{type:'arrived'});
  const second=await d.authorizeJob(f.ctx,await d.claimJob(f.ctx,jobs[1],'b'),p);assert.ok(second);assert.doesNotMatch(JSON.stringify(second.payload),/última ubicación -12,-77/);assert.match(JSON.stringify(second.payload),/no disponible/);
  await f.ctx.pool.query('UPDATE identities SET phone_verified=false WHERE id=$1',[f.contactIdentity.id]);
  assert.equal(await d.authorizeJob(f.ctx,await d.claimJob(f.ctx,jobs[2],'c'),p),null);
});
test('scanner recovers expired transport and claims but keeps authorized work unknown; no blind DLQ replay', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);const p=provider();
  const claim=await d.claimJob(f.ctx,jobs[0],'paused');const attempt=await d.authorizeJob(f.ctx,claim,p);
  await d.claimJob(f.ctx,jobs[1],'crashed');
  await f.ctx.pool.query('UPDATE outbox SET published_at=$1',[f.ctx.clock()]);f.advance(120000);
  await d.recoverWork(f.ctx);
  assert.equal((await f.ctx.pool.query('SELECT state FROM dispatch_attempts WHERE id=$1',[attempt.id])).rows[0].state,'unknown');
  assert.equal((await f.ctx.pool.query('SELECT status FROM jobs WHERE id=$1',[jobs[1].id])).rows[0].status,'pending');
  assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM outbox WHERE published_at IS NULL')).rows[0].n,'2');
  let posts=0;await d.runJob(f.ctx,jobs[0],provider({async send(){posts++;}}),'dlq');assert.equal(posts,0);
});
test('account and channel budgets persist and preserve emergency reserve across replicas', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);
  const p=provider({qualification:{...qualification,dailyLimit:1,channelDailyLimit:1,minuteLimit:1,emergencyReserve:0}});
  const results=await Promise.all(jobs.map(j=>d.runJob(f.ctx,j,p,randomUUID())));
  assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM dispatch_attempts')).rows[0].n,'1');
  assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM quota_reservations')).rows[0].n,'1');
});
test('early callbacks persist unmatched, exact response ID correlates, duplicates and contradictory late HTTP cannot regress delivery', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);const p=provider();
  const attempt=await d.authorizeJob(f.ctx,await d.claimJob(f.ctx,jobs[0],'a'),p);
  const event={id:'evt_early',type:'message.delivered',timestamp:f.ctx.clock().getTime(),projectId:'prj_fixture',senderId:'snd_fixture',data:{messageId:'msg_early',channel:jobs[0].channel,to:f.phoneFor('contact'),status:'delivered'}};
  await d.saveCallback(f.ctx,event,Buffer.from(JSON.stringify(event)));await d.saveCallback(f.ctx,event,Buffer.from(JSON.stringify(event)));
  assert.equal((await f.ctx.pool.query('SELECT disposition FROM provider_events')).rows[0].disposition,'unmatched');
  await d.finishAttempt(f.ctx,attempt,{state:'unknown'});
  assert.equal((await f.ctx.pool.query('SELECT disposition FROM provider_events')).rows[0].disposition,'unmatched');
  assert.equal((await f.ctx.pool.query('SELECT state FROM dispatch_attempts')).rows[0].state,'unknown');
  await d.finishAttempt(f.ctx,attempt,{state:'accepted',messageId:'msg_early',status:'queued'});
  await d.finishAttempt(f.ctx,attempt,{state:'unknown'});
  assert.equal((await f.ctx.pool.query('SELECT delivery_status FROM dispatch_attempts')).rows[0].delivery_status,'delivered');
  assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM provider_events')).rows[0].n,'1');
  const mismatch={...event,id:'foreign-channel',data:{...event.data,channel:'sms'}};
  if(jobs[0].channel==='sms') mismatch.data.channel='voice';await d.saveCallback(f.ctx,mismatch,Buffer.from(JSON.stringify(mismatch)));
  assert.equal((await f.ctx.pool.query("SELECT disposition FROM provider_events WHERE event_id='foreign-channel'")).rows[0].disposition,'incompatible');
});
test('paused WhatsApp leaves later-batch SMS/voice and reads/close free; slots are bounded', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs,trip}=await sos(f);const gate=deferred();const entered=deferred();let activeWA=0;let maxWA=0;const sent=[];
  const p=provider({async send(payload){sent.push(payload.channel);if(payload.channel==='whatsapp'){activeWA++;maxWA=Math.max(maxWA,activeWA);entered.resolve();await gate.promise;activeWA--;}return {state:'accepted',messageId:'msg_'+payload.channel,status:'queued'};}});
  const batches=[[{body:jobs.find(j=>j.channel==='whatsapp'),receipt:'wa'}],[{body:jobs.find(j=>j.channel==='sms'),receipt:'sms'},{body:jobs.find(j=>j.channel==='voice'),receipt:'voice'}]];
  const controller=new AbortController();const finished=deferred();
  const transport={async receive(_class,signal){if(batches.length)return batches.shift();await new Promise(r=>{if(signal.aborted)r();else signal.addEventListener('abort',r,{once:true});});return [];},async ack(){if(sent.includes('sms')&&sent.includes('voice'))finished.resolve();},async defer(){}};
  const running=d.consume(f.ctx,transport,p,'emergency',{sms:1,voice:1,whatsapp:1},controller.signal);
  try{await entered.promise;await Promise.race([finished.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('later channels blocked')),2000))]);
    assert.equal((await f.req('GET',`/v1/trips/${trip}/snapshot`,undefined,f.contact)).status,200);
    assert.equal((await f.req('POST',`/v1/trips/${trip}/commands`,{type:'arrived'})).status,200);assert.equal(maxWA,1);
  }finally{controller.abort();gate.resolve();await running;}
});
test('rolled-back new intent is never published', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);await f.ctx.pool.query('DELETE FROM outbox');
  const c=await f.ctx.pool.connect();
  try{await c.query('BEGIN');await c.query("INSERT INTO outbox(id,job_id,job_version,class,created_at,next_publish_at) VALUES($1,$2,1,'emergency',$3,$3)",[randomUUID(),jobs[0].id,f.ctx.clock()]);await c.query('ROLLBACK');}finally{c.release();}
  let sent=0;assert.equal(await d.relayOnce(f.ctx,{async publish(){sent++;}},'rollback'),false);assert.equal(sent,0);
});
test('publish acknowledgement loss creates duplicate transport but still only one provider send', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);await f.ctx.pool.query('DELETE FROM outbox WHERE job_id<>$1',[jobs[0].id]);
  const published=[];await d.relayOnce(f.ctx,{async publish(m){published.push(m);throw Error('published but ack lost');}},'first');
  assert.equal(await d.relayOnce(f.ctx,{async publish(m){published.push(m);}},'early'),false);
  f.advance(3000);await d.relayOnce(f.ctx,{async publish(m){published.push(m);}},'retry');assert.equal(published.length,2);
  let sends=0;for(const m of published)await d.runJob(f.ctx,m,provider({async send(){sends++;return {state:'unknown'};}}),'delivery');assert.equal(sends,1);
});
test('old relay cannot acknowledge a newer lease', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);await f.ctx.pool.query('DELETE FROM outbox WHERE job_id<>$1',[jobs[0].id]);
  const gate=deferred();const entered=deferred();const old=d.relayOnce(f.ctx,{async publish(){entered.resolve();await gate.promise;}},'old');await entered.promise;
  f.advance(31000);const gate2=deferred();const entered2=deferred();const newer=d.relayOnce(f.ctx,{async publish(){entered2.resolve();await gate2.promise;}},'new');await entered2.promise;
  gate.resolve();await old;assert.equal((await f.ctx.pool.query('SELECT published_at FROM outbox')).rows[0].published_at,null);
  gate2.resolve();await newer;assert.ok((await f.ctx.pool.query('SELECT published_at FROM outbox')).rows[0].published_at);
});
test('callback endpoint preserves raw bytes and needs no OIDC; failed SQL is not acknowledged', async t => {
  const config={projectId:'prj_fixture',senderId:'snd_fixture',secret:'fixture-secret-not-a-credential'};const f=await fixture(t,{callbackConfig:config});
  const raw='{"id":"evt_http","type":"message.delivered","timestamp":1792238400000,"senderId":"snd_fixture","projectId":"prj_fixture","data":{"messageId":"msg_unknown","to":"+15555550101","channel":"sms","status":"delivered"}}';
  const digest=createHmac('sha256',config.secret).update('1792238400.').update(raw).digest('hex');
  const headers={'content-type':'application/json','x-zavu-signature':`t=1792238400,v2=${digest}`};
  const response=await f.app.inject({method:'POST',url:'/v1/callbacks/zavu',headers,payload:raw});assert.equal(response.statusCode,200);
  assert.equal((await f.ctx.callbackPool.query('SELECT count(*) n FROM provider_events')).rows[0].n,'1');
  assert.equal((await f.app.inject({method:'POST',url:'/v1/callbacks/zavu',headers,payload:raw+' '})).statusCode,401);
  await f.ctx.pool.query('ALTER TABLE provider_events RENAME TO unavailable_events');
  assert.equal((await f.app.inject({method:'POST',url:'/v1/callbacks/zavu',headers,payload:raw})).statusCode,500);
});
test('unknown read result cannot authorize a second send while original emitter remains paused', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);const gate=deferred();const entered=deferred();let sends=0;
  const p=provider({async send(){sends++;entered.resolve();await gate.promise;return {state:'accepted',messageId:'msg_paused',status:'queued'};}});
  const run=d.runJob(f.ctx,jobs[0],p,'old');await entered.promise;f.advance(120000);await d.recoverWork(f.ctx);await d.reconcileOnce(f.ctx,p);await d.runJob(f.ctx,jobs[0],p,'redelivery');assert.equal(sends,1);
  gate.resolve();await run;
});
test('control publishes new outbox while provider reconciliation read is paused', async t => {
  const d=await runtime();const {control}=await import('../dist/worker.js');const f=await fixture(t);const {jobs}=await sos(f);
  await d.runJob(f.ctx,jobs[0],provider(),'old');f.advance(61000);
  const gate=deferred();const entered=deferred();const published=deferred();const abort=new AbortController();
  const p=provider({async read(){entered.resolve();await gate.promise;return {state:'missing'};}});
  const running=control(f.ctx,{async publish(){published.resolve();}},p,abort.signal);
  try{await entered.promise;await Promise.race([published.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('relay blocked behind reconciliation')),2000))]);}
  finally{abort.abort();gate.resolve();await running;}
});
test('global revoke-first blocks every authorization and no grant lock upgrades deadlock standing revoke', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs,grant}=await sos(f);const claim=await d.claimJob(f.ctx,jobs[0],'before-revoke');
  assert.equal((await f.req('POST',`/v1/contacts/${grant}/revoke`,{},f.contact)).status,200);assert.equal(await d.authorizeJob(f.ctx,claim,provider()),null);
});
test('delivery facts never regress on late failed/queued/unknown callbacks and voice never implies human answer', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);const sms=jobs.find(j=>j.channel==='sms');const voice=jobs.find(j=>j.channel==='voice');
  await d.runJob(f.ctx,sms,provider(),'sms');
  const base={type:'message.delivered',timestamp:f.ctx.clock().getTime(),projectId:'prj_fixture',senderId:'snd_fixture',data:{messageId:'msg_fixture_1',channel:'sms',to:f.phoneFor('contact'),status:'delivered'}};
  for(const status of ['delivered','failed','queued','made_up']){const event={...base,id:'event_'+status,type:'message.'+status,data:{...base.data,status}};await d.saveCallback(f.ctx,event,Buffer.from(JSON.stringify(event)));}
  assert.equal((await f.ctx.pool.query('SELECT delivery_status FROM dispatch_attempts')).rows[0].delivery_status,'delivered');
  await d.runJob(f.ctx,voice,provider({async send(){return {state:'accepted',messageId:'msg_voice',status:'queued'};}}),'voice');
  const voiceEvent={...base,id:'event_voice',data:{...base.data,messageId:'msg_voice',channel:'voice'}};await d.saveCallback(f.ctx,voiceEvent,Buffer.from(JSON.stringify(voiceEvent)));
  assert.equal((await f.ctx.pool.query('SELECT status FROM jobs WHERE id=$1',[voice.id])).rows[0].status,'accepted');
});
test('daily quotas do not erase the sliding minute limit across UTC midnight', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);const p=provider({qualification:{...qualification,minuteLimit:1,emergencyReserve:0}});
  f.advance(43190000);await f.ctx.pool.query('UPDATE jobs SET expires_at=$1',[new Date(f.ctx.clock().getTime()+3600000)]);
  await d.runJob(f.ctx,jobs[0],p,'before-midnight');f.advance(20000);await d.runJob(f.ctx,jobs[1],p,'after-midnight');
  assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM dispatch_attempts')).rows[0].n,'1');
});
test('reconciliation GETs reserve account request budget before network', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);const p=provider({qualification:{...qualification,minuteLimit:1,emergencyReserve:0}});
  await d.runJob(f.ctx,jobs[0],p,'initial');f.advance(61000);let reads=0;
  const reader={...p,async read(){reads++;return {state:'missing'};}};
  await d.reconcileOnce(f.ctx,reader);assert.equal(reads,1);
  await d.runJob(f.ctx,jobs[1],p,'must-wait');assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM dispatch_attempts')).rows[0].n,'1');
});
test('ordinary reservations stop at configured emergency margin', async t => {
  const d=await runtime();const f=await fixture(t);const {jobs}=await sos(f);const p=provider({qualification:{...qualification,dailyLimit:3,channelDailyLimit:3,minuteLimit:3,emergencyReserve:1}});
  for(const job of jobs.slice(0,2)){await f.ctx.pool.query("UPDATE jobs SET class='ordinary' WHERE id=$1",[job.id]);job.class='ordinary';await d.runJob(f.ctx,job,p,'ordinary');}
  await f.ctx.pool.query("UPDATE jobs SET class='ordinary' WHERE id=$1",[jobs[2].id]);jobs[2].class='ordinary';
  await d.runJob(f.ctx,jobs[2],p,'ordinary-denied');assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM dispatch_attempts')).rows[0].n,'2');
  await f.ctx.pool.query("UPDATE jobs SET class='emergency',due_at=$2 WHERE id=$1",[jobs[2].id,f.ctx.clock()]);jobs[2].class='emergency';
  await d.runJob(f.ctx,jobs[2],p,'emergency');assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM dispatch_attempts')).rows[0].n,'3');
});
test('authorization independently rechecks current standing consent and per-trip consent', async t => {
  const d=await runtime();
  for(const mutate of ["UPDATE contact_grants SET revoked_at=now()", "UPDATE contact_grants SET incident_accepted=false", "UPDATE trip_grants SET revoked_at=now()", "UPDATE identities SET phone='+5511000000000'"]){
    const f=await fixture(t);const {jobs}=await sos(f);const claim=await d.claimJob(f.ctx,jobs[0],'claimed-before-change');await f.ctx.pool.query(mutate);
    assert.equal(await d.authorizeJob(f.ctx,claim,provider()),null,mutate);
  }
});
test('control reconciles known IDs with new sends off and denies new authorization', async t => {
  const d=await runtime();const {configuredProvider,control}=await import('../dist/worker.js');const f=await fixture(t);const {jobs}=await sos(f);
  await d.runJob(f.ctx,jobs[0],provider(),'initial');f.advance(61000);
  const retained={...qualification,evidence:'test-only syntheticfixture: retained qualification',entries:qualification.entries.map(e=>({...e,evidence:'test-only syntheticfixture: retained channel'}))};
  const observed=deferred();const methods=[];
  const p=configuredProvider({ZAVU_LIVE_SEND:'false',ZAVU_QUALIFICATION_JSON:JSON.stringify(retained),ZAVU_API_KEY:'syntheticfixture-not-a-key',ZAVU_PROJECT_ID:'prj_fixture',ZAVU_SENDER_ID:'snd_fixture',ZAVU_CALLBACK_SECRET:'syntheticfixture-secret'},async (_url,init)=>{methods.push(init.method);observed.resolve();return new Response('{}',{status:404});});
  assert.ok(p,'control must retain read access when new sends are disabled');
  assert.equal(await d.authorizeJob(f.ctx,await d.claimJob(f.ctx,jobs[1],'disabled'),p),null);
  const abort=new AbortController();const running=control(f.ctx,{async publish(){}},p,abort.signal);
  try{await Promise.race([observed.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('read-only reconciliation disabled')),2000))]);}
  finally{abort.abort();await running;}
  assert.deepEqual(methods,['GET']);assert.equal((await f.ctx.pool.query('SELECT count(*) n FROM dispatch_attempts')).rows[0].n,'1');
});
