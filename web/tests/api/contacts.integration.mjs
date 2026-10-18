import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { MemorySession, createApiClient, createContactApi, createDriverTransport, bindJourneySession } from '../../src/lib/api/index.ts';

// Explicit dependency: these immutable controller objects must have been fetched.
// No feature source is copied into the author branch and no missing dependency is silently skipped.
const CONTACT = 'b95bdbaa3f106f33d30b3aa8b0127ca3b691ee0e';
const DRIVER = '127c82ad109702a329e5bec008708b0fbc67487b';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const archive = mkdtempSync(join(tmpdir(), 'andes-api-feature-integration-'));
after(() => rmSync(archive, { recursive: true, force: true }));
writeFileSync(join(archive, 'package.json'), '{"type":"module"}\n');
for (const [sha, files] of [
  [CONTACT, ['web/src/features/contacts/journey.ts', 'web/src/features/privacy/consent.ts']],
  [DRIVER, ['web/src/features/driver/controller.mjs', 'web/src/features/driver/controller.d.mts', 'web/src/features/driver/validation.mjs']],
]) {
  for (const file of files) {
    const target = join(archive, file); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync('git', ['show', `${sha}:${file}`], { cwd: repo }));
  }
}
const { createContactJourney } = await import(pathToFileURL(join(archive, 'web/src/features/contacts/journey.ts')));
const { createDriverJourney } = await import(pathToFileURL(join(archive, 'web/src/features/driver/controller.mjs')));
const DRIVER_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';
const INCIDENT = '44444444-4444-4444-8444-444444444444';
const GRANT = '55555555-5555-4555-8555-555555555555';
const stamp = '2026-10-17T12:00:00.000Z';
const point = { capturedAt: '2026-10-17T11:55:00.000Z', receivedAt: stamp, latitude: -12.1, longitude: -77.1, accuracy: 75 };
function setup(fetch, view = 'contact') {
  const session = new MemorySession();
  session.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'synthetic-subject', accessToken: 'synthetic.token', expiresAt: Date.now() + 60_000 });
  const api = createApiClient({ baseUrl: 'https://api.example.invalid', session, fetch });
  const journey = createContactJourney(createContactApi(api), () => 'explicit-contact-intent');
  const binding = bindJourneySession(session, api, actorId => journey.setSession(actorId ? { actorId, view } : null));
  return { session, api, journey, binding };
}
function defaultReply(url) {
  if (url.pathname === '/v1/me') return Response.json({ id: CONTACT_ID });
  if (url.pathname.endsWith('/snapshot')) return Response.json({ tripId: TRIP, location: point, freshness: 'stale', ageMs: 300_000, readAt: stamp });
  return Response.json({ id: INCIDENT, tripId: TRIP, status: 'active', createdAt: stamp, resolvedAt: null, groupCapability: 'unavailable' });
}

test('actual contact controller uses typed snapshot/incident/action methods and distinct receipts', async () => {
  const calls = [];
  const { journey, binding } = setup(async (url, init) => {
    calls.push([url.pathname, init.headers['Idempotency-Key'], init.body]);
    if (url.pathname.endsWith('/acknowledgements')) return Response.json({ id: INCIDENT, status: 'active', recorded: 'acknowledged' });
    if (url.pathname.endsWith('/actions')) return Response.json({ id: INCIDENT, status: 'active', recorded: 'action' });
    return defaultReply(url);
  });
  try {
    await binding.activate(); journey.selectTrip({ id: TRIP, driverId: DRIVER_ID });
    await journey.loadLocation();
    assert.deepEqual(journey.getState().location.data, { tripId: TRIP, location: point, freshness: 'stale', ageMs: 300_000, readAt: stamp });
    await journey.loadIncident(INCIDENT);
    assert.equal(await journey.acknowledge(), 'recorded');
    assert.equal(await journey.reportAction('Synthetic cannot-assist report'), 'recorded');
    assert.deepEqual(journey.getState().receipts.map(r => r.recorded), ['acknowledged', 'action']);
    assert.equal(journey.getState().incident.data.status, 'active');
    assert.deepEqual(calls.at(-1), [`/v1/incidents/${INCIDENT}/actions`, 'explicit-contact-intent', JSON.stringify({ action: 'Synthetic cannot-assist report' })]);
    assert.throws(() => journey.resolve());
  } finally { binding.dispose(); }
});

test('actual contact acceptance narrows scopes and ambiguous retry preserves key/body on success', async () => {
  const sent = [];
  const { journey, binding } = setup(async (url, init) => {
    if (url.pathname === '/v1/me') return defaultReply(url);
    sent.push([init.headers['Idempotency-Key'], init.body]);
    if (sent.length === 1) throw new Error('synthetic lost response');
    return Response.json({ id: GRANT, map: false, incident: true, status: 'accepted' });
  });
  try {
    await binding.activate();
    assert.equal(await journey.acceptInvitation({ id: GRANT, driverId: DRIVER_ID, contactId: CONTACT_ID,
      requested: { map: true, incident: true } }, { map: false, incident: true }), 'uncertain');
    assert.equal(sent.length, 1);
    assert.equal(await journey.retryUncertainCommand(), 'recorded');
    assert.deepEqual(sent, [
      ['explicit-contact-intent', JSON.stringify({ map: false, incident: true })],
      ['explicit-contact-intent', JSON.stringify({ map: false, incident: true })],
    ]);
    assert.deepEqual(journey.getState().invitation.accepted, { map: false, incident: true });
  } finally { binding.dispose(); }
});

test('actual contact protected caches clear immediately on token replacement and signout', async () => {
  const { session, journey, binding } = setup(async url => defaultReply(url));
  try {
    await binding.activate(); journey.selectTrip({ id: TRIP, driverId: DRIVER_ID });
    await journey.loadLocation(); await journey.loadIncident(INCIDENT);
    assert.notEqual(journey.getState().location.data, null);
    session.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'synthetic-other', accessToken: 'synthetic.other', expiresAt: Date.now() + 60_000 });
    assert.equal(journey.getState().session, null);
    assert.equal(journey.getState().location.data, null);
    assert.equal(journey.getState().incident.data, null);
    await binding.activate(); session.clear();
    assert.equal(journey.getState().session, null);
  } finally { binding.dispose(); }
});

test('actual contact 403 after a valid read clears cached location and incident views', async () => {
  let denied = false;
  const { journey, binding } = setup(async url => denied ? Response.json({ code: 'forbidden' }, { status: 403 }) : defaultReply(url));
  try {
    await binding.activate(); journey.selectTrip({ id: TRIP, driverId: DRIVER_ID });
    await journey.loadLocation(); await journey.loadIncident(INCIDENT);
    denied = true;
    assert.equal(await journey.loadLocation(), 'unavailable');
    assert.equal(journey.getState().location.status, 'denied');
    assert.equal(journey.getState().location.data, null);
    assert.equal(journey.getState().incident.data, null);
  } finally { binding.dispose(); }
});

test('repaired actual contact keeps an ambiguous revoke uncertain after a same-key refusal', async t => {
  for (const status of [400, 403, 404, 409, 422]) {
    await t.test(String(status), async () => {
      const sent = [];
      const { journey, binding } = setup(async (url, init) => {
        if (url.pathname === '/v1/me') return defaultReply(url);
        sent.push([init.headers['Idempotency-Key'], init.body]);
        if (sent.length === 1) throw new Error('synthetic lost response');
        return Response.json({ code: status === 409 ? 'consent_revoked' : 'invalid_request' }, { status });
      });
      try {
        await binding.activate(); journey.selectTrip({ id: TRIP, driverId: DRIVER_ID });
        assert.equal(await journey.revokeStanding(GRANT), 'uncertain');
        assert.equal(await journey.retryUncertainCommand(), 'uncertain');
        assert.equal(journey.getState().operation.status, 'uncertain');
        await assert.rejects(journey.loadLocation(), /revocation outcome/);
        assert.deepEqual(sent, [['explicit-contact-intent', '{}'], ['explicit-contact-intent', '{}']]);
      } finally { binding.dispose(); }
    });
  }
});

test('actual contact first-attempt conflict stays rejected, and retry401 clears its bound session', async () => {
  const first = setup(async url => url.pathname === '/v1/me' ? defaultReply(url) : Response.json({ code: 'consent_revoked' }, { status: 409 }));
  try {
    await first.binding.activate();
    assert.equal(await first.journey.revokeStanding(GRANT), 'rejected');
  } finally { first.binding.dispose(); }
  let writes = 0;
  const second = setup(async url => {
    if (url.pathname === '/v1/me') return defaultReply(url);
    writes += 1;
    if (writes === 1) throw new Error('synthetic lost response');
    return Response.json({ code: 'unauthorized' }, { status: 401 });
  });
  try {
    await second.binding.activate();
    assert.equal(await second.journey.revokeStanding(GRANT), 'uncertain');
    assert.equal(await second.journey.retryUncertainCommand(), 'superseded');
    assert.equal(second.journey.getState().session, null);
    assert.equal(second.session.snapshot().status, 'anonymous');
    assert.throws(() => second.journey.retryUncertainCommand());
    assert.equal(writes, 2);
  } finally { second.binding.dispose(); }
});

test('actual driver context binds server identity and purges its form on shared-session clear', async () => {
  const { session, api, binding: unused } = setup(async () => Response.json({ id: DRIVER_ID })); unused.dispose();
  const driver = createDriverJourney();
  const binding = bindJourneySession(session, api, id => driver.setSession(id));
  try {
    await binding.activate(); assert.equal(driver.snapshot().auth.actorId, DRIVER_ID);
    driver.setInteractionMode('stationary'); driver.editForm({ text: 'Synthetic private draft' });
    assert.equal(driver.snapshot().form.text, 'Synthetic private draft');
    session.clear();
    assert.equal(driver.snapshot().auth.actorId, null); assert.equal(driver.snapshot().form.text, '');
  } finally { binding.dispose(); driver.dispose(); }
});

test('actual driver writes and readbacks flow through the typed client adapter without blind replay', async () => {
  const fields = { truckId: GRANT, origin: 'Synthetic origin', destination: 'Synthetic destination',
    country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo' };
  const calls = []; let sosCalls = 0;
  const { session, api, binding: unused } = setup(async (url, init) => {
    calls.push({ path: url.pathname, body: init.body, key: init.headers['Idempotency-Key'] });
    if (url.pathname === '/v1/me') return Response.json({ id: DRIVER_ID });
    if (url.pathname === '/v1/trucks') return Response.json({ id: '66666666-6666-4666-8666-666666666666' });
    if (url.pathname === '/v1/trip-drafts') return Response.json({ id: TRIP, rawText: 'Synthetic draft',
      fields, missingFields: [], status: 'draft' });
    if (url.pathname.endsWith('/confirm')) return Response.json({ id: TRIP, status: 'active', fields });
    if (url.pathname.endsWith('/commands')) return Response.json({ id: TRIP, command: JSON.parse(init.body).type, automaticEscalation: false });
    if (url.pathname.endsWith('/sos')) {
      sosCalls += 1; if (sosCalls === 1) throw new Error('synthetic lost SOS response');
      return Response.json({ code: 'idempotency_conflict' }, { status: 409 });
    }
    if (url.pathname.endsWith('/snapshot')) return Response.json({ tripId: TRIP, location: point, freshness: 'stale', ageMs: 300_000, readAt: stamp });
    if (url.pathname.startsWith('/v1/incidents/')) return defaultReply(url);
    return Response.json({ id: TRIP, driver_id: DRIVER_ID, truck_id: GRANT, origin: fields.origin,
      destination: fields.destination, country: 'BR', locale: 'pt-BR', time_zone: fields.timeZone,
      status: 'active', map_active: true, checkins_active: true, paused: false, version: 1, created_at: stamp, closed_at: null });
  }); unused.dispose();
  let sequence = 0;
  const driver = createDriverJourney({ transport: createDriverTransport(api), keyFactory: () => `explicit-driver-${++sequence}` });
  const binding = bindJourneySession(session, api, id => driver.setSession(id));
  try {
    await binding.activate(); driver.setInteractionMode('stationary');
    driver.provideSelectionEvidence({ actorId: DRIVER_ID, source: 'authenticated-server-read', readAt: stamp,
      trucks: [{ id: GRANT, label: 'Synthetic owned truck' }], contacts: [] });
    assert.equal((await driver.registerTruck('Synthetic second truck')).kind, 'ok');
    driver.editForm({ text: 'Synthetic draft', fields });
    assert.equal((await driver.saveDraft()).kind, 'ok');
    assert.equal((await driver.confirmTrip({ confirmed: true })).kind, 'ok');
    assert.equal((await driver.openTrip(TRIP)).kind, 'ok');
    assert.equal((await driver.refreshLocation()).kind, 'ok');
    assert.equal(driver.snapshot().location.data.location.accuracy, 75);
    assert.equal((await driver.sendCommand('rest_report')).kind, 'ok');
    assert.equal((await driver.requestHelp()).kind, 'unknown');
    assert.equal((await driver.retryUnknown('sos', { confirmed: true })).kind, 'unknown');
    assert.equal(driver.snapshot().operations.sos.state, 'unknown');
    const sos = calls.filter(c => c.path.endsWith('/sos'));
    assert.equal(sos.length, 2); assert.deepEqual(sos[0], sos[1]);
    assert.equal(sos[0].key, 'explicit-driver-5');
    assert.equal((await driver.refreshIncident(INCIDENT)).kind, 'ok');
    assert.equal(driver.snapshot().incident.data.status, 'active');
  } finally { binding.dispose(); driver.dispose(); }
});

test('actual driver blocks cross-trip work and a fresh bound context cannot reuse old incident/location', async () => {
  const nextTrip = '77777777-7777-4777-8777-777777777777';
  const nextIncident = '88888888-8888-4888-8888-888888888888';
  const calls = [];
  const { session, api, binding: unused } = setup(async (url, init) => {
    calls.push({ path: url.pathname, body: init.body, key: init.headers['Idempotency-Key'] });
    if (url.pathname === '/v1/me') return Response.json({ id: DRIVER_ID });
    if (url.pathname.endsWith('/snapshot') || url.pathname.startsWith('/v1/incidents/')) return defaultReply(url);
    if (url.pathname.endsWith('/sos')) return Response.json({
      id: url.pathname.includes(nextTrip) ? nextIncident : INCIDENT,
      tripId: url.pathname.includes(nextTrip) ? nextTrip : TRIP,
      status: 'active', createdAt: stamp, resolvedAt: null, groupCapability: 'unavailable' });
    const id = url.pathname.split('/').at(-1);
    return Response.json({ id, driver_id: DRIVER_ID, truck_id: GRANT, origin: 'Synthetic origin',
      destination: 'Synthetic destination', country: 'BR', locale: 'pt-BR', time_zone: 'America/Sao_Paulo',
      status: 'active', map_active: true, checkins_active: true, paused: false, version: 1,
      created_at: stamp, closed_at: null });
  }); unused.dispose();
  const driver = createDriverJourney({ transport: createDriverTransport(api), keyFactory: () => 'explicit-old-context' });
  const binding = bindJourneySession(session, api, id => driver.setSession(id));
  try {
    await binding.activate(); driver.setInteractionMode('stationary');
    await driver.openTrip(TRIP); await driver.refreshLocation(); await driver.refreshIncident(INCIDENT);
    assert.equal(driver.snapshot().tripId, TRIP);
    assert.equal(driver.snapshot().location.data.tripId, TRIP);
    const before = calls.length;
    assert.deepEqual(driver.editForm({ text: 'Synthetic new trip' }), { kind: 'blocked', code: 'form-locked' });
    assert.deepEqual(driver.selectContacts([]), { kind: 'blocked', code: 'form-locked' });
    assert.deepEqual(await driver.saveDraft(), { kind: 'blocked', code: 'journey-already-bound' });
    assert.deepEqual(await driver.confirmTrip({ confirmed: true }), { kind: 'blocked', code: 'journey-already-bound' });
    assert.deepEqual(await driver.openTrip(nextTrip), { kind: 'blocked', code: 'journey-already-bound' });
    assert.equal(calls.length, before, 'Blocked cross-trip intents must send nothing');
    assert.equal((await driver.requestHelp()).data.tripId, TRIP);
    assert.equal(calls.length, before + 1, 'A cached incident must not swallow an explicit SOS tap');
  } finally { binding.dispose(); driver.dispose(); }
  const next = createDriverJourney({ transport: createDriverTransport(api), keyFactory: () => 'explicit-new-context' });
  const nextBinding = bindJourneySession(session, api, id => next.setSession(id));
  try {
    await nextBinding.activate(); next.setInteractionMode('stationary');
    assert.equal(next.snapshot().location.data, null); assert.equal(next.snapshot().incident.data, null);
    await next.openTrip(nextTrip);
    const result = await next.requestHelp();
    assert.equal(result.kind, 'ok'); assert.equal(result.data.id, nextIncident);
    assert.equal(result.data.tripId, nextTrip); assert.equal(next.snapshot().tripId, nextTrip);
    const sos = calls.filter(call => call.path.endsWith('/sos'));
    assert.deepEqual(sos, [
      { path: `/v1/trips/${TRIP}/sos`, body: '{}', key: 'explicit-old-context' },
      { path: `/v1/trips/${nextTrip}/sos`, body: '{}', key: 'explicit-new-context' },
    ]);
  } finally { nextBinding.dispose(); next.dispose(); session.clear(); }
});

test('actual driver preserves a pending, unknown and reconciled draft when another trip is opened', async () => {
  const calls = []; let loseFirstResponse;
  const fields = { truckId: GRANT, origin: 'Synthetic origin', destination: 'Synthetic destination',
    country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo' };
  const { session, api, binding: unused } = setup(async (url, init) => {
    if (url.pathname === '/v1/me') return Response.json({ id: DRIVER_ID });
    calls.push({ path: url.pathname, body: init.body, key: init.headers['Idempotency-Key'] });
    if (calls.length === 1) return new Promise((_, reject) => { loseFirstResponse = reject; });
    return Response.json({ id: TRIP, rawText: 'Synthetic draft', fields, missingFields: [], status: 'draft' });
  }); unused.dispose();
  const driver = createDriverJourney({ transport: createDriverTransport(api), keyFactory: () => 'original-draft-intent' });
  const binding = bindJourneySession(session, api, id => driver.setSession(id));
  try {
    await binding.activate(); driver.setInteractionMode('stationary');
    driver.provideSelectionEvidence({ actorId: DRIVER_ID, source: 'authenticated-server-read', readAt: stamp,
      trucks: [{ id: GRANT, label: 'Synthetic owned truck' }], contacts: [] });
    driver.editForm({ text: 'Synthetic draft', fields });
    const pending = driver.saveDraft(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(driver.snapshot().operations.draft.state, 'pending');
    assert.deepEqual(await driver.openTrip(INCIDENT), { kind: 'blocked', code: 'journey-already-bound' });
    assert.equal(calls.length, 1);
    loseFirstResponse(new Error('Synthetic response lost after dispatch'));
    assert.equal((await pending).kind, 'unknown');
    const original = driver.snapshot().operations.draft.request;
    assert.deepEqual(await driver.openTrip(INCIDENT), { kind: 'blocked', code: 'journey-already-bound' });
    assert.deepEqual(driver.snapshot().operations.draft.request, original);
    assert.equal(calls.length, 1, 'Opening another trip must not read or retry the unknown draft');
    assert.equal((await driver.retryUnknown('draft', { confirmed: true })).kind, 'ok');
    assert.deepEqual(calls[1], calls[0], 'Explicit reconciliation must retain the exact original key and payload');
    assert.equal(driver.snapshot().draft.id, TRIP);
    assert.deepEqual(await driver.openTrip(INCIDENT), { kind: 'blocked', code: 'journey-already-bound' });
    assert.equal(calls.length, 2);
  } finally { binding.dispose(); driver.dispose(); session.clear(); }
});

test('actual ContactApi TypeScript seam accepts the facade without feature imports in production', () => {
  const compiler = process.env.ANDES_TYPESCRIPT_TSC;
  assert.ok(compiler, 'Set ANDES_TYPESCRIPT_TSC to an existing TypeScript5.9.3 compiler; do not install implicitly');
  const apiUrl = pathToFileURL(fileURLToPath(new URL('../../src/lib/api/index.ts', import.meta.url))).pathname;
  const source = `import { createContactApi, createApiClient, createDriverTransport, MemorySession } from ${JSON.stringify(apiUrl)};\n`
    + `import type { ContactApi } from './web/src/features/contacts/journey.ts';\n`
    + `import { createDriverJourney } from './web/src/features/driver/controller.mjs';\n`
    + `const api = createApiClient({baseUrl:'https://api.example.invalid',session:new MemorySession()});\n`
    + `const compatible: ContactApi = createContactApi(api);\nvoid compatible;\n`
    + `const driver = createDriverJourney({transport:createDriverTransport(api)});\nvoid driver;\n`;
  const target = join(archive, 'compatibility.ts'); writeFileSync(target, source);
  execFileSync(process.execPath, [compiler, '--noEmit', '--strict', '--target', 'ES2023', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--allowImportingTsExtensions', '--lib', 'ES2023,DOM', target], { stdio: 'pipe' });
});
