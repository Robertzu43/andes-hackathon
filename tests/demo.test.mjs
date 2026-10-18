import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';
import {runtime, sos, provider, qualification} from './helpers/dispatch.mjs';

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

test('demo sessions are rate limited, and demo mode refuses live sends', async t => {
  const {f, session} = await demoFixture(t);
  for (let i = 0; i < 30; i++) assert.equal((await session()).status, 200);
  assert.deepEqual(await session(), {status: 429, body: {code: 'demo_rate_limited'}});
  f.advance(60001);
  assert.equal((await session()).status, 200);
  const {demoIssuer} = await import('../dist/demo.js');
  await assert.rejects(demoIssuer({ZAVU_LIVE_SEND: 'true'}), /DEMO_LIVE_PHONE/);
  await assert.rejects(demoIssuer({ZAVU_LIVE_SEND: 'true', DEMO_LIVE_PHONE: '999'}), /DEMO_LIVE_PHONE/);
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
  assert.throws(() => configuredProvider({...env, DEMO_MODE: 'true', ZAVU_QUALIFICATION_JSON: JSON.stringify(live)}), /allowedDestinations/);
  assert.throws(() => configuredProvider({...env, ZAVU_QUALIFICATION_JSON: JSON.stringify({...live, allowedDestinations: ['999']})}), /qualification/);
  assert.deepEqual(configuredProvider({...env, DEMO_MODE: 'true', ZAVU_QUALIFICATION_JSON: JSON.stringify({...live, allowedDestinations: ['+15555550123']})}).qualification.allowedDestinations, ['+15555550123']);
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
