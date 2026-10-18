import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fixture} from './helpers/runtime.mjs';
import {provider, qualification, runtime} from './helpers/dispatch.mjs';
import {waitForBlockedQueries} from './helpers/db-barriers.mjs';

const pepper = 'syntheticfixture-pepper-not-a-secret-000';
const live = {
  ZAVU_LIVE_SEND: 'true',
  DEMO_SMS_DAILY_CAP: '40',
  DEMO_ALERTS_PER_NUMBER_DAILY: '6',
  DEMO_PHONE_PEPPER: pepper,
};

test('demo phone settings default to Peru and hourly limits of three per number and five per IP', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  assert.deepEqual(demoLimits(live), {
    pepper, allowedCountries: ['PE'], perNumberHourly: 3, perIpHourly: 5,
    smsDailyCap: 40, alertsPerNumberDaily: 6,
  });
  assert.deepEqual(demoLimits({...live, DEMO_ALLOWED_COUNTRIES: 'PE,BR,CL,CO,MX,AR',
    DEMO_OTP_PER_NUMBER_HOURLY: '1', DEMO_OTP_PER_IP_HOURLY: '2'}), {
    pepper, allowedCountries: ['PE', 'BR', 'CL', 'CO', 'MX', 'AR'],
    perNumberHourly: 1, perIpHourly: 2, smsDailyCap: 40, alertsPerNumberDaily: 6,
  });
});

test('live demo phone settings require both daily caps and a pepper', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  for (const name of ['DEMO_SMS_DAILY_CAP', 'DEMO_ALERTS_PER_NUMBER_DAILY', 'DEMO_PHONE_PEPPER']) {
    assert.throws(() => demoLimits({...live, [name]: undefined}), new RegExp(name), `${name} missing`);
  }
});

test('demo phone limits accept positive integers and reject malformed or oversized counts even with sends off', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  const fields = [
    ['DEMO_OTP_PER_NUMBER_HOURLY', 'perNumberHourly'],
    ['DEMO_OTP_PER_IP_HOURLY', 'perIpHourly'],
    ['DEMO_SMS_DAILY_CAP', 'smsDailyCap'],
    ['DEMO_ALERTS_PER_NUMBER_DAILY', 'alertsPerNumberDaily'],
  ];
  for (const [name, field] of fields) {
    for (const [raw, expected] of [['1', 1], ['999999999', 999999999]]) {
      assert.equal(demoLimits({...live, [name]: raw})[field], expected, `${name}=${raw}`);
    }
    for (const raw of ['0', '-1', '1.5', 'five', '', ' ', ' 1', '1 ', '01', '1e2', '1000000000']) {
      for (const mode of ['true', 'false']) {
        assert.throws(() => demoLimits({...live, ZAVU_LIVE_SEND: mode, [name]: raw}),
          new RegExp(name), `${name}=${JSON.stringify(raw)}, live=${mode}`);
      }
    }
  }
});

test('demo phone countries accept supported uppercase codes with trimming and reject unknown or inherited names', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  assert.deepEqual(demoLimits({...live, DEMO_ALLOWED_COUNTRIES: ' AR, BR , CL,CO, MX, PE, US '}).allowedCountries,
    ['AR', 'BR', 'CL', 'CO', 'MX', 'PE', 'US']);
  for (const raw of ['PE,XX', 'pe', '', ' ', 'PE,', ',PE', 'PE,,BR', 'toString', 'constructor', '__proto__']) {
    assert.throws(() => demoLimits({...live, DEMO_ALLOWED_COUNTRIES: raw}), /DEMO_ALLOWED_COUNTRIES/, raw);
  }
});

test('sends off allow missing caps and generate a fresh pepper while supplied peppers need at least 32 characters', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  const off = demoLimits({});
  assert.deepEqual(off, {
    pepper: off.pepper, allowedCountries: ['PE'], perNumberHourly: 3, perIpHourly: 5,
    smsDailyCap: 0, alertsPerNumberDaily: 0,
  });
  assert.match(off.pepper, /^[0-9a-f]{64}$/);
  for (const mode of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
    const next = demoLimits({ZAVU_LIVE_SEND: mode});
    assert.deepEqual([next.smsDailyCap, next.alertsPerNumberDaily], [0, 0]);
    assert.match(next.pepper, /^[0-9a-f]{64}$/);
    assert.notEqual(next.pepper, off.pepper);
  }
  for (const mode of ['true', 'false']) {
    for (const raw of ['', 'too-short', 's'.repeat(31)]) {
      assert.throws(() => demoLimits({...live, ZAVU_LIVE_SEND: mode, DEMO_PHONE_PEPPER: raw}), /DEMO_PHONE_PEPPER/);
    }
    const minimum = 'syntheticfixture-'.padEnd(32, '0');
    assert.equal(demoLimits({...live, ZAVU_LIVE_SEND: mode, DEMO_PHONE_PEPPER: minimum}).pepper, minimum);
  }
});

test('demo phone settings never read or return a fixed code from the environment', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  assert.equal('code' in demoLimits({...live, DEMO_OTP_CODE: '123456'}), false);
  const env = {...live};
  Object.defineProperty(env, 'DEMO_OTP_CODE', {get() { throw new Error('fixed OTP must never be read'); }});
  assert.deepEqual(demoLimits(env), demoLimits(live));
});

// Fictional numbers only: +1 555 555 01xx is NANP ('US' below); +51 0… is not an assigned Peruvian mobile range.
const phone = '+15555550142', other = '+15555550143', code = '123456';
function phoneConfig(overrides = {}) {
  const sent = [];
  const config = {pepper, allowedCountries: ['US'], perNumberHourly: 3, perIpHourly: 5, smsDailyCap: 20, alertsPerNumberDaily: 6, code: () => code,
    send: async (to, text) => { sent.push({to, text}); return {state: 'accepted', messageId: `msg_${sent.length}`, status: 'queued'}; }, ...overrides};
  return {sent, config};
}
// The fake sender and the fixed code reach the app only as this in-process createApp option.
async function demoWorld(t, overrides) {
  const {demoIssuer} = await import('../dist/demo.js');
  const demo = await demoIssuer({});
  const {sent, config} = phoneConfig(overrides);
  const f = await fixture(t, {auth: demo.auth, demo, demoPhone: config, trustProxyHops: 1});
  async function session() { return (await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}})).json(); }
  async function call(path, body, token, ip = '198.51.100.7') {
    const response = await f.app.inject({method: 'POST', url: `/v1/demo/phone/${path}`, payload: body, headers: {authorization: `Bearer ${token}`, 'x-forwarded-for': ip}});
    return {status: response.statusCode, body: response.json()};
  }
  return {f, sent, session, call, demo, config};
}
async function challenges(f) { return (await f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_challenges')).rows[0].n; }

test('a code request sends one demo-prefixed SMS without URLs and stores only HMACs of the number and the IP', async t => {
  const w = await demoWorld(t); const world = await w.session();
  assert.deepEqual(await w.call('start', {phone}, world.family.token), {status: 202, body: {expiresAt: '2026-10-17T12:10:00.000Z'}});
  assert.deepEqual(w.sent, [{to: phone, text: 'Demo de Tándem: tu código es 123456'}]);
  assert.doesNotMatch(w.sent[0].text, /http/, 'Zavu holds SMS with unverified URLs');
  const rows = (await w.f.ctx.pool.query('SELECT identity_id,phone_hmac,ip_hmac,code_hash,attempts FROM demo_phone_challenges')).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].identity_id, world.family.id); assert.equal(rows[0].attempts, 0);
  for (const key of ['phone_hmac', 'ip_hmac', 'code_hash']) assert.match(rows[0][key], /^[0-9a-f]{64}$/, key);
  const row = (await w.f.ctx.pool.query('SELECT * FROM demo_phone_challenges')).rows[0];
  const mac = value => createHmac('sha256', pepper).update(value).digest('hex');
  assert.equal(row.phone_hmac, mac(`phone:${phone}`));
  assert.equal(row.ip_hmac, mac('ip:198.51.100.7'));
  assert.equal(row.code_hash, mac(`code:${row.id}:${code}`));
  assert.equal(row.created_at.toISOString(), '2026-10-17T12:00:00.000Z');
  assert.equal(row.expires_at.toISOString(), '2026-10-17T12:10:00.000Z');
  assert.equal((await w.f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1', [world.family.id])).rows[0].phone, null);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_verifications')).rows[0].n, 0);
  const stored = JSON.stringify(rows);
  for (const secret of [phone.slice(1), '198.51.100.7']) assert.ok(!stored.includes(secret), secret);
  assert.equal((await w.f.app.inject({method: 'POST', url: '/v1/demo/phone/start', payload: {phone}})).statusCode, 401, 'the actor is the token persona');
});

test('malformed numbers and countries outside DEMO_ALLOWED_COUNTRIES are refused before any SMS', async t => {
  const w = await demoWorld(t); const world = await w.session();
  for (const bad of ['15555550142', '+0155555501', '+1555', 'tel:+15555550142', '+15555550142 ', '+1 555 555 0142']) {
    assert.deepEqual(await w.call('start', {phone: bad}, world.family.token), {status: 400, body: {code: 'invalid_phone'}}, bad);
  }
  assert.deepEqual(await w.call('start', {phone: '+51000000001'}, world.family.token), {status: 403, body: {code: 'country_not_allowed'}});
  assert.equal((await w.call('start', {}, world.family.token)).status, 400);
  assert.deepEqual([w.sent.length, await challenges(w.f)], [0, 0]);
});

test('with live sends off the code request answers 503 demo_sms_disabled and is never counted', async t => {
  const w = await demoWorld(t, {send: null}); const world = await w.session();
  for (let i = 0; i < 8; i++) assert.deepEqual(await w.call('start', {phone}, world.family.token), {status: 503, body: {code: 'demo_sms_disabled'}});
  assert.equal(await challenges(w.f), 0);
});

test('a number gets at most DEMO_OTP_PER_NUMBER_HOURLY codes per hour, across worlds and IPs', async t => {
  const w = await demoWorld(t);
  for (let i = 0; i < 3; i++) assert.equal((await w.call('start', {phone}, (await w.session()).family.token, `198.51.100.${10 + i}`)).status, 202);
  assert.deepEqual(await w.call('start', {phone}, (await w.session()).family.token, '198.51.100.20'), {status: 429, body: {code: 'rate_limited'}});
  w.f.advance(3600001);
  assert.equal((await w.call('start', {phone}, (await w.session()).family.token, '198.51.100.21')).status, 202);
  assert.equal(w.sent.length, 4);
});

test('an IP gets at most DEMO_OTP_PER_IP_HOURLY codes per hour, and a forged X-Forwarded-For entry does not reset it', async t => {
  const w = await demoWorld(t); const token = (await w.session()).family.token;
  for (let i = 0; i < 5; i++) assert.equal((await w.call('start', {phone: `+1555555016${i}`}, token, '203.0.113.9')).status, 202);
  assert.deepEqual(await w.call('start', {phone: '+15555550165'}, token, '203.0.113.9'), {status: 429, body: {code: 'rate_limited'}});
  assert.deepEqual(await w.call('start', {phone: '+15555550166'}, token, '192.0.2.1, 203.0.113.9'), {status: 429, body: {code: 'rate_limited'}}, 'the client-written entry is ignored');
  assert.equal((await w.call('start', {phone: '+15555550167'}, token, '203.0.113.10')).status, 202);
  assert.equal(w.sent.length, 6);
});

test('DEMO_SMS_DAILY_CAP stops every code request for 24 hours with demo_budget_exhausted', async t => {
  const w = await demoWorld(t, {smsDailyCap: 2}); const token = (await w.session()).family.token;
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  assert.equal((await w.call('start', {phone: other}, token)).status, 202);
  const exhausted = {status: 429, body: {code: 'demo_budget_exhausted'}};
  assert.deepEqual(await w.call('start', {phone: '+15555550144'}, token), exhausted);
  w.f.advance(3600001); assert.deepEqual(await w.call('start', {phone: '+15555550144'}, token), exhausted, 'not an hourly window');
  w.f.advance(23 * 3600000); assert.equal((await w.call('start', {phone: '+15555550144'}, token)).status, 202);
  assert.equal(w.sent.length, 3);
});

test('a provider refusal answers 503 and still counts; an ambiguous provider result answers 202', async t => {
  let result = {state: 'rejected', code: 'invalid_destination'};
  const w = await demoWorld(t, {send: async () => result}); const token = (await w.session()).family.token;
  assert.deepEqual(await w.call('start', {phone}, token), {status: 503, body: {code: 'demo_sms_disabled'}});
  result = {state: 'unknown'};
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  assert.equal(await challenges(w.f), 2);
});

test('without demo mode the phone routes do not exist', async t => {
  const f = await fixture(t, {demoPhone: phoneConfig().config});
  assert.equal((await f.req('POST', '/v1/demo/phone/start', {phone})).status, 404);
  assert.equal((await f.req('POST', '/v1/demo/phone/verify', {phone, code})).status, 404);
});

test('codes go out through the Zavu adapter on the one-way SMS sender', async () => {
  const {zavuSender} = await import('../dist/demo-phone.js');
  const {createZavuProvider} = await import('../dist/notifications/zavu.js');
  const bodies = [];
  const p = createZavuProvider({...qualification, smsMode: 'oneway'}, 'syntheticfixture-key', async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    return new Response(JSON.stringify({message: {id: 'msg_code', channel: body.channel, to: body.to, status: 'queued', direction: 'outbound'}}), {status: 202});
  });
  const send = zavuSender(p);
  assert.equal((await send(phone, 'Demo de Tándem: tu código es 123456')).state, 'accepted');
  assert.equal((await send(phone, 'Demo de Tándem: tu código es 123456')).state, 'accepted');
  assert.equal(bodies.length, 2);
  const {channel, messageType, text, to, fallbackEnabled} = bodies[0];
  assert.deepEqual({channel, messageType, text, to, fallbackEnabled}, {channel: 'sms_oneway', messageType: 'text', text: 'Demo de Tándem: tu código es 123456', to: phone, fallbackEnabled: false});
  for (const body of bodies) {
    assert.match(body.metadata.attemptId, /^[0-9a-f-]{36}$/);
    assert.equal(body.idempotencyKey, `andes:otp:${body.metadata.attemptId}`);
  }
  assert.notEqual(bodies[0].idempotencyKey, bodies[1].idempotencyKey);
});

test('malformed request shapes never echo the phone or create a challenge', async t => {
  const w = await demoWorld(t); const token = (await w.session()).family.token;
  for (const body of [null, [], [phone], phone, 42, true, {}, {phone: null}, {phone: 15555550142}, {phone: []}, {phone, extra: phone}]) {
    const response = await w.f.app.inject({method: 'POST', url: '/v1/demo/phone/start',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, payload: JSON.stringify(body)});
    assert.deepEqual({status: response.statusCode, body: response.json()}, {status: 400, body: {code: 'invalid_request'}});
  }
  assert.deepEqual([w.sent.length, await challenges(w.f)], [0, 0]);
});

test('an unconfigured demo phone sender leaves both phone routes absent', async t => {
  const {demoIssuer} = await import('../dist/demo.js'); const demo = await demoIssuer({});
  const f = await fixture(t, {auth: demo.auth, demo});
  const token = (await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}})).json().family.token;
  assert.equal((await f.req('POST', '/v1/demo/phone/start', {phone}, token)).status, 404);
  assert.equal((await f.req('POST', '/v1/demo/phone/verify', {phone, code}, token)).status, 404);
});

test('the allowed calling prefixes are configurable and +1 admits the whole NANP', async t => {
  const w = await demoWorld(t, {allowedCountries: ['PE', 'BR', 'US'], perIpHourly: 10});
  const token = (await w.session()).family.token;
  for (const to of ['+51000000001', '+55000000001', '+15555550142']) {
    assert.equal((await w.call('start', {phone: to}, token)).status, 202);
  }
  assert.deepEqual(await w.call('start', {phone: '+56000000001'}, token), {status: 403, body: {code: 'country_not_allowed'}});
  assert.equal(w.sent.length, 3);
});

test('the sender observes a committed challenge and holds no transaction lock while waiting', async t => {
  const {deferred} = await import('./helpers/dispatch.mjs');
  const entered = deferred(), release = deferred();
  let w;
  w = await demoWorld(t, {perNumberHourly: 1, send: async () => {
    entered.resolve(await challenges(w.f));
    await release.promise;
    return {state: 'accepted', messageId: 'msg_postcommit', status: 'queued'};
  }});
  const token = (await w.session()).family.token;
  const pending = w.call('start', {phone}, token);
  try {
    assert.equal(await Promise.race([entered.promise, pending.then(() => 'sender not reached')]), 1);
    const client = await w.f.ctx.pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtextextended('demo_phone_start',0)) AS acquired");
      assert.equal(lock.rows[0].acquired, true, 'sending must release the cap transaction lock');
    } finally { await client.query('ROLLBACK'); client.release(); }
    assert.deepEqual(await w.call('start', {phone}, token), {status: 429, body: {code: 'rate_limited'}});
  } finally { release.resolve(); await pending; }
});

for (const cap of ['number', 'IP', 'daily']) {
  test(`concurrent starts across two app instances cannot exceed the ${cap} cap`, async t => {
    const limits = {perNumberHourly: 20, perIpHourly: 20, smsDailyCap: 20,
      ...({number: {perNumberHourly: 2}, IP: {perIpHourly: 2}, daily: {smsDailyCap: 2}}[cap])};
    const w = await demoWorld(t, limits);
    const {createApp} = await import('../dist/api/app.js');
    const {createContext} = await import('../dist/db.js');
    const ctx = createContext(w.f.ctx.pool.options.connectionString, w.f.ctx.clock);
    const second = createApp({ctx, auth: w.demo.auth, demo: w.demo, demoPhone: w.config, trustProxyHops: 1});
    await second.ready(); t.after(() => second.close());
    const worlds = [await w.session(), await w.session()];
    const holder = await w.f.ctx.pool.connect();
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('demo_phone_start',0))");
    const requests = Array.from({length: 10}, (_, i) => (i % 2 ? second : w.f.app).inject({
      method: 'POST', url: '/v1/demo/phone/start', payload: {phone: cap === 'number' ? phone : `+155555501${70 + i}`},
      headers: {authorization: `Bearer ${worlds[i % 2].family.token}`,
        'x-forwarded-for': cap === 'IP' ? '198.51.100.7' : `198.51.100.${20 + i}`},
    }).then(response => ({status: response.statusCode, body: response.json()})));
    try {
      await waitForBlockedQueries(w.f.ctx.telemetryPool, '%pg_advisory_xact_lock%', 2);
    } finally { await holder.query('ROLLBACK'); holder.release(); await Promise.allSettled(requests); }
    const replies = await Promise.all(requests);
    assert.equal(replies.filter(r => r.status === 202).length, 2);
    assert.deepEqual(replies.filter(r => r.status !== 202), Array(8).fill({status: 429,
      body: {code: cap === 'daily' ? 'demo_budget_exhausted' : 'rate_limited'}}));
    assert.deepEqual([w.sent.length, await challenges(w.f)], [2, 2]);
  });
}

test('exact hourly and daily window boundaries admit a new issuance', async t => {
  for (const [limits, elapsed] of [[{perNumberHourly: 1}, 3600000], [{perIpHourly: 1}, 3600000], [{smsDailyCap: 1}, 86400000]]) {
    const w = await demoWorld(t, limits); let token = (await w.session()).family.token;
    assert.equal((await w.call('start', {phone}, token)).status, 202);
    w.f.advance(elapsed - 1);
    const error = limits.smsDailyCap ? 'demo_budget_exhausted' : 'rate_limited';
    assert.deepEqual(await w.call('start', {phone}, token), {status: 429, body: {code: error}});
    w.f.advance(1); token = (await w.session()).family.token;
    assert.equal((await w.call('start', {phone}, token)).status, 202);
  }
});

test('latest issuance stays deterministic at tied timestamps and a spent latest row never reveals an older code', async t => {
  let next = 0; const codes = ['111111', '222222', '333333'];
  const w = await demoWorld(t, {code: () => codes[next++], perIpHourly: 10});
  const a = await w.session(), b = await w.session();
  for (const world of [a, a, b]) assert.equal((await w.call('start', {phone}, world.family.token)).status, 202);
  const rows = (await w.f.ctx.pool.query('SELECT * FROM demo_phone_challenges ORDER BY issuance_order')).rows;
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.created_at.toISOString())).size, 1);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].code_hash, createHmac('sha256', pepper).update(`code:${rows[i].id}:${codes[i]}`).digest('hex'));
    if (i) assert.ok(BigInt(rows[i].issuance_order) > BigInt(rows[i - 1].issuance_order));
  }
  const latest = async identity => (await w.f.ctx.pool.query(`SELECT * FROM demo_phone_challenges
    WHERE identity_id=$1 AND phone_hmac=$2 ORDER BY issuance_order DESC LIMIT 1`, [identity, rows[0].phone_hmac])).rows[0];
  assert.equal((await latest(a.family.id)).id, rows[1].id);
  assert.equal((await latest(b.family.id)).id, rows[2].id, 'persona binding beats the global sequence');
  await w.f.ctx.pool.query('UPDATE demo_phone_challenges SET expires_at=$2 WHERE id=$1', [rows[1].id, w.f.ctx.clock()]);
  assert.equal((await latest(a.family.id)).id, rows[1].id, 'Task 9 must retain and select the spent latest row');
  assert.equal((await latest(a.family.id)).expires_at.getTime(), w.f.ctx.clock().getTime());
  assert.deepEqual(await w.call('verify', {phone, code: codes[0]}, a.family.token), {status: 410, body: {code: 'code_expired'}}, 'an expired latest issuance cannot reveal an older code');
});

test('Zavu timeout ambiguity counts once and returns a private 202 through the start route', async t => {
  const {zavuSender} = await import('../dist/demo-phone.js');
  const {createZavuProvider} = await import('../dist/notifications/zavu.js');
  let calls = 0;
  const p = createZavuProvider({...qualification, smsMode: 'oneway'}, 'syntheticfixture-key', async (_url, init) => {
    calls++; assert.ok(init.signal instanceof AbortSignal);
    throw new Error(`acceptance unknown for ${phone}`);
  });
  const w = await demoWorld(t, {send: zavuSender(p), perNumberHourly: 1}); const token = (await w.session()).family.token;
  assert.deepEqual(await w.call('start', {phone}, token), {status: 202, body: {expiresAt: '2026-10-17T12:10:00.000Z'}});
  assert.deepEqual(await w.call('start', {phone}, token), {status: 429, body: {code: 'rate_limited'}});
  assert.deepEqual([calls, await challenges(w.f)], [1, 1]);
});

test('the right code binds only its persona once and survives the original phone-less token', async t => {
  const w = await demoWorld(t); const world = await w.session();
  assert.equal((await w.call('start', {phone}, world.family.token)).status, 202);
  assert.deepEqual(await w.call('verify', {phone, code}, world.family.token), {status: 200, body: {verified: true}});
  assert.deepEqual((await w.f.ctx.pool.query('SELECT identity_id,phone,verified_at FROM demo_phone_verifications')).rows,
    [{identity_id: world.family.id, phone, verified_at: w.f.ctx.clock()}]);
  // Authentication with the original phone-less JWT must preserve the new stored binding.
  for (let i = 0; i < 2; i++) assert.deepEqual(await w.f.req('GET', '/v1/me', undefined, world.family.token),
    {status: 200, body: {id: world.family.id}});
  assert.deepEqual((await w.f.ctx.pool.query('SELECT id,phone,phone_verified FROM identities WHERE id=ANY($1) ORDER BY phone',
    [[world.driver.id, world.family.id, world.colleague.id]])).rows,
  [{id: world.driver.id, phone: '+15555550101', phone_verified: true},
    {id: world.colleague.id, phone: '+15555550103', phone_verified: true},
    {id: world.family.id, phone, phone_verified: true}]);
  assert.deepEqual(await w.call('verify', {phone, code}, world.family.token), {status: 410, body: {code: 'code_expired'}});
  const row = (await w.f.ctx.pool.query('SELECT attempts,expires_at FROM demo_phone_challenges')).rows[0];
  assert.deepEqual(row, {attempts: 1, expires_at: w.f.ctx.clock()}, 'consume in place without counting a replay');
  assert.equal(w.sent.length, 1, 'verification never sends another SMS');
});

test('every wrong or malformed string commits an attempt and the sixth try cannot bind', async t => {
  const w = await demoWorld(t); const token = (await w.session()).family.token;
  const invalid = {status: 400, body: {code: 'invalid_code'}};
  assert.deepEqual(await w.call('verify', {phone, code}, token), invalid, 'no requested challenge');
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  assert.deepEqual(await w.call('verify', {phone: other, code}, token), invalid, 'exact number binding');
  assert.deepEqual(await w.call('verify', {phone: 'not-a-phone', code}, token), invalid);
  const wrong = ['000000', 'abc', '1234567', '12345', ''];
  for (const [i, attempt] of wrong.entries()) {
    assert.deepEqual(await w.call('verify', {phone, code: attempt}, token), invalid);
    assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, i + 1,
      'a subsequent query sees the failed attempt committed');
  }
  assert.deepEqual(await w.call('verify', {phone, code}, token), {status: 429, body: {code: 'too_many_attempts'}});
  assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, 5);
  assert.deepEqual((await w.f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1',
    [(await w.f.req('GET', '/v1/me', undefined, token)).body.id])).rows, [{phone: null, phone_verified: false}]);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_verifications')).rows[0].n, 0);
});

test('the fifth try can succeed and re-verifying another number replaces both bindings', async t => {
  const w = await demoWorld(t); const world = await w.session(); const token = world.family.token;
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  for (const wrong of ['123456\n', '１２３４５６', ' 123456', '000000']) {
    assert.deepEqual(await w.call('verify', {phone, code: wrong}, token), {status: 400, body: {code: 'invalid_code'}});
  }
  assert.deepEqual(await w.call('verify', {phone, code}, token), {status: 200, body: {verified: true}});
  assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, 5);
  w.f.advance(1);
  assert.equal((await w.call('start', {phone: other}, token)).status, 202);
  assert.deepEqual(await w.call('verify', {phone: other, code}, token), {status: 200, body: {verified: true}});
  assert.deepEqual((await w.f.ctx.pool.query('SELECT identity_id,phone,verified_at FROM demo_phone_verifications')).rows,
    [{identity_id: world.family.id, phone: other, verified_at: w.f.ctx.clock()}]);
  assert.deepEqual((await w.f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1', [world.family.id])).rows,
    [{phone: other, phone_verified: true}]);
});

for (const [elapsed, expected] of [[599999, {status: 200, body: {verified: true}}], [600000, {status: 410, body: {code: 'code_expired'}}]]) {
  test(`a code expires at exactly ten minutes (${elapsed}ms)`, async t => {
    const w = await demoWorld(t); const world = await w.session();
    assert.equal((await w.call('start', {phone}, world.family.token)).status, 202);
    w.f.advance(elapsed);
    assert.deepEqual(await w.call('verify', {phone, code}, world.family.token), expected);
    if (expected.status === 410) {
      assert.deepEqual((await w.f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1', [world.family.id])).rows,
        [{phone: null, phone_verified: false}]);
      assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_verifications')).rows[0].n, 0);
      assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, 0);
    }
  });
}

test('a code is bound to the requesting persona, world and exact number', async t => {
  const w = await demoWorld(t); const a = await w.session(), b = await w.session();
  assert.equal((await w.call('start', {phone}, a.family.token)).status, 202);
  const invalid = {status: 400, body: {code: 'invalid_code'}};
  assert.deepEqual(await w.call('verify', {phone, code}, b.family.token), invalid);
  assert.deepEqual(await w.call('verify', {phone, code}, a.driver.token), invalid);
  assert.deepEqual(await w.call('verify', {phone: other, code}, a.family.token), invalid);
  assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, 0);
  assert.deepEqual(await w.call('verify', {phone, code}, a.family.token), {status: 200, body: {verified: true}});
  const invite = await w.f.req('POST', '/v1/contacts', {contactId: b.family.id, phone, map: true, incident: true}, b.driver.token);
  assert.equal(invite.status, 200);
  assert.deepEqual(await w.f.req('POST', `/v1/contacts/${invite.body.id}/accept`, {map: true, incident: true}, b.family.token),
    {status: 409, body: {code: 'verified_phone_mismatch'}}, 'another world never verified this number');
  assert.deepEqual((await w.f.ctx.pool.query('SELECT identity_id,phone FROM demo_phone_verifications')).rows,
    [{identity_id: a.family.id, phone}]);
});

test('the contact accepts only after verifying the exact invited number', async t => {
  const w = await demoWorld(t); const world = await w.session();
  const invite = await w.f.req('POST', '/v1/contacts', {contactId: world.family.id, phone, map: true, incident: true}, world.driver.token);
  assert.equal(invite.status, 200);
  const accept = () => w.f.req('POST', `/v1/contacts/${invite.body.id}/accept`, {map: true, incident: true}, world.family.token);
  const mismatch = {status: 409, body: {code: 'verified_phone_mismatch'}};
  assert.deepEqual(await accept(), mismatch);
  assert.equal((await w.call('start', {phone: other}, world.family.token)).status, 202);
  assert.equal((await w.call('verify', {phone: other, code}, world.family.token)).status, 200);
  assert.deepEqual(await accept(), mismatch, 'verification of a different number does not accept');
  assert.equal((await w.call('start', {phone}, world.family.token)).status, 202);
  assert.equal((await w.call('verify', {phone, code}, world.family.token)).status, 200);
  assert.deepEqual(await accept(), {status: 200, body: {id: invite.body.id, map: true, incident: true, status: 'accepted'}});
});

test('verification requires authentication and strict object/string input without spending attempts', async t => {
  const w = await demoWorld(t); const token = (await w.session()).family.token;
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  for (const authorization of [undefined, 'Bearer invalid']) {
    const response = await w.f.app.inject({method: 'POST', url: '/v1/demo/phone/verify', payload: {phone, code},
      headers: authorization ? {authorization} : {}});
    assert.deepEqual({status: response.statusCode, body: response.json()}, {status: 401, body: {code: 'unauthorized'}});
  }
  for (const body of [null, [], [phone, code], phone, 42, true, {}, {phone}, {code}, {phone: null, code},
    {phone: 15555550142, code}, {phone: [], code}, {phone, code: null}, {phone, code: 123456}, {phone, code: []},
    {phone, code, identityId: 'someone-else'}, {phone, code, extra: phone}]) {
    const response = await w.f.app.inject({method: 'POST', url: '/v1/demo/phone/verify',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, payload: JSON.stringify(body)});
    assert.deepEqual({status: response.statusCode, body: response.json()}, {status: 400, body: {code: 'invalid_request'}});
  }
  assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, 0);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_verifications')).rows[0].n, 0);
  assert.deepEqual(await w.call('verify', {phone, code}, token), {status: 200, body: {verified: true}});
});

test('tied timestamps use the latest issuance and consuming it never revives an older code', async t => {
  let next = 0; const codes = ['111111', '222222'];
  const w = await demoWorld(t, {code: () => codes[next++]}); const token = (await w.session()).family.token;
  await w.f.ctx.pool.query("SELECT setval(pg_get_serial_sequence('demo_phone_challenges','issuance_order'), '9007199254740992', false)");
  for (let i = 0; i < 2; i++) assert.equal((await w.call('start', {phone}, token)).status, 202);
  const rows = (await w.f.ctx.pool.query('SELECT id,created_at,issuance_order FROM demo_phone_challenges ORDER BY issuance_order')).rows;
  assert.deepEqual(rows.map(row => row.issuance_order), ['9007199254740992', '9007199254740993']);
  assert.equal(rows[0].created_at.getTime(), rows[1].created_at.getTime());
  assert.deepEqual(await w.call('verify', {phone, code: codes[0]}, token), {status: 400, body: {code: 'invalid_code'}});
  assert.deepEqual((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges ORDER BY issuance_order')).rows,
    [{attempts: 0}, {attempts: 1}], 'an old code spends an attempt on the newest issuance');
  assert.deepEqual(await w.call('verify', {phone, code: codes[1]}, token), {status: 200, body: {verified: true}});
  assert.deepEqual(await w.call('verify', {phone, code: codes[0]}, token), {status: 410, body: {code: 'code_expired'}});
  assert.deepEqual(await w.call('verify', {phone, code: codes[1]}, token), {status: 410, body: {code: 'code_expired'}});
  assert.deepEqual((await w.f.ctx.pool.query('SELECT id,attempts,expires_at FROM demo_phone_challenges ORDER BY issuance_order')).rows,
    [{id: rows[0].id, attempts: 0, expires_at: new Date('2026-10-17T12:10:00Z')},
      {id: rows[1].id, attempts: 2, expires_at: w.f.ctx.clock()}]);
});

async function secondPhoneApp(t, w) {
  const {createApp} = await import('../dist/api/app.js');
  const {createContext} = await import('../dist/db.js');
  const ctx = createContext(w.f.ctx.pool.options.connectionString, w.f.ctx.clock);
  const app = createApp({ctx, auth: w.demo.auth, demo: w.demo, demoPhone: w.config});
  await app.ready(); t.after(() => app.close());
  return async (path, body, token) => {
    const response = await app.inject({method: 'POST', url: `/v1/demo/phone/${path}`, payload: body,
      headers: {authorization: `Bearer ${token}`}});
    return {status: response.statusCode, body: response.json()};
  };
}

test('concurrent verification across two apps consumes a code exactly once', async t => {
  const w = await demoWorld(t); const token = (await w.session()).family.token;
  const second = await secondPhoneApp(t, w);
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  const holder = await w.f.ctx.pool.connect(); const requests = [];
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM demo_phone_challenges FOR UPDATE');
    requests.push(w.call('verify', {phone, code}, token));
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%FOR UPDATE%', 1);
    requests.push(second('verify', {phone, code}, token));
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%pg_advisory_xact_lock%', 1);
  } finally { await holder.query('ROLLBACK'); holder.release(); await Promise.allSettled(requests); }
  assert.deepEqual(await Promise.all(requests), [{status: 200, body: {verified: true}}, {status: 410, body: {code: 'code_expired'}}]);
  assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, 1);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_verifications')).rows[0].n, 1);
});

test('verification waits for a concurrent start to commit before selecting the newest code', async t => {
  let next = 0; const codes = ['111111', '222222'];
  const w = await demoWorld(t, {code: () => codes[next++]}); const token = (await w.session()).family.token;
  const second = await secondPhoneApp(t, w);
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  const holder = await w.f.ctx.pool.connect(); const requests = [];
  try {
    await holder.query('BEGIN');
    await holder.query('LOCK TABLE demo_phone_challenges IN SHARE MODE');
    requests.push(second('start', {phone}, token));
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%INSERT INTO demo_phone_challenges%', 1);
    requests.push(w.call('verify', {phone, code: codes[0]}, token));
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%pg_advisory_xact_lock%', 1);
  } finally { await holder.query('ROLLBACK'); holder.release(); await Promise.allSettled(requests); }
  const [start, verify] = await Promise.all(requests);
  assert.equal(start.status, 202);
  assert.deepEqual(verify, {status: 400, body: {code: 'invalid_code'}});
  assert.deepEqual((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges ORDER BY issuance_order')).rows,
    [{attempts: 0}, {attempts: 1}]);
  assert.deepEqual(await w.call('verify', {phone, code: codes[1]}, token), {status: 200, body: {verified: true}});
});

test('a concurrent start waits for verification to consume the current code', async t => {
  let next = 0; const codes = ['111111', '222222'];
  const w = await demoWorld(t, {code: () => codes[next++]}); const token = (await w.session()).family.token;
  const second = await secondPhoneApp(t, w);
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  const holder = await w.f.ctx.pool.connect(); const requests = [];
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM demo_phone_challenges FOR UPDATE');
    requests.push(w.call('verify', {phone, code: codes[0]}, token));
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%FOR UPDATE%', 1);
    requests.push(second('start', {phone}, token));
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%pg_advisory_xact_lock%', 1);
  } finally { await holder.query('ROLLBACK'); holder.release(); await Promise.allSettled(requests); }
  const [verify, start] = await Promise.all(requests);
  assert.deepEqual(verify, {status: 200, body: {verified: true}});
  assert.equal(start.status, 202);
  assert.deepEqual(await w.call('verify', {phone, code: codes[0]}, token), {status: 400, body: {code: 'invalid_code'}});
  assert.deepEqual(await w.call('verify', {phone, code: codes[1]}, token), {status: 200, body: {verified: true}});
});

test('expiry is checked after waiting for the global issuance lock', async t => {
  const w = await demoWorld(t); const token = (await w.session()).family.token;
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  const holder = await w.f.ctx.pool.connect(); let request;
  try {
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('demo_phone_start',0))");
    request = w.call('verify', {phone, code}, token);
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%pg_advisory_xact_lock%', 1);
    w.f.advance(600000);
  } finally { await holder.query('ROLLBACK'); holder.release(); if (request) await request; }
  assert.deepEqual(await request, {status: 410, body: {code: 'code_expired'}});
  assert.equal((await w.f.ctx.pool.query('SELECT attempts FROM demo_phone_challenges')).rows[0].attempts, 0);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_verifications')).rows[0].n, 0);
});

const demoPolicy = {enabled: true, alertsPerNumberDaily: 6};
const demoBudget = {perIncident: 6, perSession: 6};
function alertProvider(overrides = {}) {
  return provider({qualification: {...qualification, allowedDestinations: [], demoLimits: demoBudget}, ...overrides});
}
async function verifiedWorld(w, number) {
  const world = await w.session();
  assert.equal((await w.call('start', {phone: number}, world.family.token)).status, 202);
  assert.equal((await w.call('verify', {phone: number, code}, world.family.token)).status, 200);
  const truck = await w.f.req('POST', '/v1/trucks', {label: 'SYNTHETIC demo truck'}, world.driver.token);
  assert.equal(truck.status, 200);
  const invite = await w.f.req('POST', '/v1/contacts', {contactId: world.family.id, phone: number, map: true, incident: true, role: 'family'}, world.driver.token);
  assert.equal(invite.status, 200);
  assert.equal((await w.f.req('POST', `/v1/contacts/${invite.body.id}/accept`, {map: true, incident: true}, world.family.token)).status, 200);
  const draft = await w.f.req('POST', '/v1/trip-drafts', {text: 'SYNTHETIC demo trip', fields: {truckId: truck.body.id, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}}, world.driver.token);
  assert.equal(draft.status, 200);
  const confirmed = await w.f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [invite.body.id, world.colleague.grantId]}, world.driver.token);
  assert.equal(confirmed.status, 200);
  const trip = confirmed.body.id;
  const incident = (await w.f.req('POST', `/v1/trips/${trip}/sos`, {}, world.driver.token)).body.id;
  const jobs = (await w.f.ctx.pool.query('SELECT j.id,j.version,j.class,j.channel,cg.role FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 ORDER BY cg.role,j.channel', [incident])).rows;
  assert.equal(jobs.length, 5);
  return {world, trip, incident, jobs, grant: invite.body.id};
}
async function authorizeAll(w, jobs, p = alertProvider(), policy = demoPolicy) {
  const d = await runtime();
  for (const job of jobs) await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, job, 'demo'), p, policy);
}
async function familyJobs(f, incident) {
  return (await f.ctx.pool.query("SELECT j.channel,j.status,j.unavailable_reason FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 AND cg.role='family' ORDER BY j.channel", [incident])).rows;
}
async function reservations(f) {
  return (await f.ctx.pool.query(`SELECT (SELECT count(*) FROM dispatch_attempts)::int AS attempts,
    (SELECT count(*) FROM quota_reservations)::int AS quota,(SELECT count(*) FROM provider_requests)::int AS requests`)).rows[0];
}

test('live demo alerts authorize the OTP-verified family despite an empty static allowlist, never the seeded colleague', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone);
  await authorizeAll(w, jobs);
  assert.deepEqual((await w.f.ctx.pool.query(`SELECT cg.role,j.status,j.unavailable_reason,a.payload->>'to' AS "to",count(*)::int n
    FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id LEFT JOIN dispatch_attempts a ON a.job_id=j.id
    WHERE j.incident_id=$1 GROUP BY 1,2,3,4 ORDER BY 1`, [incident])).rows, [
    {role: 'colleague', status: 'unavailable', unavailable_reason: 'destination_not_allowed', to: null, n: 2},
    {role: 'family', status: 'authorized', unavailable_reason: null, to: phone, n: 3},
  ]);
  assert.deepEqual(await reservations(w.f), {attempts: 3, quota: 3, requests: 3});
});

test('an OTP mark for another number never authorizes the grant number even in the static allowlist', async t => {
  const w = await demoWorld(t); const {incident, jobs, world} = await verifiedWorld(w, phone);
  await w.f.ctx.pool.query('UPDATE demo_phone_verifications SET phone=$2 WHERE identity_id=$1', [world.family.id, other]);
  await authorizeAll(w, jobs, alertProvider({qualification: {...qualification, allowedDestinations: [phone], demoLimits: demoBudget}}));
  assert.ok((await familyJobs(w.f, incident)).every(job => job.status === 'unavailable' && job.unavailable_reason === 'destination_not_allowed'));
  assert.deepEqual(await reservations(w.f), {attempts: 0, quota: 0, requests: 0});
});

test('synthetic recipients fail closed without an explicitly enabled demo policy', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone); const d = await runtime();
  const p = alertProvider({qualification: {...qualification, allowedDestinations: [phone], demoLimits: demoBudget}});
  const family = jobs.filter(job => job.role === 'family');
  for (const [i, policy] of [undefined, {enabled: false, alertsPerNumberDaily: 6}, {alertsPerNumberDaily: 6}].entries()) {
    assert.equal(await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, family[i], 'no-policy'), p, policy), null);
  }
  assert.ok((await familyJobs(w.f, incident)).every(job => job.status === 'unavailable' && job.unavailable_reason === 'destination_not_allowed'));
  assert.deepEqual(await reservations(w.f), {attempts: 0, quota: 0, requests: 0});
});

test('demo dispatch rejects every invalid per-number cap before building a payload or reserving quota', async t => {
  for (const [label, cap] of [['missing', undefined], ['null', null], ['zero', 0], ['negative', -1], ['fractional', 1.5],
    ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['string', '2'], ['boolean', true], ['object', {}]]) {
    await t.test(label, async t => {
      const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone); const d = await runtime();
      const p = alertProvider({qualification: {...qualification, allowedDestinations: [phone], demoLimits: demoBudget}});
      const build = p.payload; let payloads = 0;
      p.payload = input => { payloads++; return build(input); };
      const job = jobs.find(job => job.role === 'family');
      assert.equal(await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, job, 'invalid-cap'), p, {enabled: true, alertsPerNumberDaily: cap}), null);
      assert.deepEqual((await familyJobs(w.f, incident))[0], {channel: 'sms', status: 'unavailable', unavailable_reason: 'demo_budget_exhausted'});
      assert.equal(payloads, 0);
      assert.deepEqual(await reservations(w.f), {attempts: 0, quota: 0, requests: 0});
    });
  }
});

test('demo dispatch without qualification demoLimits exhausts the budget', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone); const d = await runtime();
  const job = jobs.find(job => job.role === 'family');
  assert.equal(await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, job, 'no-limits'), provider(), demoPolicy), null);
  assert.deepEqual((await familyJobs(w.f, incident))[0], {channel: 'sms', status: 'unavailable', unavailable_reason: 'demo_budget_exhausted'});
  assert.deepEqual(await reservations(w.f), {attempts: 0, quota: 0, requests: 0});
});

test('dispatch rejects a directly inserted cross-world grant for an OTP-verified recipient', async t => {
  const w = await demoWorld(t); const a = await verifiedWorld(w, phone); const b = await verifiedWorld(w, other);
  // Bypass /contacts entirely: all ordinary ownership, acceptance and phone checks still match.
  const foreign = (await w.f.ctx.pool.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,role)
    SELECT gen_random_uuid(),driver_id,$2,$3,true,true,true,true,accepted_at,'family' FROM contact_grants WHERE id=$1 RETURNING id`,
  [a.grant, b.world.family.id, other])).rows[0].id;
  await w.f.ctx.pool.query('INSERT INTO trip_grants(trip_id,grant_id) VALUES($1,$2)', [a.trip, foreign]);
  await w.f.ctx.pool.query('UPDATE jobs SET grant_id=$2,recipient_id=$3 WHERE grant_id=$1', [a.grant, foreign, b.world.family.id]);
  await authorizeAll(w, a.jobs.filter(job => job.role === 'family'), alertProvider({qualification: {...qualification, allowedDestinations: [other], demoLimits: demoBudget}}));
  assert.ok((await familyJobs(w.f, a.incident)).every(job => job.status === 'unavailable' && job.unavailable_reason === 'destination_not_allowed'));
  assert.deepEqual(await reservations(w.f), {attempts: 0, quota: 0, requests: 0});
});

test('OTP marks authorize only synthetic personas from the demo issuer on both sides of the grant', async t => {
  for (const actor of ['family', 'driver']) {
    for (const changed of ['issuer', 'synthetic']) {
      await t.test(`${actor} ${changed}`, async t => {
        const w = await demoWorld(t); const {incident, jobs, world} = await verifiedWorld(w, phone);
        if (changed === 'issuer') await w.f.ctx.pool.query("UPDATE identities SET issuer='https://synthetic.test' WHERE id=$1", [world[actor].id]);
        else await w.f.ctx.pool.query('UPDATE identities SET synthetic=false WHERE id=$1', [world[actor].id]);
        await authorizeAll(w, jobs.filter(job => job.role === 'family'), alertProvider({qualification: {...qualification, allowedDestinations: [phone], demoLimits: demoBudget}}));
        assert.ok((await familyJobs(w.f, incident)).every(job => job.status === 'unavailable' && job.unavailable_reason === 'destination_not_allowed'));
        assert.deepEqual(await reservations(w.f), {attempts: 0, quota: 0, requests: 0});
      });
    }
  }
});

test('the per-number daily cap spans channels within a world', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone);
  await authorizeAll(w, jobs.filter(job => job.role === 'family'), alertProvider(), {enabled: true, alertsPerNumberDaily: 2});
  assert.deepEqual(await familyJobs(w.f, incident), [
    {channel: 'sms', status: 'authorized', unavailable_reason: null},
    {channel: 'voice', status: 'authorized', unavailable_reason: null},
    {channel: 'whatsapp', status: 'unavailable', unavailable_reason: 'demo_budget_exhausted'},
  ]);
  assert.deepEqual(await reservations(w.f), {attempts: 2, quota: 2, requests: 2});
});

test('concurrent worker contexts in different worlds share one per-number cap', async t => {
  const w = await demoWorld(t); const a = await verifiedWorld(w, phone); const b = await verifiedWorld(w, phone);
  const {createContext} = await import('../dist/db.js'); const d = await runtime();
  const second = createContext(w.f.ctx.pool.options.connectionString, w.f.ctx.clock); t.after(() => second.close());
  const contexts = [w.f.ctx, second], worlds = [a, b];
  const p = alertProvider({qualification: {...qualification, allowedDestinations: [phone], demoLimits: demoBudget}});
  const claims = await Promise.all(contexts.map((ctx, i) => d.claimJob(ctx, worlds[i].jobs.find(job => job.role === 'family'), `worker-${i}`)));
  await w.f.ctx.pool.query('INSERT INTO quota_accounts VALUES($1)', [qualification.accountId]);
  const holder = await w.f.ctx.pool.connect(); const requests = [];
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT project_id FROM quota_accounts WHERE project_id=$1 FOR UPDATE', [qualification.accountId]);
    for (const [i, ctx] of contexts.entries()) requests.push(d.authorizeJob(ctx, claims[i], p, {enabled: true, alertsPerNumberDaily: 1}));
    await waitForBlockedQueries(w.f.ctx.telemetryPool, '%quota_accounts%', 2);
  } finally { await holder.query('ROLLBACK'); holder.release(); await Promise.allSettled(requests); }
  assert.equal((await Promise.all(requests)).filter(Boolean).length, 1);
  assert.deepEqual(await reservations(w.f), {attempts: 1, quota: 1, requests: 1});
  assert.deepEqual((await w.f.ctx.pool.query(`SELECT status,unavailable_reason FROM jobs
    WHERE id=ANY($1) ORDER BY status`, [claims.map(claim => claim.jobId)])).rows, [
    {status: 'authorized', unavailable_reason: null}, {status: 'unavailable', unavailable_reason: 'demo_budget_exhausted'},
  ]);
});

for (const mutation of ['delete-mark', 'change-mark', 'change-world']) {
  test(`dispatch rechecks the exact OTP/world binding after the account-lock wait: ${mutation}`, async t => {
    const w = await demoWorld(t); const {incident, jobs, world} = await verifiedWorld(w, phone); const d = await runtime();
    // A matching static allowlist must not rescue a demo recipient whose OTP binding changed.
    const p = alertProvider({qualification: {...qualification, allowedDestinations: [phone], demoLimits: demoBudget}});
    const build = p.payload; let payloads = 0;
    p.payload = input => { payloads++; return build(input); };
    const job = jobs.find(job => job.role === 'family');
    const claim = await d.claimJob(w.f.ctx, job, 'waiting-demo');
    await w.f.ctx.pool.query('INSERT INTO quota_accounts VALUES($1)', [qualification.accountId]);
    const holder = await w.f.ctx.pool.connect(); let pending;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT project_id FROM quota_accounts WHERE project_id=$1 FOR UPDATE', [qualification.accountId]);
      pending = d.authorizeJob(w.f.ctx, claim, p, demoPolicy);
      await waitForBlockedQueries(w.f.ctx.telemetryPool, '%quota_accounts%', 1);
      assert.equal(payloads, 0, 'no payload before account capacity');
      if (mutation === 'delete-mark') await w.f.ctx.pool.query('DELETE FROM demo_phone_verifications WHERE identity_id=$1', [world.family.id]);
      if (mutation === 'change-mark') await w.f.ctx.pool.query('UPDATE demo_phone_verifications SET phone=$2 WHERE identity_id=$1', [world.family.id, other]);
      if (mutation === 'change-world') await w.f.ctx.pool.query("UPDATE identities SET subject=gen_random_uuid()::text || ':family' WHERE id=$1", [world.family.id]);
    } finally { await holder.query('ROLLBACK'); holder.release(); if (pending) await pending; }
    assert.equal(await pending, null);
    assert.equal(payloads, 0);
    assert.deepEqual((await familyJobs(w.f, incident))[0], {channel: 'sms', status: 'unavailable', unavailable_reason: 'destination_not_allowed'});
    assert.deepEqual(await reservations(w.f), {attempts: 0, quota: 0, requests: 0});
  });
}

test('delivery consume passes the startup demo policy through runJob to authorization', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone); const d = await runtime();
  const {demoDispatch} = await import('../dist/worker.js');
  const sent = [];
  const p = alertProvider({async send(payload) { sent.push(payload.to); return {state: 'accepted', messageId: `msg_${sent.length}`, status: 'queued'}; }});
  const batch = jobs.map((job, i) => ({body: {jobId: job.id, version: job.version, class: job.class}, receipt: `r${i}`}));
  const abort = new AbortController(); let acked = 0;
  const transport = {
    async receive(_kind, signal) { if (batch.length) return batch.splice(0); await new Promise(resolve => {
      if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, {once: true});
    }); return []; },
    async ack() { if (++acked === jobs.length) abort.abort(); }, async defer() { assert.fail('unexpected defer'); },
  };
  await d.consume(w.f.ctx, transport, p, 'emergency', {sms: 2, whatsapp: 2, voice: 2}, abort.signal, demoDispatch({...live, DEMO_MODE: 'true'}));
  assert.deepEqual(sent, [phone, phone, phone]);
  assert.equal(acked, 5);
  assert.ok((await familyJobs(w.f, incident)).every(job => job.status === 'accepted'));
  assert.deepEqual(await reservations(w.f), {attempts: 3, quota: 3, requests: 3});
});
