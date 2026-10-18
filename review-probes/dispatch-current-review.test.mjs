import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=pathToFileURL(resolve(process.env.Q48_REVIEW_CANDIDATE)+sep);
const {fixture}=await import(new URL('tests/helpers/runtime.mjs',root));
const {sos,provider}=await import(new URL('tests/helpers/dispatch.mjs',root));
const work=await import(new URL('dist/notifications/dispatch.js',root));

function operationContext(f) {
  const target={pid:null};
  const pool={query:(...args)=>f.ctx.pool.query(...args),connect:async()=>{
    const client=await f.ctx.pool.connect(); target.pid=client.processID; return client;
  }};
  return {ctx:{...f.ctx,pool},target};
}
async function blocked(f,target,pattern) {
  const until=Date.now()+2500;
  while(Date.now()<until) {
    if(target.pid) {
      const row=(await f.ctx.pool.query(`SELECT count(*)::int n FROM pg_stat_activity
        WHERE datname=current_database() AND pid=$1 AND query LIKE $2 AND wait_event_type='Lock'`,[target.pid,pattern])).rows[0];
      if(row.n) return;
    }
    await delay(10);
  }
  assert.fail(`operation PID did not block on ${pattern}`);
}
async function finishBlocked(pending,connection,phase) {
  // Handle rejection immediately, then always await the original operation,
  // including when observing the SQL barrier fails.
  pending.catch(()=>{});
  let error,result;
  try { await phase(); } catch(e) { error=e; }
  try { await connection.query('ROLLBACK'); } catch(e) { error??=e; }
  try { connection.release(); } catch(e) { error??=e; }
  try { result=await pending; } catch(e) { error??=e; }
  if(error) throw error;
  return result;
}
function qualified() {
  const p=provider();
  return {...p,qualification:{...p.qualification,accountId:'prj_q48_'+randomUUID().replaceAll('-','')}};
}
async function quotaBlock(f,p) {
  await f.ctx.pool.query('INSERT INTO quota_accounts VALUES($1)',[p.qualification.accountId]);
  const connection=await f.ctx.pool.connect(); await connection.query('BEGIN');
  await connection.query('SELECT project_id FROM quota_accounts WHERE project_id=$1 FOR UPDATE',[p.qualification.accountId]);
  return connection;
}
const state=async(f,job)=>(await f.ctx.pool.query('SELECT status,version,expires_at,claim_until FROM jobs WHERE id=$1',[job.id])).rows[0];

for(const scenario of [
  {name:'job expiry only',lifetime:1000,before:0,wait:1001},
  {name:'job and lease expiry together',lifetime:30000,before:29900,wait:101}
]) {
  test(`expired job ends cancelled: ${scenario.name}`,{timeout:15000},async t=>{
    const f=await fixture(t); const s=await sos(f);const job=s.jobs.find(v=>v.channel==='sms');
    await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1',[job.id,new Date(f.ctx.clock().getTime()+scenario.lifetime)]);
    const claim=await work.claimJob(f.ctx,job,'q48-both-expired');assert.ok(claim);
    f.advance(scenario.before);
    const p=qualified(),connection=await quotaBlock(f,p),op=operationContext(f);
    const pending=work.authorizeJob(op.ctx,claim,p);
    const result=await finishBlocked(pending,connection,async()=>{await blocked(f,op.target,'SELECT project_id FROM quota_accounts%');await delay(scenario.wait);f.advance(scenario.wait);});
    assert.equal(result,null);await work.recoverWork(f.ctx);
    const row=await state(f,job);const attempts=(await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts WHERE job_id=$1',[job.id])).rows[0].n;
    t.diagnostic(JSON.stringify({scenario,checkedAt:f.ctx.clock(),...row,attempts}));
    assert.equal(attempts,0);assert.equal(row.status,'cancelled');assert.equal(row.version,job.version+1);
  });
}

for(const changed of [false,true]) {
  test(`phone is revalidated after quota wait: verified binding changed=${changed}`,{timeout:15000},async t=>{
    const f=await fixture(t);const s=await sos(f),job=s.jobs.find(v=>v.channel==='sms');
    const claim=await work.claimJob(f.ctx,job,'q48-phone');const p=qualified(),connection=await quotaBlock(f,p),op=operationContext(f);
    const pending=work.authorizeJob(op.ctx,claim,p);const phone=changed?'+5511888880000':'+5511999990000';
    const result=await finishBlocked(pending,connection,async()=>{
      await blocked(f,op.target,'SELECT project_id FROM quota_accounts%');
      const token=await f.token('contact',{phone_number:phone,phone_number_verified:true});
      assert.equal((await f.req('GET','/v1/me',undefined,token)).status,200);
      assert.equal((await f.ctx.pool.query('SELECT phone FROM identities WHERE id=$1',[f.contactIdentity.id])).rows[0].phone,phone);
    });
    const row=await state(f,job);
    t.diagnostic(JSON.stringify({changed,currentVerifiedPhone:phone,attemptAuthorized:!!result,payloadTo:result?.payload?.to??null,...row}));
    assert.equal(!!result,!changed,'a committed verified-phone change must invalidate the old destination');
  });
}

for(const elapsed of [0,1001]) {
  test(`claim clock follows the trip lock: ${elapsed}ms`,{timeout:15000},async t=>{
    const f=await fixture(t);const s=await sos(f),job=s.jobs.find(v=>v.channel==='sms');
    await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1',[job.id,new Date(f.ctx.clock().getTime()+1000)]);
    const connection=await f.ctx.pool.connect();await connection.query('BEGIN');await connection.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE',[s.trip]);
    const op=operationContext(f),pending=work.claimJob(op.ctx,job,'q48-stale-claim');
    const result=await finishBlocked(pending,connection,async()=>{await blocked(f,op.target,'SELECT * FROM trips WHERE id=$1 FOR UPDATE%');if(elapsed)await delay(elapsed);f.advance(elapsed);});
    const row=await state(f,job);t.diagnostic(JSON.stringify({elapsed,checkedAt:f.ctx.clock(),returnedClaim:!!result,...row}));
    assert.equal(!!result,elapsed<1000,'do not claim work that expired while waiting for the trip lock');
  });
}

test('lease-lapse observation: valid job loses immediate authorization and waits for published outbox recovery',{timeout:15000},async t=>{
  const f=await fixture(t),s=await sos(f),job=s.jobs.find(v=>v.channel==='sms');
  await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1',[job.id,new Date(f.ctx.clock().getTime()+120000)]);
  const claim=await work.claimJob(f.ctx,job,'q48-lease-delay');
  await f.ctx.pool.query('UPDATE outbox SET published_at=$2 WHERE job_id=$1',[job.id,f.ctx.clock()]);
  f.advance(29900);const p=qualified(),connection=await quotaBlock(f,p),op=operationContext(f);
  const pending=work.authorizeJob(op.ctx,claim,p);
  const attempt=await finishBlocked(pending,connection,async()=>{await blocked(f,op.target,'SELECT project_id FROM quota_accounts%');await delay(101);f.advance(101);});
  assert.equal(attempt,null);await work.recoverWork(f.ctx);assert.equal((await state(f,job)).status,'pending');
  const sent=[];const transport={async publish(value){sent.push(value);}};
  for(let n=0;n<8&&await work.relayOnce(f.ctx,transport,'control');n++) {}
  const before=sent.filter(value=>value.jobId===job.id).length;assert.equal(before,0);
  f.advance(30000);await work.recoverWork(f.ctx);
  for(let n=0;n<8&&await work.relayOnce(f.ctx,transport,'control');n++) {}
  const after=sent.filter(value=>value.jobId===job.id).length;assert.equal(after,1);
  t.diagnostic(JSON.stringify({leaseLapsedAt:30001,jobStillValidUntil:120000,republishedAt:60001,targetRepublishesBefore:before,targetRepublishesAfter:after,queueAck:'source inference from runJob/consume; no real queue used'}));
});
