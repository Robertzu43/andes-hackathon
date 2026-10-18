// Test-only child process: no production provider/queue transport is constructed.
import assert from 'node:assert/strict';
import {createContext} from '../dist/db.js';
import {claimJob,authorizeJob,recoverWork,runJob} from '../dist/notifications/dispatch.js';
import {provider} from '../tests/helpers/dispatch.mjs';
const jobs=JSON.parse(process.env.SYNTHETIC_JOBS);
const ctx=createContext(process.env.DATABASE_URL,()=>new Date(process.env.SYNTHETIC_CLOCK),2);
let calls=0;
const synthetic=provider({async send(){calls++;return {state:'accepted',messageId:'msg_synthetic_demo',status:'queued'};}});
const envelope=job=>({jobId:job.jobId,version:job.version,class:job.class});
try {
  if(process.argv[2]==='stop') {
    assert.ok(await claimJob(ctx,envelope(jobs[0]),'synthetic-stopped-process'));
    assert.ok(await authorizeJob(ctx,await claimJob(ctx,envelope(jobs[1]),'synthetic-stopped-process'),synthetic));
    console.log(JSON.stringify({committedClaim:true,committedAuthorization:true,providerCalls:calls}));
  } else {
    assert.equal(process.argv[2],'restart');await recoverWork(ctx);
    for(const job of jobs.slice(0,2))await runJob(ctx,envelope(job),synthetic,'synthetic-restarted-process');
    const states=[];
    for(const job of jobs.slice(0,2))states.push((await ctx.pool.query('SELECT state FROM dispatch_attempts WHERE job_id=$1',[job.jobId])).rows[0].state);
    console.log(JSON.stringify({providerCalls:calls,states}));
  }
} finally {await ctx.close();}
