// New public signOut binding and retained uploading-state projection only.
// Original scenario assertions are unchanged; no missing intent/cleanup is added.
import { collectQueueTrace as priorCollector, fixture } from './queue-0b1e7e6.mjs';
import { deferred, jsonResponse } from '../scripted-transport.mjs';

function sample(record) {
  return { eventId: record.provenance.eventId, sessionId: record.provenance.sessionId,
    sequence: Number(record.provenance.eventId.split(':').at(-1)), tripId: record.tripId,
    sourceAtMs: Date.parse(record.sample.capturedAt), latitude: record.sample.latitude,
    longitude: record.sample.longitude, accuracy: record.sample.accuracy };
}
export async function collectQueueTrace(args) {
  const id = args.scenario.id;
  if (!['ambiguous-restart', 'signout'].includes(id)) return priorCollector(args);
  const f = await fixture();
  const retained = async () => (await f.stores.records.getAll()).filter(r => r.state !== 'failed').map(sample);
  try {
    await f.enqueue();
    if (id === 'signout') {
      const reached = deferred(), reply = deferred();
      f.behavior.response = () => { reached.resolve(); return reply.promise; };
      const flushing = f.uploader.flush({ userId: f.inputs.scopeA.userId }); await reached.promise;
      await f.pipeline.signOut();
      reply.resolve(jsonResponse({ id: f.inputs.scopeA.tripId, received: 1 })); await flushing;
      return { scenario: id, after: { pending: await retained(), intent: null, uploader: await f.uploader.state() },
        persistedEntries: [...await f.stores.records.entries(), ...await f.stores.meta.entries()] };
    }
    f.behavior.response = async () => { throw new TypeError('SYNTHETIC lost response'); };
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const first = { requests: structuredClone(f.requests), outcome: 'ambiguous', pending: await retained() };
    f.uploader.stop(); const reopened = await f.open();
    const intent = (await f.stores.meta.getAll()).find(m => m.intent)?.intent ?? null;
    const previous = f.requests.length; const next = f.uploaderFor(reopened);
    try {
      f.behavior.response = async r => jsonResponse({ id: r.tripId, received: r.body.observations.length });
      await next.flush({ userId: f.inputs.scopeA.userId });
    } finally { next.stop(); }
    return { scenario: id, first, afterRestart: { intent }, replayRequests: f.requests.slice(previous),
      after: { pending: await retained() } };
  } finally { f.uploader.stop(); }
}
