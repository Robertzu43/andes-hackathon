// Independent receipt checks. No network, database, device or provider access.
export const BACKEND_SHA = '5591c9b55fe7f4505e36ccee96d27aa913e0debf';
export const SCHEMA = 'andes.app-acceptance.receipt/1';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = x => typeof x === 'string' && x.length > 0 && x.length <= 160;
const time = x => typeof x === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const same = (a, b) => id(a) && a === b;
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function http(steps, index, method, route, actor, status = 200) {
  const s = steps[index];
  requireThat(object(s) && s.method === method && s.route === route && s.actor === actor,
    `step ${index + 1}: expected ${actor} ${method} ${route}`);
  requireThat(s.status === status && object(s.response), `step ${index + 1}: expected HTTP ${status} JSON`);
  return s;
}
function eq(value, expected, message) { requireThat(value === expected, message); }
const tripFields = ['truckId', 'origin', 'destination', 'country', 'locale', 'timeZone'];

// Normalized route patterns are taken from Robert's actual registered routes.
// These are observations of a run, never an implementation of backend state.
export const CASES = [
  { id: 'setup', issues: [14, 15], source: 'src/contacts/routes.ts', check(s) {
    requireThat(id(http(s, 0, 'GET', '/v1/me', 'driver').response.id), 'driver identity absent');
    requireThat(id(http(s, 1, 'POST', '/v1/trucks', 'driver').response.id), 'owned truck absent');
    const invite = http(s, 2, 'POST', '/v1/contacts', 'driver');
    eq(invite.response.status, 'pending', 'invitation is not acceptance');
    const accept = http(s, 3, 'POST', '/v1/contacts/:id/accept', 'contact');
    eq(accept.response.status, 'accepted', 'contact acceptance missing');
    requireThat(same(invite.response.id, accept.response.id), 'different consent invitation accepted');
    requireThat(invite.request?.map === true || invite.request?.incident === true, 'invitation has no requested scope');
    requireThat(accept.request?.map === true || accept.request?.incident === true, 'acceptance has no permitted scope');
    for (const scope of ['map', 'incident']) {
      requireThat(typeof invite.request?.[scope] === 'boolean' && typeof accept.request?.[scope] === 'boolean', 'scope observation absent');
      requireThat(!accept.request[scope] || invite.request[scope], 'scope widened at acceptance');
      eq(accept.response[scope], accept.request[scope], 'accepted scope differs from request');
    }
  } },
  { id: 'explicit-confirm', issues: [16], source: 'src/trips/routes.ts', check(s) {
    const draft = http(s, 0, 'POST', '/v1/trip-drafts', 'driver');
    eq(draft.response.status, 'draft', 'draft activated before confirmation');
    const confirm = http(s, 1, 'POST', '/v1/trip-drafts/:id/confirm', 'driver');
    eq(confirm.request?.confirmed, true, 'explicit confirmation missing');
    eq(confirm.response.status, 'active', 'confirmation not persisted');
    requireThat(same(draft.response.id, confirm.response.id), 'confirmed another draft');
    requireThat(Array.isArray(confirm.request.contactGrantIds), 'selected grants missing');
    const entered = { ...draft.request?.fields, ...confirm.request?.fields };
    for (const key of tripFields) {
      requireThat(id(entered[key]), `missing explicitly entered ${key}`);
      eq(confirm.response.fields?.[key], entered[key], `confirmed ${key} differs from entered value`);
    }
  } },
  { id: 'duplicate-confirm', issues: [16], source: 'src/trips/routes.ts', check(s) {
    const first = http(s, 0, 'POST', '/v1/trip-drafts/:id/confirm', 'driver');
    const replay = http(s, 1, 'POST', '/v1/trip-drafts/:id/confirm', 'driver');
    requireThat(same(first.response.id, replay.response.id), 'idempotent replay created another trip');
    eq(first.response.status, 'active', 'initial confirmation not active');
    eq(replay.response.status, first.response.status, 'replay changed persisted confirmation');
    eq(first.keyAlias, replay.keyAlias, 'replay uses a different key');
    requireThat(id(first.keyAlias), 'opaque idempotency key alias missing');
    const conflict = http(s, 2, 'POST', '/v1/trip-drafts/:id/confirm', 'driver', 409);
    requireThat(id(conflict.keyAlias) && conflict.keyAlias !== first.keyAlias, 'new-key conflict control absent');
  } },
  { id: 'stale-snapshot', issues: [19, 21, 22], source: 'src/location/routes.ts', check(s) {
    const fresh = http(s, 0, 'GET', '/v1/trips/:id/snapshot', 'contact').response;
    const stale = http(s, 1, 'GET', '/v1/trips/:id/snapshot', 'contact').response;
    for (const b of [fresh, stale]) {
      requireThat(time(b.location?.capturedAt) && time(b.location?.receivedAt) && time(b.readAt), 'capture/receipt/read clocks absent');
      requireThat(Number.isFinite(b.ageMs) && b.ageMs >= 0, 'invalid source age');
      eq(b.ageMs, Math.max(0, Date.parse(b.readAt) - Date.parse(b.location.capturedAt)), 'age uses receipt instead of capture');
    }
    eq(fresh.freshness, 'fresh', 'fresh control absent');
    requireThat(fresh.ageMs <= 120000, 'fresh beyond current engineering limit');
    eq(stale.freshness, 'stale', 'stale fix silently refreshed');
    requireThat(stale.ageMs > 120000, 'stale control not actually stale');
    eq(stale.location.capturedAt, fresh.location.capturedAt, 'aging control replaced source fix');
    requireThat(same(stale.tripId, fresh.tripId), 'aging control needs the same nonempty trip identity');
  } },
  { id: 'unavailable-snapshot', issues: [21, 22], source: 'src/location/routes.ts', check(s) {
    const b = http(s, 0, 'GET', '/v1/trips/:id/snapshot', 'contact').response;
    eq(b.location, null, 'absent source became location'); eq(b.ageMs, null, 'absent age invented');
    eq(b.freshness, 'unavailable', 'absence called fresh');
  } },
  { id: 'revocation', issues: [15, 22], source: 'src/contacts/routes.ts', check(s) {
    eq(http(s, 0, 'POST', '/v1/trips/:id/contacts/:grantId/revoke', 'contact').response.revoked, true, 'revoke not persisted');
    http(s, 1, 'GET', '/v1/trips/:id/snapshot', 'contact', 403);
    http(s, 2, 'GET', '/v1/incidents/:id', 'contact', 403);
  } },
  { id: 'sos-acceptance', issues: [29, 31, 32], source: 'src/incidents/routes.ts', check(s) {
    const first = http(s, 0, 'POST', '/v1/trips/:id/sos', 'driver').response;
    const second = http(s, 1, 'POST', '/v1/trips/:id/sos', 'driver').response;
    requireThat(same(first.id, second.id), 'duplicate SOS created concurrent episode');
    for (const body of [first, second]) {
      eq(body.status, 'active', 'server did not preserve active report');
      eq(body.groupCapability, 'unavailable', 'unsupported group capability invented');
      requireThat(!('delivered' in body) && !('providerAccepted' in body), 'SOS HTTP acceptance was upgraded to provider outcome');
    }
  } },
  { id: 'acknowledgement-action', issues: [32, 35], source: 'src/incidents/routes.ts', check(s) {
    const ack = http(s, 0, 'POST', '/v1/incidents/:id/acknowledgements', 'contact').response;
    eq(ack.recorded, 'acknowledged', 'acknowledgement relabelled action'); eq(ack.status, 'active', 'ack closed incident');
    const action = http(s, 1, 'POST', '/v1/incidents/:id/actions', 'contact');
    requireThat(id(action.request?.action), 'reported action absent');
    eq(action.response.recorded, 'action', 'action not recorded separately');
    eq(action.response.status, 'active', 'action silently resolved incident');
    requireThat(same(ack.id, action.response.id), 'ack and action refer to different incidents');
  } },
  { id: 'arrival-preserves-sos', issues: [17, 29], source: 'src/trips/routes.ts', check(s) {
    const sos = http(s, 0, 'POST', '/v1/trips/:id/sos', 'driver').response;
    const arrival = http(s, 1, 'POST', '/v1/trips/:id/commands', 'driver');
    eq(arrival.request?.type, 'arrived', 'arrival input absent');
    eq(arrival.response.command, 'arrived', 'arrival not recorded');
    const incident = http(s, 2, 'GET', '/v1/incidents/:id', 'contact').response;
    requireThat(same(sos.id, incident.id), 'read another incident after arrival');
    eq(incident.status, 'active', 'arrival resolved SOS'); eq(incident.resolvedAt, null, 'resolution invented');
    http(s, 3, 'GET', '/v1/trips/:id/snapshot', 'contact', 403);
  } },
  { id: 'owner-resolution', issues: [29, 35], source: 'src/incidents/routes.ts', check(s) {
    http(s, 0, 'POST', '/v1/incidents/:id/resolve', 'contact', 403);
    eq(http(s, 1, 'POST', '/v1/incidents/:id/resolve', 'driver').response.status, 'resolved', 'owner resolution absent');
  } },
  { id: 'cross-user', issues: [14, 15], source: 'src/auth.ts', check(s) {
    http(s, 0, 'GET', '/v1/trips/:id', 'stranger', 403);
    http(s, 1, 'POST', '/v1/trips/:id/sos', 'stranger', 403);
  } },
  { id: 'self-report', issues: [24, 25], source: 'src/trips/routes.ts', check(s) {
    for (const [index, type] of ['checkin_ok', 'rest_report'].entries()) {
      const b = http(s, index, 'POST', '/v1/trips/:id/commands', 'driver');
      eq(b.request?.type, type, 'report input absent'); eq(b.response.command, type, 'report not recorded');
      eq(b.response.automaticEscalation, false, 'self-report upgraded to automatic policy');
    }
  } },
];

export function evaluate(receipt) {
  const errors = [];
  if (!object(receipt) || receipt.schema !== SCHEMA) errors.push('unknown receipt schema');
  if (!['synthetic-control', 'isolated-backend-run'].includes(receipt?.kind)) errors.push('evidence kind required');
  if (receipt?.backendSha !== BACKEND_SHA) errors.push('backend revision differs; rebind and review oracle before reuse');
  if (receipt?.externalSends !== false || receipt?.isolatedDatabase !== true) errors.push('isolated, sends-off context required');
  if (!id(receipt?.producer) || !id(receipt?.command)) errors.push('producer and execution command required');
  if (!Array.isArray(receipt?.cases) || receipt.cases.length > CASES.length) errors.push('bounded case array required');
  const entries = Array.isArray(receipt?.cases) ? receipt.cases : [];
  const known = new Set(CASES.map(c => c.id)), seen = new Set();
  for (const c of entries) {
    if (!known.has(c?.id) || seen.has(c?.id)) errors.push('unknown or duplicate case ID');
    seen.add(c?.id);
    if (!Array.isArray(c?.steps) || c.steps.length > 40) errors.push('bounded steps required');
  }
  if (errors.length) return { schema: 'andes.app-acceptance.result/1', disposition: 'fix', errors, cases: [], wholeAppAccepted: false };
  const cases = CASES.map(c => {
    const entry = entries.find(x => x.id === c.id);
    if (!entry) return { id: c.id, status: 'pending', reason: 'no recorded case' };
    try { c.check(entry.steps); return { id: c.id, status: 'pass' }; }
    catch (error) { return { id: c.id, status: 'fail', reason: error.message }; }
  });
  const failed = cases.some(c => c.status === 'fail'), missing = cases.some(c => c.status === 'pending');
  return {
    schema: 'andes.app-acceptance.result/1', backendSha: BACKEND_SHA, kind: receipt.kind,
    disposition: failed ? 'fix' : missing || receipt.kind === 'synthetic-control' ? 'inconclusive' : 'backend-receipt-checks-pass',
    cases, wholeAppAccepted: false,
    remaining: ['independent actual browser interactions and versioned UI proof', 'ES/pt-BR mobile accessibility and contrast',
      'physical phone/human/provider qualification remains separate'],
    limits: 'Receipt assertions cannot authenticate their producer or establish physical, provider or whole-app evidence.',
  };
}
