// Additional independently constructed scheduling/protocol cases for PR66.
import assert from 'node:assert/strict';
import { fixture } from './drivers/queue-0b1e7e6.mjs';
import { deferred, jsonResponse } from './scripted-transport.mjs';

const probes = [
  { id: 'positive:exact-receipt-removes-one-scoped-batch', async run(f) {
    await f.enqueue(); await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    assert.equal((await f.queue.counts()).uploaded, 1);
    assert.equal((await f.queue.counts()).retained, 0);
    assert.equal(f.requests.length, 1);
  } },
  ...['stop', 'revoke'].map(transition => ({ id: `race:${transition}-while-token-pending-cannot-start-upload`, async run(f) {
    await f.enqueue(); const reached = deferred(), token = deferred();
    f.behavior.token = () => { reached.resolve(); return token.promise; };
    const flushing = f.uploader.flush({ userId: f.inputs.scopeA.userId }); await reached.promise;
    if (transition === 'stop') await f.pipeline.stop();
    else await f.pipeline.revokeTrip(f.inputs.scopeA.tripId);
    const before = f.requests.length;
    token.resolve('SYNTHETIC-TOKEN-A'); await flushing;
    f.actual = { requestsBeforeTransitionFinished: before, requestsAfterTransition: f.requests.length - before,
      revoked: f.queue.isScopeRevoked(f.inputs.scopeA), pumpState: (await f.uploader.state()).pumpState };
    assert.equal(f.requests.length, before, 'a new location request began after retirement completed');
  } })),
  { id: 'protocol:wrong-trip-receipt-cannot-delete-samples', async run(f) {
    await f.enqueue(); f.behavior.response = async () => jsonResponse({ id: f.inputs.scopeB.tripId, received: 1 });
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const counts = await f.queue.counts();
    f.actual = { retained: counts.retained, uploaded: counts.uploaded,
      reportedReceiptTrip: (await f.uploader.state()).lastReceipt?.tripId ?? null };
    assert.equal(counts.retained, 1); assert.equal(counts.uploaded, 0);
  } },
  { id: 'protocol:malformed-success-cannot-delete-samples', async run(f) {
    await f.enqueue(); f.behavior.response = async () => new Response('{', { status: 200 });
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const counts = await f.queue.counts();
    f.actual = { retained: counts.retained, uploaded: counts.uploaded,
      received: (await f.uploader.state()).lastReceipt?.received ?? null };
    assert.equal(counts.retained, 1); assert.equal(counts.uploaded, 0);
  } },
  { id: 'intent:next-capture-cannot-rebatch-an-ambiguous-upload', async run(f) {
    await f.enqueue(); f.behavior.response = async () => { throw new TypeError('SYNTHETIC lost response'); };
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const original = structuredClone(f.requests[0]);
    await f.enqueue(f.inputs.samples[1]);
    f.behavior.response = async r => jsonResponse({ id: r.tripId, received: r.body.observations.length });
    await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    f.actual = { firstBatchSize: original.body.observations.length,
      replayBatchSize: f.requests[1]?.body.observations.length, sameKey: f.requests[1]?.key === original.key };
    assert.equal(f.requests[1].key, original.key);
    assert.deepEqual(f.requests[1].body, original.body);
  } },
  { id: 'retry:network-errors-obey-the-declared-attempt-bound', async run(f) {
    await f.enqueue(); f.behavior.response = async () => { throw new TypeError('SYNTHETIC offline'); };
    // This fixture uses the candidate's default maxAttempts=8.
    for (let i = 0; i < 9; i++) await f.uploader.flush({ userId: f.inputs.scopeA.userId });
    const counts = await f.queue.counts();
    f.actual = { requestCount: f.requests.length, pending: counts.pending, failed: counts.failed };
    assert.equal(f.requests.length, 8); assert.equal(counts.failed, 1); assert.equal(counts.pending, 0);
  } },
];

const checks = [];
for (const probe of probes) {
  const f = await fixture();
  try { await probe.run(f); checks.push({ id: probe.id, passed: true }); }
  catch { checks.push({ id: probe.id, passed: false, ...(f.actual ? { actual: f.actual } : {}) }); }
  finally { f.uploader.stop(); }
}
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({ passed, checks,
  limitation: 'Frozen public exports, clone-isolated stores and synthetic fetch/token scheduling; no real IndexedDB or device proof.' }, null, 2));
process.exitCode = passed ? 0 : 1;
