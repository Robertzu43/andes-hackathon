// Narrow follow-ups to the existing signout privacy finding, using public seams.
import assert from 'node:assert/strict';
import { fixture } from './drivers/queue-0b1e7e6.mjs';
import { deferred } from './scripted-transport.mjs';

const checks = [];
for (const id of ['late-network-rejection-after-signout', 'earlier-revocation-then-signout']) {
  const f = await fixture();
  let actual, timer;
  try {
    await Promise.race([(async () => {
      await f.enqueue();
      if (id === 'late-network-rejection-after-signout') {
        const reached = deferred(), reply = deferred();
        f.behavior.response = () => { reached.resolve(); return reply.promise; };
        const flushing = f.uploader.flush({ userId: f.inputs.scopeA.userId });
        await reached.promise;
        await f.pipeline.signOut();
        const immediatelyAfterSignout = await f.stores.meta.getAll();
        reply.reject(new TypeError('SYNTHETIC lost response'));
        await flushing;
        actual = { immediatelyAfterSignout };
      } else {
        await f.pipeline.revokeTrip(f.inputs.scopeA.tripId);
        await f.pipeline.signOut();
      }
      actual = { ...actual, requests: f.requests.length, records: await f.stores.records.getAll(),
        meta: await f.stores.meta.getAll(), uploader: await f.uploader.state() };
      const serialized = JSON.stringify(actual.meta);
      assert.equal(actual.records.length, 0);
      for (const identifier of [f.inputs.scopeA.userId, f.inputs.scopeA.tripId]) {
        assert.ok(!serialized.includes(identifier), 'signed-out owner/trip remains in durable metadata');
      }
      assert.equal(actual.uploader.unacknowledgedBatches, 0);
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Reviewer timeout')), 2000); })]);
    checks.push({ id, passed: true, actual });
  } catch { checks.push({ id, passed: false, actual }); }
  finally { clearTimeout(timer); f.uploader.stop(); }
}
const passed = checks.every(check => check.passed);
console.log(JSON.stringify({ passed, checks,
  limitation: 'Synthetic clone-isolated storage and held fetch scheduling through frozen public exports; no actual browser, provider or product acceptance.' }, null, 2));
process.exitCode = passed ? 0 : 1;
