import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMonitoringState as project } from '../../src/monitoring-state/project.mjs';
import { at, copy, fixture, observeServer, gap } from './fixtures.mjs';

// An external synthetic observer's missing interval stays separate from device
// event timestamps and from the server's received-at records. No physical run.
const faults = {
  reconnect: f => {},
  suspended: f => { f.clock.monotonicMs += 120_000; f.clock.wallMs += 120_000; },
  pausedClock: f => { f.clock.wallMs += 120_000; },
  restart: f => { f.clock.sessionId = 'SESSION-RESTART'; f.clock.monotonicMs = 5; },
  missingServer: f => { f.serverObservation = null; },
};
const availability = [
  { visibility: 'visible', connection: 'online', locationPermission: 'granted' },
  { visibility: 'hidden', connection: 'offline', locationPermission: 'granted' },
  { visibility: 'visible', connection: 'online', locationPermission: 'denied' },
  { visibility: 'visible', connection: 'online', locationPermission: 'unknown' },
];

for (const [fault, apply] of Object.entries(faults)) {
  test(`false-freshness matrix: ${fault} x availability x duplicates/order`, () => {
    let checks = 0;
    for (const available of availability) {
      for (const reversed of [false, true]) {
        for (const duplicated of [false, true]) {
          const f = observeServer(fixture(), 600_000);
          f.availability = available;
          f.coverageGaps = [gap(0, 599_000)];
          // Last usable point and driver response predate the entire gap.
          for (const field of ['responses', 'locations']) {
            const first = f[field][0];
            first.receivedAt = at(600_000);
            const older = { ...copy(first), id: `${first.id}-OLD`, sequence: 0, sourceAt: at(-60_000) };
            f[field] = reversed ? [first, older] : [older, first];
            if (duplicated) f[field].push(copy(first), copy(older));
          }
          apply(f);
          const out = project(f);
          assert.notEqual(out.response.status, 'recent');
          assert.notEqual(out.location.status, 'recent');
          assert.notEqual(out.location.freshness, 'recent');
          assert.ok(out.response.lastKnown);
          assert.ok(out.location.lastKnown);
          assert.equal(out.response.lastKnown.sourceAt, at(-2000));
          assert.equal(out.location.lastKnown.sourceAt, at(-2000));
          assert.equal(out.response.evidence.length, 2);
          assert.equal(out.location.evidence.length, 2);
          assert.equal(out.coverage.status, 'interrupted');
          assert.deepEqual(out.coverage.gaps, f.coverageGaps);
          assert.equal(out.liveMonitoring, false);
          assert.equal(out.wellbeing, 'unknown');
          assert.equal(out.incidentCause, 'unknown');
          assert.equal(out.deadline.lastKnown.dueAt, at(300_000));
          checks++;
        }
      }
    }
    assert.equal(checks, 16);
  });
}

test('a new point after reconnection may be recent while the older response and gap remain', () => {
  const f = observeServer(fixture(), 600_000);
  f.coverageGaps = [gap(0, 599_000)];
  f.locations.push({ ...copy(f.locations[0]), id: 'NEW-POINT', sequence: 2,
    sourceAt: at(600_000), receivedAt: at(600_000) });
  const out = project(f);
  assert.equal(out.location.status, 'recent');
  assert.equal(out.location.lastKnown.id, 'NEW-POINT');
  assert.equal(out.location.evidence.length, 2);
  assert.equal(out.response.status, 'stale');
  assert.equal(out.coverage.status, 'interrupted');
  assert.equal(out.coverage.gaps.length, 1);
  assert.equal(out.liveMonitoring, false);
});
