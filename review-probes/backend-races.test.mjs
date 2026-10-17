import test from 'node:test';
import assert from 'node:assert/strict';
import {randomInt, randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {fixture} from '../tests/helpers/runtime.mjs';
import {sos, provider, deferred} from '../tests/helpers/dispatch.mjs';
import {waitForBlockedQueries} from '../tests/helpers/db-barriers.mjs';
import * as work from '../dist/notifications/dispatch.js';
import {createContext} from '../dist/db.js';

// All identities, transports and provider outcomes are synthetic. These probes
// exercise the public SQL/HTTP seams; they never start AWS or provider adapters.
async function holdMutation(f, table, operation) {
  const key = randomInt(1, 1_000_000_000);
  const barrier = await f.ctx.pool.connect();
  await barrier.query('SELECT pg_advisory_lock($1)', [key]);
  await f.ctx.pool.query(`CREATE FUNCTION review_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NEW; END $$`);
  await f.ctx.pool.query(`CREATE TRIGGER review_barrier BEFORE ${operation} ON ${table}
    FOR EACH ROW EXECUTE FUNCTION review_barrier()`);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await barrier.query('SELECT pg_advisory_unlock($1)', [key]);
    barrier.release();
  };
}

for (const first of ['close', 'sos']) {
  test(`trip closure versus SOS: force ${first} to hold the trip first`, {timeout: 15000}, async t => {
    const f = await fixture(t);
    const grant = await f.grant();
    const trip = await f.trip([grant]);
    assert.equal((await f.req('POST', `/v1/trips/${trip}/locations`, {observations: [
      {capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 5}
    ]})).status, 200);
    const release = await holdMutation(f, first === 'close' ? 'trips' : 'incidents', first === 'close' ? 'UPDATE' : 'INSERT');
    const operations = {
      close: () => f.req('POST', `/v1/trips/${trip}/commands`, {type: 'arrived'}),
      sos: () => f.req('POST', `/v1/trips/${trip}/sos`, {})
    };
    let a, b;
    try {
      a = operations[first]();
      await waitForBlockedQueries(f.ctx.pool, first === 'close' ? 'UPDATE trips SET status%' : 'INSERT INTO incidents%', 1);
      b = operations[first === 'close' ? 'sos' : 'close']();
      await waitForBlockedQueries(f.ctx.pool, 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%', 1);
    } finally { await release(); }
    const results = await Promise.all([a, b]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    const incident = results[first === 'sos' ? 0 : 1].body.id;
    assert.equal((await f.ctx.pool.query('SELECT status FROM incidents WHERE id=$1', [incident])).rows[0].status, 'active');
    assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, f.contact)).status, 403);
    const job = (await f.ctx.pool.query("SELECT id,version,class FROM jobs WHERE incident_id=$1 AND channel='sms'", [incident])).rows[0];
    let payload;
    await work.runJob(f.ctx, job, provider({async send(value) { payload = value; return {state: 'unknown'}; }}), 'review-after-close');
    assert.match(payload.text, /ubicación no disponible/);
    assert.doesNotMatch(payload.text, /última ubicación/);
  });
}

const stops = {
  resolve: {table: 'incidents', pattern: 'UPDATE incidents SET status%', run: (f, s) => f.req('POST', `/v1/incidents/${s.incident}/resolve`, {})},
  tripRevoke: {table: 'trip_grants', pattern: 'UPDATE trip_grants SET revoked_at%', run: (f, s) => f.req('POST', `/v1/trips/${s.trip}/contacts/${s.grant}/revoke`, {}, f.contact)},
  standingRevoke: {table: 'contact_grants', pattern: 'UPDATE contact_grants SET revoked_at%', run: (f, s) => f.req('POST', `/v1/contacts/${s.grant}/revoke`, {}, f.contact)}
};
for (const [name, stop] of Object.entries(stops)) for (const first of ['stop', 'authorize']) {
  test(`${name} versus authorization: force ${first} to commit first`, {timeout: 15000}, async t => {
    const f = await fixture(t);
    const s = await sos(f);
    const job = s.jobs.find(j => j.channel === 'sms');
    const claim = await work.claimJob(f.ctx, job, 'review-claim');
    assert.ok(claim);
    const release = await holdMutation(f, first === 'stop' ? stop.table : 'dispatch_attempts', first === 'stop' ? 'UPDATE' : 'INSERT');
    const p = provider();
    let authorization, stopping;
    try {
      if (first === 'stop') {
        stopping = stop.run(f, s);
        await waitForBlockedQueries(f.ctx.pool, stop.pattern, 1);
        authorization = work.authorizeJob(f.ctx, claim, p);
      } else {
        authorization = work.authorizeJob(f.ctx, claim, p);
        await waitForBlockedQueries(f.ctx.pool, 'INSERT INTO dispatch_attempts%', 1);
        stopping = stop.run(f, s);
      }
      await waitForBlockedQueries(f.ctx.pool, first === 'authorize' && name === 'standingRevoke'
        ? 'SELECT t.id FROM trips t JOIN trip_grants%' : 'SELECT * FROM trips WHERE id=$1 FOR UPDATE%', 1);
    } finally { await release(); }
    const [attempt, response] = await Promise.all([authorization, stopping]);
    assert.equal(response.status, 200);
    assert.equal(Boolean(attempt), first === 'authorize');
    let sends = 0;
    await work.runJob(f.ctx, job, provider({async send() { sends++; return {state: 'unknown'}; }}), 'stale-replay');
    assert.equal(sends, 0);
    if (attempt) {
      // An already authorized result may arrive after the stop; it stays a fact.
      await work.finishAttempt(f.ctx, attempt, {state: 'unknown'});
      assert.equal((await f.ctx.pool.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status, 'unknown');
    } else {
      assert.equal((await f.ctx.pool.query('SELECT status,version FROM jobs WHERE id=$1', [job.id])).rows[0].status, 'cancelled');
    }
  });
}

test('ordinary close cancels pending/claimed work and preserves an already authorized fact', async t => {
  const f = await fixture(t);
  const {trip, grant} = await sos(f);
  const jobs = [];
  for (let i = 0; i < 3; i++) {
    const job = {jobId: randomUUID(), version: 1, class: 'ordinary'};
    await f.ctx.pool.query(`INSERT INTO jobs(id,trip_id,grant_id,recipient_id,channel,class,status,created_at,due_at)
      VALUES($1,$2,$3,$4,'sms','ordinary','pending',$5,$5)`, [job.jobId, trip, grant, f.contactIdentity.id, f.ctx.clock()]);
    jobs.push(job);
  }
  await work.claimJob(f.ctx, jobs[1], 'claimed');
  const attempt = await work.authorizeJob(f.ctx, await work.claimJob(f.ctx, jobs[2], 'authorized'), provider());
  assert.ok(attempt);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'arrived'})).status, 200);
  f.advance(61000);
  await work.recoverWork(f.ctx);
  let sends = 0;
  for (const job of jobs) await work.runJob(f.ctx, job, provider({async send() { sends++; return {state: 'unknown'}; }}), 'replay');
  assert.equal(sends, 0);
  const statuses = (await f.ctx.pool.query("SELECT status FROM jobs WHERE trip_id=$1 AND class='ordinary' ORDER BY status", [trip])).rows.map(r => r.status);
  assert.deepEqual(statuses, ['cancelled', 'cancelled', 'unknown']);
});

test('a relay paused outside SQL may publish stale transport after resolution, but cannot authorize it', async t => {
  const f = await fixture(t);
  const {incident, jobs} = await sos(f);
  await f.ctx.pool.query('DELETE FROM outbox WHERE job_id<>$1', [jobs[0].id]);
  const entered = deferred(), release = deferred();
  let message;
  const relay = work.relayOnce(f.ctx, {async publish(value) { message = value; entered.resolve(); await release.promise; }}, 'paused-relay');
  try {
    await entered.promise;
    assert.equal((await f.req('POST', `/v1/incidents/${incident}/resolve`, {})).status, 200);
    assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state=\'idle in transaction\'')).rows[0].n, 0);
  } finally { release.resolve(); await relay; }
  let sends = 0;
  await work.runJob(f.ctx, message, provider({async send() { sends++; return {state: 'unknown'}; }}), 'stale-published');
  assert.equal(sends, 0);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM dispatch_attempts')).rows[0].n, 0);
});

for (const phase of ['claimed', 'authorized']) {
  test(`SIGKILL after committed ${phase}: recovery preserves one-attempt authority`, {timeout: 15000}, async t => {
    const f = await fixture(t);
    const {jobs} = await sos(f);
    const job = jobs.find(j => j.channel === 'sms');
    const child = fork(new URL('./helpers/crash-worker.mjs', import.meta.url), [phase, JSON.stringify(job), f.ctx.clock().toISOString()], {
      env: {PATH: process.env.PATH, TEST_DATABASE_URL: f.ctx.pool.options.connectionString}, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    const [result] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Synthetic child exited before reaching its committed boundary'); })]);
    assert.equal(result.phase, phase);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    assert.equal((await exited)[1], 'SIGKILL');
    const restarted = createContext(f.ctx.pool.options.connectionString, f.ctx.clock);
    t.after(() => restarted.close());
    f.advance(31000);
    await work.recoverWork(restarted);
    let sends = 0;
    const p = provider({async send() { sends++; return {state: 'unknown'}; }});
    await Promise.all([work.runJob(restarted, job, p, 'restart-a'), work.runJob(restarted, job, p, 'restart-b')]);
    assert.equal(sends, phase === 'claimed' ? 1 : 0);
    assert.equal((await restarted.pool.query('SELECT count(*)::int AS n FROM dispatch_attempts WHERE job_id=$1', [job.id])).rows[0].n, 1);
    assert.equal((await restarted.pool.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status, 'unknown');
  });
}

test('a stale reconciliation result cannot regress a concurrently committed delivery callback', async t => {
  const f = await fixture(t);
  const {jobs} = await sos(f);
  const job = jobs.find(j => j.channel === 'sms');
  await work.runJob(f.ctx, job, provider(), 'initial');
  f.advance(61000);
  const entered = deferred(), release = deferred();
  const reconciliation = work.reconcileOnce(f.ctx, provider({async read() {
    entered.resolve(); await release.promise;
    return {state: 'accepted', messageId: 'msg_fixture_1', status: 'queued'};
  }}));
  try {
    await entered.promise;
    const event = {id: 'review-delivered', type: 'message.delivered', timestamp: f.ctx.clock().getTime(),
      projectId: 'prj_fixture', senderId: 'snd_fixture', data: {messageId: 'msg_fixture_1', channel: 'sms', to: '+5511999990000', status: 'delivered'}};
    await work.saveCallback(f.ctx, event, Buffer.from(JSON.stringify(event)));
  } finally { release.resolve(); await reconciliation; }
  assert.equal((await f.ctx.pool.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status, 'delivered');
  const fact = (await f.ctx.pool.query('SELECT delivery_status,next_reconcile_at FROM dispatch_attempts WHERE job_id=$1', [job.id])).rows[0];
  assert.deepEqual(fact, {delivery_status: 'delivered', next_reconcile_at: null});
});

for (const elapsed of [999, 1001]) test(`authorization after quota wait: ${elapsed}ms of a 1000ms remaining lifetime`, {timeout: 15000}, async t => {
  const f = await fixture(t);
  const {jobs} = await sos(f);
  const job = jobs.find(j => j.channel === 'sms');
  const claim = await work.claimJob(f.ctx, job, 'expiry-review');
  await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1', [job.id, new Date(f.ctx.clock().getTime() + 1000)]);
  await f.ctx.pool.query("INSERT INTO quota_accounts VALUES('prj_fixture')");
  const blocker = await f.ctx.pool.connect();
  let authorization;
  try {
    await blocker.query('BEGIN');
    await blocker.query("SELECT * FROM quota_accounts WHERE project_id='prj_fixture' FOR UPDATE");
    authorization = work.authorizeJob(f.ctx, claim, provider());
    await waitForBlockedQueries(f.ctx.pool, 'SELECT project_id FROM quota_accounts%', 1);
    f.advance(elapsed);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const result = await authorization;
  const fact = (await f.ctx.pool.query(`SELECT j.status,j.expires_at,a.authorized_at FROM jobs j
    LEFT JOIN dispatch_attempts a ON a.job_id=j.id WHERE j.id=$1`, [job.id])).rows[0];
  t.diagnostic(JSON.stringify({elapsedMs: elapsed, checkedAt: f.ctx.clock().toISOString(), ...fact}));
  assert.equal(Boolean(result), elapsed < 1000, 'only a job still valid when authorization commits may receive send authority');
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM dispatch_attempts WHERE job_id=$1', [job.id])).rows[0].n, elapsed < 1000 ? 1 : 0);
});
