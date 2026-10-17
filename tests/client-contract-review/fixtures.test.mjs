import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT, ERRORS, IDS, OPERATIONS, ORIGIN, clone, locationSample, snapshot } from './fixtures.mjs';
import { deferred, jsonResponse, memoryStore, scriptedTransport } from './scripted-transport.mjs';

test('fixtures pin exact source contracts and preserve source/read/upload timestamps', () => {
  for (const sha of [CONTRACT.backend, CONTRACT.phoneBoundary, CONTRACT.monitoringBoundary]) assert.match(sha, /^[0-9a-f]{40}$/);
  const stale = snapshot();
  assert.equal(stale.ageMs, 300_000);
  assert.equal(stale.freshness, 'stale');
  assert.notEqual(stale.location.capturedAt, stale.location.receivedAt);
  assert.equal(stale.location.receivedAt, stale.readAt);
});

test('synthetic source fixture can represent old/out-of-order samples without restamping', () => {
  const old = locationSample(1);
  const newer = locationSample(2);
  assert.ok(old.sourceAtMs < newer.sourceAtMs);
  assert.equal(old.tripId, IDS.trip);
  assert.equal(locationSample(3, { tripId: IDS.otherTrip }).tripId, IDS.otherTrip);
});

for (const operation of OPERATIONS) {
  test(`scripted transport preserves ${operation.name} route, body and server response`, async () => {
    const transport = scriptedTransport([operation]);
    const response = await transport.fetch(ORIGIN + operation.path, {
      method: operation.method,
      headers: { authorization: 'Bearer SYNTHETIC-ONLY', 'idempotency-key': 'synthetic-key-1', 'content-type': 'application/json' },
      ...(operation.body === undefined ? {} : { body: JSON.stringify(operation.body) }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), operation.response);
    transport.assertDrained();
  });
}

test('all documented error statuses/codes remain distinct fixture observations', async () => {
  for (const error of ERRORS) {
    const t = scriptedTransport([{ method: 'GET', path: '/v1/me', status: error.status, response: { code: error.code } }]);
    const r = await t.fetch(ORIGIN + '/v1/me');
    assert.equal(r.status, error.status);
    assert.deepEqual(await r.json(), { code: error.code });
  }
});

test('lost response is ambiguous and an unscripted blind retry fails the control', async () => {
  const t = scriptedTransport([{ method: 'POST', path: '/v1/trucks', outcome: 'network-error' }]);
  await assert.rejects(t.fetch(ORIGIN + '/v1/trucks', { method: 'POST', body: '{}' }), TypeError);
  await assert.rejects(t.fetch(ORIGIN + '/v1/trucks', { method: 'POST', body: '{}' }), /unscripted/);
  assert.equal(t.calls.length, 2);
});

test('malformed success-body fixture stays malformed for protocol-error probes', async () => {
  const t = scriptedTransport([{ method: 'GET', path: '/v1/me', rawBody: '{not-json' }]);
  const r = await t.fetch(ORIGIN + '/v1/me');
  await assert.rejects(r.json(), SyntaxError);
});

test('a held response can arrive after session invalidation, independent of transport abort', async () => {
  const wait = deferred();
  const t = scriptedTransport([{ method: 'GET', path: '/v1/me', wait, ignoreAbort: true }]);
  const controller = new AbortController();
  const pending = t.fetch(ORIGIN + '/v1/me', { signal: controller.signal });
  await new Promise(setImmediate);
  controller.abort();
  wait.resolve(jsonResponse({ id: IDS.driver }));
  assert.deepEqual(await (await pending).json(), { id: IDS.driver });
  assert.equal(t.calls[0].signal.aborted, true);
});

test('a cooperative held transport observes cancellation and releases its listener', async () => {
  const t = scriptedTransport([{ method: 'GET', path: '/v1/me', wait: deferred() }]);
  const controller = new AbortController();
  const pending = t.fetch(ORIGIN + '/v1/me', { signal: controller.signal });
  await new Promise(setImmediate);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('wrong routes, payloads and external origins fail without network fallback', async () => {
  for (const [url, init] of [
    [ORIGIN + '/v1/guessed-list-route', {}],
    ['https://example.invalid/v1/me', {}],
    [ORIGIN + '/v1/me', { method: 'POST', body: '{}' }],
  ]) {
    const t = scriptedTransport([{ method: 'GET', path: '/v1/me' }]);
    await assert.rejects(t.fetch(url, init), assert.AssertionError);
  }
});

test('memory store survives driver recreation, isolates copies, then wipes explicitly', async () => {
  const store = memoryStore();
  const original = { userId: IDS.driver, samples: [locationSample()] };
  await store.put('synthetic-queue', original);
  original.samples.length = 0;
  const one = await store.get('synthetic-queue');
  one.samples[0].tripId = IDS.otherTrip;
  assert.equal((await store.get('synthetic-queue')).samples[0].tripId, IDS.trip);
  await store.clear();
  assert.deepEqual(await store.entries(), []);
  assert.equal(await store.get('synthetic-queue'), undefined);
});

test('consumer mutations do not alter response fixtures', () => {
  const operation = clone(OPERATIONS.find(o => o.name === 'confirmTrip'));
  operation.response.fields.country = 'MX';
  assert.equal(OPERATIONS.find(o => o.name === 'confirmTrip').response.fields.country, 'BR');
});
