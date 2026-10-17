import test from 'node:test';
import assert from 'node:assert/strict';
import { openObservationQueue } from '../../src/lib/observations/queue.mjs';
import { createLocationUploader } from '../../src/lib/observations/upload.mjs';
import { createObservationPipeline } from '../../src/lib/observations/pipeline.mjs';
import { createMemoryStores } from './memory-store.mjs';

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

async function setup({ fetchImpl = null } = {}) {
  const stores = createMemoryStores();
  const queue = await openObservationQueue({ records: stores.records, meta: stores.meta, clock });
  const calls = [];
  const fetch = fetchImpl ?? (async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { status: 200, body: { id: 'trip-1', received: 1 }, json: async () => ({ id: 'trip-1', received: 1 }) };
  });
  const uploader = createLocationUploader({
    queue,
    baseUrl: 'https://api.example.com',
    getAccessToken: async () => 'test-token',
    fetchImpl: fetch,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
  });
  const pipeline = createObservationPipeline({ queue, uploader, ownerSubject: 'user-1' });
  return { queue, uploader, pipeline, calls };
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

test('motion, permission and lifecycle events have no server route and are counted, not queued', async () => {
  const { pipeline, calls } = await setup();
  for (const type of ['motion', 'permission', 'session-start', 'session-stop', 'acquisition-request']) {
    pipeline.sink(geoEvent({ type, data: {} }));
  }
  await pipeline.flush();
  assert.equal(calls.length, 0);
  const counts = await pipeline.counts();
  assert.equal(counts.boundary.unmappedNoRoute, 5);
  assert.equal(counts.queue.retained, 0);
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
