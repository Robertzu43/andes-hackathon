// Additional timing/restart/privacy paths for the same original acceptance rules.
// The original seven queue-races assertions remain unchanged.
import assert from 'node:assert/strict';
import { fixture } from './drivers/queue-0b1e7e6.mjs';
import { deferred, jsonResponse } from './scripted-transport.mjs';

const probes = [
  ...['stop', 'revoke'].map(transition => ({ id: `retirement:${transition}-during-final-record-read`, async run(f) {
    await f.enqueue(); const reached = deferred(), release = deferred();
    const get = f.stores.records.get.bind(f.stores.records);
    let held = false;
    f.stores.records.get = async key => {
      const value = await get(key);
      if (!held) { held = true; reached.resolve(); await release.promise; }
      return value;
    };
    const flushing = f.uploader.flush({ userId: f.inputs.scopeA.userId }); await reached.promise;
    if (transition === 'stop') await f.pipeline.stop();
    else await f.pipeline.revokeTrip(f.inputs.scopeA.tripId);
    const before = f.requests.length; release.resolve(); await flushing;
    f.actual = { requestsBeforeRetirementFinished: before, newRequestsAfterRetirement: f.requests.length - before,
      revoked: f.queue.isScopeRevoked(f.inputs.scopeA), pumpState: (await f.uploader.state()).pumpState };
    assert.equal(f.requests.length, before, 'a final asynchronous store read outlived retirement and started a new POST');
  } })),
  { id: 'intent:restart-plus-new-capture-preserves-original-key-and-body', async run(f) {
    await f.enqueue(); f.behavior.response = async () => { throw new TypeError('SYNTHETIC lost response'); };
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const original = structuredClone(f.requests[0]); f.uploader.stop();
    const reopened = await f.open(); await f.enqueue(f.inputs.samples[1], f.inputs.scopeA, reopened);
    const next = f.uploaderFor(reopened);
    try {
      f.behavior.response = async request => jsonResponse({ id: request.tripId, received: request.body.observations.length });
      await next.flush({ userId: f.inputs.scopeA.userId });
      f.actual = { firstBatchSize: original.body.observations.length, replayBatchSize: f.requests[1]?.body.observations.length,
        sameKey: f.requests[1]?.key === original.key, persistedMeta: await f.stores.meta.getAll() };
      assert.equal(f.requests[1].key, original.key); assert.deepEqual(f.requests[1].body, original.body);
    } finally { next.stop(); }
  } },
  { id: 'intent:malformed-success-keeps-the-original-ambiguous-request', async run(f) {
    await f.enqueue(); f.behavior.response = async () => new Response('{', { status: 200 });
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const original = structuredClone(f.requests[0]); await f.enqueue(f.inputs.samples[1]);
    f.behavior.response = async request => jsonResponse({ id: request.tripId, received: request.body.observations.length });
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    f.actual = { firstBatchSize: original.body.observations.length, replayBatchSize: f.requests[1]?.body.observations.length,
      sameKey: f.requests[1]?.key === original.key };
    assert.equal(f.requests[1].key, original.key); assert.deepEqual(f.requests[1].body, original.body);
  } },
  { id: 'signout:held-completion-cannot-restore-old-receipt-or-retain-owner-metadata', async run(f) {
    await f.enqueue(); const reached = deferred(), reply = deferred();
    f.behavior.response = () => { reached.resolve(); return reply.promise; };
    const flushing = f.uploader.flush({ userId: f.inputs.scopeA.userId }); await reached.promise;
    await f.pipeline.signOut();
    reply.resolve(jsonResponse({ id: f.inputs.scopeA.tripId, received: 1 })); await flushing;
    const state = await f.uploader.state();
    const persisted = JSON.stringify([await f.stores.records.getAll(), await f.stores.meta.getAll()]);
    f.actual = { retained: state.counts.retained, cachedReceiptTrip: state.lastReceipt?.tripId ?? null,
      persistedOldOwner: persisted.includes(f.inputs.scopeA.userId), persistedOldTrip: persisted.includes(f.inputs.scopeA.tripId) };
    assert.equal(state.lastReceipt, null, 'an old completion recreated a prior-session receipt after signout');
    assert.equal(f.actual.persistedOldOwner, false); assert.equal(f.actual.persistedOldTrip, false);
  } },
];
const checks = [];
for (const probe of probes) {
  const f = await fixture();
  let timer;
  try {
    await Promise.race([probe.run(f), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Reviewer probe timed out')), 2000);
    })]);
    checks.push({ id: probe.id, passed: true });
  }
  catch { checks.push({ id: probe.id, passed: false, ...(f.actual ? { actual: f.actual } : {}) }); }
  finally { clearTimeout(timer); f.uploader.stop(); }
}
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({ passed, checks, limitation:
  'Frozen public queue/store/transport seams with independent scheduling, restart and privacy cases; no product UI or provider qualification.' }, null, 2));
process.exitCode = passed ? 0 : 1;
