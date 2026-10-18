// Only adapt the existing trace to the candidate's newly persisted intent shape.
// Keep every original scenario/assertion unchanged; no queue behavior is supplied.
import assert from 'node:assert/strict';
import { collectQueueTrace as priorCollector } from './queue-9b53b74.mjs';
import { fixture } from './queue-0b1e7e6.mjs';
import { jsonResponse } from '../scripted-transport.mjs';

export async function collectQueueTrace(args) {
  if (!['ambiguous-restart', 'wrong-ack'].includes(args.scenario.id)) return priorCollector(args);
  const f = await fixture();
  const retained = async () => (await f.stores.records.getAll()).filter(r => r.state !== 'failed').map(record => ({
    eventId: record.provenance.eventId, sessionId: record.provenance.sessionId,
    sequence: Number(record.provenance.eventId.split(':').at(-1)), tripId: record.tripId,
    sourceAtMs: Date.parse(record.sample.capturedAt), latitude: record.sample.latitude,
    longitude: record.sample.longitude, accuracy: record.sample.accuracy,
  }));
  try {
    await f.enqueue();
    if (args.scenario.id === 'wrong-ack') {
      f.behavior.response = async () => jsonResponse({ id: f.inputs.scopeB.tripId, received: 1 });
      await f.uploader.flush({ userId: f.inputs.scopeA.userId });
      // An unacknowledged uploading record is retained work, just like pending.
      return { scenario: args.scenario.id, after: { pending: await retained(),
        acceptedCount: (await f.queue.counts()).uploaded,
        outcome: (await f.uploader.state()).lastReceipt ? 'accepted' : 'protocol-error' } };
    }
    f.behavior.response = async () => { throw new TypeError('SYNTHETIC lost response'); };
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const first = { requests: structuredClone(f.requests), outcome: 'ambiguous', pending: await retained() };
    f.uploader.stop(); const reopened = await f.open();
    const actual = reopened.stickyIntent(f.inputs.scopeA);
    assert.ok(actual, 'candidate did not retain an intent');
    const persisted = Object.values((await f.stores.meta.get('meta')).stickyIntents);
    assert.equal(persisted.length, 1); assert.deepEqual(actual, persisted[0]);
    const intent = { key: actual.key, body: { observations: actual.samples },
      userId: actual.userId, tripId: actual.tripId,
      // This label identifies the review scenario, not a persisted auth field.
      // The real queue's authorization scope is userId + tripId only. Its key,
      // samples and both scope fields above all come from actual durable meta.
      sessionId: args.inputs.scopeA.sessionId };
    const previous = f.requests.length, next = f.uploaderFor(reopened);
    try {
      f.behavior.response = async r => jsonResponse({ id: r.tripId, received: r.body.observations.length });
      await next.flush({ userId: f.inputs.scopeA.userId });
    } finally { next.stop(); }
    return { scenario: args.scenario.id, first, afterRestart: { intent },
      replayRequests: f.requests.slice(previous), after: { pending: await retained() } };
  } finally { f.uploader.stop(); }
}
