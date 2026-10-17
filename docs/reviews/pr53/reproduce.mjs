// Review reproductions, not corrected behavior or product acceptance.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(process.argv[2] ?? new URL('../../../', import.meta.url).pathname);
const { projectMonitoringState: project } = await import(pathToFileURL(resolve(root, 'src/monitoring-state/project.mjs')));
const T = Date.parse('2026-10-17T12:00:00Z');
const at = delta => new Date(T + delta).toISOString();
function input() {
  const clock = { sessionId: 'review-session', wallMs: T, monotonicMs: 10000 };
  const event = (id, kind) => ({ id, tripId: 'review-trip', sourceAt: at(-2000), receivedAt: at(-1000),
    timeUncertaintyMs: 0, provenance: { kind, reference: `synthetic:${id}` } });
  return { tripId: 'review-trip', clock, previousClock: null,
    serverObservation: { id: 'anchor', tripId: 'review-trip', observedAt: at(0), receivedClock: { ...clock },
      uncertaintyMs: 0, provenance: { kind: 'server-observation', reference: 'synthetic:anchor' } },
    budgets: { responseMs: 10000, locationMs: 10000, notificationMs: 10000, serverMs: 30000,
      clockSkewMs: 100, maxTickGapMs: 5000, maxAccuracyMeters: 100 },
    availability: { visibility: 'visible', connection: 'online', locationPermission: 'granted' },
    responses: [{ ...event('report', 'driver-report'), sessionId: 'review-session', sequence: 1, response: 'ok' }],
    locations: [{ ...event('point', 'device-observation'), sessionId: 'review-session', sequence: 1,
      latitude: 0, longitude: 0, accuracyMeters: 15 }],
    deadlines: [{ ...event('deadline', 'server-state'), revision: 1, sourceAt: at(-60000), dueAt: at(300000) }],
    notifications: [{ ...event('notification', 'server-state'), revision: 1, notificationId: 'message', state: 'accepted' }],
    coverageGaps: [] };
}
const results = [];
function probe(id, mutate, verify) {
  const f = input(); mutate(f); const out = project(f); verify(out);
  results.push({ id, location: { status: out.location.status, lastKnown: out.location.lastKnown?.id ?? null,
    reasons: out.location.reasons }, response: { status: out.response.status, lastKnown: out.response.lastKnown?.id ?? null },
    deadline: { status: out.deadline.status, comparison: out.deadline.comparison },
    observation: 'assertions confirmed the stated behavior; no repair or acceptance' });
}
probe('positive-control', () => {}, o => {
  assert.equal(o.location.status, 'recent'); assert.equal(o.response.status, 'recent');
  assert.equal(o.liveMonitoring, false); assert.equal(o.wellbeing, 'unknown');
});
for (const length of [2, 10, 60]) probe(`B1-1Hz-${length}`, f => {
  f.locations = Array.from({ length }, (_, i) => ({ ...f.locations[0], id: `point-${i}`, sequence: i,
    sourceAt: at(-1000 * (length - i)), timeUncertaintyMs: 500 }));
}, o => { assert.equal(o.location.lastKnown, null); assert.ok(o.location.reasons.includes('latest-source-time-uncertain')); });
probe('B2-overlapping-unusable-point', f => {
  f.locations[0].sourceAt = at(-20000); f.locations[0].timeUncertaintyMs = 500;
  f.locations.push({ ...f.locations[0], id: 'unusable', sequence: 2, sourceAt: at(-19500), accuracyMeters: 1000 });
}, o => { assert.equal(o.location.lastKnown, null); assert.equal(o.location.unusableEvidence.length, 1); });
probe('B2-newer-nonoverlap-control', f => {
  f.locations[0].sourceAt = at(-20000);
  f.locations.push({ ...f.locations[0], id: 'unusable', sequence: 2, sourceAt: at(-1000), accuracyMeters: 1000 });
}, o => { assert.equal(o.location.lastKnown.id, 'point'); assert.equal(o.location.status, 'stale'); });
for (const variant of ['receipt', 'timestamp-spelling']) probe(`B3-duplicate-${variant}`, f => {
  const duplicate = structuredClone(f.responses[0]);
  if (variant === 'receipt') duplicate.receivedAt = at(0);
  else duplicate.sourceAt = duplicate.sourceAt.replace('.000Z', 'Z');
  f.responses.push(duplicate);
}, o => { assert.equal(o.response.lastKnown, null); assert.ok(o.response.reasons.includes('conflicting-event-id')); });
probe('B4-old-conflict-poisons-newer', f => {
  const point = f.locations[0];
  f.locations = [{ ...point, id: 'old-1', sequence: 1, sourceAt: at(-60000) },
    { ...point, id: 'old-2', sequence: 2, sourceAt: at(-61000) },
    { ...point, id: 'new-valid', sequence: 3, sourceAt: at(-1000) }];
}, o => { assert.equal(o.location.lastKnown, null); assert.ok(o.location.reasons.includes('source-clock-reversal')); });
probe('F1-phone-ahead-300ms', f => Object.assign(f.locations[0], { sourceAt: at(300), receivedAt: at(0) }),
  o => { assert.equal(o.location.status, 'unknown'); assert.ok(o.location.reasons.includes('source-after-server-receipt')); });
probe('F2-uncertainty-near-now', f => Object.assign(f.locations[0], { sourceAt: at(-5000), timeUncertaintyMs: 30000 }),
  o => { assert.equal(o.location.status, 'unknown'); assert.equal(o.location.ageMs.min, -25000);
    assert.ok(o.location.reasons.includes('event-in-server-future')); });
probe('F3-overlap-3sec-2sec', f => {
  Object.assign(f.locations[0], { sourceAt: at(-4000), timeUncertaintyMs: 2000 });
  f.locations.push({ ...f.locations[0], id: 'newer', sequence: 2, sourceAt: at(-1000) });
}, o => assert.equal(o.location.lastKnown, null));
probe('F3-old-null-uncertainty', f => f.locations.push({ ...f.locations[0], id: 'old', sequence: 0,
  sourceAt: at(-60000), timeUncertaintyMs: null }), o => assert.equal(o.location.lastKnown, null));
probe('F4-remote-permission-unknown', f => { f.availability.locationPermission = 'unknown'; },
  o => { assert.equal(o.location.status, 'unknown'); assert.equal(o.location.freshness, 'recent'); });
for (const state of ['pending', 'claimed', 'authorized', 'rejected', 'unknown', 'unavailable']) {
  const f = input(); f.notifications[0].state = state;
  assert.throws(() => project(f), TypeError); results.push({ id: `F5-notification-${state}`, throws: 'TypeError' });
}
for (const change of ['missing-uncertainty', 'backend-accuracy']) {
  const f = input();
  if (change === 'missing-uncertainty') delete f.locations[0].timeUncertaintyMs;
  else { f.locations[0].accuracy = f.locations[0].accuracyMeters; delete f.locations[0].accuracyMeters; }
  assert.throws(() => project(f), TypeError); results.push({ id: `F5-${change}`, throws: 'TypeError' });
}
probe('F6-paused-clock-resume', f => { f.clock.wallMs += 60000; },
  o => { assert.equal(o.time.status, 'unknown'); assert.equal(o.location.status, 'unknown'); });
for (const [due, comparison] of [[300000, 'before'], [-1000, 'reached']]) probe(`K1-old-agreement-${comparison}`, f => {
  f.deadlines[0].dueAt = at(due);
}, o => { assert.equal(o.deadline.status, 'stale'); assert.equal(o.deadline.comparison, comparison); });
probe('K3-stale-anchor', f => { f.clock.wallMs += 60000; f.clock.monotonicMs += 60000;
  f.locations[0].sourceAt = at(-60000); f.deadlines[0].dueAt = at(1000);
}, o => { assert.equal(o.location.status, 'unknown'); assert.ok(o.location.ageMs.min > 10000);
  assert.equal(o.deadline.comparison, 'unknown'); });
probe('K4-open-and-closed-gap', f => {
  const g = { id: 'gap', tripId: f.tripId, startAt: at(-10000), endAt: null,
    provenance: { kind: 'independent-observer', reference: 'synthetic:gap' } };
  f.coverageGaps = [g, { ...g, endAt: at(-5000) }];
}, o => { assert.equal(o.coverage.gaps.length, 2); assert.equal(o.location.status, 'unknown'); });
probe('K5-cross-message-event-id', f => f.notifications.push({ ...f.notifications[0], notificationId: 'other-message' }),
  o => { assert.equal(o.notifications.messages.length, 2);
    assert.ok(o.notifications.messages.every(m => m.lastKnown && !m.reasons.includes('conflicting-event-id'))); });
{
  const f = input(); f.deadlines.push({ ...f.deadlines[0], id: 'bad-revision', revision: 2, dueAt: at(-61000) });
  assert.throws(() => project(f), TypeError); results.push({ id: 'K6-bad-deadline-revision', throws: 'TypeError' });
}
probe('K7-unusable-in-two-evidence-fields', f => {
  f.locations.push({ ...f.locations[0], id: 'rejected', sequence: 1, accuracyMeters: 1000 });
}, o => { assert.ok(o.location.evidence.some(e => e.id === 'rejected'));
  assert.ok(o.location.unusableEvidence.some(e => e.id === 'rejected')); });
probe('K8-empty-unknown-reasons', f => { f.responses = []; f.locations = []; },
  o => { assert.equal(o.response.status, 'unknown'); assert.deepEqual(o.response.reasons, []);
    assert.equal(o.location.status, 'unknown'); assert.deepEqual(o.location.reasons, []); });

// B5: remove real clock/session guards only inside a disposable archive, retaining
// the author's original tests and fixtures byte-for-byte.
const sandbox = await mkdtemp(resolve(tmpdir(), 'andes-pr53-mutation-'));
await mkdir(resolve(sandbox, 'src/monitoring-state'), { recursive: true });
await mkdir(resolve(sandbox, 'tests/monitoring-state'), { recursive: true });
let source = await readFile(resolve(root, 'src/monitoring-state/project.mjs'), 'utf8');
for (const line of [
  "    if (earlier.sessionId !== now.sessionId) return { reasons: ['clock-session-changed'], elapsed: null };",
  "    if (mono < 0 || wall < 0) failures.push('clock-reversed');",
  "    if (Math.abs(wall - mono) > budgets.clockSkewMs) failures.push('clock-disagreement');",
]) { assert.equal(source.split(line).length, 2); source = source.replace(line, ''); }
await writeFile(resolve(sandbox, 'src/monitoring-state/project.mjs'), source);
for (const file of ['fixtures.mjs', 'fault-matrix.test.mjs']) {
  await writeFile(resolve(sandbox, 'tests/monitoring-state', file), await readFile(resolve(root, 'tests/monitoring-state', file)));
}
const { projectMonitoringState: mutant } = await import(pathToFileURL(resolve(sandbox, 'src/monitoring-state/project.mjs')));
const control = input(); control.clock.sessionId = 'restarted';
assert.equal(project(control).location.status, 'unknown');
assert.equal(mutant(control).location.status, 'recent');
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=false-freshness matrix',
  resolve(sandbox, 'tests/monitoring-state/fault-matrix.test.mjs')], { encoding: 'utf8' });
assert.equal(run.status, 0, run.stdout + run.stderr);
assert.match(run.stdout, /# pass 5\b/);
await writeFile(resolve(sandbox, 'matrix-mutant.tap'), run.stdout + run.stderr);
results.push({ id: 'B5-matrix-insensitive', matrixGroupsPassed: 5, combinations: 80,
  deletedProductionGuards: ['session changed', 'clock reversed', 'clock disagreement'],
  mutationControl: 'restarted recent source changes unknown -> recent', rawOutput: resolve(sandbox, 'matrix-mutant.tap') });
results.push({ id: 'K9-complexity', source: 'project.mjs:85-95',
  pairsFor3600Records: 3600 * 3599 / 2, timestampParsesForSameSession: 2 * 3600 * 3599 / 2,
  observation: 'structural operation count, not a runtime benchmark' });
console.log(JSON.stringify({ runtime: process.version, candidate: 'e9df5cbfd5c2cfbb19698d46bb957b8561920e66',
  purpose: 'Preserved failure behavior and bounded counterexamples; retired-unmerged is not fixed/ACCEPT',
  probes: results.length, results }, null, 2));
