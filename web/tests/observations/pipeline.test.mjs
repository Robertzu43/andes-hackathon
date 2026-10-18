import test from 'node:test';
import assert from 'node:assert/strict';
import { openObservationQueue } from '../../src/lib/observations/queue.mjs';
import { createLocationUploader } from '../../src/lib/observations/upload.mjs';
import { createObservationPipeline } from '../../src/lib/observations/pipeline.mjs';
import { createMemoryStores, tokenFor } from './memory-store.mjs';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const clock = { nowMs: () => NOW };
const SOURCE_MS = NOW - 5_000; // phone-captured 5s before receipt
const RECEIPT_MS = NOW - 4_000;

const geoEvent = (overrides = {}) => ({
  schema: 'andes.phone-observations.provisional/1',
  category: 'phone-observation',
  type: 'geolocation',
  eventId: 'session-1:1:3',
  sessionId: 'session-1',
  tripId: 'trip-1',
  sourceTime: { value: SOURCE_MS, basis: 'unix-epoch-ms', provenance: 'position.timestamp' },
  clientReceiptTime: { wallMs: RECEIPT_MS, monoMs: 12_000 },
  data: {
    requestId: '1:geo:1',
    watch: false,
    accuracyM: 14,
    coordinates: { latitude: -33.4489, longitude: -70.6693 },
    redaction: 'explicit-consent-and-purpose',
    ...overrides.data,
  },
  ...overrides,
});

async function setup({ fetchImpl = null, stores = createMemoryStores() } = {}) {
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  const calls = [];
  const fetch = fetchImpl ?? (async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { status: 200, body: { id: 'trip-1', received: 1 }, json: async () => ({ id: 'trip-1', received: 1 }) };
  });
  const uploader = createLocationUploader({
    queue,
    baseUrl: 'https://api.example.com',
    getAccessToken: async () => tokenFor('user-1'),
    fetchImpl: fetch,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const pipeline = createObservationPipeline({ queue, uploader, ownerSubject: 'user-1' });
  return { queue, uploader, pipeline, calls, stores };
}

test('consented geolocation maps to the wire sample with the SOURCE timestamp preserved', async () => {
  const { pipeline, calls } = await setup();
  const returned = pipeline.sink(geoEvent());
  assert.equal(returned, undefined, 'sink is synchronous and returns no thenable');
  await pipeline.flush();
  assert.equal(calls.length, 1);
  const observation = calls[0].body.observations[0];
  assert.equal(observation.capturedAt, new Date(SOURCE_MS).toISOString(), 'capturedAt comes from position.timestamp, never client receipt');
  assert.equal(observation.latitude, -33.4489);
  assert.equal(observation.longitude, -70.6693);
  assert.equal(observation.accuracy, 14);
  assert.deepEqual(Object.keys(observation).sort(), ['accuracy', 'capturedAt', 'latitude', 'longitude']);
  const counts = await pipeline.counts();
  assert.equal(counts.boundary.persisted, 1);
  assert.equal(counts.queue.uploaded, 1);
});

test('redacted geolocation (no consent coordinates) never enters the queue', async () => {
  const { pipeline, calls } = await setup();
  pipeline.sink(geoEvent({ data: { requestId: '1:geo:1', accuracyM: 14, coordinates: null, redaction: 'omitted' } }));
  await pipeline.flush();
  assert.equal(calls.length, 0);
  const counts = await pipeline.counts();
  assert.equal(counts.boundary.droppedNoCoordinates, 1);
  assert.equal(counts.queue.retained, 0);
});

test('geolocation without accuracy cannot upload: server requires it', async () => {
  const { pipeline, calls } = await setup();
  pipeline.sink(geoEvent({ data: { requestId: '1:geo:1', accuracyM: null, coordinates: { latitude: -33.45, longitude: -70.66 } } }));
  await pipeline.flush();
  assert.equal(calls.length, 0);
  assert.equal((await pipeline.counts()).boundary.droppedMissingAccuracy, 1);
});

test('geolocation without a unix-epoch source time is dropped at the boundary', async () => {
  const { pipeline, calls } = await setup();
  pipeline.sink(geoEvent({ sourceTime: { value: null, basis: 'unix-epoch-ms', provenance: 'position.timestamp' } }));
  await pipeline.flush();
  assert.equal(calls.length, 0);
  assert.equal((await pipeline.counts()).boundary.droppedBadSourceTime, 1);
});

test('motion, permission and other non-lifecycle events have no server route and are counted, not queued', async () => {
  const { pipeline, calls } = await setup();
  for (const type of ['motion', 'permission', 'acquisition-request', 'geolocation-error']) {
    pipeline.sink(geoEvent({ type, data: {} }));
  }
  await pipeline.flush();
  assert.equal(calls.length, 0);
  const counts = await pipeline.counts();
  assert.equal(counts.boundary.unmappedNoRoute, 4);
  assert.equal(counts.queue.retained, 0);
});

test('session lifecycle events are local intent: observed, never uploaded, never a delivery claim', async () => {
  const { pipeline, calls } = await setup();
  pipeline.sink(geoEvent({ type: 'session-start', data: { streamsDisabledUntilExplicitAcquisition: true } }));
  pipeline.sink(geoEvent());
  await pipeline.drain();
  pipeline.sink(geoEvent({
    type: 'session-stop',
    data: { reason: 'explicit-stop', sharingState: 'stopped', resumable: false },
  }));
  await pipeline.flush();
  const status = await pipeline.tripStatus('trip-1');
  assert.equal(status.lifecycle.intent, 'stopped');
  assert.equal(status.lifecycle.reason, 'explicit-stop');
  assert.equal(status.lifecycle.sharingState, 'stopped');
  assert.equal(status.lifecycle.resumable, false);
  assert.equal(status.queue.unsent, 0, 'the sample uploaded; unsent reflects occupancy only');
  const counts = await pipeline.counts();
  assert.equal(counts.boundary.lifecycleObserved, 2);
  assert.equal(counts.boundary.unmappedNoRoute, 0);
  assert.equal(calls.length, 1, 'only the location sample hit the wire — nothing POSTed for stop intent');
  assert.equal(counts.lifecycle['trip-1'].intent, 'stopped');
});

test('foreign schemas are ignored and counted', async () => {
  const { pipeline } = await setup();
  pipeline.sink({ schema: 'something-else/1', type: 'geolocation', data: {} });
  pipeline.sink(null);
  const counts = await pipeline.counts();
  assert.equal(counts.boundary.unmappedSchema, 2);
  assert.equal(counts.boundary.received, 2);
});

test('sink never throws and never returns a thenable, per the adapter contract', async () => {
  const { pipeline } = await setup();
  for (const bad of [undefined, 42, 'x', {}, geoEvent()]) {
    const result = pipeline.sink(bad);
    assert.equal(result, undefined);
    assert.equal(typeof result?.then, 'undefined');
  }
});

test('queue rejection at drain is counted as enqueueRejected, not thrown', async () => {
  const { pipeline, queue } = await setup();
  await queue.wipeScope({ tripId: 'trip-1', userId: 'user-1' });
  pipeline.sink(geoEvent());
  await pipeline.drain();
  const counts = await pipeline.counts();
  assert.equal(counts.boundary.enqueueRejected, 1);
  assert.equal(counts.boundary.persisted, 0);
});

test('revokeTrip wipes queued records for the trip and blocks re-entry', async () => {
  const { pipeline, queue } = await setup();
  pipeline.sink(geoEvent());
  await pipeline.drain();
  const wiped = await pipeline.revokeTrip('trip-1');
  assert.equal(wiped, 1);
  pipeline.sink(geoEvent({ eventId: 'session-1:1:4', sourceTime: { value: SOURCE_MS + 1000, basis: 'unix-epoch-ms', provenance: 'position.timestamp' } }));
  await pipeline.drain();
  const counts = await queue.counts();
  assert.equal(counts.retained, 0);
  assert.equal(counts.wipedByRevocation, 1);
});

test('flush uploads only after the staged events are persisted', async () => {
  const { pipeline, calls } = await setup();
  pipeline.sink(geoEvent());
  pipeline.sink(geoEvent({
    eventId: 'session-1:1:4',
    sourceTime: { value: SOURCE_MS + 1000, basis: 'unix-epoch-ms', provenance: 'position.timestamp' },
    data: { requestId: '1:geo:1', accuracyM: 9, coordinates: { latitude: -33.44, longitude: -70.65 } },
  }));
  await pipeline.flush();
  assert.equal(calls.length, 1, 'both staged samples drain into one batch');
  assert.equal(calls[0].body.observations.length, 2);
});

test('stop drains staging best-effort and stops the uploader', async () => {
  const { pipeline, queue, calls } = await setup();
  pipeline.sink(geoEvent());
  await pipeline.stop();
  const counts = await queue.counts();
  assert.equal(counts.pending, 1, 'persisted locally; upload after stop is the host’s next-session concern');
  assert.equal(calls.length, 0);
});

test('signOut wipes every record for the owner, revokes scopes, stops the pump and clears intent', async () => {
  const { pipeline, queue, uploader } = await setup();
  pipeline.sink(geoEvent({ type: 'session-start', data: {} }));
  pipeline.sink(geoEvent());
  pipeline.sink(geoEvent({
    eventId: 'session-1:1:4',
    tripId: 'trip-2',
    sourceTime: { value: SOURCE_MS + 1000, basis: 'unix-epoch-ms', provenance: 'position.timestamp' },
    data: { requestId: '1:geo:1', accuracyM: 9, coordinates: { latitude: -33.44, longitude: -70.65 } },
  }));
  await pipeline.drain();
  assert.equal((await queue.counts()).retained, 2);
  const wiped = await pipeline.signOut();
  assert.equal(wiped, 2);
  const counts = await queue.counts();
  assert.equal(counts.retained, 0);
  assert.equal(counts.wipedBySignout, 2);
  assert.equal(queue.isScopeRevoked({ tripId: 'trip-1', userId: 'user-1' }), true);
  assert.equal(queue.isScopeRevoked({ tripId: 'trip-2', userId: 'user-1' }), true);
  assert.equal((await uploader.state()).pumpState, 'stopped');
  assert.deepEqual((await pipeline.counts()).lifecycle, {});
  pipeline.sink(geoEvent({ eventId: 'session-2:1:1' }));
  await pipeline.drain();
  assert.equal((await queue.counts()).retained, 0, 'nothing re-enters after sign-out');
});

test('signOut during an in-flight receipt: no receipt fact, no counts, no owner plaintext in durable meta', async () => {
  let resolveResponse;
  let fetchCalled;
  const called = new Promise((resolve) => { fetchCalled = resolve; });
  const fetch = async () => {
    fetchCalled();
    return new Promise((resolve) => { resolveResponse = resolve; });
  };
  const { pipeline, queue, uploader, stores } = await setup({ fetchImpl: fetch });
  pipeline.sink(geoEvent());
  await pipeline.drain();
  const flushing = pipeline.flush();
  await called; // the POST is on the wire, response pending
  const wiped = await pipeline.signOut();
  assert.equal(wiped, 1);
  resolveResponse({ status: 200, json: async () => ({ id: 'trip-1', received: 1 }) });
  await flushing;
  const counts = await queue.counts();
  assert.equal(counts.uploaded, 0, 'a receipt released after sign-out confirms nothing');
  assert.equal(counts.retained, 0);
  assert.equal((await uploader.state()).lastReceipt, null, 'no receipt fact is recreated after sign-out');
  const persisted = await stores.meta.get('meta');
  assert.deepEqual(persisted.revokedScopes ?? [], [], 'session revocation is not persisted — no owner/trip plaintext survives sign-out');
  const reopened = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  assert.equal((await reopened.counts()).retained, 0);
  assert.equal(reopened.isScopeRevoked({ tripId: 'trip-1', userId: 'user-1' }), false, 'session revocation dies with the page');
});

test('signOut with an in-flight REJECTED request recreates no durable intent and no plaintext', async () => {
  let rejectResponse;
  let fetchCalled;
  const called = new Promise((resolve) => { fetchCalled = resolve; });
  const fetch = async () => {
    fetchCalled();
    return new Promise((_, reject) => { rejectResponse = reject; });
  };
  const { pipeline, queue, uploader, stores } = await setup({ fetchImpl: fetch });
  pipeline.sink(geoEvent());
  await pipeline.drain();
  const flushing = pipeline.flush();
  await called; // the POST is on the wire
  const wiped = await pipeline.signOut();
  assert.equal(wiped, 1);
  rejectResponse(new TypeError('lost response')); // ambiguous rejection lands AFTER sign-out
  await flushing;
  const state = await uploader.state();
  assert.equal(state.unacknowledgedBatches, 0, 'no sticky intent is recreated after sign-out');
  assert.equal((await queue.counts()).retained, 0);
  const intents = (await stores.meta.getAll()).filter((entry) => entry.intent);
  assert.equal(intents.length, 0, 'no durable intent record survives sign-out');
  const persisted = JSON.stringify(await stores.meta.getAll());
  assert.equal(persisted.includes('user-1'), false, 'no owner plaintext in durable meta');
  assert.equal(persisted.includes('trip-1'), false, 'no trip plaintext in durable meta');
});

test('revokeTrip then signOut leaves no owner/trip plaintext tombstone in durable meta', async () => {
  const { pipeline, queue, stores } = await setup();
  pipeline.sink(geoEvent());
  await pipeline.drain();
  await pipeline.revokeTrip('trip-1'); // per-trip consent withdrawal: persisted by design
  assert.equal(queue.isScopeRevoked({ tripId: 'trip-1', userId: 'user-1' }), true);
  await pipeline.signOut();
  const persisted = JSON.stringify(await stores.meta.getAll());
  assert.equal(persisted.includes('user-1'), false, 'revocation tombstone is not stored as owner plaintext');
  assert.equal(persisted.includes('trip-1'), false, 'revocation tombstone is not stored as trip plaintext');
  const reopened = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  assert.equal(reopened.isScopeRevoked({ tripId: 'trip-1', userId: 'user-1' }), true,
    'consent revocation still survives restart — only the plaintext is gone');
});

// ---- Gatekeeper review of 170e83a: regression tests -------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const laterEvent = (offsetMs) => geoEvent({
  eventId: `session-1:1:${10 + offsetMs}`,
  sourceTime: { value: SOURCE_MS + offsetMs, basis: 'unix-epoch-ms', provenance: 'position.timestamp' },
});
const storedText = async (stores) => JSON.stringify([await stores.records.getAll(), await stores.meta.getAll()]);

test('item 2: signOut racing an in-flight 503 flush leaves no coordinates, no intent and sends nothing afterwards', async () => {
  for (let delay = 0; delay <= 30; delay += 2) {
    const stores = createMemoryStores({ delayMs: 2 });
    let signOutCalled = false;
    let postsAfterSignOut = 0;
    const fetch = async () => {
      if (signOutCalled) postsAfterSignOut += 1;
      await sleep(3);
      return { status: 503, json: async () => ({ code: 'internal_error' }) };
    };
    const { pipeline } = await setup({ fetchImpl: fetch, stores });
    pipeline.sink(geoEvent());
    pipeline.sink(laterEvent(1000));
    await pipeline.drain();
    const flushing = pipeline.flush().catch(() => {});
    await sleep(delay);
    signOutCalled = true;
    await pipeline.signOut();
    await flushing;
    await sleep(20); // let any straggling write land
    assert.equal(postsAfterSignOut, 0, `no POST starts after signOut() (delay ${delay})`);
    assert.equal((await stores.records.getAll()).length, 0, `no record survives signOut (delay ${delay})`);
    const text = await storedText(stores);
    assert.equal(text.includes('-33.4489'), false, `no coordinates in storage after signOut (delay ${delay})`);
    assert.equal(text.includes('user-1'), false, `no owner plaintext after signOut (delay ${delay})`);
  }
});

test('item 3: a sample reaching the sink while revokeTrip runs is not kept', async () => {
  const stores = createMemoryStores({ delayMs: 2 });
  const { pipeline } = await setup({ stores });
  pipeline.sink(geoEvent());
  await pipeline.drain();
  const revoking = pipeline.revokeTrip('trip-1');
  pipeline.sink(laterEvent(1000));
  await revoking;
  await pipeline.drain();
  const status = await pipeline.tripStatus('trip-1');
  assert.deepEqual(status.queue, { pending: 0, uploading: 0, failed: 0, unsent: 0, revoked: true });
  assert.equal((await stores.records.getAll()).length, 0, 'no coordinates stored for a revoked trip');
});

test('item 3: revoking during a flush leaves no pending coordinates', async () => {
  for (let delay = 0; delay <= 40; delay += 2) {
    const stores = createMemoryStores({ delayMs: 2 });
    const fetch = async () => {
      await sleep(3);
      return { status: 503, json: async () => ({ code: 'internal_error' }) };
    };
    const { pipeline } = await setup({ fetchImpl: fetch, stores });
    for (const offset of [0, 1000, 2000]) pipeline.sink(laterEvent(offset));
    await pipeline.drain();
    const flushing = pipeline.flush();
    await sleep(delay);
    await pipeline.revokeTrip('trip-1');
    await flushing;
    await sleep(20);
    assert.equal((await stores.records.getAll()).length, 0, `records are not re-created after the wipe (delay ${delay})`);
    assert.equal((await storedText(stores)).includes('-33.4489'), false, `no coordinates kept (delay ${delay})`);
  }
});

test('item 12: a far-future sourceTime is dropped at the boundary and never throws from the sink', async () => {
  const { pipeline } = await setup();
  const farFuture = geoEvent({ sourceTime: { value: 9e15, basis: 'unix-epoch-ms', provenance: 'position.timestamp' } });
  assert.doesNotThrow(() => pipeline.sink(farFuture));
  assert.equal((await pipeline.counts()).boundary.droppedBadSourceTime, 1);
});
