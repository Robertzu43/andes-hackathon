import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { MemorySession, createApiClient, createDriverTransport, bindJourneySession } from '../../src/lib/api/index.ts';

const archive = mkdtempSync(join(tmpdir(), 'andes-api-sos-driver-'));
after(() => rmSync(archive, { recursive: true, force: true }));
writeFileSync(join(archive, 'package.json'), '{"type":"module"}\n');
for (const file of ['controller.mjs', 'validation.mjs']) {
  const target = join(archive, file); mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, execFileSync('git', ['show',
    `80e9d45f9a234de54b1017e856e8349c097b8760:web/src/features/driver/${file}`], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  }));
}
const { createDriverJourney } = await import(pathToFileURL(join(archive, 'controller.mjs')));
// Keep the original oracle above and reproduce explicit reactivation with the current controller.
for (const file of ['controller.mjs', 'validation.mjs']) {
  const target = join(archive, 'current', file); mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, execFileSync('git', ['show',
    `20c08faad67fddbe27eebac7585c63b3366f31a8:web/src/features/driver/${file}`], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  }));
}
const { createDriverJourney: createCurrentDriverJourney } = await import(pathToFileURL(join(archive, 'current/controller.mjs')));
const actor = '11111111-1111-4111-8111-111111111111';
const trip = '22222222-2222-4222-8222-222222222222';
const incident = '33333333-3333-4333-8333-333333333333';
const credentials = (accessToken = 'synthetic.original', subject = 'synthetic-owner', expiresAt = Date.now() + 60_000) => ({
  issuer: 'https://identity.synthetic.invalid', subject, accessToken, expiresAt,
});
const sos = () => ({ id: incident, tripId: trip, status: 'active', groupCapability: 'unavailable' });
const descriptor = () => ({ operation: 'sos', params: { id: trip }, idempotencyKey: 'original-sos-intent' });
function setup(fetch) {
  const session = new MemorySession(); session.setCredentials(credentials());
  let calls = 0;
  const api = createApiClient({ session, baseUrl: 'https://synthetic.invalid', fetch: async (url, init) => {
    calls++; return fetch(url, init);
  } });
  return { session, api, transport: createDriverTransport(api), calls: () => calls };
}

test('same-account refresh preserves accepted SOS receipts and a 200 body still being read', async t => {
  for (const held of [false, true]) await t.test(held ? 'body pending' : 'already accepted', async () => {
    let release, reached;
    const body = new Promise(resolve => { release = resolve; });
    const reading = new Promise(resolve => { reached = resolve; });
    const f = setup(async url => {
      if (url.pathname === '/v1/me') return Response.json({ id: actor });
      if (url.pathname.endsWith('/sos')) {
        const response = Response.json(sos());
        if (held) response.json = async () => { reached(); return body; };
        return response;
      }
      return Response.json({ id: trip, driver_id: actor, truck_id: actor, origin: 'Synthetic origin',
        destination: 'Synthetic destination', country: 'BR', locale: 'pt-BR', time_zone: 'America/Sao_Paulo',
        status: 'active', map_active: true, checkins_active: true, paused: false, version: 1,
        created_at: '2026-10-17T12:00:00.000Z', closed_at: null });
    });
    const journey = createDriverJourney({ transport: f.transport, keyFactory: () => 'original-sos-intent' });
    const binding = bindJourneySession(f.session, f.api, id => journey.setSession(id));
    try {
      await binding.activate(); journey.setInteractionMode('stationary');
      assert.equal((await journey.openTrip(trip)).kind, 'ok');
      const pending = journey.requestHelp();
      if (held) await reading; else assert.equal((await pending).kind, 'ok');
      f.session.setCredentials(credentials('synthetic.refreshed'));
      release(sos());
      assert.equal((await pending).kind, 'ok');
      const snapshot = journey.snapshot();
      assert.equal(snapshot.tripId, trip);
      assert.equal(snapshot.incident.data?.id, incident);
      assert.equal(snapshot.operations.sos?.state, 'accepted');
      assert.equal(f.calls(), 3); // One identity, one trip and one SOS; refresh never replays.
      f.session.setCredentials(credentials('synthetic.other', 'another-account'));
      assert.equal(journey.snapshot().incident.data, null);
      assert.equal(journey.snapshot().tripId, null);
    } finally { release(sos()); binding.dispose(); journey.dispose(); f.session.clear(); }
  });
});

test('explicit same-account reactivation verifies first and preserves current-controller SOS state', async t => {
  for (const held of [false, true]) await t.test(held ? 'committed response pending' : 'already accepted', async () => {
    let releaseSos, reachedSos, releaseIdentity, reachedIdentity;
    const sosBody = new Promise(resolve => { releaseSos = resolve; });
    const sosReading = new Promise(resolve => { reachedSos = resolve; });
    const identityBody = new Promise(resolve => { releaseIdentity = resolve; });
    const identityReading = new Promise(resolve => { reachedIdentity = resolve; });
    let verifyAgain = false, identityCalls = 0, sosCalls = 0;
    let serverActor = actor;
    const f = setup(async url => {
      if (url.pathname === '/v1/me') {
        identityCalls++;
        const response = Response.json({ id: serverActor });
        if (verifyAgain) response.json = async () => { reachedIdentity(); await identityBody; return { id: serverActor }; };
        return response;
      }
      if (url.pathname.endsWith('/sos')) {
        sosCalls++;
        const response = Response.json(sos());
        if (held) response.json = async () => { reachedSos(); return sosBody; };
        return response;
      }
      return Response.json({ id: trip, driver_id: actor, truck_id: actor, origin: 'Synthetic origin',
        destination: 'Synthetic destination', country: 'BR', locale: 'pt-BR', time_zone: 'America/Sao_Paulo',
        status: 'active', map_active: true, checkins_active: true, paused: false, version: 1,
        created_at: '2026-10-17T12:00:00.000Z', closed_at: null });
    });
    const journey = createCurrentDriverJourney({ transport: f.transport, keyFactory: () => 'original-sos-intent' });
    const actors = [];
    const binding = bindJourneySession(f.session, f.api, id => { actors.push(id); journey.setSession(id); });
    const pending = [];
    try {
      await binding.activate(); journey.setInteractionMode('stationary');
      assert.equal((await journey.openTrip(trip)).kind, 'ok');
      const help = journey.requestHelp(); pending.push(help);
      if (held) await sosReading; else assert.equal((await help).kind, 'ok');
      f.session.setCredentials(credentials('synthetic.refreshed'));
      verifyAgain = true;
      const first = binding.activate(); first.catch(() => {}); pending.push(first);
      const second = binding.activate(); second.catch(() => {}); pending.push(second);
      await identityReading;
      assert.equal(journey.snapshot().tripId, trip, 'Verification must not clear the existing trip');
      assert.equal(journey.snapshot().operations.sos?.state, held ? 'pending' : 'accepted');
      assert.equal(identityCalls, 2, 'Concurrent same-credential reactivation shares one verification');
      releaseIdentity(); await Promise.all([first, second]);
      assert.deepEqual(actors, [null, actor], 'A verified unchanged actor must not republish a reset');
      releaseSos(sos()); assert.equal((await help).kind, 'ok');
      assert.equal(journey.snapshot().incident.data?.id, incident);
      assert.equal(journey.snapshot().operations.sos?.state, 'accepted');
      assert.equal(sosCalls, 1, 'Revalidation must not replay the SOS');
      // A genuinely changed server actor still retires all old protected facts.
      serverActor = '44444444-4444-4444-8444-444444444444';
      await binding.activate();
      assert.deepEqual(actors, [null, actor, null, serverActor]);
      assert.equal(journey.snapshot().tripId, null);
      assert.equal(journey.snapshot().incident.data, null);
      f.session.clear(); assert.equal(journey.snapshot().auth.actorId, null);
    } finally {
      releaseIdentity(); releaseSos(sos());
      await Promise.allSettled(pending);
      binding.dispose(); journey.dispose(); f.session.clear();
    }
  });
});

test('zero-dispatch SOS outcomes are not_sent and 429 is a definite rejection', async t => {
  for (const condition of ['signed-out', 'invalid-key', 'invalid-resource', 'pre-aborted', '429']) {
    await t.test(condition, async () => {
      const f = setup(async () => Response.json({ code: 'demo_rate_limited' }, { status: 429 }));
      const request = descriptor(); const controller = new AbortController();
      if (condition === 'signed-out') f.session.clear();
      if (condition === 'invalid-key') request.idempotencyKey = '';
      if (condition === 'invalid-resource') request.params.id = '../invalid';
      if (condition === 'pre-aborted') controller.abort();
      const result = await f.transport(request, { signal: controller.signal });
      assert.equal(result.kind, condition === '429' ? 'rejected' : 'not_sent');
      assert.equal(f.calls(), condition === '429' ? 1 : 0);
      if (condition === '429') assert.equal(result.status, 429);
      f.session.clear();
    });
  }
});

test('SOS works without AbortSignal.any and leaves no request timer', async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = new Set();
  const f = setup(async () => Response.json(sos()));
  try {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
    globalThis.setTimeout = (...args) => { const timer = set(...args); timers.add(timer); return timer; };
    globalThis.clearTimeout = timer => { timers.delete(timer); return clear(timer); };
    assert.equal((await f.transport(descriptor(), { signal: new AbortController().signal })).kind, 'ok');
    assert.equal(f.calls(), 1); assert.equal(timers.size, 0);
  } finally {
    if (original) Object.defineProperty(AbortSignal, 'any', original); else delete AbortSignal.any;
    globalThis.setTimeout = set; globalThis.clearTimeout = clear;
    for (const timer of timers) clear(timer);
    f.session.clear();
  }
});

test('a stale 401 from an earlier token cannot invalidate refreshed credentials for the same account', async () => {
  let finish;
  const f = setup(async () => new Promise(resolve => { finish = resolve; }));
  const pending = f.api.reportSos(trip, { idempotencyKey: 'original-sos-intent' });
  f.session.setCredentials(credentials('synthetic.refreshed'));
  finish(Response.json({ code: 'unauthorized' }, { status: 401 }));
  await assert.rejects(pending, error => error.status === 401 && error.outcome === 'rejected');
  assert.equal(f.session.capture().authorization, 'Bearer synthetic.refreshed');
  f.session.clear();
});
