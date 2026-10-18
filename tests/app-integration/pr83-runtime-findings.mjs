// Bounded verification of the two dispatch residuals raised on the exact PR83 head.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../helpers/runtime.mjs';
import {sos, provider} from '../helpers/dispatch.mjs';
import {waitForBlockedQueries} from '../helpers/db-barriers.mjs';
import {claimJob, authorizeJob, recoverWork} from '../../dist/notifications/dispatch.js';

async function accountLock(f, p) {
  await f.ctx.pool.query('INSERT INTO quota_accounts VALUES($1) ON CONFLICT DO NOTHING', [p.qualification.accountId]);
  const holder = await f.ctx.pool.connect();
  await holder.query('BEGIN');
  await holder.query('SELECT project_id FROM quota_accounts WHERE project_id=$1 FOR UPDATE', [p.qualification.accountId]);
  return holder;
}
for (const duringWait of [false, true]) test(`verified phone changes ${duringWait ? 'during quota wait' : 'before authorization'} must block an old-destination attempt`, async t => {
  const f = await fixture(t), {jobs} = await sos(f), p = provider();
  const claim = await claimJob(f.ctx, jobs.find(j => j.channel === 'sms'), 'q46-phone-binding');
  let holder, pending;
  try {
    if (duringWait) {
      holder = await accountLock(f, p);
      pending = authorizeJob(f.ctx, claim, p);
      await waitForBlockedQueries(f.ctx.pool, 'SELECT project_id FROM quota_accounts%', 1);
    }
    // Actual signed HTTP identity update, not a manual rewrite of the consent grant.
    await f.app.listen({host: '127.0.0.1', port: 0});
    const jwt = await f.token('contact', {phone_number: '+5511999991111'});
    const response = await fetch(`http://127.0.0.1:${f.app.server.address().port}/v1/me`, {headers: {Authorization: `Bearer ${jwt}`}});
    assert.equal(response.status, 200); await response.json();
    const identity = (await f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1', [f.contactIdentity.id])).rows[0];
    assert.equal(identity.phone, '+5511999991111'); assert.equal(identity.phone_verified, true);
    if (holder) {await holder.query('COMMIT'); holder.release(); holder = null;}
    const attempt = await (pending ?? authorizeJob(f.ctx, claim, p));
    assert.equal(Boolean(attempt), false, 'Current verified destination no longer matches accepted consent');
  } finally {
    if (holder) {await holder.query('ROLLBACK'); holder.release();}
    await pending?.catch(() => {});
  }
});

for (const elapsed of [1000, 30001]) test(`job expiry after quota wait ${elapsed}ms must cancel expired work`, async t => {
  const f = await fixture(t), {jobs} = await sos(f), p = provider(), message = jobs.find(j => j.channel === 'sms');
  await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1', [message.id, new Date(f.ctx.clock().getTime() + 1000)]);
  const claim = await claimJob(f.ctx, message, 'q46-joint-expiry');
  const holder = await accountLock(f, p); let pending, released = false;
  try {
    pending = authorizeJob(f.ctx, claim, p);
    await waitForBlockedQueries(f.ctx.pool, 'SELECT project_id FROM quota_accounts%', 1);
    f.advance(elapsed);
    await holder.query('COMMIT'); holder.release(); released = true;
    assert.equal(await pending, null);
    await recoverWork(f.ctx);
    const job = (await f.ctx.pool.query('SELECT status FROM jobs WHERE id=$1', [message.id])).rows[0];
    assert.equal(job.status, 'cancelled', 'An expired job must not recover into permanently pending work');
    assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts WHERE job_id=$1', [message.id])).rows[0].n, 0);
  } finally {
    if (!released) {await holder.query('ROLLBACK'); holder.release();}
    await pending?.catch(() => {});
  }
});
