import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, MemorySession, createApiClient, createDemoSessionGateway, createDemoWorld } from '../../src/lib/api/index.ts';

const trip = '11111111-1111-4111-8111-111111111111';
const family = '22222222-2222-4222-8222-222222222222';
const colleague = '33333333-3333-4333-8333-333333333333';
const incident = '44444444-4444-4444-8444-444444444444';
const stamp = '2026-10-17T12:00:00.000Z';
function jwt(persona, override = {}) {
  return `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({
    iss: 'https://demo.andes.invalid', aud: 'andes-demo', sub: `${incident}:${persona}`,
    exp: Math.floor(Date.now() / 1000) + 7200, ...override,
  })).toString('base64url')}.synthetic-unverified-signature`;
}
function world() {
  return { synthetic: true, expiresInSeconds: 7200, driver: { id: trip, token: jwt('driver'), truckId: incident },
    family: { id: family, token: jwt('family'), grantId: incident },
    colleague: { id: colleague, token: jwt('colleague'), grantId: trip } };
}
function status() {
  return { trip: { status: 'arrived', paused: false, expectedArrivalAt: stamp }, check: null,
    incident: { id: incident, trigger: 'sos', checkReason: 'silence', status: 'active', createdAt: stamp },
    deliveries: [{ role: 'family', channel: 'sms', status: 'unknown', unavailableReason: null },
      { role: 'group', channel: 'group', status: 'unavailable', unavailableReason: 'group_support_unverified' }] };
}
function setup(fetch, authenticated = true) {
  const session = new MemorySession();
  if (authenticated) session.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'synthetic',
    accessToken: 'PRIVATE_SYNTHETIC_TOKEN', expiresAt: Date.now() + 60_000 });
  const api = createApiClient({ baseUrl: 'https://api.example.invalid', session, fetch });
  return { session, api };
}
const invalid = error => error instanceof ApiError && error.kind === 'invalid_response';

test('status preserves latest active SOS after arrival and source facts without inventing readAt', async () => {
  const raw = status(); raw.location = { freshness: 'stale', ageMs: 500_000, capturedAt: stamp, accuracy: 85, latitude: -12 };
  raw.deliveries[0].phone = 'PRIVATE_PHONE'; raw.incident.recipientId = family;
  const { api } = setup(async (url, init) => {
    assert.equal(url.pathname, `/v1/trips/${trip}/status`); assert.equal(init.method, 'GET');
    assert.equal(init.headers['Idempotency-Key'], undefined); return Response.json(raw);
  });
  const result = await api.getTripStatus(trip.toUpperCase());
  assert.equal(result.trip.status, 'arrived'); assert.equal(result.incident.status, 'active');
  assert.equal(result.incident.trigger, 'sos'); assert.equal(result.incident.checkReason, 'silence');
  assert.equal(result.location.ageMs, 500_000); assert.equal(result.location.capturedAt, stamp);
  assert.equal(result.deliveries[0].status, 'unknown');
  assert.equal('readAt' in result, false); assert.equal('latitude' in result.location, false);
  assert.equal('phone' in result.deliveries[0], false); assert.equal('recipientId' in result.incident, false);
});

test('status location freshness must agree with its age at the server 120000ms bound', async () => {
  for (const [freshness, ageMs, ok] of [['fresh', 3_600_000, false], ['stale', 1_000, false],
    ['fresh', 120_000, true], ['stale', 120_001, true]]) {
    const raw = status(); raw.location = { freshness, ageMs, capturedAt: stamp, accuracy: 20 };
    const { api } = setup(async () => Response.json(raw));
    if (ok) assert.equal((await api.getTripStatus(trip)).location.freshness, freshness);
    else await assert.rejects(api.getTripStatus(trip), invalid); // An hour-old position is never shown as live.
  }
});

test('status distinguishes omitted location, unavailable location and server asking deadline', async () => {
  const raw = status(); raw.check = { status: 'asking', reason: 'sharing_stopped', askUntil: stamp };
  const { api } = setup(async () => Response.json(raw));
  assert.equal('location' in await api.getTripStatus(trip), false);
  raw.location = { freshness: 'unavailable', ageMs: null, capturedAt: null, accuracy: null };
  const result = await api.getTripStatus(trip);
  assert.equal(result.location.freshness, 'unavailable'); assert.equal(result.check.askUntil, stamp);
  assert.equal(result.check.reason, 'sharing_stopped');
});

test('malformed status enums and contradictory location/delivery facts fail closed', async () => {
  const bad = [
    { ...status(), check: { status: 'asking', reason: 'crime_detected', askUntil: stamp } },
    { ...status(), incident: null },
    { ...status(), deliveries: [{ role: 'family', channel: 'sms', status: 'human_help_confirmed', unavailableReason: null }] },
    { ...status(), location: { freshness: 'fresh', ageMs: null, capturedAt: stamp, accuracy: 5 } },
    { ...status(), location: { freshness: 'unavailable', ageMs: 0, capturedAt: null, accuracy: null } },
  ];
  for (const raw of bad) {
    const { api } = setup(async () => Response.json(raw));
    await assert.rejects(api.getTripStatus(trip), invalid);
  }
});

test('sharing uses one explicit key/body and an ambiguous response is never replayed', async () => {
  const calls = []; let lose = true;
  const { api } = setup(async (url, init) => {
    calls.push({ path: url.pathname, method: init.method, body: init.body, key: init.headers['Idempotency-Key'] });
    if (lose) { lose = false; throw Error('PRIVATE_NETWORK_DETAIL'); }
    return Response.json({ id: trip, sharing: 'stopped' });
  });
  const input = { state: 'stopped', reason: 'permission_denied' }; const options = { idempotencyKey: 'explicit-sharing-intent' };
  await assert.rejects(api.setSharing(trip, input, options), e => e.kind === 'network' && e.outcome === 'unknown');
  assert.equal(calls.length, 1);
  assert.equal((await api.setSharing(trip, input, options)).sharing, 'stopped');
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], { path: `/v1/trips/${trip}/sharing`, method: 'POST', body: JSON.stringify(input), key: options.idempotencyKey });
  await assert.rejects(api.setSharing(trip, input, {}), e => e.kind === 'invalid_input' && e.outcome === 'not_sent');
});

test('new arrival/role fields pass through without creating regional or time defaults', async () => {
  let sent;
  const { api } = setup(async (url, init) => {
    sent = JSON.parse(init.body);
    if (url.pathname === '/v1/contacts') return Response.json({ id: family, status: 'pending' });
    return Response.json({ id: trip, rawText: 'Synthetic', status: 'draft', fields: sent.fields, missingFields: ['truckId'] });
  });
  const result = await api.createDraft({ text: 'Synthetic', fields: { expectedArrivalAt: stamp } }, { idempotencyKey: 'draft-with-explicit-arrival' });
  assert.deepEqual(sent.fields, { expectedArrivalAt: stamp }); assert.deepEqual(result.fields, sent.fields);
  await api.inviteContact({ contactId: family, phone: '+15555550102', map: true, incident: true, role: 'colleague' },
    { idempotencyKey: 'explicit-colleague' });
  assert.equal(sent.role, 'colleague');
});

test('demo session is explicit, anonymous and unkeyed even with another active identity', async () => {
  let calls = 0;
  const { session, api } = setup(async (url, init) => {
    calls++; assert.equal(url.pathname, '/v1/demo/session'); assert.equal(init.method, 'POST');
    assert.equal(init.body, '{}'); assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers['Idempotency-Key'], undefined); assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    return Response.json({ ...world(), secret: 'PRIVATE' });
  });
  await assert.rejects(api.createDemoSession(), e => e.kind === 'invalid_input' && e.outcome === 'not_sent');
  assert.equal(calls, 0); const result = await api.createDemoSession({ demo: true });
  assert.equal(calls, 1); assert.equal(result.synthetic, true); assert.equal('secret' in result, false);
  assert.equal(session.snapshot().subject, 'synthetic', 'Acquisition must not install credentials by itself');
});

test('demo 401 (demo mode off), 404 and 429 and ambiguous creation retain their safe status without clearing or replaying an account', async () => {
  for (const status of [401, 404, 429]) {
    const { session, api } = setup(async () => Response.json({ code: status === 429 ? 'demo_rate_limited' : 'unauthorized' }, { status }));
    await assert.rejects(api.createDemoSession({ demo: true }), e => e.status === status && e.outcome === 'rejected'
      && (status !== 429 || e.code === 'demo_rate_limited'));
    assert.equal(session.snapshot().status, 'authenticated');
  }
  let calls = 0;
  const { api } = setup(async () => { calls++; throw Error('PRIVATE_DEMO_FAILURE'); }, false);
  await assert.rejects(api.createDemoSession({ demo: true }), e => e.kind === 'network' && e.outcome === 'unknown');
  assert.equal(calls, 1);
});

test('malformed or non-synthetic demo responses cannot become a world', async () => {
  for (const raw of [{ ...world(), synthetic: false }, { ...world(), expiresInSeconds: 999999 },
    { ...world(), family: { ...world().family, id: trip } }, { ...world(), driver: { ...world().driver, token: 'not-a-jwt' } }]) {
    const { api } = setup(async () => Response.json(raw), false);
    await assert.rejects(api.createDemoSession({ demo: true }), invalid);
  }
});

test('demo gateway authenticates each explicitly chosen persona only after actual typed me', async () => {
  for (const persona of ['driver', 'family', 'colleague']) {
    const raw = world(); let reads = 0; let creates = 0; let finish;
    const { session, api } = setup(async url => {
      if (url.pathname === '/v1/demo/session') { creates++; return Response.json(raw); }
      reads++; return new Promise(resolve => { finish = () => resolve(Response.json({ id: raw[persona].id })); });
    }, false);
    const gateway = createDemoSessionGateway({ api, session, persona });
    try {
      const pending = gateway.begin(); assert.equal(pending, gateway.begin());
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(gateway.getSnapshot(), { state: 'connecting', mode: 'demo' });
      finish(); await pending;
      assert.deepEqual(gateway.getSnapshot(), { state: 'authenticated', mode: 'demo' });
      assert.equal(creates, 1); assert.equal(reads, 1);
      assert.equal(session.snapshot().subject, `${incident}:${persona}`);
      assert.equal('token' in gateway.getSnapshot(), false);
      gateway.end(); assert.equal(session.snapshot().status, 'anonymous');
    } finally { gateway.dispose(); }
  }
});

test('demo gateway rejects token metadata and mismatched server identity without caching personas', async () => {
  const tokens = [jwt('family'), jwt('driver', { iss: 'https://wrong.example.invalid' }),
    jwt('driver', { exp: 1 }), jwt('driver', { sub: trip })];
  for (const token of tokens) {
    let reads = 0; const raw = world(); raw.driver.token = token;
    const { session, api } = setup(async url => {
      if (url.pathname === '/v1/demo/session') return Response.json(raw);
      reads++; return Response.json({ id: trip });
    }, false);
    const gateway = createDemoSessionGateway({ api, session, persona: 'driver' });
    try { await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'error'); assert.equal(reads, 0); }
    finally { gateway.dispose(); }
  }
  const { session, api } = setup(async url => Response.json(url.pathname === '/v1/demo/session' ? world() : { id: family }), false);
  const gateway = createDemoSessionGateway({ api, session, persona: 'driver' });
  try { await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'error'); assert.equal(session.snapshot().status, 'anonymous'); }
  finally { gateway.dispose(); }
});

test('demo logout retires late acquisition and a later explicit begin reuses that world', async () => {
  let creates = 0; let finish;
  const { session, api } = setup(async url => {
    if (url.pathname === '/v1/me') return Response.json({ id: trip });
    creates++; if (creates === 1) return new Promise(resolve => { finish = () => resolve(Response.json(world())); });
    return Response.json(world());
  }, false);
  const gateway = createDemoSessionGateway({ api, session, persona: 'driver' });
  try {
    const pending = gateway.begin(); await new Promise(resolve => setImmediate(resolve));
    gateway.end(); finish(); await pending;
    assert.equal(session.snapshot().status, 'anonymous'); assert.equal(gateway.getSnapshot().state, 'signed-out');
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'authenticated'); assert.equal(creates, 1);
  } finally { gateway.dispose(); }
});

test('a second begin reuses the unexpired world so the active trip and SOS stay reachable', async () => {
  let creates = 0;
  const { session, api } = setup(async url => {
    if (url.pathname === '/v1/demo/session') { creates++; return Response.json(world()); }
    return Response.json({ id: trip });
  }, false);
  const gateway = createDemoSessionGateway({ api, session, persona: 'driver' });
  const realNow = Date.now;
  try {
    await gateway.begin(); await gateway.begin(); gateway.end(); await gateway.begin();
    assert.equal(gateway.getSnapshot().state, 'authenticated');
    assert.equal(creates, 1);
    Date.now = () => realNow() + 7_201_000; // Past the world's declared 7200s lifetime.
    await gateway.begin();
    assert.equal(gateway.getSnapshot().state, 'authenticated');
    assert.equal(creates, 2);
  } finally { Date.now = realNow; gateway.dispose(); }
});

test('driver, family and colleague personas share one world so contacts reach the driver trip', async () => {
  let creates = 0; const raw = world();
  const { session, api } = setup(async (url, init) => {
    if (url.pathname === '/v1/demo/session') { creates++; return Response.json(raw); }
    const persona = ['driver', 'family', 'colleague'].find(p => init.headers.Authorization === `Bearer ${raw[p].token}`);
    return Response.json({ id: raw[persona].id });
  }, false);
  const shared = createDemoWorld(api);
  for (const persona of ['driver', 'family', 'colleague']) {
    const gateway = createDemoSessionGateway({ api, session, persona, world: shared });
    try {
      await gateway.begin();
      assert.equal(gateway.getSnapshot().state, 'authenticated');
      assert.equal(session.snapshot().subject, `${incident}:${persona}`);
    } finally { gateway.dispose(); }
  }
  assert.equal(creates, 1);
});

test('a world whose tokens the server rejects (restart) is dropped so the next begin recovers', async () => {
  let creates = 0; let restarted = false;
  const { session, api } = setup(async url => {
    if (url.pathname === '/v1/demo/session') { creates++; restarted = false; return Response.json(world()); }
    return restarted ? Response.json({ code: 'unauthorized' }, { status: 401 }) : Response.json({ id: trip });
  }, false);
  const gateway = createDemoSessionGateway({ api, session, persona: 'driver' });
  try {
    await gateway.begin(); restarted = true;
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'error'); assert.equal(creates, 1);
    await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'authenticated'); assert.equal(creates, 2);
  } finally { gateway.dispose(); }
});
