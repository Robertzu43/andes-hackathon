import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';
import {runtime, sos, provider, qualification, deferred} from './helpers/dispatch.mjs';

// Critical findings at c752de8 that Robert chose to fix before the backend reaches main.

test('shutdown never aborts an authorized send, and stops claiming new work', async t => {
  const d = await runtime(); const f = await fixture(t); const {jobs} = await sos(f);
  const started = deferred(); const release = deferred();
  const p = provider({async send(_payload, signal) { started.resolve(); await release.promise; return signal?.aborted ? {state: 'unknown'} : {state: 'accepted', messageId: 'msg_shutdown', status: 'queued'}; }});
  const abort = new AbortController();
  const running = d.runJob(f.ctx, jobs[0], p, 'shutdown', abort.signal);
  await started.promise; abort.abort(); release.resolve(); await running;
  assert.deepEqual((await f.ctx.pool.query('SELECT state,provider_message_id FROM dispatch_attempts')).rows, [{state: 'accepted', provider_message_id: 'msg_shutdown'}]);
  await d.runJob(f.ctx, jobs[1], p, 'shutdown', abort.signal);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts')).rows[0].n, 1);
  assert.equal((await f.ctx.pool.query('SELECT status FROM jobs WHERE id=$1', [jobs[1].id])).rows[0].status, 'pending');
});

test('capture times that cannot be parsed are rejected instead of slipping past the bounds', async t => {
  const f = await fixture(t); const trip = await f.trip();
  for (const capturedAt of ['2999-01-01T00:00:00+05', '2026-10-17T23:59:60Z']) {
    assert.equal((await f.req('POST', `/v1/trips/${trip}/locations`, {observations: [{capturedAt, latitude: -12, longitude: -77, accuracy: 5}]})).status, 400, capturedAt);
  }
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM locations')).rows[0].n, 0);
});

test('a non-canonical locale is stored canonically so alert channels still match', async t => {
  const f = await fixture(t); const grant = await f.grant();
  const draft = await f.draft({locale: 'pt-br'});
  assert.equal(draft.body.fields.locale, 'pt-BR');
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [grant], fields: {locale: 'PT-br'}})).body.id;
  assert.equal((await f.ctx.pool.query('SELECT locale FROM trips WHERE id=$1', [trip])).rows[0].locale, 'pt-BR');
  const incident = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  assert.deepEqual((await f.ctx.pool.query("SELECT DISTINCT status FROM jobs WHERE incident_id=$1 AND channel<>'group'", [incident])).rows, [{status: 'pending'}]);
});

test('trips stored with a non-canonical locale before the fix still match every qualified channel', async t => {
  const d = await runtime(); const f = await fixture(t); const grant = await f.grant(); const trip = await f.trip([grant]);
  await f.ctx.pool.query("UPDATE trips SET locale='pt-br' WHERE id=$1", [trip]); // a row written before canonical storage
  const incident = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  const jobs = (await f.ctx.pool.query("SELECT id,version,class,channel,status FROM jobs WHERE incident_id=$1 AND channel<>'group' ORDER BY channel", [incident])).rows;
  assert.deepEqual(jobs.map(j => `${j.channel}:${j.status}`), ['sms:pending', 'voice:pending', 'whatsapp:pending']);
  for (const job of jobs) assert.ok(await d.authorizeJob(f.ctx, await d.claimJob(f.ctx, job, 'legacy-locale'), provider()), job.channel);
});

test('a token without a verified phone never downgrades the stored phone or cancels SOS jobs', async t => {
  const d = await runtime(); const f = await fixture(t); const {jobs} = await sos(f);
  for (const claims of [{phone_number: undefined, phone_number_verified: undefined}, {phone_number_verified: false}]) {
    assert.equal((await f.req('GET', '/v1/me', undefined, await f.token('contact', claims))).status, 200);
  }
  assert.deepEqual((await f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1', [f.contactIdentity.id])).rows, [{phone: '+15555550100', phone_verified: true}]);
  assert.ok(await d.authorizeJob(f.ctx, await d.claimJob(f.ctx, jobs[0], 'phone'), provider()));
  await f.req('GET', '/v1/me', undefined, await f.token('contact', {phone_number: '+15555550111'}));
  assert.equal((await f.ctx.pool.query('SELECT phone FROM identities WHERE id=$1', [f.contactIdentity.id])).rows[0].phone, '+15555550111');
  // Outside demo sign-in an unchanged identity is never rewritten, so requests take no identity row lock or write.
  const version = async () => (await f.ctx.pool.query('SELECT xmin::text AS v, last_seen_at FROM identities WHERE id=$1', [f.contactIdentity.id])).rows[0];
  const before = await version(); f.advance(60000);
  assert.equal((await f.req('GET', '/v1/me', undefined, await f.token('contact', {phone_number: '+15555550111'}))).status, 200);
  assert.deepEqual(await version(), before);
});

test('rate-limit and auth/payment rejections retry within a bounded persisted budget; permanent ones stay terminal', async t => {
  const {createZavuProvider} = await import('../dist/notifications/zavu.js');
  for (const [status, retryable] of [[429, true], [401, true], [402, true], [403, true], [400, false], [404, false]]) {
    const p = createZavuProvider(qualification, 'fixture', async () => new Response(JSON.stringify({code: 'fixture_code'}), {status}));
    assert.deepEqual(await p.send(p.payload({attemptId: 'a', to: '+15555550101', channel: 'sms', country: 'BR', locale: 'pt-BR', summary: 's'})), {state: 'rejected', code: 'fixture_code', retryable}, String(status));
  }
  const d = await runtime(); const f = await fixture(t); const {jobs} = await sos(f);
  const sms = jobs.find(j => j.channel === 'sms'); let calls = 0;
  const limited = provider({async send() { calls++; return {state: 'rejected', code: 'rate_limit_exceeded', retryable: true}; }});
  let message = {jobId: sms.id, version: sms.version, class: sms.class};
  for (let i = 1; i <= 3; i++) {
    await d.runJob(f.ctx, message, limited, 'retry');
    const row = (await f.ctx.pool.query('SELECT status,version,retry_count,due_at FROM jobs WHERE id=$1', [sms.id])).rows[0];
    assert.deepEqual({status: row.status, retry_count: row.retry_count}, {status: 'pending', retry_count: i});
    assert.ok(row.due_at > f.ctx.clock(), 'retry waits for its backoff');
    assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM outbox WHERE job_id=$1 AND job_version=$2', [sms.id, row.version])).rows[0].n, 1);
    await d.runJob(f.ctx, {...message, version: row.version}, limited, 'too-early');
    assert.equal(calls, i, 'no send before the backoff elapses');
    f.advance(row.due_at.getTime() - f.ctx.clock().getTime()); message = {...message, version: row.version};
  }
  await d.runJob(f.ctx, message, limited, 'retry');
  assert.deepEqual((await f.ctx.pool.query('SELECT status,retry_count FROM jobs WHERE id=$1', [sms.id])).rows, [{status: 'rejected', retry_count: 3}]);
  assert.equal(calls, 4);
  const voice = jobs.find(j => j.channel === 'voice');
  await d.runJob(f.ctx, voice, provider({async send() { return {state: 'rejected', code: 'invalid_number', retryable: false}; }}), 'permanent');
  assert.deepEqual((await f.ctx.pool.query('SELECT status,retry_count FROM jobs WHERE id=$1', [voice.id])).rows, [{status: 'rejected', retry_count: 0}]);
});
