import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { ApiError, MemorySession, createApiClient, createIdempotencyKey } from '../../src/lib/api/index.ts';

// All tokens, identities, locations and responses here are synthetic transport fixtures.
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-17T12:00:00.000Z';
const fields = { truckId: id, origin: 'Origen sintético', destination: 'Destino sintético', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo' };
function json(value, status = 200) { return Response.json(value, { status }); }
function session(clock) {
  const s = new MemorySession(clock);
  s.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'synthetic-A', accessToken: 'synthetic.token.A', expiresAt: (clock?.() ?? Date.now()) + 60_000 });
  return s;
}
function fixture(fetch, options = {}) {
  const s = options.session ?? session();
  return { s, api: createApiClient({ baseUrl: 'https://api.example.invalid/', session: s, fetch, ...options }) };
}
const write = { idempotencyKey: 'synthetic-intent-1' };

test('every current operation uses its sourced route, method, payload and credentials', async t => {
  const draft = { id, rawText: 'synthetic', fields: {}, missingFields: Object.keys(fields), status: 'draft' };
  const trip = { id, driver_id: other, truck_id: id, origin: fields.origin, destination: fields.destination,
    country: 'BR', locale: 'pt-BR', time_zone: fields.timeZone, status: 'active', map_active: true,
    checkins_active: true, paused: false, version: 1, created_at: stamp, closed_at: null };
  const snapshot = { tripId: id, location: null, freshness: 'unavailable', ageMs: null, readAt: stamp };
  const samples = [{ capturedAt: stamp, latitude: -12.1, longitude: -77.1, accuracy: 25 }];
  const cases = [
    ['getIdentity', [], 'GET', '/v1/me', undefined, { id }],
    ['createTruck', [{ label: 'Synthetic truck' }, write], 'POST', '/v1/trucks', { label: 'Synthetic truck' }, { id }],
    ['inviteContact', [{ contactId: other, phone: '+12025550123', map: true, incident: false }, write], 'POST', '/v1/contacts',
      { contactId: other, phone: '+12025550123', map: true, incident: false }, { id, status: 'pending' }],
    ['acceptContact', [id, { map: true, incident: false }, write], 'POST', `/v1/contacts/${id}/accept`,
      { map: true, incident: false }, { id, map: true, incident: false, status: 'accepted' }],
    ['revokeContact', [id, write], 'POST', `/v1/contacts/${id}/revoke`, {}, { id, revoked: true }],
    ['createDraft', [{ text: 'synthetic' }, write], 'POST', '/v1/trip-drafts', { text: 'synthetic' }, draft],
    ['confirmTrip', [id, { confirmed: true, contactGrantIds: [], fields }, write], 'POST', `/v1/trip-drafts/${id}/confirm`,
      { confirmed: true, contactGrantIds: [], fields }, { id, status: 'active', fields }],
    ['getTrip', [id], 'GET', `/v1/trips/${id}`, undefined, trip],
    ...['arrived', 'cancel', 'pause', 'resume', 'checkin_ok', 'rest_report'].map(type =>
      ['commandTrip', [id, type, write], 'POST', `/v1/trips/${id}/commands`, { type }, { id, command: type, automaticEscalation: false }]),
    ['uploadLocations', [id, samples, write], 'POST', `/v1/trips/${id}/locations`, { observations: samples }, { id, received: 1 }],
    ['getSnapshot', [id], 'GET', `/v1/trips/${id}/snapshot`, undefined, snapshot],
    ['revokeTripContact', [id, other, write], 'POST', `/v1/trips/${id}/contacts/${other}/revoke`, {}, { id: other, tripId: id, revoked: true }],
    ['reportSos', [id, write], 'POST', `/v1/trips/${id}/sos`, {}, { id, tripId: id, status: 'active', groupCapability: 'unavailable' }],
    ['getIncident', [id], 'GET', `/v1/incidents/${id}`, undefined,
      { id, tripId: id, status: 'active', createdAt: stamp, resolvedAt: null, groupCapability: 'unavailable' }],
    ['acknowledgeIncident', [id, write], 'POST', `/v1/incidents/${id}/acknowledgements`, {}, { id, status: 'active', recorded: 'acknowledged' }],
    ['reportAction', [id, 'Reported synthetic action', write], 'POST', `/v1/incidents/${id}/actions`, { action: 'Reported synthetic action' }, { id, status: 'active', recorded: 'action' }],
    ['resolveIncident', [id, write], 'POST', `/v1/incidents/${id}/resolve`, {}, { id, status: 'resolved' }],
  ];
  for (const [method, args, http, path, body, result] of cases) {
    await t.test(`${method} ${body?.type ?? ''}`, async () => {
      let calls = 0;
      const { api } = fixture(async (url, init) => {
        calls += 1;
        assert.equal(url.origin, 'https://api.example.invalid');
        assert.equal(url.pathname, path);
        assert.equal(init.method, http);
        assert.deepEqual(init.body === undefined ? undefined : JSON.parse(init.body), body);
        assert.equal(init.headers.Authorization, 'Bearer synthetic.token.A');
        assert.equal(init.headers['Idempotency-Key'], http === 'POST' ? write.idempotencyKey : undefined);
        assert.equal(init.credentials, 'omit');
        assert.equal(init.cache, 'no-store');
        assert.equal(init.redirect, 'error');
        assert.equal(init.referrerPolicy, 'no-referrer');
        return json({ ...result, privateExtra: 'must-not-leak' });
      });
      assert.deepEqual(await api[method](...args), result);
      assert.equal(calls, 1);
    });
  }
});

test('configuration is explicit and rejects unsafe token destinations', () => {
  for (const baseUrl of ['', '/relative', 'http://remote.example.invalid', 'file:///private',
    'https://user:password@api.example.invalid', 'https://api.example.invalid/?token=secret', 'https://api.example.invalid/#token']) {
    assert.throws(() => createApiClient({ baseUrl, session: session() }), e => e instanceof ApiError && e.kind === 'configuration');
  }
  assert.throws(() => createApiClient({ baseUrl: 'https://api.example.invalid', session: null }), e => e.kind === 'configuration');
});

test('invalid credential values fail with safe local errors', () => {
  const s = new MemorySession();
  for (const credentials of [null, {}, { issuer: {}, subject: 'A' },
    { issuer: 'https://identity.example.invalid', subject: 'A', accessToken: 'token\r\nheader', expiresAt: Date.now() + 1000 }]) {
    assert.throws(() => s.setCredentials(credentials), e => e instanceof ApiError && e.kind === 'invalid_input');
  }
  assert.deepEqual(s.snapshot(), { status: 'anonymous' });
});

test('explicit proxy base path is preserved', async () => {
  const { api } = fixture(async url => { assert.equal(url.pathname, '/api/v1/me'); return json({ id }); }, { baseUrl: 'https://app.example.invalid/api' });
  await api.getIdentity();
});

test('missing, expired and cleared sessions send nothing and snapshots contain no token', async () => {
  let now = 1000;
  const s = new MemorySession(() => now);
  let calls = 0;
  const { api } = fixture(async () => { calls += 1; return json({ id }); }, { session: s });
  await assert.rejects(api.getIdentity(), e => e.kind === 'unauthenticated');
  s.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'A', accessToken: 'synthetic-token', expiresAt: 2000 });
  assert.equal(JSON.stringify(s.snapshot()).includes('synthetic-token'), false);
  now = 2000;
  await assert.rejects(api.getIdentity(), e => e.kind === 'session_expired');
  assert.deepEqual(s.snapshot(), { status: 'expired' });
  s.clear();
  await assert.rejects(api.getIdentity(), e => e.kind === 'unauthenticated');
  assert.equal(calls, 0);
});

test('HTTP distinctions remain actionable and server text never becomes an error', async t => {
  for (const [status, kind] of [[400, 'invalid_input'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'not_found'],
    [409, 'conflict'], [422, 'unsupported'], [500, 'server'], [503, 'server']]) {
    await t.test(String(status), async () => {
      const { api, s } = fixture(async () => json({ code: 'PRIVATE_SENTINEL', token: 'PRIVATE_SENTINEL' }, status));
      await assert.rejects(api.reportSos(id, write), e => {
        assert.equal(e.status, status); assert.equal(e.kind, kind);
        assert.equal(e.outcome, status < 500 ? 'rejected' : 'unknown');
        assert.equal(`${e.message}${JSON.stringify(e)}${e.stack}`.includes('PRIVATE_SENTINEL'), false);
        return true;
      });
      assert.equal(s.snapshot().status, status === 401 ? 'anonymous' : 'authenticated');
    });
  }
});

test('safe backend codes are preserved without private error payloads', async () => {
  const { api } = fixture(async () => json({ code: 'verified_phone_mismatch', detail: 'private' }, 409));
  await assert.rejects(api.acceptContact(id, { map: true, incident: false }, write), e => e.code === 'verified_phone_mismatch' && !('detail' in e));
});

test('write requires a bounded visible-ASCII key and UUID resources cannot escape the route', async () => {
  let calls = 0;
  const { api } = fixture(async () => { calls += 1; return json({ id }); });
  for (const key of [undefined, '', 'space key', 'line\nbreak', 'é', 'a'.repeat(129)]) {
    await assert.rejects(api.createTruck({ label: 'synthetic' }, { idempotencyKey: key }), e => e.kind === 'invalid_input' && e.outcome === 'not_sent');
  }
  await assert.rejects(api.getTrip('../me?token=secret'), e => e.kind === 'invalid_input' && e.outcome === 'not_applicable');
  assert.equal(calls, 0);
  assert.match(createIdempotencyKey(), /^[0-9a-f-]{36}$/);
});

test('payload is captured before async work and explicit retries preserve key and content', async () => {
  const sent = [];
  const body = { label: 'original' };
  const { api } = fixture(async (_url, init) => { sent.push([init.body, init.headers['Idempotency-Key']]); return json({ id }); });
  const result = api.createTruck(body, write);
  body.label = 'changed later';
  await result;
  await api.createTruck({ label: 'original' }, write);
  assert.deepEqual(sent, [[JSON.stringify({ label: 'original' }), write.idempotencyKey], [JSON.stringify({ label: 'original' }), write.idempotencyKey]]);
});

test('UUID case aliases preserve the same backend idempotency path scope', async () => {
  const resource = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
  const paths = [];
  const { api } = fixture(async (url, init) => {
    paths.push([url.pathname, init.headers['Idempotency-Key']]);
    return json({ id: resource, tripId: resource, status: 'active', groupCapability: 'unavailable' });
  });
  await api.reportSos(resource.toUpperCase(), write);
  await api.reportSos(resource, write);
  assert.deepEqual(paths, [[`/v1/trips/${resource}/sos`, write.idempotencyKey], [`/v1/trips/${resource}/sos`, write.idempotencyKey]]);
});

test('network failure never replays a write or exposes transport cause', async () => {
  let calls = 0;
  const { api } = fixture(async () => { calls += 1; throw new Error('PRIVATE_TOKEN_FROM_TRANSPORT'); });
  await assert.rejects(api.reportSos(id, write), e => {
    assert.equal(e.kind, 'network'); assert.equal(e.outcome, 'unknown');
    assert.equal(`${e.stack}${JSON.stringify(e)}`.includes('PRIVATE_TOKEN_FROM_TRANSPORT'), false);
    assert.equal(e.cause, undefined); return true;
  });
  assert.equal(calls, 1);
});

test('caller cancellation before dispatch sends nothing; cancellation after dispatch stays unknown', async () => {
  const cancelled = new AbortController(); cancelled.abort('private cancellation reason');
  let calls = 0;
  const { api } = fixture(async (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
  });
  await assert.rejects(api.reportSos(id, { ...write, signal: cancelled.signal }), e => e.kind === 'cancelled' && e.outcome === 'not_sent');
  const controller = new AbortController();
  const pending = api.reportSos(id, { ...write, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, e => e.kind === 'cancelled' && e.outcome === 'unknown');
  assert.equal(calls, 1);
});

test('local timeout aborts one attempt and does not imply server cancellation', async () => {
  let calls = 0;
  const { api } = fixture(async (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }, { timeoutMs: 10 });
  await assert.rejects(api.reportSos(id, write), e => e.kind === 'timeout' && e.outcome === 'unknown');
  assert.equal(calls, 1);
});

test('session replacement aborts old work and a stale 401 cannot erase the new session', async () => {
  let finish;
  let signal;
  const { api, s } = fixture(async (_url, init) => { signal = init.signal; return new Promise(resolve => { finish = resolve; }); });
  const pending = api.reportSos(id, write);
  s.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'B', accessToken: 'synthetic.token.B', expiresAt: Date.now() + 60_000 });
  assert.equal(signal.aborted, true);
  finish(json({ code: 'unauthorized' }, 401));
  await assert.rejects(pending, e => e.status === 401 && e.outcome === 'rejected');
  assert.equal(s.snapshot().subject, 'B');
});

test('a request expiring in flight aborts without refreshing or replaying', async () => {
  const s = new MemorySession();
  s.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'A', accessToken: 'synthetic-token', expiresAt: Date.now() + 25 });
  const { api } = fixture(async (_url, init) => new Promise((_resolve, reject) =>
    init.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })), { session: s });
  await assert.rejects(api.reportSos(id, write), e => e.kind === 'session_expired' && e.outcome === 'unknown');
});

test('invalid success, HTML and impossible snapshots remain protocol errors', async () => {
  for (const response of [json({}), new Response('<html>private</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{bad-json', { headers: { 'content-type': 'application/json' } })]) {
    const { api } = fixture(async () => response);
    await assert.rejects(api.createTruck({ label: 'synthetic' }, write), e => e.kind === 'invalid_response' && e.outcome === 'unknown');
  }
  const { api } = fixture(async () => json({ tripId: id, readAt: stamp, freshness: 'fresh', ageMs: 0, location: null }));
  await assert.rejects(api.getSnapshot(id), e => e.kind === 'invalid_response' && e.outcome === 'not_applicable');
  const unexpected = fixture(async () => json({ id }, 201));
  await assert.rejects(unexpected.api.createTruck({ label: 'synthetic' }, write), e => e.kind === 'invalid_response' && e.outcome === 'unknown');
});

test('stale location and attributed action facts are preserved', async () => {
  const result = { tripId: id, readAt: stamp, freshness: 'stale', ageMs: 200_000,
    location: { capturedAt: '2026-10-17T11:56:40.000Z', receivedAt: stamp, latitude: -12.1, longitude: -77.1, accuracy: 15 } };
  const { api } = fixture(async () => json(result));
  assert.deepEqual(await api.getSnapshot(id), result);
});

test('native fetch reaches a loopback HTTP server and refuses credential redirects', async t => {
  let targetCalls = 0;
  const server = createServer((req, res) => {
    if (req.url === '/v1/me') {
      assert.equal(req.headers.authorization, 'Bearer synthetic.token.A');
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ id }));
    } else if (req.url === '/v1/trucks') { res.writeHead(307, { location: '/redirect-target' }); res.end(); }
    else { targetCalls += 1; res.writeHead(200); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const api = createApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, session: session() });
  assert.deepEqual(await api.getIdentity(), { id });
  await assert.rejects(api.createTruck({ label: 'synthetic' }, write), e => e.kind === 'network' && e.outcome === 'unknown');
  assert.equal(targetCalls, 0);
});
