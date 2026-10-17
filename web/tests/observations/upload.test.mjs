import test from 'node:test';
import assert from 'node:assert/strict';
import { openObservationQueue } from '../../src/lib/observations/queue.mjs';
import { createLocationUploader } from '../../src/lib/observations/upload.mjs';
import { createMemoryStores } from './memory-store.mjs';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const clock = { nowMs: () => NOW };
const scope = { tripId: 'trip-1', userId: 'user-1' };

const sampleAt = (ms, overrides = {}) => ({
  capturedAt: new Date(ms).toISOString(),
  latitude: -33.45,
  longitude: -70.66,
  accuracy: 12,
  ...overrides,
});

function fakeFetch(handlers) {
  // handlers: array of { status, body } or Error, consumed in order; the
  // last one repeats. Records every call for assertion.
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = handlers.length > 1 ? handlers.shift() : handlers[0];
    if (next instanceof Error) throw next;
    return {
      status: next.status,
      json: async () => next.body,
    };
  };
  return { fetch, calls };
}

const silentTimers = () => {
  const scheduled = [];
  let nextId = 1;
  return {
    scheduled,
    setTimeout: (fn, ms) => { const id = nextId++; scheduled.push({ id, fn, ms }); return id; },
    clearTimeout: (id) => { const index = scheduled.findIndex((s) => s.id === id); if (index >= 0) scheduled.splice(index, 1); },
    runNext: () => scheduled.shift()?.fn(),
  };
};

async function setup({ fetchHandlers = [{ status: 200, body: { id: 'trip-1', received: 1 } }], samples = [sampleAt(NOW - 1000)], timers = silentTimers(), uploaderOptions = {} } = {}) {
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  for (const sample of samples) await queue.enqueue({ sample, scope });
  const { fetch, calls } = fakeFetch(fetchHandlers);
  const uploader = createLocationUploader({
    queue,
    baseUrl: 'https://api.example.com',
    getAccessToken: async () => 'test-token',
    fetchImpl: fetch,
    timers,
    ...uploaderOptions,
  });
  return { queue, uploader, calls, timers, stores };
}

test('uploads a batch with the exact contract shape and headers', async () => {
  const { uploader, calls, queue } = await setup();
  const result = await uploader.flush({ userId: 'user-1' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, 'https://api.example.com/v1/trips/trip-1/locations');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer test-token');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  const key = call.init.headers['Idempotency-Key'];
  assert.match(key, /^loc1-[0-9a-f]{64}$/);
  assert.ok(key.length <= 128);
  assert.deepEqual(call.body, { observations: [sampleAt(NOW - 1000)] });
  const counts = await queue.counts();
  assert.equal(counts.uploaded, 1);
  assert.equal(counts.retained, 0);
});

test('batches at the server maximum of 100 observations', async () => {
  const samples = [];
  for (let i = 0; i < 205; i += 1) samples.push(sampleAt(NOW - 300_000 + i * 1000));
  const received = (n) => ({ status: 200, body: { id: 'trip-1', received: n } });
  const { uploader, calls, queue } = await setup({
    samples,
    fetchHandlers: [received(100), received(100), received(5)],
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.observations.length, 100);
  assert.equal(calls[1].body.observations.length, 100);
  assert.equal(calls[2].body.observations.length, 5);
  const keys = calls.map((c) => c.init.headers['Idempotency-Key']);
  assert.equal(new Set(keys).size, 3, 'distinct batches have distinct keys');
  const counts = await queue.counts();
  assert.equal(counts.uploaded, 205);
});

test('reconnect retry reuses the same idempotency key for the same batch', async () => {
  const timers = silentTimers();
  const { uploader, calls, queue } = await setup({
    timers,
    fetchHandlers: [new TypeError('fetch failed'), { status: 200, body: { id: 'trip-1', received: 1 } }],
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 1);
  const countsAfterFailure = await queue.counts();
  assert.equal(countsAfterFailure.uploading, 1, 'unacknowledged batch stays sticky in uploading');
  assert.equal(countsAfterFailure.pending, 0);
  assert.equal(timers.scheduled.length, 1, 'a backoff retry is scheduled');
  timers.runNext();
  await uploader.flush({ userId: 'user-1' }); // joins the in-flight retry
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
  assert.equal((await queue.counts()).uploaded, 1);
});

test('an ambiguous batch retries with identical content even after more samples arrive', async () => {
  const timers = silentTimers();
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope });
  const { fetch, calls } = fakeFetch([new TypeError('lost response'), { status: 200, body: { id: 'trip-1', received: 1 } }, { status: 200, body: { id: 'trip-1', received: 1 } }]);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => 't', fetchImpl: fetch, timers,
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls[0].body.observations.length, 1);
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.observations.length, 1, 'retry preserves the original ambiguous content');
  assert.equal(calls[1].init.headers['Idempotency-Key'], calls[0].init.headers['Idempotency-Key']);
  assert.equal(calls[1].body.observations[0].capturedAt, sampleAt(NOW - 2000).capturedAt);
  assert.equal(calls[2].body.observations.length, 1, 'the newer sample follows as its own batch');
  assert.notEqual(calls[2].init.headers['Idempotency-Key'], calls[0].init.headers['Idempotency-Key']);
  assert.equal((await queue.counts()).uploaded, 2);
});

test('network errors consume attempts and exhausted records are retained as failed', async () => {
  const { uploader, queue } = await setup({
    fetchHandlers: [new TypeError('down')],
    uploaderOptions: { maxAttempts: 2 },
  });
  await uploader.flush({ userId: 'user-1' });
  let counts = await queue.counts();
  assert.equal(counts.uploading, 1);
  await uploader.flush({ userId: 'user-1' });
  counts = await queue.counts();
  assert.equal(counts.uploading, 0);
  assert.equal(counts.pending, 0);
  assert.equal(counts.failed, 1);
  assert.equal(counts.failedRetained, 1);
});

test('500 responses consume attempts and retain exhausted records as failed', async () => {
  const { uploader, queue } = await setup({
    fetchHandlers: [{ status: 500, body: { code: 'internal' } }],
    uploaderOptions: { maxAttempts: 2 },
  });
  await uploader.flush({ userId: 'user-1' });
  let counts = await queue.counts();
  assert.equal(counts.uploading, 1);
  await uploader.flush({ userId: 'user-1' });
  counts = await queue.counts();
  assert.equal(counts.uploading, 0);
  assert.equal(counts.failed, 1);
  assert.equal(counts.failedRetained, 1);
});

test('401 blocks the pump without burning retry budget', async () => {
  const { uploader, queue, calls } = await setup({
    fetchHandlers: [{ status: 401, body: { code: 'unauthorized' } }],
  });
  await uploader.flush({ userId: 'user-1' });
  const state = await uploader.state();
  assert.equal(state.pumpState, 'auth-blocked');
  const counts = await queue.counts();
  assert.equal(counts.pending, 1);
  assert.equal(calls.length, 1);
});

test('400 validation, 404 missing and 400 bounds are permanent, counted rejections', async () => {
  for (const [status, code, countKey] of [
    [400, 'validation', 'rejectedValidation'],
    [404, 'not_found', 'rejectedMissing'],
    [400, 'capture_time_out_of_bounds', 'rejectedBounds'],
  ]) {
    const { uploader, queue } = await setup({ fetchHandlers: [{ status, body: { code } }] });
    await uploader.flush({ userId: 'user-1' });
    const counts = await queue.counts();
    assert.equal(counts[countKey], 1, `${code} counted as ${countKey}`);
    assert.equal(counts.retained, 0);
  }
});

test('409 idempotency_conflict is a permanent defect signal, never retried', async () => {
  const { uploader, queue, calls } = await setup({
    fetchHandlers: [{ status: 409, body: { code: 'idempotency_conflict' } }],
  });
  await uploader.flush({ userId: 'user-1' });
  await uploader.flush({ userId: 'user-1' });
  const counts = await queue.counts();
  assert.equal(counts.conflictErrors, 1);
  assert.equal(calls.length, 1, 'no retry after a conflict');
});

test('409 location_stopped keeps records pending for a reactivated map, without attempts', async () => {
  const { uploader, queue } = await setup({
    fetchHandlers: [{ status: 409, body: { code: 'location_stopped' } }],
  });
  await uploader.flush({ userId: 'user-1' });
  const counts = await queue.counts();
  assert.equal(counts.pending, 1);
  assert.equal(counts.tripStoppedRejections, 1);
  const state = await uploader.state();
  assert.equal(state.pumpState, 'idle');
});

test('flush scopes the drain to the signed-in owner only', async () => {
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope: { tripId: 'trip-9', userId: 'user-2' } });
  const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'trip-1', received: 1 } }]);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => 't', fetchImpl: fetch, timers: silentTimers(),
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.includes('trip-1'), true);
  const counts = await queue.counts();
  assert.equal(counts.pending, 1, "user-2's record was not touched");
});

test('missing token surfaces auth-blocked without a request', async () => {
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const { fetch, calls } = fakeFetch([]);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => { throw new Error('no session'); }, fetchImpl: fetch, timers: silentTimers(),
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 0);
  assert.equal((await uploader.state()).pumpState, 'auth-blocked');
});

test('stop halts retries and reports stopped', async () => {
  const timers = silentTimers();
  const { uploader } = await setup({ timers, fetchHandlers: [new TypeError('down')] });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(timers.scheduled.length, 1);
  uploader.stop();
  assert.equal((await uploader.flush({ userId: 'user-1' })).reason, 'stopped');
  assert.equal((await uploader.state()).pumpState, 'stopped');
});

test('flush on an empty queue sends nothing', async () => {
  const { uploader, calls } = await setup({ samples: [] });
  const result = await uploader.flush({ userId: 'user-1' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
});

test('a request never starts after stop(), even if the token resolves late', async () => {
  const timers = silentTimers();
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'trip-1', received: 1 } }]);
  let releaseToken;
  let tokenRequested;
  const requested = new Promise((resolve) => { tokenRequested = resolve; });
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com',
    getAccessToken: () => { tokenRequested(); return new Promise((resolve) => { releaseToken = resolve; }); },
    fetchImpl: fetch, timers,
  });
  const flushing = uploader.flush({ userId: 'user-1' });
  await requested; // the flush is parked inside getAccessToken
  uploader.stop();
  releaseToken('late-token');
  await flushing;
  assert.equal(calls.length, 0, 'no POST after retirement');
  const counts = await queue.counts();
  assert.equal(counts.pending, 1, 'record returns to pending, unsent');
});

test('a request never starts after the scope was revoked while the token was pending', async () => {
  const timers = silentTimers();
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'trip-1', received: 1 } }]);
  let releaseToken;
  let tokenRequested;
  const requested = new Promise((resolve) => { tokenRequested = resolve; });
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com',
    getAccessToken: () => { tokenRequested(); return new Promise((resolve) => { releaseToken = resolve; }); },
    fetchImpl: fetch, timers,
  });
  const flushing = uploader.flush({ userId: 'user-1' });
  await requested; // the flush is parked inside getAccessToken
  await queue.wipeScope(scope);
  releaseToken('late-token');
  await flushing;
  assert.equal(calls.length, 0, 'no POST for a wiped scope');
  assert.equal((await queue.counts()).retained, 0);
});

test('a 2xx with the wrong trip id or wrong count is not a receipt', async () => {
  for (const body of [
    { id: 'trip-OTHER', received: 1 },
    { id: 'trip-1', received: 2 },
    null, // malformed JSON
  ]) {
    const { uploader, queue, calls } = await setup({
      fetchHandlers: [{ status: 200, body }],
    });
    await uploader.flush({ userId: 'user-1' });
    const counts = await queue.counts();
    assert.equal(counts.uploaded, 0, `nothing confirmed for body ${JSON.stringify(body)}`);
    assert.equal(counts.receiptMismatches, 1);
    assert.equal(counts.pending, 1, 'sample retained, not deleted on an unvalidated receipt');
    const state = await uploader.state();
    assert.equal(state.lastError, 'receipt-mismatch');
    assert.equal(calls.length, 1, 'no hot retry of a defective receipt');
  }
});

test('a wiped sticky batch is never retried, even under its old key', async () => {
  const timers = silentTimers();
  const { uploader, queue, calls } = await setup({
    timers,
    fetchHandlers: [new TypeError('lost'), { status: 200, body: { id: 'trip-1', received: 1 } }],
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 1);
  await queue.wipeScope(scope);
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 1, 'no retry after revocation');
  assert.equal((await queue.counts()).retained, 0);
});

test('constructor guards', async () => {
  const queue = await openObservationQueue({ ...createMemoryStores(), clock });
  assert.throws(() => createLocationUploader({ queue, baseUrl: 'http://insecure.example.com', getAccessToken: async () => 't', fetchImpl: async () => {} }), TypeError);
  assert.throws(() => createLocationUploader({ queue, baseUrl: 'https://api.example.com', getAccessToken: async () => 't', fetchImpl: async () => {}, batchSize: 101 }), RangeError);
});
