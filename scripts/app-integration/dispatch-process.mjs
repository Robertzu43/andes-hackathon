// SQL-authorized dispatch exercised with an in-process stub; never construct AWS.
import assert from 'node:assert/strict';
import {appendFileSync, readFileSync} from 'node:fs';
import {createContext} from '../../dist/db.js';
import {claimJob, authorizeJob, recoverWork, runJob} from '../../dist/notifications/dispatch.js';
import {createZavuProvider} from '../../dist/notifications/zavu.js';
import {runDatabaseUrl} from './runtime.mjs';

assert.equal(process.env.ANDES_APP_INTEGRATION, 'synthetic-only');
runDatabaseUrl(process.env.APP_INTEGRATION_DATABASE_URL);
const ctx = createContext(process.env.APP_INTEGRATION_DATABASE_URL,
  () => new Date(readFileSync(process.env.APP_INTEGRATION_CLOCK, 'utf8')), 2);
const qualification = {accountId: 'synthetic_q46', senderId: 'synthetic_q46', live: true,
  evidence: 'syntheticfixture: stub only; no live qualification', dailyLimit: 100, channelDailyLimit: 50, minuteLimit: 30, emergencyReserve: 5,
  entries: ['sms', 'whatsapp', 'voice'].map(channel => ({channel, country: 'BR', locale: 'pt-BR',
    evidence: 'syntheticfixture: stub only', text: 'SYNTHETIC', templateId: 'synthetic', summaryVariable: '1', voiceLanguage: 'pt-BR'}))};
const stub = {...createZavuProvider(qualification, 'synthetic-not-a-credential', async () => { throw Error('External HTTP forbidden in this fixture'); }),
  async send(payload) {
    appendFileSync(process.env.APP_INTEGRATION_STUB_LOG, JSON.stringify({channel: payload.channel, attemptId: payload.metadata.attemptId}) + '\n');
    return {state: 'accepted', messageId: `synthetic_${payload.metadata.attemptId}`, status: 'queued'};
  }, async read() { return {state: 'missing'}; }};
try {
  const jobs = JSON.parse(process.env.APP_INTEGRATION_JOBS);
  if (process.argv[2] === 'abandon') {
    assert.ok(await claimJob(ctx, jobs[0], 'synthetic-before-restart'));
    assert.ok(await authorizeJob(ctx, await claimJob(ctx, jobs[1], 'synthetic-before-restart'), stub));
  } else {
    assert.equal(process.argv[2], 'recover');
    await recoverWork(ctx);
    for (const job of jobs) await runJob(ctx, job, stub, 'synthetic-after-restart');
  }
} finally {await ctx.close();}
