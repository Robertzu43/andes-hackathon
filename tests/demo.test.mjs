import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture} from './helpers/runtime.mjs';
import {runtime, sos, provider, qualification} from './helpers/dispatch.mjs';
import {cfg, sweep, checksOf, asking} from './helpers/checks.mjs';

async function demoFixture(t) {
  const {demoIssuer} = await import('../dist/demo.js');
  const demo = await demoIssuer({});
  const f = await fixture(t, {auth: demo.auth, demo});
  const session = async () => { const r = await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}}); return {status: r.statusCode, body: r.json()}; };
  return {f, session};
}

test('a demo session creates an isolated synthetic world whose personas can run the whole journey', async t => {
  const {f, session} = await demoFixture(t);
  const world = await session();
  assert.equal(world.status, 200);
  assert.equal(world.body.synthetic, true);
  const {driver, family, colleague} = world.body;
  assert.equal((await f.req('GET', '/v1/me', undefined, driver.token)).body.id, driver.id);
  const draft = await f.req('POST', '/v1/trip-drafts', {text: 'Lima a Ica, llego 18:00', fields: {truckId: driver.truckId, origin: 'Lima', destination: 'Ica', country: 'PE', locale: 'es-PE', timeZone: 'America/Lima'}}, driver.token);
  assert.equal(draft.status, 200);
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [family.grantId, colleague.grantId]}, driver.token)).body.id;
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, family.token)).status, 200);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {}, driver.token)).status, 200);
  assert.deepEqual((await f.ctx.pool.query("SELECT cg.role,count(*)::int n FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id GROUP BY cg.role ORDER BY cg.role")).rows,
    [{role: 'colleague', n: 2}, {role: 'family', n: 3}]);
  const other = (await session()).body;
  assert.notEqual(other.driver.id, driver.id);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, other.family.token)).status, 403);
});

test('demo sessions are rate limited, and live sends need the consented DEMO_LIVE_PHONE', async t => {
  const {f, session} = await demoFixture(t);
  for (let i = 0; i < 30; i++) assert.equal((await session()).status, 200);
  assert.deepEqual(await session(), {status: 429, body: {code: 'demo_rate_limited'}});
  f.advance(60001);
  assert.equal((await session()).status, 200);
  const {demoIssuer} = await import('../dist/demo.js');
  await assert.rejects(demoIssuer({ZAVU_LIVE_SEND: 'true'}), /DEMO_LIVE_PHONE/);
  await assert.rejects(demoIssuer({ZAVU_LIVE_SEND: 'true', DEMO_LIVE_PHONE: '999'}), /DEMO_LIVE_PHONE/);
});

test('the real server entry stays off demo mode unless DEMO_MODE is exactly "true"', () => {
  const start = env => spawnSync(process.execPath, [fileURLToPath(new URL('../dist/server.js', import.meta.url))], {encoding: 'utf8', timeout: 20000, env: {PATH: process.env.PATH, ...env}});
  for (const mode of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
    const run = start(mode === undefined ? {} : {DEMO_MODE: mode});
    assert.equal(run.status, 1, `DEMO_MODE=${mode}`);
    assert.match(run.stderr, /Trusted OIDC configuration required/, `DEMO_MODE=${mode} must demand OIDC`);
  }
  // Control: only the explicit value skips OIDC and reaches the next startup requirement.
  const demo = start({DEMO_MODE: 'true'});
  assert.equal(demo.status, 1);
  assert.doesNotMatch(demo.stderr, /OIDC/);
  assert.match(demo.stderr, /Database URL or complete PostgreSQL components required/);
});

test('without demo mode the session route does not exist and real tokens are unaffected', async t => {
  const f = await fixture(t);
  assert.notEqual((await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}})).statusCode, 200);
  assert.equal((await f.req('GET', '/v1/me')).status, 200);
});

test('live demo sends reach only the consented phone: the family persona uses it, every other destination is refused', async t => {
  const {demoIssuer} = await import('../dist/demo.js');
  const demo = await demoIssuer({ZAVU_LIVE_SEND: 'true', DEMO_LIVE_PHONE: '+15555550123'});
  const f = await fixture(t, {auth: demo.auth, demo});
  const world = (await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}})).json();
  const phones = (await f.ctx.pool.query('SELECT id,phone FROM identities WHERE id = ANY($1) ORDER BY phone', [[world.family.id, world.colleague.id]])).rows;
  assert.deepEqual(phones, [{id: world.colleague.id, phone: '+15555550103'}, {id: world.family.id, phone: '+15555550123'}]);

  const {configuredProvider} = await import('../dist/worker.js');
  const live = {...qualification, evidence: 'test-only syntheticfixture: live', entries: qualification.entries.map(e => ({...e, evidence: 'test-only syntheticfixture: channel'}))};
  const env = {ZAVU_LIVE_SEND: 'true', ZAVU_API_KEY: 'syntheticfixture-not-a-key', ZAVU_PROJECT_ID: 'prj_fixture', ZAVU_SENDER_ID: 'snd_fixture', ZAVU_CALLBACK_SECRET: 'syntheticfixture-secret'};
  const limits = {perIncident: 6, perSession: 6};
  const demoLive = (extra, demoEnv = {DEMO_MODE: 'true', DEMO_LIVE_PHONE: '+15555550123'}) => configuredProvider({...env, ...demoEnv, ZAVU_QUALIFICATION_JSON: JSON.stringify({...live, ...extra})});
  for (const allowed of [undefined, [], ['+15555550199'], ['+15555550123', '+15555550199']]) {
    assert.throws(() => demoLive({allowedDestinations: allowed, demoLimits: limits}), /DEMO_MODE live sends/, `allowedDestinations ${JSON.stringify(allowed)} is not exactly the consented phone`);
  }
  assert.throws(() => demoLive({allowedDestinations: ['+15555550123'], demoLimits: limits}, {DEMO_MODE: 'true'}), /DEMO_MODE live sends/);
  assert.throws(() => demoLive({allowedDestinations: ['+15555550123']}), /DEMO_MODE live sends/, 'a live demo needs explicit send budgets');
  for (const demoLimits of [{perIncident: 0, perSession: 6}, {perIncident: 6}, {perIncident: 6, perSession: 1.5}, 'six']) {
    assert.throws(() => demoLive({allowedDestinations: ['+15555550123'], demoLimits}), /qualification/);
  }
  assert.throws(() => configuredProvider({...env, ZAVU_QUALIFICATION_JSON: JSON.stringify({...live, allowedDestinations: ['999']})}), /qualification/);
  const accepted = demoLive({allowedDestinations: ['+15555550123'], demoLimits: limits}).qualification;
  assert.deepEqual({allowed: accepted.allowedDestinations, limits: accepted.demoLimits}, {allowed: ['+15555550123'], limits});
});

test('demo personas can invite only personas from their own world', async t => {
  const {f, session} = await demoFixture(t);
  const a = (await session()).body; const b = (await session()).body;
  const invite = (from, to, phone) => f.req('POST', '/v1/contacts', {contactId: to.id, phone, map: true, incident: true}, from.token);
  assert.deepEqual(await invite(a.driver, b.family, '+15555550102'), {status: 403, body: {code: 'demo_world_boundary'}});
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM contact_grants WHERE contact_id=$1', [b.family.id])).rows[0].n, 1, 'only its own world grant');
  assert.equal((await invite(a.family, a.colleague, '+15555550103')).status, 200, 'same-world invitation still works');
});

test('live demo sends stop at the per-incident and per-session budgets, checked at authorization', async t => {
  const d = await runtime(); const f = await fixture(t); const grant = await f.grant();
  let sends = 0;
  const limited = provider({qualification: {...qualification, allowedDestinations: ['+5511999990000'], demoLimits: {perIncident: 2, perSession: 3}}, async send() { sends++; return {state: 'accepted', messageId: 'msg_x', status: 'queued'}; }});
  const sosAndAuthorize = async () => {
    const incident = (await f.req('POST', `/v1/trips/${await f.trip([grant])}/sos`, {})).body.id;
    const jobs = (await f.ctx.pool.query("SELECT id,version,class FROM jobs WHERE incident_id=$1 AND channel<>'group' ORDER BY channel", [incident])).rows;
    const authorized = [];
    for (const job of jobs) authorized.push(Boolean(await d.authorizeJob(f.ctx, await d.claimJob(f.ctx, job, 'budget'), limited)));
    return authorized;
  };
  assert.deepEqual(await sosAndAuthorize(), [true, true, false], 'per incident: 2');
  assert.deepEqual(await sosAndAuthorize(), [true, false, false], 'per session (the one consented persona): 3');
  assert.deepEqual((await f.ctx.pool.query("SELECT status,unavailable_reason,count(*)::int n FROM jobs WHERE channel<>'group' GROUP BY 1,2 ORDER BY 1")).rows,
    [{status: 'authorized', unavailable_reason: null, n: 3}, {status: 'unavailable', unavailable_reason: 'demo_budget_exhausted', n: 3}]);
  assert.deepEqual((await f.ctx.pool.query('SELECT (SELECT count(*) FROM dispatch_attempts)::int attempts,(SELECT count(*) FROM quota_reservations)::int quota')).rows, [{attempts: 3, quota: 3}]);
  assert.equal(sends, 0);
});

test('dispatch refuses any destination outside a configured allowlist without calling the provider', async t => {
  const d = await runtime(); const f = await fixture(t); const {jobs} = await sos(f);
  let sends = 0;
  const blocked = provider({qualification: {...qualification, allowedDestinations: ['+15555550123']}, async send() { sends++; return {state: 'accepted', messageId: 'msg_x', status: 'queued'}; }});
  assert.equal(await d.authorizeJob(f.ctx, await d.claimJob(f.ctx, jobs[0], 'allowlist'), blocked), null);
  assert.deepEqual((await f.ctx.pool.query('SELECT status,unavailable_reason FROM jobs WHERE id=$1', [jobs[0].id])).rows, [{status: 'unavailable', unavailable_reason: 'destination_not_allowed'}]);
  const allowed = provider({qualification: {...qualification, allowedDestinations: ['+5511999990000']}});
  assert.ok(await d.authorizeJob(f.ctx, await d.claimJob(f.ctx, jobs[1], 'allowlist'), allowed));
  assert.equal(sends, 0);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts')).rows[0].n, 1);
});

test('an empty allowlist refuses every destination before quota or the provider', async t => {
  const d = await runtime(); const f = await fixture(t); const {jobs} = await sos(f);
  let sends = 0;
  const none = provider({qualification: {...qualification, allowedDestinations: []}, async send() { sends++; return {state: 'accepted', messageId: 'msg_x', status: 'queued'}; }});
  for (const job of jobs) assert.equal(await d.authorizeJob(f.ctx, await d.claimJob(f.ctx, job, 'empty-allowlist'), none), null);
  assert.deepEqual((await f.ctx.pool.query("SELECT status,unavailable_reason,count(*)::int n FROM jobs WHERE channel<>'group' GROUP BY 1,2")).rows,
    [{status: 'unavailable', unavailable_reason: 'destination_not_allowed', n: 3}]);
  assert.deepEqual((await f.ctx.pool.query('SELECT (SELECT count(*) FROM dispatch_attempts)::int attempts,(SELECT count(*) FROM quota_reservations)::int quota')).rows, [{attempts: 0, quota: 0}]);
  assert.equal(sends, 0);
});

const demoChecks = {...cfg, demo: true};
async function demoTrip(f, world) {
  const draft = await f.req('POST', '/v1/trip-drafts', {text: 'SYNTHETIC demo trip', fields: {truckId: world.driver.truckId, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}}, world.driver.token);
  return (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [world.family.grantId, world.colleague.grantId]}, world.driver.token)).body.id;
}
const incidentJobs = async (f, trip) => (await f.ctx.pool.query("SELECT count(*)::int n FROM jobs WHERE trip_id=$1 AND channel<>'group'", [trip])).rows[0].n;

test('in demo mode an abandoned trip opens no check and alerts nobody; a watched trip still escalates; SOS always works', async t => {
  const {f, session} = await demoFixture(t);
  const watched = (await session()).body; const left = (await session()).body;
  const watchedTrip = await demoTrip(f, watched); const leftTrip = await demoTrip(f, left);
  const poll = () => f.req('GET', `/v1/trips/${watchedTrip}/status`, undefined, watched.family.token);
  f.advance(120001); await poll(); await sweep(f, demoChecks);
  assert.deepEqual(await checksOf(f, watchedTrip), [asking('silence')]);
  assert.deepEqual(await checksOf(f, leftTrip), [], 'nobody has looked at this world for longer than the ask window');
  f.advance(60000); await poll(); await sweep(f, demoChecks);
  assert.equal((await checksOf(f, watchedTrip))[0].status, 'escalated');
  assert.equal(await incidentJobs(f, watchedTrip), 5);
  f.advance(3600000); await sweep(f, demoChecks); await sweep(f, demoChecks);
  assert.deepEqual(await checksOf(f, leftTrip), []);
  assert.equal(await incidentJobs(f, leftTrip), 0);
  assert.equal((await f.req('POST', `/v1/trips/${leftTrip}/sos`, {}, left.driver.token)).status, 200, 'an explicit SOS is never suppressed');
  assert.equal(await incidentJobs(f, leftTrip), 5);
});

test('after the demo issuer restarts, a trip whose tokens died cancels its open check instead of escalating', async t => {
  const {f, session} = await demoFixture(t);
  const world = (await session()).body; const trip = await demoTrip(f, world);
  f.advance(120001); await f.req('GET', `/v1/trips/${trip}/status`, undefined, world.driver.token); await sweep(f, demoChecks);
  assert.deepEqual(await checksOf(f, trip), [asking('silence')]);
  const {demoIssuer} = await import('../dist/demo.js'); const {createApp} = await import('../dist/api/app.js');
  const restarted = await demoIssuer({});
  const app = createApp({ctx: f.ctx, auth: restarted.auth, demo: restarted}); await app.ready();
  const stale = await app.inject({method: 'GET', url: `/v1/trips/${trip}/status`, headers: {authorization: `Bearer ${world.driver.token}`}});
  assert.equal(stale.statusCode, 401, 'the old world lost its authority');
  f.advance(60000); await sweep(f, demoChecks);
  assert.deepEqual(await checksOf(f, trip), [{reason: 'silence', status: 'cancelled', incident_id: null}]);
  f.advance(3600000); await sweep(f, demoChecks);
  assert.equal((await checksOf(f, trip)).length, 1);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM incidents')).rows[0].n, 0);
});
