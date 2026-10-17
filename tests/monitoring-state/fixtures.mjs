// Entirely synthetic phone observations, server records and separate observer log.
export const NOW = Date.parse('2026-10-17T12:00:00Z');
export const at = delta => new Date(NOW + delta).toISOString();
export const copy = value => structuredClone(value);

export function fixture() {
  const clock = { sessionId: 'SESSION-A', wallMs: NOW, monotonicMs: 10_000 };
  const common = { tripId: 'TRIP-SYNTH', sourceAt: at(-2000), receivedAt: at(-1000),
    timeUncertaintyMs: 0, sessionId: 'SESSION-A', sequence: 1 };
  return {
    tripId: 'TRIP-SYNTH', clock,
    previousClock: { ...clock, wallMs: NOW - 1000, monotonicMs: 9000 },
    serverObservation: { id: 'SERVER-SNAPSHOT-A', tripId: 'TRIP-SYNTH', observedAt: at(0),
      receivedClock: { ...clock }, uncertaintyMs: 0,
      provenance: { kind: 'server-observation', reference: 'synthetic-server-log:1' } },
    budgets: { responseMs: 10_000, locationMs: 10_000, notificationMs: 10_000,
      serverMs: 30_000, clockSkewMs: 100, maxTickGapMs: 5000, maxAccuracyMeters: 100 },
    availability: { visibility: 'visible', connection: 'online', locationPermission: 'granted' },
    responses: [{ ...common, id: 'RESPONSE-A', response: 'ok',
      provenance: { kind: 'driver-report', reference: 'synthetic-device-log:response-1' } }],
    locations: [{ ...common, id: 'LOCATION-A', latitude: 0, longitude: 0, accuracyMeters: 15,
      provenance: { kind: 'device-observation', reference: 'synthetic-device-log:position-1' } }],
    deadlines: [{ id: 'DEADLINE-A', tripId: 'TRIP-SYNTH', revision: 1, sourceAt: at(-60_000),
      receivedAt: at(-59_000), timeUncertaintyMs: 0, dueAt: at(300_000),
      provenance: { kind: 'server-state', reference: 'synthetic-server-log:deadline-1' } }],
    notifications: [{ id: 'NOTIFICATION-A', notificationId: 'MESSAGE-A', tripId: 'TRIP-SYNTH',
      revision: 1, sourceAt: at(-1000), receivedAt: at(-1000), timeUncertaintyMs: 0, state: 'accepted',
      provenance: { kind: 'server-state', reference: 'synthetic-server-log:accepted-1' } }],
    coverageGaps: [],
  };
}

export function observeServer(input, delta) {
  input.clock.wallMs = NOW + delta;
  input.clock.monotonicMs = 10_000 + delta;
  input.previousClock = { ...input.clock, wallMs: input.clock.wallMs - 1000,
    monotonicMs: input.clock.monotonicMs - 1000 };
  input.serverObservation.observedAt = at(delta);
  input.serverObservation.receivedClock = { ...input.clock };
  return input;
}

export function gap(start = -1000, end = null) {
  return { id: 'GAP-OBSERVER-A', tripId: 'TRIP-SYNTH', startAt: at(start), endAt: end === null ? null : at(end),
    provenance: { kind: 'independent-observer', reference: 'synthetic-observer-log:1' } };
}
