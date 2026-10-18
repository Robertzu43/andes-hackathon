// Only the three explicitly requested PR83 merge gates; no new application feature.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {fixture} from '../helpers/runtime.mjs';
import {provider, sos} from '../helpers/dispatch.mjs';
import {runJob} from '../../dist/notifications/dispatch.js';

async function entry(f, extra = {}) {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = fork('dist/server.js', [], {silent: true, execArgv: [], env: {
    PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: f.ctx.pool.options.connectionString,
    PORT: String(port), ZAVU_LIVE_SEND: 'false', ...extra,
  }});
  child.stdout.resume(); child.stderr.resume();
  return {child, origin: `http://127.0.0.1:${port}`, async close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try {await exited;} finally {clearTimeout(timer);}
  }};
}
async function healthy(server) {
  for (let i = 0; i < 100; i++) {
    assert.equal(server.child.exitCode, null, 'Actual server exited before health readiness');
    try {if ((await fetch(server.origin + '/health')).status === 200) return;} catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('Actual server did not become ready');
}

test('actual server defaults demo off and requires explicit activation', {timeout: 15000}, async t => {
  const f = await fixture(t);
  const missing = await entry(f); // Neither DEMO_MODE nor OIDC configuration exists.
  try {
    const exit = once(missing.child, 'exit');
    let timer;
    try {
      const [code] = await Promise.race([exit, new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Default startup silently enabled demo without OIDC')), 2000);})]);
      assert.notEqual(code, 0);
    } finally {clearTimeout(timer);}
  } finally {await missing.close();}
  const standard = await entry(f, {OIDC_ISSUER: 'https://synthetic.invalid', OIDC_AUDIENCE: 'synthetic-review', OIDC_JWKS_URL: 'https://synthetic.invalid/jwks'});
  try {
    await healthy(standard);
    assert.equal((await fetch(standard.origin + '/v1/demo/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 401);
  } finally {await standard.close();}
  const explicit = await entry(f, {DEMO_MODE: 'true'});
  try {
    await healthy(explicit);
    const response = await fetch(explicit.origin + '/v1/demo/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
    assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.synthetic, true);
    // Tokens are intentionally neither returned as test evidence nor logged.
  } finally {await explicit.close();}
});

test('empty allowedDestinations denies every provider attempt', async t => {
  const f = await fixture(t), {jobs} = await sos(f); let calls = 0;
  const p = provider({async send() {calls++; return {state: 'accepted', messageId: 'synthetic-allowlist', status: 'queued'};}});
  p.qualification = {...p.qualification, allowedDestinations: []};
  await runJob(f.ctx, jobs.find(j => j.channel === 'sms'), p, 'q46-empty-allowlist');
  assert.equal(calls, 0);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts')).rows[0].n, 0);
  const state = (await f.ctx.pool.query("SELECT status,unavailable_reason FROM jobs WHERE incident_id IS NOT NULL AND channel='sms'")).rows[0];
  assert.deepEqual(state, {status: 'unavailable', unavailable_reason: 'destination_not_allowed'});
});

test('pre-existing noncanonical SQL trip locale retains qualified alert channels', async t => {
  const f = await fixture(t), grant = await f.grant(), trip = await f.trip([grant]);
  // This value was accepted and persisted by the pre-fix API, not an invalid locale.
  await f.ctx.pool.query("UPDATE trips SET locale='pt-br' WHERE id=$1", [trip]);
  const response = await f.req('POST', `/v1/trips/${trip}/sos`, {});
  assert.equal(response.status, 200);
  const jobs = (await f.ctx.pool.query("SELECT status FROM jobs WHERE incident_id=$1 AND channel<>'group'", [response.body.id])).rows;
  assert.equal(jobs.length, 3);
  assert.equal(jobs.every(job => job.status === 'pending'), true, 'Existing valid locale must not disable every qualified channel');
});
