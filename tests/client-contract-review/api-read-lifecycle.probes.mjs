// Independent delta oracle for API PR59/7da6dbb and read contract PR65/748d30c.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDS, NOW, ORIGIN, REGIONAL_FIELDS } from './fixtures.mjs';
import { deferred, jsonResponse, scriptedTransport } from './scripted-transport.mjs';

const root = process.env.ANDES_REVIEW_API_ROOT;
if (!root) throw new TypeError('An exact archived API candidate is required');
const { createApiClient, MemorySession, bindJourneySession, createDriverTransport } =
  await import(pathToFileURL(resolve(root, 'web/src/lib/api/index.ts')).href);
const stamp = new Date(NOW).toISOString();
const truck = { id: IDS.truck, label: 'SYNTHETIC truck' };
const contact = { id: IDS.grant, contactId: IDS.contact, phone: '+12025550123',
  map: { requested: true, accepted: true }, incident: { requested: true, accepted: false },
  status: 'revoked', acceptedAt: stamp, revokedAt: stamp, revokedBy: 'contact' };
const trip = { id: IDS.trip, ...REGIONAL_FIELDS, status: 'active', mapActive: true, checkinsActive: true,
  paused: false, version: 1, createdAt: stamp, closedAt: null, contactGrantIds: [IDS.grant] };
const profile = { id: IDS.driver, phone: null, phoneVerified: false };
const bootstrap = { profile, trucks: [truck], contacts: [contact], trips: { active: [trip], recent: [] },
  limits: { trucks: 100, contacts: 100, activeTrips: 50, recentTrips: 20 },
  hasMore: { trucks: false, contacts: true, activeTrips: false, recentTrips: false } };
const credentials = (subject = 'SYNTHETIC-A', expiresAt = NOW + 60_000) => ({
  issuer: 'https://identity.synthetic.invalid', subject, accessToken: `SYNTHETIC-${subject}`, expiresAt,
});
function fixture(fetch, clock = () => NOW) {
  const session = new MemorySession(clock); session.setCredentials(credentials());
  const api = createApiClient({ baseUrl: ORIGIN, session, fetch });
  return { session, api };
}
const checks = [];
async function probe(id, run) {
  try { await run(); checks.push({ id, passed: true }); }
  catch { checks.push({ id, passed: false }); }
}

for (const [method, path, result] of [
  ['getProfile', '/v1/profile', profile], ['getBootstrap', '/v1/bootstrap', bootstrap],
  ['listTrucks', '/v1/trucks', { trucks: [truck], limit: 100, hasMore: true }],
  ['listContacts', '/v1/contacts', { contacts: [contact], limit: 100, hasMore: false }],
  ['listTrips', '/v1/trips', { active: [trip], recent: [], limits: { active: 50, recent: 20 },
    hasMore: { active: false, recent: true } }],
]) await probe(`read:${method}-exact-wire-and-truncation`, async () => {
  const transport = scriptedTransport([{ method: 'GET', path, response: result }]);
  const f = fixture(transport.fetch);
  try {
    assert.deepEqual(await f.api[method](), result); transport.assertDrained();
    const request = transport.calls[0];
    assert.equal(request.bodyText, ''); assert.equal(request.headers['idempotency-key'], undefined);
    assert.equal(request.cache, 'no-store');
  } finally { f.session.clear(); }
});
await probe('read:revoked-history-is-preserved-and-private-fields-are-projected-out', async () => {
  const body = structuredClone(bootstrap); body.contacts[0].privateToken = 'SYNTHETIC-PRIVATE';
  body.rawDraftText = 'SYNTHETIC-PRIVATE';
  const f = fixture(async () => jsonResponse(body));
  try {
    const result = await f.api.getBootstrap();
    assert.deepEqual(result, bootstrap); assert.equal('readAt' in result, false);
    assert.equal(result.contacts[0].status, 'revoked'); assert.equal(result.contacts[0].map.accepted, true);
  } finally { f.session.clear(); }
});
for (const [id, method, body] of [
  ['oversized-bootstrap', 'getBootstrap', { ...bootstrap, trucks: Array(101).fill(truck) }],
  ['duplicate-trucks', 'listTrucks', { trucks: [truck, truck], limit: 100, hasMore: false }],
  ['unpublished-limit', 'listTrucks', { trucks: [], limit: 101, hasMore: false }],
  ['accepted-unrequested-scope', 'listContacts', { contacts: [{ ...contact, map: { requested: false, accepted: true } }], limit: 100, hasMore: false }],
  ['missing-truncation', 'getBootstrap', { ...bootstrap, hasMore: {} }],
]) await probe(`protocol:${id}`, async () => {
  const f = fixture(async () => jsonResponse(body));
  try { await assert.rejects(f.api[method](), error => error.kind === 'invalid_response' && error.outcome === 'not_applicable'); }
  finally { f.session.clear(); }
});
await probe('lifecycle:concurrent-activation-cannot-publish-the-older-result', async () => {
  const waits = [deferred(), deferred()]; let count = 0;
  const f = fixture(() => waits[count++].promise); const published = [];
  const binding = bindJourneySession(f.session, f.api, value => published.push(value));
  try {
    const older = binding.activate(); const rejected = assert.rejects(older, error => error.kind === 'session_changed');
    const newer = binding.activate();
    waits[1].resolve(jsonResponse({ id: IDS.driver })); await newer;
    const afterNew = [...published];
    waits[0].resolve(jsonResponse({ id: IDS.driver })); await rejected;
    assert.deepEqual(published, afterNew); assert.equal(published.at(-1), IDS.driver);
  } finally { binding.dispose(); f.session.clear(); }
});
await probe('lifecycle:rotation-retires-a-held-identity-response', async () => {
  const wait = deferred(); const f = fixture(() => wait.promise); let actor = 'SYNTHETIC-OLD-CACHE';
  const binding = bindJourneySession(f.session, f.api, value => { actor = value; });
  try {
    const pending = binding.activate(); const rejected = assert.rejects(pending, error => error.kind === 'session_changed');
    f.session.setCredentials(credentials('SYNTHETIC-B'));
    wait.resolve(jsonResponse({ id: IDS.driver })); await rejected;
    assert.equal(actor, null);
  } finally { binding.dispose(); f.session.clear(); }
});
await probe('lifecycle:current-401-clears-all-bound-views', async () => {
  let denied = false; const f = fixture(async () => denied
    ? jsonResponse({ code: 'unauthorized' }, 401) : jsonResponse({ id: IDS.driver }));
  const views = [null, null];
  const bindings = views.map((_, i) => bindJourneySession(f.session, f.api, value => { views[i] = value; }));
  try {
    for (const binding of bindings) await binding.activate(); denied = true;
    await assert.rejects(f.api.getBootstrap(), error => error.status === 401);
    assert.deepEqual(views, [null, null]); assert.equal(f.session.snapshot().status, 'anonymous');
  } finally { bindings.forEach(b => b.dispose()); f.session.clear(); }
});
await probe('lifecycle:expiry-invalidates-an-idle-observed-view', async () => {
  let now = NOW;
  const f = fixture(async () => jsonResponse({ id: IDS.driver }), () => now);
  f.session.setCredentials(credentials('SYNTHETIC-A', NOW + 5)); let actor;
  const binding = bindJourneySession(f.session, f.api, value => { actor = value; });
  try {
    await binding.activate(); now += 6;
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(actor, null); assert.equal(f.session.snapshot().status, 'expired');
  } finally { binding.dispose(); f.session.clear(); }
});
for (const status of [400, 401, 403, 404, 409, 422, 500]) await probe(`driver-adapter:http-${status}-keeps-terminal-or-unknown-meaning`, async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return jsonResponse({ code: 'synthetic_code' }, status); });
  try {
    const result = await createDriverTransport(f.api)({ operation: 'sos', params: { id: IDS.trip },
      idempotencyKey: 'q47-original-intent' }, { signal: new AbortController().signal });
    assert.equal(result.kind, status === 500 ? 'unknown' : 'rejected');
    assert.equal(result.status, status); assert.equal(calls, 1);
  } finally { f.session.clear(); }
});
await probe('driver-adapter:command-preserves-controller-body-and-original-key', async () => {
  const result = { id: IDS.trip, command: 'rest_report', automaticEscalation: false };
  const transport = scriptedTransport([{ method: 'POST', path: `/v1/trips/${IDS.trip}/commands`,
    body: { type: 'rest_report' }, response: result }]);
  const f = fixture(transport.fetch);
  try {
    assert.deepEqual(await createDriverTransport(f.api)({ operation: 'command', params: { id: IDS.trip },
      body: { type: 'rest_report' }, idempotencyKey: 'q47-original-command' },
    { signal: new AbortController().signal }), { kind: 'ok', data: result });
    assert.equal(transport.calls[0].headers['idempotency-key'], 'q47-original-command'); transport.assertDrained();
  } finally { f.session.clear(); }
});
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({ passed, checks, limitation:
  'Frozen typed-client exports with independent synthetic wire fixtures and lifecycle scheduling; no actual read-route SQL, browser or provider qualification.' }, null, 2));
process.exitCode = passed ? 0 : 1;
