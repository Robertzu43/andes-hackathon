// Reviewer binding for PR66 0b1e7e6. No author tests or queue behavior are copied.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoryStore, deferred, jsonResponse } from '../scripted-transport.mjs';
import { queueInputs, wireSample } from '../queue-probes.mjs';

const root = process.env.ANDES_REVIEW_QUEUE_ROOT;
if (!root) throw new TypeError('An exact archived queue candidate is required');
export const candidate = await import(pathToFileURL(resolve(root, 'web/src/lib/observations/index.mjs')).href);
export const inertTimers = { setTimeout: () => 1, clearTimeout() {} };

function collection() {
  const store = memoryStore();
  return { ...store, async getAll() { return (await store.entries()).map(([, value]) => value); },
    async count() { return (await store.entries()).length; } };
}

export async function fixture(options = {}) {
  const inputs = queueInputs();
  const stores = { records: collection(), meta: collection() };
  const open = () => candidate.openObservationQueue({ ...stores, capacity: options.capacity ?? 3,
    clock: { nowMs: () => inputs.nowMs } });
  const queue = await open();
  const requests = [];
  const behavior = { token: async () => 'SYNTHETIC-TOKEN-A',
    response: async request => jsonResponse({ id: request.tripId, received: request.body.observations.length }) };
  function uploaderFor(selectedQueue = queue) {
    return candidate.createLocationUploader({ queue: selectedQueue, baseUrl: 'https://andes.synthetic.invalid',
      timers: inertTimers, getAccessToken: () => behavior.token(), fetchImpl: async (url, init) => {
        const parsed = new URL(url);
        if (parsed.origin !== 'https://andes.synthetic.invalid') throw new Error('Unexpected origin');
        const tripId = parsed.pathname.split('/')[3];
        const headers = new Headers(init.headers);
        const request = { path: parsed.pathname, tripId,
          userId: headers.get('authorization') === 'Bearer SYNTHETIC-TOKEN-B' ? inputs.scopeB.userId : inputs.scopeA.userId,
          key: headers.get('idempotency-key'), body: JSON.parse(init.body) };
        requests.push(request);
        return behavior.response(request);
      } });
  }
  const uploader = uploaderFor();
  const pipeline = candidate.createObservationPipeline({ queue, uploader, ownerSubject: inputs.scopeA.userId });
  const enqueue = (sample = inputs.samples[0], scope = inputs.scopeA, target = queue) => target.enqueue({
    sample: wireSample(sample), scope,
    provenance: { eventId: sample.eventId, sessionId: sample.sessionId, requestId: sample.requestId },
  });
  function normalized(record) {
    return { eventId: record.provenance.eventId, sessionId: record.provenance.sessionId,
      // Sequence is fixture-label metadata encoded in the supplied event ID.
      sequence: Number(record.provenance.eventId.split(':').at(-1)),
      tripId: record.tripId, sourceAtMs: Date.parse(record.sample.capturedAt),
      latitude: record.sample.latitude, longitude: record.sample.longitude, accuracy: record.sample.accuracy };
  }
  const pending = async scope => (await stores.records.getAll()).filter(r =>
    r.state === 'pending' && (!scope || r.tripId === scope.tripId && r.userId === scope.userId)).map(normalized);
  return { inputs, stores, open, queue, uploader, uploaderFor, pipeline, requests, behavior, enqueue, pending };
}

export async function collectQueueTrace({ scenario }) {
  const f = await fixture();
  const { inputs: input, queue, uploader, stores, requests } = f;
  const trace = { scenario: scenario.id };
  try {
    switch (scenario.id) {
      case 'source-time':
        await f.enqueue(); await uploader.flush({ userId: input.scopeA.userId });
        return { ...trace, requests, after: { acceptedCount: (await queue.counts()).uploaded } };
      case 'capacity':
        for (const sample of input.samples) await f.enqueue(sample);
        return { ...trace, after: { pending: await f.pending(), dropped: (await queue.counts()).droppedOverflow } };
      case 'restart': {
        await f.enqueue(); const before = { pending: await f.pending() };
        await f.open();
        return { ...trace, before, after: { pending: await f.pending() } };
      }
      case 'ambiguous-restart': {
        await f.enqueue(); f.behavior.response = async () => { throw new TypeError('SYNTHETIC lost response'); };
        await uploader.flush({ userId: input.scopeA.userId });
        const first = { requests: structuredClone(requests), outcome: 'ambiguous', pending: await f.pending() };
        uploader.stop(); const reopened = await f.open();
        // The candidate persists records/counts, but no batch descriptor/key.
        // Report that absence, rather than reconstructing the missing intent.
        const persisted = (await stores.meta.getAll()).find(m => m.intent)?.intent ?? null;
        const next = f.uploaderFor(reopened); const previousCount = requests.length;
        f.behavior.response = async r => jsonResponse({ id: r.tripId, received: r.body.observations.length });
        await next.flush({ userId: input.scopeA.userId }); next.stop();
        return { ...trace, first, afterRestart: { intent: persisted },
          replayRequests: requests.slice(previousCount), after: { pending: await f.pending() } };
      }
      case 'wrong-ack': {
        await f.enqueue();
        f.behavior.response = async () => jsonResponse({ id: input.scopeB.tripId, received: 1 });
        await uploader.flush({ userId: input.scopeA.userId });
        return { ...trace, after: { pending: await f.pending(), acceptedCount: (await queue.counts()).uploaded,
          outcome: (await uploader.state()).lastReceipt ? 'accepted' : 'protocol-error' } };
      }
      case 'scope-switch':
        await f.enqueue(); await f.enqueue(input.sampleB, input.scopeB);
        f.behavior.token = async () => 'SYNTHETIC-TOKEN-B';
        await uploader.flush({ userId: input.scopeB.userId });
        return { ...trace, requests, after: { pending: await f.pending(input.scopeB) } };
      case 'stop-revocation': {
        await f.enqueue(); const reached = deferred(), reply = deferred();
        f.behavior.response = async () => { reached.resolve(); return reply.promise; };
        const flushing = uploader.flush({ userId: input.scopeA.userId }); await reached.promise;
        await f.pipeline.revokeTrip(input.scopeA.tripId); await f.pipeline.stop();
        const requestCount = requests.length;
        reply.resolve(jsonResponse({ id: input.scopeA.tripId, received: 1 })); await flushing;
        await f.enqueue(); await uploader.flush({ userId: input.scopeA.userId });
        return { ...trace, requestsAfterStop: requests.slice(requestCount),
          after: { stopped: (await uploader.state()).pumpState === 'stopped' } };
      }
      case 'signout':
        // No signout/owner-retirement operation exists in these public exports.
        // Clearing the stores here would implement missing candidate behavior.
        throw new TypeError('Candidate exposes no signout retirement boundary');
      case 'retention':
        await f.enqueue(); await f.enqueue(input.expired);
        await uploader.flush({ userId: input.scopeA.userId });
        return { ...trace, requests, after: { dropped: (await queue.counts()).droppedOutOfBounds } };
      case 'storage-unavailable': {
        const opened = await candidate.openObservationStores({ idbFactory: null });
        return { ...trace, after: { storageStatus: opened.ok ? 'available' : 'unavailable', durable: opened.ok } };
      }
      default: throw new TypeError('Unknown reviewer scenario');
    }
  } finally { uploader.stop(); }
}
