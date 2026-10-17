// Reviewer-owned synthetic inputs. These are HTTP examples, never observed evidence.
export const CONTRACT = Object.freeze({
  backend: 'ebc8fb1d36f441ef012ca585201cefabf61383d6',
  phoneBoundary: 'b34ca56a79515104d7412d46f0e20d7045a5ba8e',
  monitoringBoundary: 'e9df5cbfd5c2cfbb19698d46bb957b8561920e66',
  source: 'docs/contracts/runtime.md',
});
export const ORIGIN = 'https://andes.synthetic.invalid';
export const NOW = Date.parse('2026-10-17T18:00:00Z');
export const IDS = Object.freeze(Object.fromEntries([
  ['driver', 1], ['otherDriver', 2], ['contact', 3], ['truck', 4],
  ['trip', 5], ['otherTrip', 6], ['grant', 7], ['incident', 8],
].map(([name, number]) => [name, `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`])));
export const clone = (value) => structuredClone(value);

export function snapshot({ sourceAgeMs = 300_000, receivedAgeMs = 0 } = {}) {
  return {
    tripId: IDS.trip,
    location: {
      capturedAt: new Date(NOW - sourceAgeMs).toISOString(),
      receivedAt: new Date(NOW - receivedAgeMs).toISOString(),
      latitude: 0, longitude: 0, accuracy: 15,
    },
    freshness: sourceAgeMs > 120_000 ? 'stale' : 'fresh',
    ageMs: sourceAgeMs, readAt: new Date(NOW).toISOString(),
  };
}

export const REGIONAL_FIELDS = Object.freeze({
  truckId: IDS.truck, origin: 'Synthetic freight origin', destination: 'Synthetic freight destination',
  country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo',
});

// No list/read routes are guessed. Lane41's later contract must add them explicitly.
export const OPERATIONS = Object.freeze([
  { name: 'identity', method: 'GET', path: '/v1/me', response: { id: IDS.driver } },
  { name: 'createTruck', method: 'POST', path: '/v1/trucks', body: { label: 'Synthetic truck' }, response: { id: IDS.truck } },
  { name: 'inviteContact', method: 'POST', path: '/v1/contacts',
    body: { contactId: IDS.contact, phone: '+15555550100', map: true, incident: true }, response: { id: IDS.grant, status: 'pending' } },
  { name: 'acceptContact', method: 'POST', path: `/v1/contacts/${IDS.grant}/accept`,
    body: { map: true, incident: false }, response: { id: IDS.grant, map: true, incident: false, status: 'accepted' } },
  { name: 'revokeStanding', method: 'POST', path: `/v1/contacts/${IDS.grant}/revoke`, body: {}, response: { id: IDS.grant, revoked: true } },
  { name: 'createDraft', method: 'POST', path: '/v1/trip-drafts',
    body: { text: 'Synthetic freight trip; no extraction asserted' },
    response: { id: IDS.trip, rawText: 'Synthetic freight trip; no extraction asserted', fields: {},
      missingFields: ['truckId', 'origin', 'destination', 'country', 'locale', 'timeZone'], status: 'draft' } },
  { name: 'confirmTrip', method: 'POST', path: `/v1/trip-drafts/${IDS.trip}/confirm`,
    body: { confirmed: true, contactGrantIds: [], fields: clone(REGIONAL_FIELDS) },
    response: { id: IDS.trip, status: 'active', fields: clone(REGIONAL_FIELDS) } },
  { name: 'command', method: 'POST', path: `/v1/trips/${IDS.trip}/commands`, body: { type: 'checkin_ok' },
    response: { id: IDS.trip, command: 'checkin_ok', automaticEscalation: false } },
  { name: 'uploadLocations', method: 'POST', path: `/v1/trips/${IDS.trip}/locations`,
    body: { observations: [{ capturedAt: new Date(NOW - 300_000).toISOString(), latitude: 0, longitude: 0, accuracy: 15 }] },
    response: { id: IDS.trip, received: 1 } },
  { name: 'snapshot', method: 'GET', path: `/v1/trips/${IDS.trip}/snapshot`, response: snapshot() },
  { name: 'revokeTrip', method: 'POST', path: `/v1/trips/${IDS.trip}/contacts/${IDS.grant}/revoke`,
    body: {}, response: { id: IDS.grant, tripId: IDS.trip, revoked: true } },
  { name: 'sos', method: 'POST', path: `/v1/trips/${IDS.trip}/sos`, body: {},
    response: { id: IDS.incident, tripId: IDS.trip, status: 'active', groupCapability: 'unavailable' } },
  { name: 'incident', method: 'GET', path: `/v1/incidents/${IDS.incident}`,
    response: { id: IDS.incident, tripId: IDS.trip, status: 'active', createdAt: new Date(NOW).toISOString(), resolvedAt: null, groupCapability: 'unavailable' } },
  { name: 'acknowledge', method: 'POST', path: `/v1/incidents/${IDS.incident}/acknowledgements`, body: {},
    response: { id: IDS.incident, status: 'active', recorded: 'acknowledged' } },
  { name: 'action', method: 'POST', path: `/v1/incidents/${IDS.incident}/actions`, body: { action: 'Synthetic attributed action' },
    response: { id: IDS.incident, status: 'active', recorded: 'action' } },
  { name: 'resolve', method: 'POST', path: `/v1/incidents/${IDS.incident}/resolve`, body: {},
    response: { id: IDS.incident, status: 'resolved' } },
]);

export const ERRORS = Object.freeze([
  { status: 400, code: 'capture_time_out_of_bounds' },
  { status: 401, code: 'unauthorized' },
  { status: 403, code: 'forbidden' },
  { status: 404, code: 'incident_not_found' },
  { status: 409, code: 'idempotency_conflict' },
  { status: 422, code: 'unsupported_audio' },
  { status: 500, code: 'internal_error' },
]);

export function locationSample(sequence = 1, overrides = {}) {
  return {
    eventId: `synthetic-session:${sequence}`, tripId: IDS.trip, sessionId: 'synthetic-session',
    sequence, sourceAtMs: NOW - 300_000 + sequence * 1000,
    latitude: 0, longitude: 0, accuracy: 15, ...overrides,
  };
}
