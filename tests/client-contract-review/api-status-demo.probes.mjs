// Independent PR81 oracle: PR74/4c138ca runtime and PR65/3ea6e1b owner reads.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDS, ORIGIN, REGIONAL_FIELDS } from './fixtures.mjs';
import { deferred, jsonResponse } from './scripted-transport.mjs';

const root = process.env.ANDES_REVIEW_API_ROOT;
if (!root) throw new TypeError('An exact archived API candidate is required');
const { createApiClient, MemorySession, createDemoSessionGateway } =
  await import(pathToFileURL(resolve(root, 'web/src/lib/api/index.ts')).href);
const stamp = '2026-10-17T12:00:00.000Z';
const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const settle = () => new Promise(setImmediate);

function demoWorld(seed = 1, expiration = Math.floor(Date.now() / 1000) + 3600) {
  const world = { synthetic: true, expiresInSeconds: 7200 };
  for (const [i, persona] of ['driver', 'family', 'colleague'].entries()) {
    // Deliberately unverified synthetic signature: only the HTTP seam below can
    // provide an authenticated /me result. Never write these tokens to results.
    const token = `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({
      iss: 'https://demo.andes.invalid', aud: 'andes-demo', sub: `${uuid(900 + seed)}:${persona}`, exp: expiration,
    })).toString('base64url')}.synthetic-not-verified`;
    world[persona] = { id: uuid(seed * 10 + i + 1), token,
      ...(persona === 'driver' ? { truckId: uuid(seed * 10 + 4) } : { grantId: uuid(seed * 10 + i + 5) }) };
  }
  return world;
}
function fixture(behavior, authenticated = true) {
  const session = new MemorySession(), calls = [];
  if (authenticated) session.setCredentials({ issuer: 'https://identity.synthetic.invalid', subject: 'SYNTHETIC-EXISTING',
    accessToken: 'SYNTHETIC-EXISTING-TOKEN', expiresAt: Date.now() + 60_000 });
  const api = createApiClient({ baseUrl: ORIGIN, session, fetch: async (url, init) => {
    assert.equal(url.origin, ORIGIN);
    const headers = new Headers(init.headers);
    calls.push({ method: init.method, path: url.pathname, body: init.body, key: headers.get('idempotency-key'),
      hasAuthorization: headers.has('authorization'), credentials: init.credentials, cache: init.cache, redirect: init.redirect });
    return behavior(url, init);
  } });
  return { api, session, calls, dispose() { session.clear(); } };
}
function reads() {
  const profile = { id: IDS.driver, phone: null, phoneVerified: false };
  const truck = { id: IDS.truck, label: 'SYNTHETIC truck' };
  const trip = { id: IDS.trip, ...REGIONAL_FIELDS, status: 'active', mapActive: true, checkinsActive: true,
    paused: false, version: 1, createdAt: stamp, closedAt: null, contactGrantIds: [] };
  return [
    ['getProfile', '/v1/profile', { ...profile, readAt: stamp }],
    ['listTrucks', '/v1/trucks', { trucks: [truck], limit: 100, hasMore: false, readAt: stamp }],
    ['listContacts', '/v1/contacts', { contacts: [], limit: 100, hasMore: false, readAt: stamp }],
    ['listTrips', '/v1/trips', { active: [trip], recent: [], limits: { active: 50, recent: 20 },
      hasMore: { active: false, recent: false }, readAt: stamp }],
    ['getBootstrap', '/v1/bootstrap', { profile, trucks: [truck], contacts: [], trips: { active: [trip], recent: [] },
      limits: { trucks: 100, contacts: 100, activeTrips: 50, recentTrips: 20 },
      hasMore: { trucks: false, contacts: false, activeTrips: false, recentTrips: false }, readAt: stamp }],
  ];
}
function status() {
  return { trip: { status: 'arrived', paused: false, expectedArrivalAt: stamp },
    check: { status: 'asking', reason: 'arrival_overdue', askUntil: stamp },
    incident: { id: IDS.incident, trigger: 'sos', checkReason: 'silence', status: 'active', createdAt: stamp },
    deliveries: [{ role: 'family', channel: 'sms', status: 'unknown', unavailableReason: null },
      { role: 'group', channel: 'group', status: 'unavailable', unavailableReason: 'group_support_unverified' }] };
}
const checks = [];
async function probe(id, run) {
  let timer;
  try {
    await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Reviewer timeout')), 2000); })]);
    checks.push({ id, passed: true });
  } catch { checks.push({ id, passed: false }); }
  finally { clearTimeout(timer); }
}

for (const [method, path, body] of reads()) {
  await probe(`read:${method}-preserves-server-readAt`, async () => {
    const f = fixture(async () => jsonResponse(body));
    try {
      assert.deepEqual(await f.api[method](), body);
      assert.equal(f.calls[0].path, path); assert.equal(f.calls[0].method, 'GET'); assert.equal(f.calls[0].body, undefined);
      assert.equal(f.calls[0].key, null); assert.equal(f.calls[0].cache, 'no-store');
    } finally { f.dispose(); }
  });
  await probe(`read:${method}-rejects-old-missing-readAt-contract`, async () => {
    const old = structuredClone(body); delete old.readAt;
    const f = fixture(async () => jsonResponse(old));
    try { await assert.rejects(f.api[method](), e => e.kind === 'invalid_response' && e.outcome === 'not_applicable'); }
    finally { f.dispose(); }
  });
}
await probe('read:bootstrap-clock-is-root-only-and-never-a-client-default', async () => {
  const raw = reads().at(-1)[2]; const f = fixture(async () => jsonResponse(raw));
  try {
    const result = await f.api.getBootstrap();
    assert.equal(result.readAt, stamp); assert.equal('readAt' in result.profile, false);
    assert.equal('readAt' in result.trucks[0], false); assert.equal('expectedArrivalAt' in result.trips.active[0], false);
  } finally { f.dispose(); }
});
await probe('read:malformed-server-clock-does-not-become-a-fabricated-time', async () => {
  const f = fixture(async () => jsonResponse({ ...reads()[0][2], readAt: 'not-a-server-instant' }));
  try { await assert.rejects(f.api.getProfile(), e => e.kind === 'invalid_response'); } finally { f.dispose(); }
});
await probe('status:source-facts-stay-distinct-and-private-fields-are-projected-out', async () => {
  const raw = status(); raw.readAt = 'SYNTHETIC-UNPUBLISHED'; raw.incident.phone = 'SYNTHETIC-PRIVATE';
  raw.location = { freshness: 'stale', ageMs: 300_000, capturedAt: stamp, accuracy: 75, latitude: 0, longitude: 0 };
  const f = fixture(async () => jsonResponse(raw));
  try {
    const result = await f.api.getTripStatus(IDS.trip);
    assert.equal(result.trip.status, 'arrived'); assert.equal(result.incident.status, 'active');
    assert.equal(result.incident.trigger, 'sos'); assert.equal(result.incident.checkReason, 'silence');
    assert.equal(result.check.reason, 'arrival_overdue'); assert.equal(result.check.askUntil, stamp);
    assert.equal(result.deliveries[0].status, 'unknown'); assert.equal(result.location.ageMs, 300_000);
    assert.equal(result.location.capturedAt, stamp); assert.equal('latitude' in result.location, false);
    assert.equal('phone' in result.incident, false); assert.equal('readAt' in result, false);
    assert.equal(f.calls[0].path, `/v1/trips/${IDS.trip}/status`);
  } finally { f.dispose(); }
});
await probe('status:omitted-and-unavailable-location-are-not-interchangeable', async () => {
  const raw = status(); const f = fixture(async () => jsonResponse(raw));
  try {
    assert.equal('location' in await f.api.getTripStatus(IDS.trip), false);
    raw.location = { freshness: 'unavailable', ageMs: null, capturedAt: null, accuracy: null };
    assert.deepEqual((await f.api.getTripStatus(IDS.trip)).location, raw.location);
  } finally { f.dispose(); }
});
await probe('status:unknown-delivery-state-and-impossible-source-facts-fail-closed', async () => {
  for (const raw of [{ ...status(), deliveries: [{ role: 'family', channel: 'sms', status: 'help_confirmed', unavailableReason: null }] },
    { ...status(), location: { freshness: 'fresh', ageMs: null, capturedAt: stamp, accuracy: 3 } }]) {
    const f = fixture(async () => jsonResponse(raw));
    try { await assert.rejects(f.api.getTripStatus(IDS.trip), e => e.kind === 'invalid_response'); } finally { f.dispose(); }
  }
});
await probe('sharing:one-attempt-freezes-body-and-explicit-replay-keeps-original-key', async () => {
  let attempts = 0; const f = fixture(async () => {
    if (++attempts === 1) throw new TypeError('SYNTHETIC lost sharing response');
    return jsonResponse({ id: IDS.trip, sharing: 'stopped' });
  });
  try {
    const body = { state: 'stopped', reason: 'page_hidden' }, options = { idempotencyKey: 'q47-sharing-intent' };
    const pending = f.api.setSharing(IDS.trip, body, options); body.state = 'resumed';
    await assert.rejects(pending, e => e.kind === 'network' && e.outcome === 'unknown'); assert.equal(attempts, 1);
    await f.api.setSharing(IDS.trip, { state: 'stopped', reason: 'page_hidden' }, options);
    assert.deepEqual(f.calls[1], f.calls[0]);
    assert.equal(f.calls[0].path, `/v1/trips/${IDS.trip}/sharing`);
    assert.equal(f.calls[0].body, '{"state":"stopped","reason":"page_hidden"}');
  } finally { f.dispose(); }
});
await probe('sharing:closed-trip-conflict-is-a-refusal-without-retry', async () => {
  const f = fixture(async () => jsonResponse({ code: 'trip_closed' }, 409));
  try {
    await assert.rejects(f.api.setSharing(IDS.trip, { state: 'resumed', reason: 'user' }, { idempotencyKey: 'q47-closed' }),
      e => e.status === 409 && e.outcome === 'rejected'); assert.equal(f.calls.length, 1);
  } finally { f.dispose(); }
});
await probe('demo:explicit-anonymous-acquisition-does-not-replace-existing-session', async () => {
  const raw = demoWorld(); const f = fixture(async () => jsonResponse(raw));
  try {
    await assert.rejects(f.api.createDemoSession(), e => e.kind === 'invalid_input'); assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.api.createDemoSession({ demo: true }), raw);
    assert.deepEqual(f.calls[0], { method: 'POST', path: '/v1/demo/session', body: '{}', key: null,
      hasAuthorization: false, credentials: 'omit', cache: 'no-store', redirect: 'error' });
    assert.equal(f.session.snapshot().subject, 'SYNTHETIC-EXISTING');
  } finally { f.dispose(); }
});
for (const status of [401, 429]) await probe(`demo:anonymous-${status}-does-not-invalidate-another-account`, async () => {
  const f = fixture(async () => jsonResponse({ code: status === 429 ? 'demo_rate_limited' : 'unauthorized' }, status));
  try {
    await assert.rejects(f.api.createDemoSession({ demo: true }), e => e.status === status && e.outcome === 'rejected');
    assert.equal(f.session.snapshot().subject, 'SYNTHETIC-EXISTING'); assert.equal(f.calls.length, 1);
  } finally { f.dispose(); }
});
await probe('demo:ambiguous-world-creation-is-not-replayed', async () => {
  const f = fixture(async () => { throw new TypeError('SYNTHETIC lost world response'); }, false);
  try {
    await assert.rejects(f.api.createDemoSession({ demo: true }), e => e.kind === 'network' && e.outcome === 'unknown');
    assert.equal(f.calls.length, 1); assert.equal(f.session.snapshot().status, 'anonymous');
  } finally { f.dispose(); }
});
for (const persona of ['driver', 'family', 'colleague']) await probe(`demo-gateway:${persona}-requires-server-identity-and-keeps-token-out-of-view`, async () => {
  const raw = demoWorld(), me = deferred();
  const f = fixture(async (url, init) => {
    if (url.pathname === '/v1/demo/session') return jsonResponse(raw);
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${raw[persona].token}`); return me.promise;
  }, false);
  const gateway = createDemoSessionGateway({ session: f.session, api: f.api, persona, mode: 'external' });
  try {
    const pending = gateway.begin(); assert.equal(gateway.begin(), pending); await settle();
    assert.deepEqual(gateway.getSnapshot(), { state: 'connecting', mode: 'demo' });
    me.resolve(jsonResponse({ id: raw[persona].id })); await pending;
    assert.deepEqual(gateway.getSnapshot(), { state: 'authenticated', mode: 'demo' });
    assert.equal(JSON.stringify(gateway.getSnapshot()).includes('token'), false); assert.equal(f.calls.length, 2);
  } finally { gateway.dispose(); f.dispose(); }
});
await probe('demo-gateway:unverified-claims-cannot-override-a-server-refusal-or-identity-mismatch', async () => {
  for (const reply of [jsonResponse({ code: 'unauthorized' }, 401), jsonResponse({ id: IDS.otherDriver })]) {
    const raw = demoWorld(); const f = fixture(async url => url.pathname === '/v1/demo/session' ? jsonResponse(raw) : reply, false);
    const gateway = createDemoSessionGateway({ session: f.session, api: f.api, persona: 'driver' });
    try { await gateway.begin(); assert.notEqual(gateway.getSnapshot().state, 'authenticated'); assert.equal(f.session.snapshot().status, 'anonymous'); }
    finally { gateway.dispose(); f.dispose(); }
  }
});
await probe('demo-gateway:retired-world-cannot-install-after-a-later-explicit-begin', async () => {
  const old = deferred(), current = demoWorld(2); let worlds = 0;
  const f = fixture(async url => {
    if (url.pathname === '/v1/demo/session') return ++worlds === 1 ? old.promise : jsonResponse(current);
    return jsonResponse({ id: current.driver.id });
  }, false);
  const gateway = createDemoSessionGateway({ session: f.session, api: f.api, persona: 'driver' });
  try {
    const first = gateway.begin(); await settle(); gateway.end(); await gateway.begin();
    old.resolve(jsonResponse(demoWorld(1))); await first;
    assert.equal(gateway.getSnapshot().state, 'authenticated'); assert.equal(worlds, 2);
    assert.equal(f.session.snapshot().subject, `${uuid(902)}:driver`);
  } finally { gateway.dispose(); f.dispose(); }
});
await probe('demo-gateway:old-me401-cannot-clear-a-newly-verified-world', async () => {
  const oldMe = deferred(); let worlds = 0, reads = 0;
  const f = fixture(async url => {
    if (url.pathname === '/v1/demo/session') return jsonResponse(demoWorld(++worlds));
    return ++reads === 1 ? oldMe.promise : jsonResponse({ id: demoWorld(2).driver.id });
  }, false);
  const gateway = createDemoSessionGateway({ session: f.session, api: f.api, persona: 'driver' });
  try {
    const first = gateway.begin(); await settle(); gateway.end(); await gateway.begin();
    oldMe.resolve(jsonResponse({ code: 'unauthorized' }, 401)); await first;
    assert.equal(gateway.getSnapshot().state, 'authenticated'); assert.equal(f.session.snapshot().subject, `${uuid(902)}:driver`);
  } finally { gateway.dispose(); f.dispose(); }
});
await probe('demo-gateway:unverified-long-expiry-is-capped-by-declared-world-lifetime', async () => {
  const raw = demoWorld(1, Math.floor(Date.now() / 1000) + 86_400);
  const f = fixture(async url => jsonResponse(url.pathname === '/v1/demo/session' ? raw : { id: raw.driver.id }), false);
  const gateway = createDemoSessionGateway({ session: f.session, api: f.api, persona: 'driver' });
  try { await gateway.begin(); assert.equal(gateway.getSnapshot().state, 'authenticated');
    assert.ok(f.session.snapshot().expiresAt <= Date.now() + 7_200_000); }
  finally { gateway.dispose(); f.dispose(); }
});
await probe('fields:arrival-and-contact-role-remain-explicit-source-values', async () => {
  const f = fixture(async (url, init) => {
    const body = JSON.parse(init.body);
    return jsonResponse(url.pathname === '/v1/contacts' ? { id: IDS.grant, status: 'pending' }
      : { id: IDS.trip, status: 'draft', rawText: body.text, fields: body.fields, missingFields: ['truckId'] });
  });
  try {
    const draft = await f.api.createDraft({ text: 'SYNTHETIC', fields: { expectedArrivalAt: stamp } }, { idempotencyKey: 'q47-arrival' });
    assert.deepEqual(draft.fields, { expectedArrivalAt: stamp });
    await f.api.inviteContact({ contactId: IDS.contact, phone: '+12025550123', map: false, incident: true, role: 'colleague' },
      { idempotencyKey: 'q47-role' });
    assert.equal(JSON.parse(f.calls[1].body).role, 'colleague');
  } finally { f.dispose(); }
});
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({ passed, checks, limitation:
  'Frozen SDK with independent synthetic wire fixtures and unverified fake JWTs. Actual server signature/SQL checks are a separate run; no browser/provider/backend-policy or whole-app acceptance.' }, null, 2));
process.exitCode = passed ? 0 : 1;
