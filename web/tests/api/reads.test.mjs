import assert from 'node:assert/strict';
import test from 'node:test';
import { MemorySession, createApiClient } from '../../src/lib/api/index.ts';

// Wire oracle: PR65/748d30c docs/contracts/client-read.md and src/client-read/routes.ts.
const id = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const stamp = '2026-10-17T12:00:00.000Z';
const profile = { id: id(1), phone: '+5511999990000', phoneVerified: true };
const truck = { id: id(2), label: 'Caminhão sintético' };
const contact = { id: id(3), contactId: id(4), phone: '+5511999990001', map: { requested: true, accepted: true },
  incident: { requested: true, accepted: false }, status: 'revoked', acceptedAt: stamp,
  revokedAt: '2026-10-17T12:01:00.000Z', revokedBy: 'contact' };
const summary = { id: id(5), truckId: id(2), origin: 'Synthetic origin', destination: 'Synthetic destination',
  country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo', status: 'active', mapActive: true,
  checkinsActive: true, paused: false, version: 1, createdAt: stamp, closedAt: null, contactGrantIds: [id(3)] };
const recent = { ...summary, id: id(6), status: 'arrived', mapActive: false, checkinsActive: false,
  closedAt: '2026-10-17T13:00:00.000Z' };
const trips = { active: [summary], recent: [recent], limits: { active: 50, recent: 20 }, hasMore: { active: false, recent: false } };
const bootstrap = { profile, trucks: [truck], contacts: [contact], trips: { active: [summary], recent: [recent] },
  limits: { trucks: 100, contacts: 100, activeTrips: 50, recentTrips: 20 },
  hasMore: { trucks: false, contacts: false, activeTrips: false, recentTrips: false } };

function fixture(reply) {
  const session = new MemorySession();
  session.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'synthetic-A', accessToken: 'synthetic.A', expiresAt: Date.now() + 60_000 });
  const api = createApiClient({ baseUrl: 'https://api.example.invalid/', session, fetch: reply });
  return { api, session };
}

test('five additive reads use only their actual GET routes with no owner/body/key', async t => {
  for (const [method, path, result] of [
    ['getProfile', '/v1/profile', profile], ['getBootstrap', '/v1/bootstrap', bootstrap],
    ['listTrucks', '/v1/trucks', { trucks: [truck], limit: 100, hasMore: false }],
    ['listContacts', '/v1/contacts', { contacts: [contact], limit: 100, hasMore: false }],
    ['listTrips', '/v1/trips', trips],
  ]) {
    await t.test(method, async () => {
      let calls = 0;
      const { api } = fixture(async (url, init) => {
        calls += 1;
        assert.equal(url.pathname, path); assert.equal(url.search, '');
        assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
        assert.equal(init.headers['Idempotency-Key'], undefined);
        assert.equal(init.headers.Authorization, 'Bearer synthetic.A');
        assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
        return Response.json({ ...result, privateBackendField: 'must-not-project' });
      });
      assert.deepEqual(await api[method](), result);
      assert.equal(calls, 1);
    });
  }
});

test('bootstrap preserves revoked management facts, regional fields, selected grants and truncation', async () => {
  const body = structuredClone(bootstrap); body.hasMore.contacts = true;
  const { api } = fixture(async () => Response.json(body));
  const result = await api.getBootstrap();
  assert.equal(result.contacts[0].status, 'revoked');
  assert.equal(result.contacts[0].map.accepted, true); // Historical acceptance is not current permission.
  assert.equal(result.contacts[0].revokedBy, 'contact');
  assert.equal(result.hasMore.contacts, true);
  assert.equal(result.trips.active[0].timeZone, 'America/Sao_Paulo');
  assert.deepEqual(result.trips.active[0].contactGrantIds, [id(3)]);
  assert.equal('readAt' in result, false); // The published source has no such timestamp.
});

test('empty focused lists and unknown phone remain real empty/unverified facts', async () => {
  const { api } = fixture(async url => url.pathname.endsWith('/profile')
    ? Response.json({ id: id(1), phone: null, phoneVerified: false })
    : Response.json({ trucks: [], limit: 100, hasMore: false }));
  assert.deepEqual(await api.getProfile(), { id: id(1), phone: null, phoneVerified: false });
  assert.deepEqual(await api.listTrucks(), { trucks: [], limit: 100, hasMore: false });
});

test('list bounds, duplicate identities, wrong limits and contradictory buckets fail closed', async () => {
  const cases = [
    ['listTrucks', { trucks: Array.from({ length: 101 }, (_, n) => ({ id: id(n + 20), label: 'Synthetic' })), limit: 100, hasMore: true }],
    ['listTrucks', { trucks: [truck, truck], limit: 100, hasMore: false }],
    ['listTrucks', { trucks: [truck], limit: 50, hasMore: false }],
    ['listTrips', { ...trips, active: [recent] }],
    ['listTrips', { ...trips, recent: [summary] }],
    ['getBootstrap', { ...bootstrap, hasMore: { trucks: false } }],
  ];
  for (const [method, body] of cases) {
    const { api } = fixture(async () => Response.json(body));
    await assert.rejects(api[method](), error => error.kind === 'invalid_response' && error.outcome === 'not_applicable');
  }
});

test('unverified and malformed consent/profile responses cannot become accepted capabilities', async () => {
  const cases = [
    ['getProfile', { id: id(1), phone: null, phoneVerified: true }],
    ['getProfile', { id: id(1), phone: 'not-an-international-number', phoneVerified: true }],
    ['listContacts', { contacts: [{ ...contact, status: 'accepted', revokedAt: null, revokedBy: null, acceptedAt: null }], limit: 100, hasMore: false }],
    ['listContacts', { contacts: [{ ...contact, map: { requested: false, accepted: true } }], limit: 100, hasMore: false }],
    ['listContacts', { contacts: [{ ...contact, status: 'pending', revokedAt: null, revokedBy: null }], limit: 100, hasMore: false }],
  ];
  for (const [method, body] of cases) {
    const { api } = fixture(async () => Response.json(body));
    await assert.rejects(api[method](), error => error.kind === 'invalid_response');
  }
});

test('read failures remain failures rather than fabricated empty catalogues', async () => {
  for (const status of [401, 403, 404, 409, 422, 500]) {
    const { api } = fixture(async () => Response.json({ code: 'invalid_request' }, { status }));
    await assert.rejects(api.getBootstrap(), error => error.status === status);
  }
  const { api } = fixture(async () => { throw new Error('synthetic network loss'); });
  await assert.rejects(api.getBootstrap(), error => error.kind === 'network' && error.outcome === 'not_applicable');
});

test('an old bootstrap reply cannot populate a replacement session', async () => {
  let finish;
  const { session, api } = fixture(async () => new Promise(resolve => { finish = resolve; }));
  const pending = api.getBootstrap();
  session.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'synthetic-B', accessToken: 'synthetic.B', expiresAt: Date.now() + 60_000 });
  finish(Response.json(bootstrap));
  await assert.rejects(pending, error => error.kind === 'session_changed');
  assert.equal(session.snapshot().subject, 'synthetic-B');
});
