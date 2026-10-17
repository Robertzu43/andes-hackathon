import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { MemorySession, createApiClient, createContactApi, bindJourneySession } from '../../src/lib/api/index.ts';

// Explicit dependency: these immutable controller objects must have been fetched.
// No feature source is copied into the author branch and no missing dependency is silently skipped.
const CONTACT = 'a8466d50554238951570ec4a2949e5f8d7348541';
const DRIVER = 'c256e75a1b58168925a8e9f760c3759ee33bfa0a';
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

test('actual ContactApi TypeScript seam accepts the facade without feature imports in production', () => {
  const compiler = process.env.ANDES_TYPESCRIPT_TSC;
  assert.ok(compiler, 'Set ANDES_TYPESCRIPT_TSC to an existing TypeScript5.9.3 compiler; do not install implicitly');
  const apiUrl = pathToFileURL(fileURLToPath(new URL('../../src/lib/api/index.ts', import.meta.url))).pathname;
  const source = `import { createContactApi, createApiClient, MemorySession } from ${JSON.stringify(apiUrl)};\n`
    + `import type { ContactApi } from './web/src/features/contacts/journey.ts';\n`
    + `const api = createApiClient({baseUrl:'https://api.example.invalid',session:new MemorySession()});\n`
    + `const compatible: ContactApi = createContactApi(api);\nvoid compatible;\n`;
  const target = join(archive, 'compatibility.ts'); writeFileSync(target, source);
  execFileSync(process.execPath, [compiler, '--noEmit', '--strict', '--target', 'ES2023', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--allowImportingTsExtensions', '--lib', 'ES2023,DOM', target], { stdio: 'pipe' });
});
