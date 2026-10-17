import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDS, NOW, clone } from './fixtures.mjs';
import { assertQueueTrace, queueInputs, queueScenarios, runQueueProbes, wireSample } from './queue-probes.mjs';

// Fabricated traces only: positive/fault controls validate assertions, never a queue.
function control(id) {
  const i = queueInputs();
  const sample = i.samples[0];
  const request = { ...i.scopeA, path: `/v1/trips/${IDS.trip}/locations`, key: 'synthetic-batch-key',
    body: { observations: [wireSample(sample)] } };
  const traces = {
    'source-time': { requests: [request], after: { acceptedCount: 1 } },
    capacity: { after: { pending: i.samples.slice(-3), dropped: 2 } },
    restart: { before: { pending: [sample] }, after: { pending: [sample] } },
    'ambiguous-restart': { first: { requests: [request], outcome: 'ambiguous', pending: [sample] },
      afterRestart: { intent: { key: request.key, body: request.body, ...i.scopeA } },
      replayRequests: [request], after: { pending: [], outcome: 'accepted' } },
    'wrong-ack': { after: { pending: [sample], acceptedCount: 0, outcome: 'protocol-error' } },
    'scope-switch': { requests: [{ ...i.scopeB, path: `/v1/trips/${IDS.otherTrip}/locations`, key: 'synthetic-B-key',
      body: { observations: [wireSample(i.sampleB)] } }], after: { pending: [] } },
    'stop-revocation': { requestsAfterStop: [], after: { stopped: true } },
    signout: { after: { pending: [], intent: null }, persistedEntries: [] },
    retention: { requests: [request], after: { dropped: 1 } },
    'storage-unavailable': { after: { storageStatus: 'unavailable', durable: false } },
  };
  return clone({ scenario: id, ...traces[id] });
}

for (const scenario of queueScenarios) {
  test(`queue oracle accepts the ${scenario.id} positive trace control`, () => {
    assertQueueTrace(scenario.id, control(scenario.id));
  });
}

const defects = {
  'source-time': t => { t.requests[0].body.observations[0].capturedAt = new Date(NOW).toISOString(); },
  capacity: t => { t.after.pending.push(queueInputs().samples[0]); t.after.dropped = 1; },
  restart: t => { t.after.pending[0].sourceAtMs = NOW; },
  'ambiguous-restart': t => { t.afterRestart.intent.key = 'new-key-after-loss'; },
  'wrong-ack': t => { t.after.pending = []; t.after.acceptedCount = 1; },
  'scope-switch': t => { t.requests[0].tripId = IDS.trip; },
  'stop-revocation': t => { t.requestsAfterStop.push({ method: 'POST' }); },
  signout: t => { t.persistedEntries.push(['old-user-location', { userId: IDS.driver }]); },
  retention: t => { t.requests[0].body.observations.push(wireSample(queueInputs().expired)); },
  'storage-unavailable': t => { t.after.storageStatus = 'ready'; t.after.durable = true; },
};
for (const [id, mutate] of Object.entries(defects)) {
  test(`queue oracle rejects the ${id} fault control`, () => {
    const trace = control(id); mutate(trace);
    assert.throws(() => assertQueueTrace(id, trace), assert.AssertionError);
  });
}

test('ambiguous restart may hold pending work rather than automatically resend', () => {
  const trace = control('ambiguous-restart');
  trace.replayRequests = [];
  trace.after = { outcome: 'ambiguous', pending: [queueInputs().samples[0]] };
  assertQueueTrace('ambiguous-restart', trace);
});

test('queue scenarios cannot pass with empty/missing evidence or an unknown axis', async () => {
  for (const scenario of queueScenarios) assert.throws(() => assertQueueTrace(scenario.id, { scenario: scenario.id }));
  assert.throws(() => assertQueueTrace('invented', { scenario: 'invented' }), RangeError);
  const results = await runQueueProbes(async ({ scenario }) => ({ scenario: scenario.id }));
  assert.ok(results.every(result => result.passed === false));
});

test('queue collector hangs become bounded failures, never skipped/passing cases', async () => {
  const results = await runQueueProbes(() => new Promise(() => {}), { timeoutMs: 1 });
  assert.equal(results.length, queueScenarios.length);
  assert.ok(results.every(result => !result.passed));
});
