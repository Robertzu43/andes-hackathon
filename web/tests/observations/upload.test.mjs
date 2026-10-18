import test from 'node:test';
import assert from 'node:assert/strict';
import { openObservationQueue, QUEUE_LIMITS } from '../../src/lib/observations/queue.mjs';
import { createLocationUploader } from '../../src/lib/observations/upload.mjs';
import { createMemoryStores, tokenFor } from './memory-store.mjs';

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
    getAccessToken: async () => tokenFor('user-1'),
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
  assert.equal(call.init.headers.Authorization, `Bearer ${tokenFor('user-1')}`);
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
  assert.equal(countsAfterFailure.uploading, 0, 'no request is in flight after the failure settled');
  assert.equal(countsAfterFailure.pending, 1, 'unacknowledged batch is retained as pending unsent work');
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
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: fetch, timers,
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

test('offline: network errors never exhaust the retry budget and the batch resends after reconnect', async () => {
  // Gatekeeper item 5: 183 s offline used to burn the 8-attempt budget and
  // leave the sample permanently failed.
  const online = new EventTarget();
  const handlers = Array.from({ length: 20 }, () => new TypeError('offline'));
  handlers.push({ status: 200, body: { id: 'trip-1', received: 1 } });
  const { uploader, queue, calls } = await setup({ fetchHandlers: handlers, uploaderOptions: { onlineTarget: online } });
  for (let i = 0; i < 20; i += 1) await uploader.flush({ userId: 'user-1' });
  let counts = await queue.counts();
  assert.equal(counts.failed, 0, 'network errors are not counted against maxAttempts');
  assert.equal(counts.pending, 1);
  online.dispatchEvent(new Event('online'));
  await uploader.flush({ userId: 'user-1' }); // joins the reconnect flush
  counts = await queue.counts();
  assert.equal(counts.uploaded, 1, 'the sample is resent once back online');
  assert.equal(calls.length, 21);
  assert.equal(new Set(calls.map((c) => c.init.headers['Idempotency-Key'])).size, 1, 'same ambiguous batch, same key');
});

test('500 responses consume attempts and retain exhausted records as failed', async () => {
  const { uploader, queue } = await setup({
    fetchHandlers: [{ status: 500, body: { code: 'internal' } }],
    uploaderOptions: { maxAttempts: 2 },
  });
  await uploader.flush({ userId: 'user-1' });
  let counts = await queue.counts();
  assert.equal(counts.uploading, 0);
  assert.equal(counts.pending, 1, 'unacknowledged batch retained as pending');
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

test('single-sample 400 invalid_request, 404 trip_not_found and old 400 bounds are permanent, counted rejections', async () => {
  const old = [sampleAt(NOW - 20 * 3_600_000)]; // a server with a faster clock sees it as >24 h old
  for (const [status, code, countKey, samples] of [
    [400, 'invalid_request', 'rejectedValidation', undefined],
    [404, 'trip_not_found', 'rejectedMissing', undefined],
    [400, 'capture_time_out_of_bounds', 'rejectedBounds', old],
  ]) {
    const { uploader, queue } = await setup({ fetchHandlers: [{ status, body: { code } }], samples });
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

test('409 location_stopped (trip closed) wipes the scope instead of retrying forever', async () => {
  // Gatekeeper item 6: five flushes used to send five POSTs.
  const { uploader, queue, calls } = await setup({
    fetchHandlers: [{ status: 409, body: { code: 'location_stopped' } }],
  });
  for (let i = 0; i < 5; i += 1) await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 1, 'a closed trip is never retried');
  const counts = await queue.counts();
  assert.equal(counts.retained, 0, 'no coordinates kept for a trip that can no longer receive them');
  assert.equal(counts.tripStoppedRejections, 1);
  assert.equal(queue.isScopeRevoked(scope), true, 'late samples for the closed trip cannot re-enter');
  assert.equal((await uploader.state()).pumpState, 'idle');
});

test('flush scopes the drain to the signed-in owner only', async () => {
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope: { tripId: 'trip-9', userId: 'user-2' } });
  const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'trip-1', received: 1 } }]);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: fetch, timers: silentTimers(),
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
  releaseToken(tokenFor('user-1'));
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
  releaseToken(tokenFor('user-1'));
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
      fetchHandlers: [{ status: 200, body }, { status: 200, body: { id: 'trip-1', received: 1 } }],
    });
    await uploader.flush({ userId: 'user-1' });
    let counts = await queue.counts();
    assert.equal(counts.uploaded, 0, `nothing confirmed for body ${JSON.stringify(body)}`);
    assert.equal(counts.receiptMismatches, 1);
    assert.equal(counts.uploading, 0, 'no request in flight once the defective receipt settled');
    assert.equal(counts.pending, 1, 'sample retained as pending unsent work, not deleted on an unvalidated receipt');
    let state = await uploader.state();
    assert.equal(state.lastError, 'receipt-mismatch');
    assert.equal(state.unacknowledgedBatches, 1, 'original intent pinned durably');
    assert.equal(calls.length, 1, 'no hot retry of a defective receipt');
    // A later flush replays the IDENTICAL content under the IDENTICAL key —
    // the intent is never regrown or rekeyed even after a defective 2xx.
    await uploader.flush({ userId: 'user-1' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.headers['Idempotency-Key'], calls[0].init.headers['Idempotency-Key']);
    assert.deepEqual(calls[1].body, calls[0].body);
    counts = await queue.counts();
    assert.equal(counts.uploaded, 1);
    state = await uploader.state();
    assert.equal(state.unacknowledgedBatches, 0);
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

test('the sticky intent survives a full queue + uploader restart, content and key intact', async () => {
  const timers = silentTimers();
  const stores = createMemoryStores();
  const queue1 = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue1.enqueue({ sample: sampleAt(NOW - 2000), scope });
  const first = fakeFetch([new TypeError('lost response')]);
  const uploader1 = createLocationUploader({
    queue: queue1, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: first.fetch, timers,
  });
  await uploader1.flush({ userId: 'user-1' });
  assert.equal(first.calls.length, 1);
  const originalKey = first.calls[0].init.headers['Idempotency-Key'];

  // Simulate a page reload: brand-new queue + uploader on the same stores.
  const queue2 = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue2.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const second = fakeFetch([{ status: 200, body: { id: 'trip-1', received: 1 } }]);
  const uploader2 = createLocationUploader({
    queue: queue2, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: second.fetch, timers,
  });
  await uploader2.flush({ userId: 'user-1' });
  assert.equal(second.calls.length, 2);
  assert.equal(second.calls[0].init.headers['Idempotency-Key'], originalKey, 'restarted uploader replays the persisted intent key');
  assert.equal(second.calls[0].body.observations.length, 1, 'the ambiguous batch is not regrown after restart');
  assert.equal(second.calls[0].body.observations[0].capturedAt, sampleAt(NOW - 2000).capturedAt);
  assert.equal(second.calls[1].body.observations.length, 1, 'the post-restart sample follows as its own batch');
  assert.notEqual(second.calls[1].init.headers['Idempotency-Key'], originalKey);
  assert.equal((await queue2.counts()).uploaded, 2);
});

test('the ambiguous intent persists as its own meta record with the exact replay contract', async () => {
  const timers = silentTimers();
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({
    sample: sampleAt(NOW - 2000),
    scope: { ...scope, sessionId: 'session-A' },
    provenance: { eventId: 'evt-1', requestId: 'req-1' },
  });
  const { fetch, calls } = fakeFetch([new TypeError('lost response')]);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: fetch, timers,
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 1);
  const intents = (await stores.meta.getAll()).filter((entry) => entry.intent);
  assert.equal(intents.length, 1, 'one durable intent record per scope');
  assert.deepEqual(intents[0].intent, {
    key: calls[0].init.headers['Idempotency-Key'],
    body: calls[0].body,
    userId: scope.userId,
    tripId: scope.tripId,
    sessionId: 'session-A',
  }, 'the persisted intent is exactly { key, body, userId, tripId, sessionId }');
  assert.deepEqual(intents[0].queueIds, ['q-1']);
});

test('revocation landing during the pre-flight store re-read still blocks the POST', async () => {
  const timers = silentTimers();
  const stores = createMemoryStores();
  // Wrap records.get so it snapshots the current value, then parks until the
  // test releases it — reproducing a wipe that lands mid re-read.
  let releaseRead;
  let readParked;
  let armed = true;
  const parked = new Promise((resolve) => { readParked = resolve; });
  const recordsStore = {
    ...stores.records,
    get(key) {
      if (!armed) return stores.records.get(key);
      const snapshot = stores.records.get(key); // captures pre-wipe value now
      return new Promise((resolve) => {
        readParked();
        releaseRead = () => { armed = false; snapshot.then(resolve); };
      });
    },
  };
  const queue = await openObservationQueue({ records: recordsStore, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const { fetch, calls } = fakeFetch([{ status: 200, body: { id: 'trip-1', received: 1 } }]);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: fetch, timers,
  });
  const flushing = uploader.flush({ userId: 'user-1' });
  await parked; // the flush is parked inside the getRecords re-read
  await queue.wipeScope(scope);
  releaseRead();
  await flushing;
  assert.equal(calls.length, 0, 'the final synchronous gate blocks the retired POST');
  assert.equal((await queue.counts()).retained, 0);
});

test('a valid receipt landing after stop() produces no local side effects', async () => {
  const timers = silentTimers();
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  let resolveResponse;
  let fetchCalled;
  const called = new Promise((resolve) => { fetchCalled = resolve; });
  const fetch = async () => {
    fetchCalled();
    return new Promise((resolve) => { resolveResponse = resolve; });
  };
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: fetch, timers,
  });
  const flushing = uploader.flush({ userId: 'user-1' });
  await called;
  uploader.stop();
  resolveResponse({ status: 200, json: async () => ({ id: 'trip-1', received: 1 }) });
  await flushing;
  const counts = await queue.counts();
  assert.equal(counts.uploaded, 0, 'nothing confirmed after retirement');
  assert.equal(counts.retained, 1, 'the record is kept — unconfirmed is never deleted');
  const state = await uploader.state();
  assert.equal(state.lastReceipt, null, 'no receipt fact written after stop');
});

test('constructor guards', async () => {
  const queue = await openObservationQueue({ ...createMemoryStores(), clock });
  assert.throws(() => createLocationUploader({ queue, baseUrl: 'http://insecure.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: async () => {} }), TypeError);
  assert.throws(() => createLocationUploader({ queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: async () => {}, batchSize: 101 }), RangeError);
});

// ---- Gatekeeper review of 170e83a: regression tests -------------------------

const receipt = (n = 1, tripId = 'trip-1') => ({ status: 200, json: async () => ({ id: tripId, received: n }) });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('item 1: an unscoped flush (online event before any scoped flush) uploads nothing', async () => {
  const online = new EventTarget();
  const { uploader, calls, queue } = await setup({ uploaderOptions: { onlineTarget: online } });
  assert.equal((await uploader.flush()).ok, false, 'a flush without an owner is refused');
  online.dispatchEvent(new Event('online'));
  for (let i = 0; i < 5; i += 1) await tick();
  assert.equal(calls.length, 0, 'no POST without an owner scope');
  assert.equal((await queue.counts()).pending, 1);
});

test("item 1: one owner's samples are never sent with another identity's token", async () => {
  // user-1 left samples on the device; the session now belongs to user-2.
  const online = new EventTarget();
  const { uploader, calls, queue } = await setup({
    fetchHandlers: [{ status: 404, body: { code: 'trip_not_found' } }],
    uploaderOptions: { onlineTarget: online, getAccessToken: async () => tokenFor('user-2') },
  });
  await uploader.flush({ userId: 'user-1' });
  online.dispatchEvent(new Event('online'));
  for (let i = 0; i < 5; i += 1) await tick();
  assert.equal(calls.length, 0, "user-1's coordinates never travel with user-2's bearer token");
  assert.equal((await uploader.state()).lastError, 'token-owner-mismatch');
  const counts = await queue.counts();
  assert.equal(counts.pending, 1, "user-1's records are neither sent nor deleted");
  assert.equal(counts.rejectedMissing, 0);
});

test('item 1: an opaque (non-JWT) token is refused rather than trusted', async () => {
  const { uploader, calls } = await setup({ uploaderOptions: { getAccessToken: async () => 'opaque-token' } });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 0);
});

test('item 7: one out-of-bounds sample does not delete the valid samples batched with it', async () => {
  const samples = Array.from({ length: 10 }, (_, i) => sampleAt(NOW - 20 * 3_600_000 + i * 1000));
  const bad = samples[4].capturedAt; // the server (faster clock) sees this one as >24 h old
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.observations.some((o) => o.capturedAt === bad)) {
      return { status: 400, json: async () => ({ code: 'capture_time_out_of_bounds' }) };
    }
    return receipt(body.observations.length);
  };
  const { uploader, queue } = await setup({ samples, uploaderOptions: { fetchImpl: fetch } });
  for (let i = 0; i < 3; i += 1) await uploader.flush({ userId: 'user-1' });
  const counts = await queue.counts();
  assert.equal(counts.uploaded, 9, 'all nine valid samples are delivered');
  assert.equal(counts.rejectedBounds, 1, 'only the rejected sample is dropped');
  assert.equal(counts.retained, 0);
});

test('item 7: a device clock 31 s fast never deletes the batch', async () => {
  let serverCaughtUp = false;
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    return serverCaughtUp ? receipt(body.observations.length) : { status: 400, json: async () => ({ code: 'capture_time_out_of_bounds' }) };
  };
  const samples = Array.from({ length: 100 }, (_, i) => sampleAt(NOW - 99_000 + i * 1000));
  const { uploader, queue } = await setup({ samples, uploaderOptions: { fetchImpl: fetch } });
  await uploader.flush({ userId: 'user-1' });
  let counts = await queue.counts();
  assert.equal(counts.retained, 100, 'nothing is deleted while the server sees the captures as future-dated');
  assert.equal(counts.rejectedBounds, 0);
  serverCaughtUp = true;
  await uploader.flush({ userId: 'user-1' });
  counts = await queue.counts();
  assert.equal(counts.uploaded, 100);
});

test('item 7: samples inside the safety margin of the 24 h window are dropped before sending', async () => {
  const nearlyExpired = sampleAt(NOW - QUEUE_LIMITS.captureWindowMs + 30_000);
  const { uploader, queue, calls } = await setup({ samples: [nearlyExpired, sampleAt(NOW - 1000)] });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.observations.length, 1, 'only the sample the server will accept is sent');
  assert.equal((await queue.counts()).droppedOutOfBounds, 1);
});

test('item 7: a sticky replay is re-checked against the window and never sent with an aged-out sample', async () => {
  let now = NOW;
  const mutableClock = { nowMs: () => now };
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock: mutableClock });
  await queue.enqueue({ sample: sampleAt(NOW - QUEUE_LIMITS.captureWindowMs + 120_000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const { fetch, calls } = fakeFetch([new TypeError('lost'), { status: 200, body: { id: 'trip-1', received: 1 } }]);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: fetch, timers: silentTimers(),
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls[0].body.observations.length, 2);
  now = NOW + 90_000; // the older sample is now inside the margin
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.observations.length, 1, 'the aged-out sample is not replayed');
  assert.notEqual(calls[1].init.headers['Idempotency-Key'], calls[0].init.headers['Idempotency-Key'], 'changed content gets a new key');
  assert.equal((await queue.counts()).uploaded, 1);
});

test('item 8: 429 and 408 are retryable and never delete the batch', async () => {
  for (const status of [429, 408]) {
    const { uploader, queue, timers } = await setup({
      fetchHandlers: [{ status, body: { code: 'rate_limited' } }, { status: 200, body: { id: 'trip-1', received: 1 } }],
    });
    await uploader.flush({ userId: 'user-1' });
    let counts = await queue.counts();
    assert.equal(counts.pending, 1, `${status} keeps the batch`);
    assert.equal(counts.rejectedValidation, 0);
    assert.equal(timers.scheduled.length, 1, `${status} schedules a backoff retry`);
    await uploader.flush({ userId: 'user-1' });
    counts = await queue.counts();
    assert.equal(counts.uploaded, 1);
  }
});

test('item 8: only 404 trip_not_found is permanent; a route-not-found 404 keeps the queue', async () => {
  const { uploader, queue } = await setup({
    samples: [sampleAt(NOW - 2000), sampleAt(NOW - 1000)],
    fetchHandlers: [{ status: 404, body: { message: 'Route POST://v1/trips/trip-1/locations not found' } }],
  });
  await uploader.flush({ userId: 'user-1' });
  const counts = await queue.counts();
  assert.equal(counts.retained, 2, 'a misrouted request deletes nothing');
  assert.equal(counts.rejectedMissing, 0);
});

test('item 8: a trailing-slash baseUrl still hits the contract route', async () => {
  const { uploader, calls } = await setup({ uploaderOptions: { baseUrl: 'https://api.example.com/' } });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(calls[0].url, 'https://api.example.com/v1/trips/trip-1/locations');
});

test('item 9: a 403 on one trip does not block uploads for other trips', async () => {
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope: { tripId: 'trip-forbidden', userId: 'user-1' } });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope: { tripId: 'trip-ok', userId: 'user-1' } });
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return url.includes('trip-forbidden') ? { status: 403, json: async () => ({ code: 'forbidden' }) } : receipt(1, 'trip-ok');
  };
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com', getAccessToken: async () => tokenFor('user-1'), fetchImpl: fetch, timers: silentTimers(),
  });
  for (let i = 0; i < 3; i += 1) await uploader.flush({ userId: 'user-1' });
  assert.ok(urls.some((u) => u.includes('trip-ok')), 'trip-ok is sent despite the forbidden trip');
  const counts = await queue.counts();
  assert.equal(counts.uploaded, 1);
  assert.notEqual((await uploader.state()).pumpState, 'auth-blocked', 'a 403 is scoped to its trip');
});

test('item 11: a missing crypto.subtle digest never leaves the batch stuck uploading', async () => {
  const { uploader, queue, calls } = await setup({
    uploaderOptions: { digest: async () => { throw new TypeError('crypto.subtle is unavailable'); } },
  });
  await uploader.flush({ userId: 'user-1' }).catch(() => {});
  const counts = await queue.counts();
  assert.equal(counts.uploading, 0, 'nothing stays in uploading');
  assert.equal(counts.pending, 1);
  assert.equal(calls.length, 0);
});

test('item 11: a stalled response body times out instead of hanging the shared flush', async () => {
  const timers = silentTimers();
  const fetch = async () => ({ status: 200, json: () => new Promise(() => {}) });
  const { uploader, queue } = await setup({ timers, uploaderOptions: { fetchImpl: fetch, requestTimeoutMs: 5_000 } });
  const flushing = uploader.flush({ userId: 'user-1' });
  for (let i = 0; i < 20 && !timers.scheduled.some((t) => t.ms === 5_000); i += 1) await tick();
  for (let i = 0; i < 20; i += 1) {
    timers.scheduled.find((t) => t.ms === 5_000)?.fn();
    await tick();
  }
  const outcome = await Promise.race([flushing.then(() => 'settled'), new Promise((resolve) => setTimeout(() => resolve('hung'), 500))]);
  assert.equal(outcome, 'settled', 'the request timeout covers the body read');
  const counts = await queue.counts();
  assert.equal(counts.uploading, 0);
  assert.equal(counts.pending, 1, 'an unreadable receipt confirms nothing');
});

test('should-fix: a captive-portal 200 counts attempts and backs off instead of pinning the batch forever', async () => {
  const { uploader, queue, timers } = await setup({
    fetchHandlers: [{ status: 200, body: null }],
    uploaderOptions: { maxAttempts: 2 },
  });
  await uploader.flush({ userId: 'user-1' });
  assert.equal(timers.scheduled.length, 1, 'a retry is scheduled');
  await uploader.flush({ userId: 'user-1' });
  const counts = await queue.counts();
  assert.equal(counts.failed, 1, 'the attempt budget applies to unverifiable receipts');
  assert.equal((await uploader.state()).unacknowledgedBatches, 0);
});
