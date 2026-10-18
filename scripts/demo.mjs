import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fixture} from '../tests/helpers/runtime.mjs';

const cleanups=[];
try {
  const f=await fixture({after(fn){cleanups.push(fn);}});
  const grant=await f.grant();const draft=await f.draft();
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM trips')).rows[0].n,0);
  const confirmed=await f.req('POST',`/v1/trip-drafts/${draft.body.id}/confirm`,{confirmed:true,contactGrantIds:[grant]});
  assert.equal(confirmed.status,200);const trip=confirmed.body.id;
  console.log('SYNTHETIC: signed test identities, confirmed trip; no external identity/provider/queue network.');
  const location=await f.req('POST',`/v1/trips/${trip}/locations`,{observations:[{capturedAt:f.ctx.clock().toISOString(),latitude:-12,longitude:-77,accuracy:8}]});assert.equal(location.status,200);
  assert.equal((await f.req('GET',`/v1/trips/${trip}/snapshot`,undefined,f.contact)).body.freshness,'fresh');
  f.advance(121000);
  assert.equal((await f.req('GET',`/v1/trips/${trip}/snapshot`,undefined,f.contact)).body.freshness,'stale');
  console.log('SYNTHETIC: fresh → stale is a simulated clock advance, not phone telemetry.');
  const first=await f.req('POST',`/v1/trips/${trip}/sos`,{});
  const duplicate=await f.req('POST',`/v1/trips/${trip}/sos`,{});assert.equal(first.body.id,duplicate.body.id);
  const jobs=(await f.ctx.pool.query("SELECT id AS \"jobId\",version,class FROM jobs WHERE incident_id=$1 AND channel<>'group' ORDER BY channel",[first.body.id])).rows;assert.equal(jobs.length,3);
  console.log('SYNTHETIC: duplicate SOS taps persist one active incident and three independent channel jobs.');
  function processPhase(phase) {
    const child=spawnSync(process.execPath,['scripts/demo-recovery.mjs',phase],{encoding:'utf8',env:{PATH:process.env.PATH,DATABASE_URL:f.ctx.pool.options.connectionString,SYNTHETIC_CLOCK:f.ctx.clock().toISOString(),SYNTHETIC_JOBS:JSON.stringify(jobs)}});
    assert.equal(child.status,0,`Synthetic recovery process failed: ${child.stderr}`);
    return JSON.parse(child.stdout);
  }
  assert.deepEqual(processPhase('stop'),{committedClaim:true,committedAuthorization:true,providerCalls:0});
  f.advance(61000);
  assert.deepEqual(processPhase('restart'),{providerCalls:1,states:['accepted','unknown']});
  console.log('SYNTHETIC: actual child-process exit/restart recovered an expired unattempted claim; committed ambiguous authorization stayed unknown with no resend. Lease passage uses simulated time.');
  assert.equal((await f.req('POST',`/v1/trips/${trip}/contacts/${grant}/revoke`,{},f.contact)).status,200);
  assert.equal((await f.req('GET',`/v1/trips/${trip}/snapshot`,undefined,f.contact)).status,403);
  assert.equal((await f.ctx.pool.query('SELECT status FROM jobs WHERE id=$1',[jobs[2].jobId])).rows[0].status,'cancelled');
  console.log('SYNTHETIC: revocation blocks contact map reads and cancels unattempted work. All checks passed; no live send.');
} finally {for(const cleanup of cleanups.reverse())await cleanup();}
