// Assertions over reviewer-collected candidate traces. A trace is not self-authenticating.
import assert from 'node:assert/strict';
import { IDS, NOW, clone, locationSample } from './fixtures.mjs';

export const queueScenarios = Object.freeze([
  { id: 'source-time', actions: ['enqueue old sample', 'advance receipt clock', 'flush once'] },
  { id: 'capacity', actions: ['configure capacity 3', 'enqueue five unique valid samples', 'inspect without upload'] },
  { id: 'restart', actions: ['enqueue', 'close without signout', 'recreate over same store and scope', 'inspect'] },
  { id: 'ambiguous-restart', actions: ['enqueue', 'lose upload response', 'inspect retained intent', 'restart', 'explicit reconcile/replay'] },
  { id: 'wrong-ack', actions: ['enqueue', 'return upload acknowledgement for other trip', 'inspect retained work'] },
  { id: 'scope-switch', actions: ['enqueue as A/trip1', 'open B/trip2', 'enqueue B sample', 'flush current scope'] },
  { id: 'stop-revocation', actions: ['start one held upload', 'stop/revoke', 'release old reply', 'try enqueue/flush'] },
  { id: 'signout', actions: ['enqueue A sample', 'start held upload', 'sign out', 'release reply', 'inspect memory and store'] },
  { id: 'retention', actions: ['configure 24h retention', 'enqueue recent and 25h old samples', 'flush or prune'] },
  { id: 'storage-unavailable', actions: ['make persistent store reject writes', 'enqueue', 'inspect visible durability state'] },
]);

export const queueInputs = () => ({
  scopeA: { userId: IDS.driver, tripId: IDS.trip, sessionId: 'synthetic-A' },
  scopeB: { userId: IDS.otherDriver, tripId: IDS.otherTrip, sessionId: 'synthetic-B' },
  capacity: 3, retentionMs: 86_400_000, nowMs: NOW,
  samples: Array.from({ length: 5 }, (_, i) => locationSample(i + 1)),
  sampleB: locationSample(9, { tripId: IDS.otherTrip, sessionId: 'synthetic-B' }),
  expired: locationSample(10, { sourceAtMs: NOW - 90_000_000 }),
});

export function wireSample(sample) {
  return { capturedAt: new Date(sample.sourceAtMs).toISOString(), latitude: sample.latitude,
    longitude: sample.longitude, accuracy: sample.accuracy };
}

function array(value) { assert.ok(Array.isArray(value), 'missing trace array'); return value; }
function pending(trace) { return array(trace.after?.pending); }
function requestFor(request, scope, samples) {
  assert.equal(request.userId, scope.userId);
  assert.equal(request.tripId, scope.tripId);
  assert.equal(request.path, `/v1/trips/${scope.tripId}/locations`);
  assert.match(request.key, /^[\x21-\x7e]{1,128}$/);
  assert.deepEqual(request.body, { observations: samples.map(wireSample) });
}

export function assertQueueTrace(id, trace) {
  const input = queueInputs();
  const sample = input.samples[0];
  assert.equal(trace.scenario, id);
  switch (id) {
    case 'source-time':
      assert.equal(array(trace.requests).length, 1);
      requestFor(trace.requests[0], input.scopeA, [sample]);
      assert.equal(trace.after.acceptedCount, 1);
      assert.notEqual(trace.requests[0].body.observations[0].capturedAt, new Date(NOW).toISOString());
      break;
    case 'capacity': {
      const kept = pending(trace);
      assert.equal(kept.length, input.capacity);
      assert.equal(trace.after.dropped, input.samples.length - input.capacity);
      assert.equal(new Set(kept.map(s => s.eventId)).size, kept.length);
      for (const item of kept) assert.deepEqual(item, input.samples.find(s => s.eventId === item.eventId));
      break;
    }
    case 'restart':
      assert.deepEqual(array(trace.before?.pending), [sample]);
      assert.deepEqual(pending(trace), [sample]);
      break;
    case 'ambiguous-restart': {
      assert.equal(array(trace.first?.requests).length, 1, 'first flush automatically replayed a write');
      const first = trace.first.requests[0];
      requestFor(first, input.scopeA, [sample]);
      assert.equal(trace.first.outcome, 'ambiguous');
      assert.deepEqual(array(trace.first.pending), [sample]);
      assert.deepEqual(trace.afterRestart.intent, { key: first.key, body: first.body, ...input.scopeA });
      const replay = array(trace.replayRequests);
      assert.ok(replay.length <= 1);
      for (const attempt of replay) {
        requestFor(attempt, input.scopeA, [sample]);
        assert.equal(attempt.key, first.key, 'reconciliation changed the idempotency scope');
      }
      if (!replay.length) {
        assert.equal(trace.after.outcome, 'ambiguous');
        assert.deepEqual(pending(trace), [sample]);
      }
      break;
    }
    case 'wrong-ack':
      assert.deepEqual(pending(trace), [sample]);
      assert.notEqual(trace.after.acceptedCount, 1, 'wrong-trip ACK discarded another scope');
      assert.ok(['rejected', 'ambiguous', 'protocol-error'].includes(trace.after.outcome));
      break;
    case 'scope-switch':
      assert.equal(array(trace.requests).length, 1);
      requestFor(trace.requests[0], input.scopeB, [input.sampleB]);
      for (const item of pending(trace)) assert.equal(item.tripId, input.scopeB.tripId);
      break;
    case 'stop-revocation':
      assert.equal(array(trace.requestsAfterStop).length, 0);
      assert.equal(trace.after.stopped, true);
      break;
    case 'signout': {
      assert.deepEqual(pending(trace), []);
      assert.equal(trace.after.intent, null);
      const retained = JSON.stringify([trace.after, array(trace.persistedEntries)]);
      for (const secret of [IDS.driver, IDS.trip, sample.eventId, 'SYNTHETIC-TOKEN-A']) {
        assert.ok(!retained.includes(secret), 'prior identity/location remains after signout or late completion');
      }
      break;
    }
    case 'retention':
      assert.equal(trace.after.dropped, 1);
      assert.equal(array(trace.requests).length, 1);
      requestFor(trace.requests[0], input.scopeA, [sample]);
      break;
    case 'storage-unavailable':
      assert.equal(trace.after.storageStatus, 'unavailable');
      assert.equal(trace.after.durable, false, 'failed persistence was reported as durable');
      break;
    default: throw new RangeError('Unknown reviewer queue scenario');
  }
}

export async function runQueueProbes(collectTrace, { timeoutMs = 2000 } = {}) {
  if (typeof collectTrace !== 'function') throw new TypeError('A reviewer-bound trace collector is required');
  const results = [];
  for (const scenario of queueScenarios) {
    let timer;
    try {
      const trace = await Promise.race([
        collectTrace({ scenario: clone(scenario), inputs: queueInputs() }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Queue probe timed out')), timeoutMs); }),
      ]);
      assertQueueTrace(scenario.id, trace);
      results.push({ id: scenario.id, passed: true });
    } catch {
      results.push({ id: scenario.id, passed: false });
    } finally { clearTimeout(timer); }
  }
  return results;
}
