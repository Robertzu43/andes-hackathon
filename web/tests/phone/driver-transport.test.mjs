// Process-scoped synthetic HTTP only; no network or provider is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, MemorySession, ApiError } from '../../src/lib/api/index.ts';
import { createDriverTransport, decodeDriverResponse } from '../../src/lib/api/driver.ts';
import { createDriverJourney } from '../../src/features/driver/controller.mjs';

const trip = '11111111-1111-4111-8111-111111111111';
const incident = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const stamp = '2026-10-18T12:00:00.000Z';
const status = { trip: { status: 'arrived', paused: false, expectedArrivalAt: null }, check: null,
  incident: { id: incident, trigger: 'sos', checkReason: null, status: 'active', label: null, createdAt: stamp },
  deliveries: [{ role: 'family', channel: 'sms', status: 'unknown', unavailableReason: null }] };
const readStatus = { operation: 'readStatus', params: { id: trip } };
const resolve = { operation: 'resolveIncident', params: { id: incident }, body: {}, idempotencyKey: 'synthetic-resolution' };
const options = () => ({ signal: new AbortController().signal });

function fixture(fetch) {
  const session = new MemorySession();
  session.setCredentials({ issuer: 'https://identity.example.invalid', subject: 'synthetic',
    accessToken: 'synthetic.token.only', expiresAt: Date.now() + 60_000 });
  return createDriverTransport(createApiClient({ baseUrl: 'https://app.example.invalid', session, fetch }));
}

// Catches a missing status switch/decoder or a write-shaped status request.
test('readStatus reaches the SDK and is decoded', async () => {
  const calls = [];
  const transport = fixture(async (url, init) => {
    calls.push({ path: url.pathname, method: init.method, key: init.headers['Idempotency-Key'], body: init.body });
    return Response.json({ ...status, readAt: stamp });
  });
  assert.deepEqual(await transport(readStatus, options()), { kind: 'ok', data: status });
  assert.deepEqual(calls, [{ path: `/v1/trips/${trip}/status`, method: 'GET', key: undefined, body: undefined }]);
  assert.deepEqual(decodeDriverResponse(readStatus, { ...status, readAt: stamp }), status);
  assert.throws(() => decodeDriverResponse(readStatus, { ...status, check: { status: 'safe' } }),
    e => e instanceof ApiError && e.kind === 'invalid_response' && e.outcome === 'not_applicable');
});

// Catches resolving the trip instead of the incident, dropping the key, or inventing a time.
test('resolveIncident reaches the SDK with the incident ID, empty body and original key', async () => {
  const calls = [];
  const transport = fixture(async (url, init) => {
    calls.push({ path: url.pathname, method: init.method, key: init.headers['Idempotency-Key'], body: init.body });
    return Response.json({ id: incident, status: 'resolved', resolvedAt: stamp });
  });
  assert.deepEqual(await transport(resolve, options()), { kind: 'ok', data: { id: incident, status: 'resolved' } });
  assert.deepEqual(calls, [{ path: `/v1/incidents/${incident}/resolve`, method: 'POST', key: 'synthetic-resolution', body: '{}' }]);
  assert.deepEqual(decodeDriverResponse(resolve, { id: incident, status: 'resolved', resolvedAt: stamp }),
    { id: incident, status: 'resolved' });
  assert.throws(() => decodeDriverResponse(resolve, { id: incident, status: 'active' }),
    e => e instanceof ApiError && e.kind === 'invalid_response' && e.outcome === 'unknown');
});

test('resolution transport distinguishes HTTP rejection, zero dispatch and ambiguous dispatch without retry', async () => {
  for (const code of [400, 403, 409, 429]) {
    const transport = fixture(async () => Response.json({ code: 'forbidden' }, { status: code }));
    assert.deepEqual(await transport(resolve, options()), { kind: 'rejected', status: code, code: 'forbidden' });
  }
  let calls = 0;
  const transport = fixture(async () => { calls += 1; throw Error('synthetic lost response'); });
  assert.equal((await transport({ ...resolve, idempotencyKey: undefined }, options())).kind, 'not_sent');
  assert.equal(calls, 0);
  assert.equal((await transport(resolve, options())).kind, 'unknown');
  assert.equal(calls, 1);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await transport(readStatus, { signal: aborted.signal })).kind, 'unknown');
  assert.equal(calls, 1);
});

// Exercise the full production binding, including controller-owned ID correlation.
test('SDK status enables owner resolution after arrival and wrong acknowledgement IDs remain unknown', async () => {
  const calls = [];
  let responseId = trip;
  const transport = fixture(async (url, init) => {
    calls.push({ path: url.pathname, key: init.headers['Idempotency-Key'], body: init.body });
    if (url.pathname.endsWith('/status')) return Response.json(status);
    if (url.pathname.endsWith('/resolve')) return Response.json({ id: responseId, status: 'resolved' });
    return Response.json({ id: trip, driver_id: actor, truck_id: incident, origin: 'Lima', destination: 'Cusco',
      country: 'PE', locale: 'es', time_zone: 'America/Lima', status: 'arrived', paused: false,
      map_active: false, checkins_active: false, version: 2, created_at: stamp, closed_at: stamp });
  });
  const journey = createDriverJourney({ transport, decodeResponse: decodeDriverResponse, keyFactory: () => 'synthetic-owner-resolution' });
  try {
    journey.setSession(actor); journey.setInteractionMode('stationary');
    assert.equal((await journey.openTrip(trip)).kind, 'ok');
    assert.equal((await journey.refreshStatus()).kind, 'ok');
    assert.equal(journey.snapshot().incident.data.tripId, trip);
    assert.equal((await journey.resolveIncident()).kind, 'unknown');
    const original = journey.snapshot().operations.resolve.request;
    responseId = incident;
    assert.equal((await journey.retryUnknown('resolve', { confirmed: true })).kind, 'ok');
    assert.deepEqual(journey.snapshot().operations.resolve.request, original);
    assert.deepEqual(calls.at(-1), calls.at(-2));
    assert.equal(journey.snapshot().incident.data.status, 'active');
    assert.equal(journey.snapshot().incident.invalidated, true);
    assert.equal(journey.snapshot().status.invalidated, true);
    assert.equal('resolvedAt' in journey.snapshot().incident.data, false);
  } finally { journey.dispose(); }
});
