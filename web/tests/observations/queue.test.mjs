import test from 'node:test';
import assert from 'node:assert/strict';
import { openObservationQueue, validateSample, QUEUE_LIMITS } from '../../src/lib/observations/queue.mjs';
import { createMemoryStores } from './memory-store.mjs';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const clock = { nowMs: () => NOW };
const scope = { tripId: 'trip-1', userId: 'user-1' };
const otherScope = { tripId: 'trip-2', userId: 'user-2' };

const sampleAt = (ms, overrides = {}) => ({
  capturedAt: new Date(ms).toISOString(),
  latitude: -33.45,
  longitude: -70.66,
  accuracy: 12,
  ...overrides,
});

const open = async (stores = createMemoryStores(), options = {}) =>
  openObservationQueue({ records: stores.records, meta: stores.meta, clock, ...options });

test('validateSample mirrors the server schema', () => {
  assert.equal(validateSample(sampleAt(NOW)), null);
  assert.equal(validateSample(null), 'not-an-object');
  assert.equal(validateSample(sampleAt(NOW, { capturedAt: 'nope' })), 'bad-captured-at');
  assert.equal(validateSample(sampleAt(NOW, { latitude: 91 })), 'bad-latitude');
  assert.equal(validateSample(sampleAt(NOW, { longitude: -181 })), 'bad-longitude');
  assert.equal(validateSample(sampleAt(NOW, { accuracy: -1 })), 'bad-accuracy');
  assert.equal(validateSample(sampleAt(NOW, { accuracy: 100_001 })), 'bad-accuracy');
});

test('enqueue accepts a valid scoped sample and counts it', async () => {
  const queue = await open();
  const result = await queue.enqueue({ sample: sampleAt(NOW - 1000), provenance: { eventId: 's:1:1', sessionId: 's', requestId: '1:geo:1' }, scope });
  assert.equal(result.ok, true);
  const counts = await queue.counts();
  assert.equal(counts.enqueued, 1);
  assert.equal(counts.pending, 1);
  assert.equal(counts.retained, 1);
});

test('enqueue rejects bad scope and bad samples without counting them as drops', async () => {
  const queue = await open();
  assert.equal((await queue.enqueue({ sample: sampleAt(NOW), scope: { tripId: '', userId: 'u' } })).reason, 'bad-scope');
  assert.equal((await queue.enqueue({ sample: sampleAt(NOW, { latitude: 200 }), scope })).reason, 'bad-sample:bad-latitude');
  const counts = await queue.counts();
  assert.equal(counts.enqueued, 0);
  assert.equal(counts.retained, 0);
});

test('enqueue drops expired and future-dated captures with explicit counts', async () => {
  const queue = await open();
  const expired = await queue.enqueue({ sample: sampleAt(NOW - QUEUE_LIMITS.captureWindowMs - 1), scope });
  assert.equal(expired.reason, 'capture-out-of-bounds');
  const future = await queue.enqueue({ sample: sampleAt(NOW + QUEUE_LIMITS.futureSkewMs + 1), scope });
  assert.equal(future.reason, 'capture-out-of-bounds');
  const boundary = await queue.enqueue({ sample: sampleAt(NOW + QUEUE_LIMITS.futureSkewMs), scope });
  assert.equal(boundary.ok, true);
  const counts = await queue.counts();
  assert.equal(counts.droppedOutOfBounds, 2);
  assert.equal(counts.enqueued, 1);
});

test('enqueue dedupes the same capture timestamp within a trip', async () => {
  const queue = await open();
  assert.equal((await queue.enqueue({ sample: sampleAt(NOW - 500), scope })).ok, true);
  const dupe = await queue.enqueue({ sample: sampleAt(NOW - 500, { accuracy: 30 }), scope });
  assert.equal(dupe.reason, 'duplicate-capture');
  const sameTimeOtherTrip = await queue.enqueue({ sample: sampleAt(NOW - 500), scope: otherScope });
  assert.equal(sameTimeOtherTrip.ok, true);
  const counts = await queue.counts();
  assert.equal(counts.droppedDuplicate, 1);
  assert.equal(counts.enqueued, 2);
});

test('capacity overflow evicts the oldest pending record and counts it', async () => {
  const queue = await open(createMemoryStores(), { capacity: 2 });
  await queue.enqueue({ sample: sampleAt(NOW - 3000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope });
  const third = await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  assert.equal(third.ok, true);
  const counts = await queue.counts();
  assert.equal(counts.droppedOverflow, 1);
  assert.equal(counts.retained, 2);
  const batch = await queue.takeBatch({ ...scope, limit: 10 });
  assert.deepEqual(batch.map((r) => r.capturedAtMs), [NOW - 2000, NOW - 1000]);
});

test('takeBatch returns FIFO order, marks uploading, and drops aged-out records', async () => {
  const queue = await open();
  await queue.enqueue({ sample: sampleAt(NOW - 3000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope: otherScope });
  const batch = await queue.takeBatch({ ...scope, limit: QUEUE_LIMITS.batchMax });
  assert.equal(batch.length, 2);
  assert.deepEqual(batch.map((r) => r.capturedAtMs), [NOW - 3000, NOW - 2000]);
  assert.ok(batch.every((r) => r.state === 'uploading'));
  const secondTake = await queue.takeBatch({ ...scope, limit: QUEUE_LIMITS.batchMax });
  assert.equal(secondTake.length, 0);
});

test('takeBatch honors the server batch maximum slice', async () => {
  const queue = await open();
  for (let i = 0; i < 5; i += 1) await queue.enqueue({ sample: sampleAt(NOW - 5000 + i * 1000), scope });
  const batch = await queue.takeBatch({ ...scope, limit: 2 });
  assert.equal(batch.length, 2);
});

test('records that age out while queued are dropped at batch time, never sent', async () => {
  const stores = createMemoryStores();
  const oldClock = { nowMs: () => NOW - QUEUE_LIMITS.captureWindowMs + 60_000 };
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock: oldClock });
  await queue.enqueue({ sample: sampleAt(NOW - QUEUE_LIMITS.captureWindowMs - 10_000), scope });
  const later = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  const batch = await later.takeBatch({ ...scope, limit: 10 });
  assert.equal(batch.length, 0);
  const counts = await later.counts();
  assert.equal(counts.droppedOutOfBounds, 1);
  assert.equal(counts.retained, 0);
});

test('confirmUploaded deletes records and counts the receipt', async () => {
  const queue = await open();
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const batch = await queue.takeBatch({ ...scope, limit: 10 });
  await queue.confirmUploaded(batch);
  const counts = await queue.counts();
  assert.equal(counts.uploaded, 1);
  assert.equal(counts.retained, 0);
});

test('releaseBatch returns records to pending with attempts counted; countAttempt false for auth', async () => {
  const queue = await open();
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const batch = await queue.takeBatch({ ...scope, limit: 10 });
  await queue.releaseBatch(batch, 'network-error');
  let counts = await queue.counts();
  assert.equal(counts.pending, 1);
  let retaken = await queue.takeBatch({ ...scope, limit: 10 });
  assert.equal(retaken[0].attempts, 1);
  assert.equal(retaken[0].lastError, 'network-error');
  await queue.releaseBatch(retaken, 'auth-unavailable', { countAttempt: false });
  retaken = await queue.takeBatch({ ...scope, limit: 10 });
  assert.equal(retaken[0].attempts, 1);
  counts = await queue.counts();
  assert.equal(counts.failedRetained, 0);
});

test('markFailed retains records in failed state, out of the pending drain', async () => {
  const queue = await open();
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope });
  const batch = await queue.takeBatch({ ...scope, limit: 10 });
  await queue.markFailed(batch, 'http-500');
  const counts = await queue.counts();
  assert.equal(counts.failed, 1);
  assert.equal(counts.failedRetained, 1);
  assert.equal((await queue.takeBatch({ ...scope, limit: 10 })).length, 0);
  assert.equal((await queue.pendingScopes()).length, 0);
});

test('wipeScope deletes every retained record for the scope and blocks re-entry', async () => {
  const queue = await open();
  await queue.enqueue({ sample: sampleAt(NOW - 3000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope: otherScope });
  const wiped = await queue.wipeScope(scope);
  assert.equal(wiped, 2);
  assert.equal(queue.isScopeRevoked(scope), true);
  const reenqueue = await queue.enqueue({ sample: sampleAt(NOW - 500), scope });
  assert.equal(reenqueue.reason, 'scope-revoked');
  const counts = await queue.counts();
  assert.equal(counts.wipedByRevocation, 2);
  assert.equal(counts.retained, 1);
});

test('state survives reopen: records, counts and revoked scopes persist', async () => {
  const stores = createMemoryStores();
  const first = await open(stores);
  await first.enqueue({ sample: sampleAt(NOW - 1000), scope });
  await first.wipeScope(otherScope);
  const reopened = await open(stores);
  const counts = await reopened.counts();
  assert.equal(counts.enqueued, 1);
  assert.equal(counts.pending, 1);
  assert.equal(counts.wipedByRevocation, 0);
  assert.equal(reopened.isScopeRevoked(otherScope), true);
});

test('records left uploading by an interrupted page recover to pending once', async () => {
  const stores = createMemoryStores();
  const first = await open(stores);
  await first.enqueue({ sample: sampleAt(NOW - 1000), scope });
  await first.takeBatch({ ...scope, limit: 10 });
  const reopened = await open(stores);
  const counts = await reopened.counts();
  assert.equal(counts.pending, 1);
  assert.equal(counts.uploading, 0);
  assert.equal(counts.recoveredAfterInterruption, 1);
  const batch = await reopened.takeBatch({ ...scope, limit: 10 });
  assert.equal(batch.length, 1);
});

test('pendingScopes aggregates by trip and user', async () => {
  const queue = await open();
  await queue.enqueue({ sample: sampleAt(NOW - 3000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 2000), scope });
  await queue.enqueue({ sample: sampleAt(NOW - 1000), scope: otherScope });
  const scopes = await queue.pendingScopes();
  assert.equal(scopes.length, 2);
  const mine = scopes.find((s) => s.tripId === 'trip-1');
  assert.equal(mine.pending, 2);
});
