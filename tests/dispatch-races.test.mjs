import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from './helpers/runtime.mjs';
import {sos, provider} from './helpers/dispatch.mjs';

// Q48's dispatch race probes on #61/#83 (e9d960d), kept as regressions. Clock advances are injected; lock waits are real.
const work = await import('../dist/notifications/dispatch.js');

/** A context whose pool records the backend PID of the operation under test, so barriers watch only that operation. */
function operationContext(f) {
  const target = {pid: null};
  const pool = {query: (...args) => f.ctx.pool.query(...args), connect: async () => { const client = await f.ctx.pool.connect(); target.pid = client.processID; return client; }};
  return {ctx: {...f.ctx, pool}, target};
}
async function blocked(f, target, pattern) {
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    if (target.pid && (await f.ctx.pool.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1 AND query LIKE $2 AND wait_event_type='Lock'`, [target.pid, pattern])).rows[0].n) return;
    await delay(10);
  }
  assert.fail(`operation did not block on ${pattern}`);
}
/** Run the phase while the barrier holds, then always release it and await the operation, even if the phase fails. */
async function finishBlocked(pending, connection, phase) {
  pending.catch(() => {});
  let error, result;
  try { await phase(); } catch (e) { error = e; }
  try { await connection.query('ROLLBACK'); } catch (e) { error ??= e; }
  connection.release();
  try { result = await pending; } catch (e) { error ??= e; }
  if (error) throw error;
  return result;
}
// Each test gets its own quota project: the provider advisory lock is database-wide, not per schema.
function qualified() { const p = provider(); return {...p, qualification: {...p.qualification, accountId: `prj_race_${randomUUID().replaceAll('-', '')}`}}; }
async function quotaBlock(f, p) {
  await f.ctx.pool.query('INSERT INTO quota_accounts VALUES($1)', [p.qualification.accountId]);
  const connection = await f.ctx.pool.connect(); await connection.query('BEGIN');
  await connection.query('SELECT project_id FROM quota_accounts WHERE project_id=$1 FOR UPDATE', [p.qualification.accountId]);
  return connection;
}
const state = async (f, job) => (await f.ctx.pool.query('SELECT status,version FROM jobs WHERE id=$1', [job.id])).rows[0];
const smsJob = async f => { const s = await sos(f); return {...s, job: s.jobs.find(j => j.channel === 'sms')}; };

for (const scenario of [{name: 'job expiry only', lifetime: 1000, before: 0, wait: 1001}, {name: 'job and lease expiry together', lifetime: 30000, before: 29900, wait: 101}]) {
  test(`a job that expires during the quota wait ends cancelled: ${scenario.name}`, {timeout: 15000}, async t => {
    const f = await fixture(t); const {job} = await smsJob(f);
    await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1', [job.id, new Date(f.ctx.clock().getTime() + scenario.lifetime)]);
    const claim = await work.claimJob(f.ctx, job, 'race-expiry'); assert.ok(claim);
    f.advance(scenario.before);
    const p = qualified(), connection = await quotaBlock(f, p), op = operationContext(f);
    const result = await finishBlocked(work.authorizeJob(op.ctx, claim, p), connection, async () => {
      await blocked(f, op.target, 'SELECT project_id FROM quota_accounts%'); await delay(scenario.wait); f.advance(scenario.wait);
    });
    assert.equal(result, null); await work.recoverWork(f.ctx);
    assert.deepEqual(await state(f, job), {status: 'cancelled', version: job.version + 1});
    assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts WHERE job_id=$1', [job.id])).rows[0].n, 0);
  });
}

for (const changed of [false, true]) {
  test(`the contact's verified phone is re-read after the quota wait (changed: ${changed})`, {timeout: 15000}, async t => {
    const f = await fixture(t); const {job} = await smsJob(f);
    const claim = await work.claimJob(f.ctx, job, 'race-phone'); const p = qualified(), connection = await quotaBlock(f, p), op = operationContext(f);
    const phone = changed ? '+15555550188' : '+15555550100';
    const result = await finishBlocked(work.authorizeJob(op.ctx, claim, p), connection, async () => {
      await blocked(f, op.target, 'SELECT project_id FROM quota_accounts%');
      assert.equal((await f.req('GET', '/v1/me', undefined, await f.token('contact', {phone_number: phone, phone_number_verified: true}))).status, 200);
      assert.equal((await f.ctx.pool.query('SELECT phone FROM identities WHERE id=$1', [f.contactIdentity.id])).rows[0].phone, phone);
    });
    assert.equal(Boolean(result), !changed, 'a committed verified-phone change must stop the old destination');
    if (changed) assert.deepEqual(await state(f, job), {status: 'cancelled', version: job.version + 1});
  });
}
