// Independent probes against an immutable candidate checkout, never the author fixture pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fixture} from '../helpers/runtime.mjs';
import {provider, qualification, deferred, sos} from '../helpers/dispatch.mjs';
import * as dispatch from '../../dist/notifications/dispatch.js';
import {createZavuProvider} from '../../dist/notifications/zavu.js';

async function http(f) {
  await f.app.listen({host: '127.0.0.1', port: 0});
  const origin = `http://127.0.0.1:${f.app.server.address().port}`;
  return async (method, path, body, token = f.driver) => {
    const response = await fetch(origin + path, {method, headers: {Authorization: `Bearer ${token}`,
      'Idempotency-Key': randomUUID(), ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: response.status, body: await response.json()};
  };
}
async function worker(f, message, status = 429) {
  const child = fork('scripts/app-integration/pr83-review-worker.mjs', [], {
    env: {PATH: process.env.PATH, HOME: process.env.HOME, TEST_DATABASE_URL: f.ctx.pool.options.connectionString,
      ANDES_APP_INTEGRATION: 'synthetic-only', ZAVU_LIVE_SEND: 'false'}, silent: true, execArgv: [],
  });
  child.stdout.resume(); child.stderr.resume();
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
  try {
    const ready = once(child, 'message', {signal: abort.signal});
    const exit = once(child, 'exit', {signal: abort.signal});
    child.send({message, clock: f.ctx.clock().toISOString(), status});
    const [result] = await ready; assert.equal(result.failed, undefined);
    const [code] = await exit; assert.equal(code, 0); return result;
  } finally {clearTimeout(timer); abort.abort(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');}
}
const row = async (f, id) => (await f.ctx.pool.query('SELECT status,version,retry_count,due_at FROM jobs WHERE id=$1', [id])).rows[0];

test('native HTTP rejects unparseable capture instants atomically and accepts a valid control', async t => {
  const f = await fixture(t), trip = await f.trip(), request = await http(f);
  const valid = {capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 5};
  for (const capturedAt of ['2999-01-01T00:00:00+05', '2026-10-17T23:59:60Z']) {
    const response = await request('POST', `/v1/trips/${trip}/locations`, {observations: [valid, {...valid, capturedAt}]});
    assert.equal(response.status, 400, 'Malformed capture must not enter a partially committed batch');
    assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM locations')).rows[0].n, 0);
  }
  assert.equal((await request('POST', `/v1/trips/${trip}/locations`, {observations: [valid]})).status, 200);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM locations')).rows[0].n, 1);
});

test('native draft and confirmation canonicalize locale and preserve qualified channel eligibility', async t => {
  const f = await fixture(t), request = await http(f), grant = await f.grant();
  const draft = await request('POST', '/v1/trip-drafts', {text: 'SYNTHETIC reviewer', fields: {
    truckId: await f.truck(), origin: 'A', destination: 'B', country: 'BR', locale: 'pt-br', timeZone: 'America/Sao_Paulo'}});
  assert.equal(draft.status, 200); assert.equal(draft.body.fields.locale, 'pt-BR');
  assert.equal((await request('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [grant], fields: {locale: 'not_a_locale'}})).status, 400);
  const trip = await request('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [grant], fields: {locale: 'PT-br'}});
  assert.equal(trip.status, 200); assert.equal(trip.body.fields.locale, 'pt-BR');
  assert.equal((await f.ctx.pool.query('SELECT locale FROM trips WHERE id=$1', [trip.body.id])).rows[0].locale, 'pt-BR');
  const incident = await request('POST', `/v1/trips/${trip.body.id}/sos`, {});
  const jobs = (await f.ctx.pool.query("SELECT status FROM jobs WHERE incident_id=$1 AND channel<>'group'", [incident.body.id])).rows;
  assert.equal(jobs.length, 3); assert.ok(jobs.every(j => j.status === 'pending'));
});

test('native verified-phone binding survives absent/unverified claims without a row rewrite; verified changes still invalidate old consent', async t => {
  const f = await fixture(t), {jobs} = await sos(f), request = await http(f);
  const identity = async () => (await f.ctx.pool.query('SELECT phone,phone_verified,xmin::text AS revision FROM identities WHERE id=$1', [f.contactIdentity.id])).rows[0];
  const original = await identity();
  for (const claims of [{phone_number: undefined, phone_number_verified: undefined}, {phone_number: '+5511999991111', phone_number_verified: false}]) {
    assert.equal((await request('GET', '/v1/me', undefined, await f.token('contact', claims))).status, 200);
    assert.deepEqual(await identity(), original);
  }
  assert.ok(await dispatch.authorizeJob(f.ctx, await dispatch.claimJob(f.ctx, jobs[0], 'verified-control'), provider()));
  assert.equal((await request('GET', '/v1/me', undefined, await f.token('contact', {phone_number: '+5511999991111'}))).status, 200);
  assert.notEqual((await identity()).revision, original.revision);
  assert.equal(await dispatch.authorizeJob(f.ctx, await dispatch.claimJob(f.ctx, jobs[1], 'changed-phone'), provider()), null);
  assert.equal((await row(f, jobs[1].id)).status, 'cancelled');
});

test('consumer shutdown drains a real authorized SQL attempt through the actual provider adapter without forwarding cancellation', async t => {
  const f = await fixture(t), {jobs} = await sos(f), started = deferred(), release = deferred();
  let signal, calls = 0, finished = false;
  const p = createZavuProvider(qualification, 'synthetic-never-live', async (_target, init) => {
    calls++; signal = init.signal; const payload = JSON.parse(init.body); started.resolve();
    await release.promise;
    if (init.signal.aborted) throw Error('synthetic shutdown abort');
    return new Response(JSON.stringify({message: {id: 'synthetic-shutdown-message', status: 'queued', direction: 'outbound', channel: payload.channel, to: payload.to}}), {status: 202});
  });
  const abort = new AbortController(); let batches = 0;
  const transport = {async receive() {
    if (batches++ === 0) return [{body: jobs[0], receipt: 'synthetic-receipt'}];
    if (!abort.signal.aborted) await once(abort.signal, 'abort'); return [];
  }, async ack() {}, async defer() {assert.fail('No saturation expected');}};
  const running = dispatch.consume(f.ctx, transport, p, 'emergency', {sms: 1, whatsapp: 1, voice: 1}, abort.signal).then(() => {finished = true;});
  await started.promise; abort.abort(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(finished, false, 'Shutdown must await the authorized send');
  const forwardedAbort = signal.aborted; release.resolve(); await running;
  assert.equal(forwardedAbort, false);
  assert.equal((await f.ctx.pool.query('SELECT provider_message_id FROM dispatch_attempts')).rows[0].provider_message_id, 'synthetic-shutdown-message');
  await dispatch.runJob(f.ctx, jobs[1], p, 'already-stopped', abort.signal); assert.equal(calls, 1);
});

test('definitive provider classification stays separate from ambiguous responses', async () => {
  for (const [status, retryable] of [[401,true], [402,true], [403,true], [429,true], [400,false], [404,false]]) {
    const p = createZavuProvider(qualification, 'synthetic-never-live', async () => new Response('{"error":{"code":"synthetic_rejection"}}', {status}));
    const result = await p.send(p.payload({attemptId: 'synthetic-attempt', channel: 'sms', to: '+15555550101', country: 'BR', locale: 'pt-BR', summary: 'synthetic'}));
    assert.deepEqual(result, {state: 'rejected', code: 'synthetic_rejection', retryable});
  }
  for (const [status, body] of [[500,'{"code":"synthetic_failure"}'], [429,'{}'], [429,'not-json']]) {
    const p = createZavuProvider(qualification, 'synthetic-never-live', async () => new Response(body, {status}));
    assert.deepEqual(await p.send(p.payload({attemptId: 'synthetic-attempt', channel: 'sms', to: '+15555550101', country: 'BR', locale: 'pt-BR', summary: 'synthetic'})), {state: 'unknown'});
  }
});

test('retry budget and exact backoff persist across actual worker-process restarts and duplicate transport', async t => {
  const f = await fixture(t), {jobs} = await sos(f), original = jobs.find(j => j.channel === 'sms');
  let message = {...original}, allKeys = [];
  for (let i = 0; i < 4; i++) {
    const results = i === 1 ? await Promise.all([worker(f, message), worker(f, message)]) : [await worker(f, message)];
    assert.equal(results.reduce((sum, r) => sum + r.calls, 0), 1);
    allKeys.push(...results.flatMap(r => r.keys));
    const state = await row(f, original.id);
    assert.equal(state.retry_count, Math.min(i + 1, 3));
    if (i < 3) {
      assert.equal(state.status, 'pending'); assert.equal(state.version, original.version + i + 1);
      assert.equal(state.due_at.getTime() - f.ctx.clock().getTime(), 30000 * 2 ** i);
      message = {...message, version: state.version};
      assert.equal((await worker(f, message)).calls, 0, 'Early delivery cannot spend another attempt');
      f.advance(30000 * 2 ** i);
      assert.equal((await worker(f, original)).calls, 0, 'Old version cannot consume new authority');
    } else assert.equal(state.status, 'rejected');
  }
  assert.equal(new Set(allKeys).size, 4, 'Only definitive rejections create fresh provider attempt keys');
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts WHERE job_id=$1', [original.id])).rows[0].n, 4);
});

for (const stop of ['resolution', 'revocation', 'expiry']) test(`retry reauthorization blocks ${stop} after a definitive rejection`, async t => {
  const f = await fixture(t), {jobs, trip, incident, grant} = await sos(f), message = jobs.find(j => j.channel === 'sms');
  assert.equal((await worker(f, message)).calls, 1);
  const next = {...message, version: (await row(f, message.id)).version};
  if (stop === 'resolution') await f.req('POST', `/v1/incidents/${incident}/resolve`, {});
  if (stop === 'revocation') await f.req('POST', `/v1/trips/${trip}/contacts/${grant}/revoke`, {}, f.contact);
  if (stop === 'expiry') await f.ctx.pool.query('UPDATE jobs SET expires_at=$2 WHERE id=$1', [message.id, new Date(f.ctx.clock().getTime() + 1000)]);
  f.advance(30000);
  assert.equal((await worker(f, next)).calls, 0);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts WHERE job_id=$1', [message.id])).rows[0].n, 1);
});

test('ambiguous send result never returns to a new sendable version after recovery', async t => {
  const f = await fixture(t), {jobs} = await sos(f), message = jobs.find(j => j.channel === 'sms');
  assert.equal((await worker(f, message, 500)).calls, 1);
  f.advance(600000); await dispatch.recoverWork(f.ctx);
  assert.equal((await worker(f, message)).calls, 0);
  const state = await row(f, message.id); assert.equal(state.status, 'unknown'); assert.equal(state.version, message.version);
  assert.equal(state.retry_count, 0);
});
