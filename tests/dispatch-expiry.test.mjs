import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/runtime.mjs';
import { sos, provider } from './helpers/dispatch.mjs';
import { waitForBlockedQueries } from './helpers/db-barriers.mjs';
import { authorizeJob, claimJob } from '../dist/notifications/dispatch.js';

const cases = [
  ['job lifetime', 1000, 999, true],
  ['job lifetime', 1000, 1000, false],
  ['job lifetime', 1000, 1001, false],
  ['claim lease', 60000, 29999, true],
  ['claim lease', 60000, 30000, false],
  ['claim lease', 60000, 30001, false],
];

for (const [boundary, lifetime, elapsed, allowed] of cases) {
  test(`quota wait rechecks ${boundary} after ${elapsed}ms`, { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const { jobs } = await sos(f);
    const job = jobs.find(value => value.channel === 'sms');
    const claim = await claimJob(f.ctx, job, 'expiry-regression');
    assert.ok(claim);
    await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1',
      [job.id, new Date(f.ctx.clock().getTime() + lifetime)]);
    await f.ctx.pool.query("INSERT INTO quota_accounts VALUES('prj_fixture')");
    const blocker = await f.ctx.pool.connect();
    let authorization;
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT * FROM quota_accounts WHERE project_id='prj_fixture' FOR UPDATE");
      authorization = authorizeJob(f.ctx, claim, provider());
      await waitForBlockedQueries(f.ctx.pool, 'SELECT project_id FROM quota_accounts%', 1);
      f.advance(elapsed);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    const result = await authorization;
    assert.equal(Boolean(result), allowed);
    const attempts = await f.ctx.pool.query('SELECT authorized_at FROM dispatch_attempts WHERE job_id=$1', [job.id]);
    assert.equal(attempts.rowCount, allowed ? 1 : 0);
    const reservations = await f.ctx.pool.query('SELECT reserved_at FROM quota_reservations');
    const requests = await f.ctx.pool.query("SELECT reserved_at FROM provider_requests WHERE kind='send'");
    assert.equal(reservations.rowCount, allowed ? 1 : 0);
    assert.equal(requests.rowCount, allowed ? 1 : 0);
    if (allowed) {
      assert.deepEqual(attempts.rows[0].authorized_at, f.ctx.clock());
      assert.deepEqual(reservations.rows[0].reserved_at, f.ctx.clock());
      assert.deepEqual(requests.rows[0].reserved_at, f.ctx.clock());
    }
  });
}
