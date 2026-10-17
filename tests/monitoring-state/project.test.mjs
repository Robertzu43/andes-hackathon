import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMonitoringState as project } from '../../src/monitoring-state/project.mjs';
import { NOW, at, copy, fixture, observeServer, gap } from './fixtures.mjs';

function noSafetyClaim(out) {
  assert.equal(out.liveMonitoring, false);
  assert.equal(out.wellbeing, 'unknown');
  assert.equal(out.incidentCause, 'unknown');
  assert.notEqual(out.coverage.status, 'live');
}

test('positive facts remain independently visible without asserting safety or interval coverage', () => {
  const out = project(fixture());
  assert.equal(out.response.status, 'recent');
  assert.equal(out.response.lastKnown.response, 'ok');
  assert.equal(out.location.status, 'recent');
  assert.equal(out.location.lastKnown.accuracyMeters, 15);
  assert.deepEqual(out.response.ageMs, { min: 2000, max: 2000 });
  assert.equal(out.deadline.lastKnown.dueAt, at(300_000));
  assert.equal(out.deadline.owner, 'server');
  assert.equal(out.deadline.comparison, 'before');
  assert.equal(out.notifications.messages[0].lastKnown.state, 'accepted');
  assert.equal(out.coverage.status, 'unknown');
  assert.equal(out.response.lastKnown.provenance.kind, 'driver-report');
  noSafetyClaim(out);
});

test('empty and absent evidence remain explicit unknowns', () => {
  const f = fixture();
  for (const field of ['responses', 'locations', 'deadlines', 'notifications']) delete f[field];
  f.serverObservation = null;
  const out = project(f);
  for (const field of ['response', 'location', 'deadline']) {
    assert.equal(out[field].status, 'unknown');
    assert.equal(out[field].lastKnown, null);
    assert.equal(out[field].ageMs, null);
  }
  assert.deepEqual(out.notifications, { status: 'unknown', messages: [] });
  assert.equal(out.deadline.comparison, 'unknown');
  noSafetyClaim(out);
});

test('a local tick and online flag cannot replace missing server evidence', () => {
  const f = fixture();
  f.serverObservation = null;
  const out = project(f);
  assert.equal(out.time.status, 'unknown');
  assert.equal(out.response.status, 'unknown');
  assert.equal(out.location.status, 'unknown');
  assert.ok(out.response.lastKnown);
  assert.equal(out.deadline.lastKnown.dueAt, at(300_000));
  assert.equal(out.deadline.comparison, 'unknown');
  noSafetyClaim(out);
});

test('delayed upload and reconnection age original source times, not receipt times', () => {
  const f = observeServer(fixture(), 600_000);
  f.responses[0].receivedAt = at(600_000);
  f.locations[0].receivedAt = at(600_000);
  f.coverageGaps = [gap(0, 599_000)];
  const out = project(f);
  for (const field of ['response', 'location']) {
    assert.equal(out[field].status, 'stale');
    assert.deepEqual(out[field].ageMs, { min: 602_000, max: 602_000 });
    assert.equal(out[field].lastKnown.sourceAt, at(-2000));
  }
  assert.equal(out.coverage.status, 'interrupted');
  assert.equal(out.deadline.comparison, 'reached');
  assert.deepEqual(out.coverage.gaps, f.coverageGaps);
  noSafetyClaim(out);
});

test('suspension with both clocks advancing leaves a local gap and stale server reference', () => {
  const f = fixture();
  f.clock.wallMs += 600_000;
  f.clock.monotonicMs += 600_000;
  const out = project(f);
  assert.equal(out.time.status, 'stale');
  assert.equal(out.coverage.status, 'interrupted');
  assert.ok(out.time.reasons.includes('local-observation-gap'));
  assert.equal(out.location.status, 'unknown');
  assert.deepEqual(out.location.ageMs, { min: 602_000, max: 602_000 });
  assert.ok(out.location.lastKnown);
  assert.equal(out.deadline.comparison, 'unknown');
  noSafetyClaim(out);
});

test('paused monotonic clock during suspension makes time unknown', () => {
  const f = fixture();
  f.clock.wallMs += 600_000;
  const out = project(f);
  assert.equal(out.time.status, 'unknown');
  assert.ok(out.time.reasons.includes('clock-disagreement'));
  assert.equal(out.response.ageMs, null);
  assert.equal(out.response.status, 'unknown');
  assert.ok(out.location.lastKnown);
  noSafetyClaim(out);
});

for (const field of ['wallMs', 'monotonicMs']) {
  test(`${field} reversal cannot freshen evidence or decide the deadline`, () => {
    const f = fixture();
    f.clock[field] -= 10_000;
    const out = project(f);
    assert.equal(out.time.status, 'unknown');
    assert.equal(out.location.status, 'unknown');
    assert.equal(out.deadline.comparison, 'unknown');
    assert.ok(out.time.reasons.includes('clock-reversed'));
    noSafetyClaim(out);
  });
}

test('page restart invalidates old monotonic anchor', () => {
  const f = fixture();
  f.clock = { sessionId: 'SESSION-B', wallMs: NOW, monotonicMs: 50 };
  const out = project(f);
  assert.equal(out.time.status, 'unknown');
  assert.equal(out.response.status, 'unknown');
  assert.equal(out.coverage.status, 'interrupted');
  assert.ok(out.location.lastKnown);
  noSafetyClaim(out);
});

test('fresh server evidence after restart permits a new fact but retains the missing interval', () => {
  const f = fixture();
  f.clock.sessionId = 'SESSION-B';
  f.serverObservation.receivedClock = copy(f.clock);
  f.coverageGaps = [gap(-60_000, -3000)];
  f.responses[0].sessionId = 'SESSION-B';
  const out = project(f);
  assert.equal(out.response.status, 'recent');
  assert.equal(out.coverage.status, 'interrupted');
  assert.deepEqual(out.coverage.gaps, f.coverageGaps);
  noSafetyClaim(out);
});

for (const permission of ['denied', 'unavailable', 'prompt', 'unknown']) {
  test(`location permission ${permission} retains last position and its own freshness`, () => {
    const f = observeServer(fixture(), 60_000);
    f.availability.locationPermission = permission;
    const out = project(f);
    assert.equal(out.location.status, ['denied', 'unavailable'].includes(permission) ? 'unavailable' : 'unknown');
    assert.equal(out.location.freshness, 'stale');
    assert.equal(out.location.lastKnown.id, 'LOCATION-A');
    assert.deepEqual(out.location.ageMs, { min: 62_000, max: 62_000 });
    noSafetyClaim(out);
  });
}

for (const change of [{ visibility: 'hidden' }, { connection: 'offline' }]) {
  test(`availability ${JSON.stringify(change)} cannot prove interval coverage`, () => {
    const f = fixture();
    Object.assign(f.availability, change);
    const out = project(f);
    assert.equal(out.coverage.status, 'interrupted');
    // The previously observed time-specific response is still a known fact.
    assert.equal(out.response.status, 'recent');
    noSafetyClaim(out);
  });
}

test('reported fatigue, help and crime remain attributed reports', () => {
  for (const response of ['fatigue', 'sleepiness', 'help-request', 'security-concern',
    'reported-attempted-robbery', 'reported-robbery-theft', 'rest-started']) {
    const f = fixture();
    f.responses[0].response = response;
    const out = project(f);
    assert.equal(out.response.lastKnown.response, response);
    assert.equal(out.response.lastKnown.provenance.kind, 'driver-report');
    noSafetyClaim(out);
  }
});

test('no response never becomes sleep or robbery even after the deadline', () => {
  const f = observeServer(fixture(), 600_000);
  f.responses = [];
  const out = project(f);
  assert.equal(out.response.status, 'unknown');
  assert.equal(out.deadline.comparison, 'reached');
  noSafetyClaim(out);
});

test('reordered uploads and duplicate events do not replace a later source observation', () => {
  const f = fixture();
  const older = { ...copy(f.responses[0]), id: 'RESPONSE-OLD', sourceAt: at(-60_000),
    receivedAt: at(0), sequence: 0, response: 'fatigue' };
  const normal = project({ ...f, responses: [older, f.responses[0]] });
  const reordered = project({ ...f, responses: [f.responses[0], older, copy(older), copy(f.responses[0])] });
  assert.deepEqual(normal, reordered);
  assert.equal(normal.response.lastKnown.response, 'ok');
  assert.equal(normal.response.evidence.length, 2);
});

for (const field of ['responses', 'locations']) {
  test(`${field} conflicting identities and sequences preserve evidence without choosing a fresh winner`, () => {
    for (const mutation of [{ response: 'fatigue', latitude: 1 }, { id: 'CONFLICT', sourceAt: at(-1500) }]) {
      const f = fixture();
      const conflicting = { ...copy(f[field][0]), ...mutation };
      f[field].push(conflicting);
      const out = project(f)[field === 'responses' ? 'response' : 'location'];
      assert.equal(out.status, 'unknown');
      assert.equal(out.lastKnown, null);
      assert.equal(out.evidence.length, 2);
      assert.ok(out.reasons.includes('conflicting-sequence'));
    }
  });
}

test('source clock reversal against sequence retains contradictory reports', () => {
  const f = fixture();
  f.responses.push({ ...copy(f.responses[0]), id: 'REVERSED', sourceAt: at(-5000), sequence: 2 });
  const out = project(f);
  assert.equal(out.response.status, 'unknown');
  assert.equal(out.response.evidence.length, 2);
  assert.ok(out.response.reasons.includes('source-clock-reversal'));
});

test('uncertain source order across sessions does not pick a latest response', () => {
  const f = fixture();
  f.responses.push({ ...copy(f.responses[0]), id: 'OTHER-SESSION', sessionId: 'SESSION-B',
    sourceAt: at(-1000), timeUncertaintyMs: 2000, response: 'help-request' });
  const out = project(f);
  assert.equal(out.response.status, 'unknown');
  assert.equal(out.response.lastKnown, null);
  assert.equal(out.response.evidence.length, 2);
  assert.ok(out.response.reasons.includes('latest-source-time-uncertain'));
});

test('unknown source-time uncertainty retains a single response with unknown age', () => {
  const f = fixture();
  f.responses[0].timeUncertaintyMs = null;
  const out = project(f);
  assert.ok(out.response.lastKnown);
  assert.equal(out.response.status, 'unknown');
  assert.equal(out.response.ageMs, null);
});

test('future source relative to server receipt cannot be recent', () => {
  const f = fixture();
  f.locations[0].receivedAt = at(-5000);
  const out = project(f);
  assert.equal(out.location.status, 'unknown');
  assert.ok(out.location.reasons.includes('source-after-server-receipt'));
  assert.ok(out.location.lastKnown);
});

test('future event or receipt relative to server evidence cannot be recent', () => {
  for (const key of ['sourceAt', 'receivedAt']) {
    const f = fixture();
    f.responses[0][key] = at(1000);
    const out = project(f);
    assert.equal(out.response.status, 'unknown');
    assert.ok(out.response.reasons.includes('event-in-server-future'));
  }
});

test('explicit observation gaps retain disagreement rather than freshening overlapping points', () => {
  const f = fixture();
  f.coverageGaps = [gap(-3000, -1000)];
  const out = project(f);
  for (const key of ['response', 'location']) {
    assert.equal(out[key].status, 'unknown');
    assert.ok(out[key].lastKnown);
    assert.ok(out[key].reasons.includes('source-overlaps-unobserved-interval'));
  }
  assert.equal(out.coverage.gaps[0].provenance.kind, 'independent-observer');
  noSafetyClaim(out);
});

test('open gap remains visible after an online signal and a new local tick', () => {
  const f = fixture();
  f.coverageGaps = [gap(-3000)];
  const out = project(f);
  assert.equal(out.location.status, 'unknown');
  assert.equal(out.coverage.gaps[0].endAt, null);
  noSafetyClaim(out);
});

test('uncertainty bounds straddling a freshness budget stay unknown', () => {
  const f = fixture();
  f.budgets.responseMs = 2000;
  f.serverObservation.uncertaintyMs = 100;
  f.responses[0].timeUncertaintyMs = 100;
  const out = project(f);
  assert.deepEqual(out.response.ageMs, { min: 1800, max: 2200 });
  assert.equal(out.response.status, 'unknown');
  assert.ok(out.response.reasons.includes('freshness-boundary-uncertain'));
});

test('tolerated wall/monotonic disagreement expands age bounds instead of inventing precision', () => {
  const f = fixture();
  f.clock.monotonicMs += 1000;
  f.clock.wallMs += 1100;
  f.budgets.responseMs = 3000;
  const out = project(f);
  assert.equal(out.time.status, 'recent');
  assert.deepEqual(out.response.ageMs, { min: 3000, max: 3100 });
  assert.equal(out.response.status, 'unknown');
  assert.ok(out.response.reasons.includes('freshness-boundary-uncertain'));
});

test('freshness budget has an explicit inclusive boundary', () => {
  const f = fixture();
  f.budgets.locationMs = 2000;
  assert.equal(project(f).location.status, 'recent');
  f.budgets.locationMs = 1999;
  assert.equal(project(f).location.status, 'stale');
});

test('unusable latest positions do not hide a stale usable location or invent accuracy', () => {
  const f = observeServer(fixture(), 60_000);
  for (const accuracyMeters of [null, 101]) {
    const newPoint = { ...copy(f.locations[0]), id: 'UNUSABLE', sequence: 2,
      sourceAt: at(59_000), receivedAt: at(60_000), accuracyMeters };
    const out = project({ ...f, locations: [...f.locations, newPoint] });
    assert.equal(out.location.status, 'stale');
    assert.equal(out.location.lastKnown.id, 'LOCATION-A');
    assert.equal(out.location.unusableEvidence.length, 1);
  }
});

test('all unusable locations remain unknown with raw source evidence retained', () => {
  const f = fixture();
  f.locations[0].accuracyMeters = null;
  const out = project(f);
  assert.equal(out.location.status, 'unknown');
  assert.equal(out.location.lastKnown, null);
  assert.equal(out.location.unusableEvidence[0].sourceAt, at(-2000));
});

test('server deadline revisions win over upload order and local activity', () => {
  const f = fixture();
  const revision = { ...copy(f.deadlines[0]), id: 'DEADLINE-B', revision: 2, dueAt: at(600_000) };
  f.deadlines = [revision, f.deadlines[0], copy(revision)];
  const out = project(f);
  assert.equal(out.deadline.lastKnown.revision, 2);
  assert.equal(out.deadline.lastKnown.dueAt, at(600_000));
  assert.equal(out.deadline.evidence.length, 2);
  const next = observeServer(copy(f), 1);
  next.context = { locale: 'pt-BR', timeZone: 'America/Sao_Paulo', country: null };
  assert.equal(project(next).deadline.lastKnown.dueAt, out.deadline.lastKnown.dueAt);
});

test('equivalent offsets and locale/zone changes cannot move agreed deadline', () => {
  const f = fixture();
  f.deadlines[0].dueAt = '2026-10-17T07:05:00-05:00';
  f.serverObservation.observedAt = '2026-10-17T17:30:00+05:30';
  const before = project(f);
  f.context = { locale: 'es-MX', timeZone: 'Asia/Kolkata', country: 'BR' };
  assert.deepEqual(project(f), before);
  assert.equal(before.deadline.comparison, 'before');
  assert.equal(before.deadline.lastKnown.dueAt, '2026-10-17T07:05:00-05:00');
});

test('deadline exact boundary and server uncertainty have distinct comparisons', () => {
  const f = observeServer(fixture(), 300_000);
  assert.equal(project(f).deadline.comparison, 'reached');
  f.serverObservation.uncertaintyMs = 1;
  assert.equal(project(f).deadline.comparison, 'uncertain');
  observeServer(f, 299_998);
  assert.equal(project(f).deadline.comparison, 'before');
});

test('conflicting server revisions do not silently replace an agreed deadline', () => {
  const f = fixture();
  f.deadlines.push({ ...copy(f.deadlines[0]), id: 'CONTRADICTORY', dueAt: at(600_000) });
  const out = project(f);
  assert.equal(out.deadline.lastKnown, null);
  assert.equal(out.deadline.comparison, 'unknown');
  assert.equal(out.deadline.evidence.length, 2);
  assert.ok(out.deadline.reasons.includes('conflicting-revision'));
});

test('notification acceptance, delivery, failure and per-message histories stay separate', () => {
  const f = fixture();
  const accepted = copy(f.notifications[0]);
  f.notifications.push({ ...accepted, id: 'DELIVERY', revision: 2, state: 'delivered' },
    { ...accepted, id: 'SECOND', notificationId: 'MESSAGE-B', state: 'failed' });
  const out = project(f);
  assert.equal(out.notifications.messages[0].lastKnown.state, 'delivered');
  assert.equal(out.notifications.messages[0].evidence.length, 2);
  assert.equal(out.notifications.messages[1].lastKnown.state, 'failed');
  assert.equal(out.response.lastKnown.response, 'ok');
  f.notifications = [accepted];
  assert.equal(project(f).notifications.messages[0].lastKnown.state, 'accepted');
  noSafetyClaim(out);
});

test('old notification evidence is retained as stale; it does not imply current delivery', () => {
  const f = observeServer(fixture(), 60_000);
  const out = project(f);
  assert.equal(out.notifications.messages[0].status, 'stale');
  assert.equal(out.notifications.messages[0].lastKnown.state, 'accepted');
  assert.equal(out.notifications.messages[0].ageMs.min, 61_000);
});

test('notification conflicts remain unknown with both server records preserved', () => {
  const f = fixture();
  f.notifications.push({ ...copy(f.notifications[0]), id: 'CONFLICT', state: 'delivered' });
  const out = project(f);
  assert.equal(out.notifications.messages[0].status, 'unknown');
  assert.equal(out.notifications.messages[0].lastKnown, null);
  assert.equal(out.notifications.messages[0].evidence.length, 2);
});

test('local-only events cannot own deadlines or notification status', () => {
  for (const field of ['deadlines', 'notifications']) {
    const f = fixture();
    f[field][0].provenance.kind = 'device-observation';
    assert.throws(() => project(f), /provenance.kind/);
  }
});

test('trip mismatches fail explicitly instead of mixing evidence', () => {
  for (const field of ['responses', 'locations', 'deadlines', 'notifications']) {
    const f = fixture();
    f[field][0].tripId = 'OTHER';
    assert.throws(() => project(f), /another trip/);
  }
  const f = fixture();
  f.serverObservation.tripId = 'OTHER';
  assert.throws(() => project(f), /another trip/);
});

test('invalid calendar and timezone components are rejected rather than normalised', () => {
  for (const sourceAt of ['2026-02-30T12:00:00Z', '2026-10-17T24:00:00Z',
    '2026-10-17T12:00:00+00:99', '2026-10-17T12:00:00-24:00', '2026-10-17T12:00:00',
    '2026-10-17T12:00:00+00:00:99', '2026-10-17T12:00:00Z\n']) {
    const f = fixture();
    f.responses[0].sourceAt = sourceAt;
    assert.throws(() => project(f), /instant/);
  }
});

test('caller supplies every provisional budget; malformed values never become reassuring output', () => {
  for (const value of [undefined, NaN, Infinity, -1, '1000']) {
    const f = fixture();
    f.budgets.locationMs = value;
    assert.throws(() => project(f), /budgets.locationMs/);
  }
  const f = fixture();
  f.responses[0].timeUncertaintyMs = undefined;
  assert.throws(() => project(f), /timeUncertaintyMs/);
});

test('projection is deterministic, leaves inputs untouched and shares no mutable evidence', () => {
  const f = fixture();
  const original = copy(f);
  const first = project(f);
  assert.deepEqual(first, project(f));
  assert.deepEqual(f, original);
  first.response.lastKnown.response = 'fatigue';
  first.location.lastKnown.provenance.reference = 'changed';
  first.coverage.availability.visibility = 'hidden';
  assert.deepEqual(f, original);
  assert.deepEqual(project(f), project(original));
});
