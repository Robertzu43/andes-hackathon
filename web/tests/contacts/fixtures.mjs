// Synthetic operation receipts only; not an auth backend or real participant evidence.
export const ids = { driver: '00000000-0000-4000-8000-000000000001', contact: '00000000-0000-4000-8000-000000000002',
  trip: '00000000-0000-4000-8000-000000000003', grant: '00000000-0000-4000-8000-000000000004',
  incident: '00000000-0000-4000-8000-000000000005', other: '00000000-0000-4000-8000-000000000006' };
export const hint = () => ({ id: ids.grant, driverId: ids.driver, contactId: ids.contact,
  requested: { map: true, incident: true } });
export const point = () => ({ tripId: ids.trip, freshness: 'stale', ageMs: 180_000,
  readAt: '2026-10-17T12:03:00.000Z', location: { capturedAt: '2026-10-17T12:00:00.000Z',
    receivedAt: '2026-10-17T12:02:59.000Z', latitude: 0, longitude: 0, accuracy: 15 } });
export const incident = () => ({ id: ids.incident, tripId: ids.trip, status: 'active',
  createdAt: '2026-10-17T12:00:00.000Z', resolvedAt: null, groupCapability: 'unavailable' });
// GET /v1/trips/:id/status as main's #74 returns it to the driver or an incident-scope contact.
export const tripStatus = () => ({ trip: { status: 'active', paused: false, expectedArrivalAt: null },
  check: { status: 'asking', reason: 'sharing_stopped', askUntil: '2026-10-17T12:06:00.000Z' },
  incident: { id: ids.incident, trigger: 'missed_check', checkReason: 'silence', status: 'active', label: null,
    createdAt: '2026-10-17T12:00:00.000Z' },
  deliveries: [{ role: 'colleague', channel: 'sms', status: 'pending', unavailableReason: null },
    { role: 'group', channel: 'group', status: 'unavailable', unavailableReason: 'group_support_unverified' }],
  location: { freshness: 'stale', ageMs: 180_000, capturedAt: '2026-10-17T12:00:00.000Z', accuracy: 15 } });
// What a map-only contact gets: no check, incident or deliveries, whatever is happening.
export const mapOnlyStatus = () => ({ ...tripStatus(), check: null, incident: null, deliveries: [] });
export function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const httpError = status => Object.assign(new Error('untrusted body must not reach state'), { status });
export function apiFixture(overrides = {}) {
  const calls = [];
  const implementations = {
    inviteContact: () => ({ id: ids.grant, status: 'pending' }),
    acceptContact: (id, body) => ({ id, ...body, status: 'accepted' }),
    revokeContact: id => ({ id, revoked: true }),
    revokeTripContact: (tripId, id) => ({ id, tripId, revoked: true }),
    getTripSnapshot: () => point(), getIncident: () => incident(), getTripStatus: () => tripStatus(),
    acknowledgeIncident: id => ({ id, status: 'active', recorded: 'acknowledged' }),
    reportIncidentAction: id => ({ id, status: 'active', recorded: 'action' }),
    resolveIncident: id => ({ id, status: 'resolved' }), ...overrides,
  };
  const api = Object.fromEntries(Object.entries(implementations).map(([method, action]) => [method, async (...args) => {
    calls.push({ method, args });
    return action(...args);
  }]));
  return { api, calls };
}
