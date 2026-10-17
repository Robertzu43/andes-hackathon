// Provisional local projection for #22. No clock reads, sends, storage or scheduling.
export const PROJECTION_VERSION = 'andes.monitoring-state.provisional/1';

const RESPONSES = ['ok', 'fatigue', 'sleepiness', 'help-request', 'security-concern',
  'reported-attempted-robbery', 'reported-robbery-theft', 'rest-planned', 'rest-started', 'rest-ended'];
const NOTIFICATIONS = ['scheduled', 'accepted', 'delivered', 'failed', 'cancelled'];

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be nonempty text`);
  return value;
}

function number(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`${name} out of range`);
  return value;
}

function choice(value, choices, name) {
  if (!choices.includes(value)) throw new TypeError(`${name} is unsupported`);
  return value;
}

// Check components before Date can normalise invalid dates or offsets.
function instant(value) {
  if (typeof value !== 'string') throw new TypeError('instant requires an explicit offset');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!m) throw new TypeError('instant must use YYYY-MM-DDTHH:MM:SS[.fff]Z or +/-HH:MM');
  const [, y, mo, d, h, mi, s, fraction, zone] = m;
  const date = new Date(0);
  date.setUTCFullYear(+y, +mo - 1, +d);
  date.setUTCHours(+h, +mi, +s, +(fraction ?? '').padEnd(3, '0'));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d
      || date.getUTCHours() !== +h || date.getUTCMinutes() !== +mi || date.getUTCSeconds() !== +s) {
    throw new TypeError('invalid calendar instant');
  }
  const offset = zone === 'Z' ? 0 : (zone[0] === '+' ? 1 : -1)
    * (+zone.slice(1, 3) * 60 + +zone.slice(4, 6)) * 60_000;
  return date.getTime() - offset;
}

function clock(value) {
  return { sessionId: text(value.sessionId, 'clock.sessionId'),
    wallMs: number(value.wallMs, 'clock.wallMs'),
    monotonicMs: number(value.monotonicMs, 'clock.monotonicMs') };
}

function provenance(value, kinds) {
  return { kind: choice(value?.kind, kinds, 'provenance.kind'),
    reference: text(value.reference, 'provenance.reference') };
}

function event(value, tripId, kind) {
  if (value.tripId !== tripId) throw new TypeError('event belongs to another trip');
  instant(value.sourceAt);
  instant(value.receivedAt);
  const uncertainty = value.timeUncertaintyMs === null ? null
    : number(value.timeUncertaintyMs, 'timeUncertaintyMs');
  const result = { id: text(value.id, 'event.id'), tripId, sourceAt: value.sourceAt,
    receivedAt: value.receivedAt, timeUncertaintyMs: uncertainty,
    provenance: provenance(value.provenance, [kind]) };
  if (kind !== 'server-state') {
    result.sessionId = text(value.sessionId, 'event.sessionId');
    result.sequence = number(value.sequence, 'event.sequence');
    if (!Number.isSafeInteger(result.sequence)) throw new TypeError('sequence must be an integer');
  } else {
    result.revision = number(value.revision, 'event.revision');
    if (!Number.isSafeInteger(result.revision)) throw new TypeError('revision must be an integer');
  }
  return result;
}

const unique = values => [...new Set(values)].sort();
const canonicalOrder = (a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;

function evidence(values) {
  // Normalised objects have a fixed key order, so equivalent duplicates collapse.
  return [...new Map(values.map(v => [JSON.stringify(v), v])).values()].sort(canonicalOrder);
}

function select(values, byRevision = false) {
  const records = evidence(values);
  const reasons = [];
  for (let i = 0; i < records.length; i++) {
    for (const b of records.slice(i + 1)) {
      const a = records[i];
      if (a.id === b.id) reasons.push('conflicting-event-id');
      if (byRevision && a.revision === b.revision) reasons.push('conflicting-revision');
      if (!byRevision && a.sessionId === b.sessionId) {
        if (a.sequence === b.sequence) reasons.push('conflicting-sequence');
        if ((a.sequence - b.sequence) * (instant(a.sourceAt) - instant(b.sourceAt)) < 0) {
          reasons.push('source-clock-reversal');
        }
      }
    }
  }
  if (!records.length || reasons.length) return { lastKnown: null, evidence: records, reasons: unique(reasons) };
  let latest;
  if (byRevision) latest = records.reduce((a, b) => a.revision > b.revision ? a : b);
  else {
    latest = records.reduce((a, b) => instant(a.sourceAt) > instant(b.sourceAt) ? a : b);
    if (records.length > 1 && records.some(other => other !== latest
      && (other.timeUncertaintyMs === null || latest.timeUncertaintyMs === null
        || instant(other.sourceAt) + other.timeUncertaintyMs >= instant(latest.sourceAt) - latest.timeUncertaintyMs))) {
      reasons.push('latest-source-time-uncertain');
      latest = null;
    }
  }
  return { lastKnown: latest, evidence: records, reasons };
}

function timeReference(input, now, previous, budgets) {
  const reasons = [];
  const compare = earlier => {
    if (earlier.sessionId !== now.sessionId) return { reasons: ['clock-session-changed'], elapsed: null };
    const mono = now.monotonicMs - earlier.monotonicMs;
    const wall = now.wallMs - earlier.wallMs;
    const failures = [];
    if (mono < 0 || wall < 0) failures.push('clock-reversed');
    if (Math.abs(wall - mono) > budgets.clockSkewMs) failures.push('clock-disagreement');
    return { reasons: failures, elapsed: { min: Math.min(mono, wall), max: Math.max(mono, wall) } };
  };
  const prior = previous ? compare(previous) : null;
  if (prior) reasons.push(...prior.reasons);
  const localGap = prior?.elapsed?.max > budgets.maxTickGapMs;
  if (localGap) reasons.push('local-observation-gap');
  if (!input) return { status: 'unknown', boundsMs: null, reasons: unique([...reasons, 'server-observation-missing']), localGap };
  if (input.tripId !== input.expectedTripId) throw new TypeError('server observation belongs to another trip');
  const received = clock(input.receivedClock);
  const p = provenance(input.provenance, ['server-observation']);
  const asOf = instant(input.observedAt);
  const uncertainty = number(input.uncertaintyMs, 'server.uncertaintyMs');
  const elapsed = compare(received);
  reasons.push(...elapsed.reasons);
  // A new server observation cannot explain a contradictory local clock sample.
  const usable = !elapsed.reasons.length && !(prior?.reasons.includes('clock-reversed')
    || prior?.reasons.includes('clock-disagreement'));
  return { status: !usable ? 'unknown' : elapsed.elapsed.max <= budgets.serverMs ? 'recent' : 'stale',
    boundsMs: usable ? { min: asOf + elapsed.elapsed.min - uncertainty, max: asOf + elapsed.elapsed.max + uncertainty } : null,
    observation: { id: text(input.id, 'server.id'), observedAt: input.observedAt,
      receivedClock: received, uncertaintyMs: uncertainty, provenance: p },
    reasons: unique(reasons), localGap };
}

function fact(selection, budget, time, gaps) {
  const result = { ...selection, status: 'unknown', ageMs: null, reasons: [...selection.reasons] };
  const value = selection.lastKnown;
  if (!value) return result;
  const source = instant(value.sourceAt);
  const receipt = instant(value.receivedAt);
  if (value.timeUncertaintyMs === null) result.reasons.push('source-time-uncertain');
  else {
    if (source - value.timeUncertaintyMs > receipt) result.reasons.push('source-after-server-receipt');
    if (gaps.some(g => source + value.timeUncertaintyMs >= instant(g.startAt)
      && (g.endAt === null || source - value.timeUncertaintyMs <= instant(g.endAt)))) {
      result.reasons.push('source-overlaps-unobserved-interval');
    }
    if (time.boundsMs) {
      result.ageMs = { min: time.boundsMs.min - source - value.timeUncertaintyMs,
        max: time.boundsMs.max - source + value.timeUncertaintyMs };
      if (receipt > time.boundsMs.max || result.ageMs.min < 0) result.reasons.push('event-in-server-future');
    }
  }
  if (time.status !== 'recent') result.reasons.push(`server-time-${time.status}`);
  if (result.ageMs && !result.reasons.length) {
    result.status = result.ageMs.max <= budget ? 'recent' : result.ageMs.min > budget ? 'stale' : 'unknown';
    if (result.status === 'unknown') result.reasons.push('freshness-boundary-uncertain');
  }
  result.reasons = unique(result.reasons);
  return result;
}

/** Derive facts from caller-supplied synthetic/provisional evidence; never certify monitoring. */
export function projectMonitoringState(input) {
  const tripId = text(input.tripId, 'tripId');
  const now = clock(input.clock);
  const previous = input.previousClock == null ? null : clock(input.previousClock);
  const budgets = {};
  for (const key of ['responseMs', 'locationMs', 'notificationMs', 'serverMs', 'clockSkewMs', 'maxTickGapMs', 'maxAccuracyMeters']) {
    budgets[key] = number(input.budgets?.[key], `budgets.${key}`);
  }
  const visibility = choice(input.availability?.visibility, ['visible', 'hidden', 'unknown'], 'visibility');
  const connection = choice(input.availability?.connection, ['online', 'offline', 'unknown'], 'connection');
  const permission = choice(input.availability?.locationPermission, ['granted', 'denied', 'prompt', 'unavailable', 'unknown'], 'locationPermission');
  const time = timeReference(input.serverObservation == null ? null
    : { ...input.serverObservation, expectedTripId: tripId }, now, previous, budgets);
  const gaps = evidence((input.coverageGaps ?? []).map(g => {
    if (g.tripId !== tripId) throw new TypeError('gap belongs to another trip');
    if (g.endAt !== null && instant(g.endAt) < instant(g.startAt)) throw new TypeError('gap ends before start');
    instant(g.startAt);
    return { id: text(g.id, 'gap.id'), tripId, startAt: g.startAt, endAt: g.endAt,
      provenance: provenance(g.provenance, ['independent-observer', 'device-observation', 'server-observation']) };
  }));
  const responses = (input.responses ?? []).map(v => ({ ...event(v, tripId, 'driver-report'),
    response: choice(v.response, RESPONSES, 'response') }));
  const locations = (input.locations ?? []).map(v => ({ ...event(v, tripId, 'device-observation'),
    latitude: number(v.latitude, 'latitude', -90, 90), longitude: number(v.longitude, 'longitude', -180, 180),
    accuracyMeters: v.accuracyMeters === null ? null : number(v.accuracyMeters, 'accuracyMeters') }));
  const usable = locations.filter(v => v.accuracyMeters !== null && v.accuracyMeters <= budgets.maxAccuracyMeters);
  // Inspect all location events for identity/clock conflicts, including unusable points.
  const locationHistory = select(locations);
  const location = fact(locationHistory.reasons.length ? locationHistory : select(usable), budgets.locationMs, time, gaps);
  location.unusableEvidence = evidence(locations.filter(v => !usable.includes(v)));
  location.freshness = location.status;
  if (permission !== 'granted') {
    location.status = permission === 'denied' || permission === 'unavailable' ? 'unavailable' : 'unknown';
    location.reasons = unique([...location.reasons, `location-permission-${permission}`]);
  }
  const deadlines = (input.deadlines ?? []).map(v => {
    if (instant(v.dueAt) < instant(v.sourceAt)) throw new TypeError('deadline precedes agreement');
    return { ...event(v, tripId, 'server-state'), dueAt: v.dueAt };
  });
  const deadlineFact = fact(select(deadlines, true), budgets.serverMs, time, []);
  const deadline = { ...deadlineFact, owner: 'server', comparison: 'unknown' };
  if (deadline.lastKnown && !deadline.reasons.length && time.status === 'recent') {
    const due = instant(deadline.lastKnown.dueAt);
    deadline.comparison = time.boundsMs.min >= due ? 'reached'
      : time.boundsMs.max < due ? 'before' : 'uncertain';
  }
  const notifications = (input.notifications ?? []).map(v => ({ ...event(v, tripId, 'server-state'),
    notificationId: text(v.notificationId, 'notificationId'),
    state: choice(v.state, NOTIFICATIONS, 'notification.state') }));
  const notificationFacts = unique(notifications.map(v => v.notificationId)).map(notificationId => ({
    notificationId,
    ...fact(select(notifications.filter(v => v.notificationId === notificationId), true), budgets.notificationMs, time, []),
  }));
  const interrupted = gaps.length > 0 || time.localGap || time.reasons.some(r => r.startsWith('clock-'))
    || visibility === 'hidden' || connection === 'offline' || permission === 'denied' || permission === 'unavailable';
  return { version: PROJECTION_VERSION, tripId, time,
    response: fact(select(responses), budgets.responseMs, time, gaps), location, deadline,
    notifications: { status: notificationFacts.length ? 'recorded' : 'unknown', messages: notificationFacts },
    coverage: { status: interrupted ? 'interrupted' : 'unknown', gaps,
      availability: { visibility, connection, locationPermission: permission } },
    liveMonitoring: false, wellbeing: 'unknown', incidentCause: 'unknown' };
}
