import { narrowScope, operationalPrivacy, sharingScope, type SharingScope } from '../privacy/consent.ts';

// Semantic seam for lane45's authenticated transport; this module never owns tokens or fetch.
export interface ReadOptions { signal: AbortSignal }
export interface WriteOptions extends ReadOptions { idempotencyKey: string }
export interface ContactApi {
  inviteContact(body: SharingScope & { contactId: string; phone: string }, options: WriteOptions): Promise<unknown>;
  acceptContact(id: string, body: SharingScope, options: WriteOptions): Promise<unknown>;
  revokeContact(id: string, options: WriteOptions): Promise<unknown>;
  revokeTripContact(tripId: string, grantId: string, options: WriteOptions): Promise<unknown>;
  getTripSnapshot(tripId: string, options: ReadOptions): Promise<unknown>;
  getIncident(id: string, options: ReadOptions): Promise<unknown>;
  acknowledgeIncident(id: string, options: WriteOptions): Promise<unknown>;
  reportIncidentAction(id: string, body: { action: string }, options: WriteOptions): Promise<unknown>;
  resolveIncident(id: string, options: WriteOptions): Promise<unknown>;
}
export interface Session { actorId: string; view: 'driver' | 'contact' }
/** A caller-supplied invitation hint, NOT a grant read or proof of current consent. */
export interface Invitation {
  id: string; driverId: string; contactId: string; requested: SharingScope;
  accepted: SharingScope | null; status: 'pending' | 'accepted' | 'revoked';
}
interface TripSelection { id: string; driverId: string }
interface Location {
  capturedAt: string; receivedAt: string; latitude: number; longitude: number; accuracy: number;
}
export interface Snapshot {
  tripId: string; location: Location | null; freshness: 'fresh' | 'stale' | 'unavailable';
  ageMs: number | null; readAt: string;
}
interface Incident {
  id: string; tripId: string; status: 'active' | 'resolved'; createdAt: string;
  resolvedAt: string | null; groupCapability: 'unavailable';
}
type ReadState<T> = { status: 'unread' | 'loading' | 'recorded' | 'denied' | 'unknown'; data: T | null };
type Operation = { kind: string; status: 'idle' | 'pending' | 'recorded' | 'rejected' | 'uncertain';
  failure: 'authentication' | 'forbidden' | 'missing' | 'conflict' | 'invalid' | 'unsupported' | 'server' | 'network' | null };
interface State {
  session: Session | null; trip: TripSelection | null; invitation: Invitation | null;
  location: ReadState<Snapshot>; incident: ReadState<Incident>;
  receipts: { actorId: string; incidentId: string; recorded: 'acknowledged' | 'action'; action: string | null }[];
  tripRevoked: boolean; operation: Operation;
}
const unread = <T>(): ReadState<T> => ({ status: 'unread', data: null });
const idle = (): Operation => ({ kind: '', status: 'idle', failure: null });
const uuid = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) {
    throw new TypeError('Expected an API UUID');
  }
  return value.toLowerCase();
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid API response');
  return value as Record<string, unknown>;
};
const instant = (value: unknown): string => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) throw new TypeError('Expected the API ISO timestamp');
  return value;
};
function match(value: unknown, expected: unknown) {
  if (value !== expected) throw new TypeError('API response does not match the request');
}
function failure(error: unknown): Operation['failure'] {
  const status = (error as { status?: number; statusCode?: number })?.status
    ?? (error as { statusCode?: number })?.statusCode;
  const categories: Record<number, NonNullable<Operation['failure']>> = {
    400: 'invalid', 401: 'authentication', 403: 'forbidden', 404: 'missing', 409: 'conflict', 422: 'unsupported',
  };
  return categories[status ?? 0] ?? (status ? 'server' : 'network');
}

/** Age a cached observation without relabelling it live or refreshing its authorization. */
export function locationAge(snapshot: Snapshot, nowMs: number) {
  const read = Date.parse(snapshot.readAt);
  const captured = snapshot.location ? Date.parse(snapshot.location.capturedAt) : null;
  const known = snapshot.ageMs !== null && captured !== null && Number.isFinite(nowMs)
    && nowMs >= read && captured <= read;
  return { ageMs: known ? snapshot.ageMs! + nowMs - read : null,
    serverFreshnessAtRead: snapshot.freshness, readAt: snapshot.readAt,
    live: false, currentAuthorization: 'requires-server-check' } as const;
}

/** Headless journey. Local view selection never grants server authority. */
export function createContactJourney(api: ContactApi, keyFactory: () => string = () => crypto.randomUUID()) {
  let state: State = { session: null, trip: null, invitation: null, location: unread(),
    incident: unread(), receipts: [], tripRevoked: false, operation: idle() };
  let epoch = 0;
  const requests = new Set<AbortController>();
  const reads = { location: 0, incident: 0 };
  let retry: (() => Promise<'recorded' | 'superseded' | 'rejected' | 'uncertain'>) | null = null;
  function invalidate(preserveUncertain = false) {
    const uncertain = preserveUncertain && state.operation.status === 'uncertain'
      ? { operation: state.operation, retry } : null;
    epoch++;
    for (const request of requests) request.abort();
    requests.clear();
    retry = null;
    state.location = unread(); state.incident = unread(); state.receipts = [];
    state.operation = uncertain?.operation ?? idle();
    if (uncertain) retry = uncertain.retry;
  }
  function session(view?: Session['view']) {
    if (!state.session || (view && state.session.view !== view)) throw new TypeError('Choose the authenticated journey view');
    return state.session;
  }
  function trip() {
    session();
    if (!state.trip) throw new TypeError('Select a trip');
    return state.trip;
  }
  function activeIncident(view: Session['view']) {
    const actor = session(view);
    const selected = trip();
    if (view === 'driver' && selected.driverId !== actor.actorId) throw new TypeError('Only the driver may resolve');
    if (!state.incident.data || state.incident.data.status !== 'active') throw new TypeError('Read an active incident first');
    return state.incident.data.id;
  }
  async function write(kind: string, request: (options: WriteOptions) => Promise<unknown>,
    apply: (body: Record<string, unknown>) => void, existingKey?: string) {
    session();
    if (state.operation.status === 'pending') throw new TypeError('A command is already pending');
    if (state.operation.status === 'uncertain' && !existingKey) throw new TypeError('Retry the unchanged command explicitly');
    const key = existingKey ?? keyFactory();
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key)) throw new TypeError('Invalid idempotency key');
    const started = epoch;
    const controller = new AbortController(); requests.add(controller);
    state.operation = { kind, status: 'pending', failure: null };
    retry = null;
    try {
      const response = await request({ signal: controller.signal, idempotencyKey: key });
      if (started !== epoch) return 'superseded' as const;
      apply(object(response));
      state.operation = { kind, status: 'recorded', failure: null };
      return 'recorded' as const;
    } catch (error) {
      if (started !== epoch) return 'superseded' as const;
      const reason = failure(error);
      // A later refusal is evidence about that attempt, not proof the first write did not commit.
      const uncertain = existingKey !== undefined || reason === 'network' || reason === 'server';
      if (reason === 'authentication' || reason === 'forbidden' || reason === 'missing') {
        invalidate();
      }
      if (reason === 'authentication') {
        state.session = null; state.trip = null; state.invitation = null;
      }
      state.operation = { kind, status: uncertain ? 'uncertain' : 'rejected', failure: reason };
      if (uncertain && state.session) retry = () => write(kind, request, apply, key);
      return uncertain ? 'uncertain' as const : 'rejected' as const;
    } finally { requests.delete(controller); }
  }
  async function read<T>(slot: 'location' | 'incident', request: (options: ReadOptions) => Promise<unknown>,
    parse: (body: Record<string, unknown>) => T) {
    session();
    if (state.operation.kind.startsWith('revoke') && ['pending', 'uncertain'].includes(state.operation.status)) {
      throw new TypeError('Wait for the revocation outcome before another protected read');
    }
    const started = epoch; const sequence = ++reads[slot];
    const controller = new AbortController(); requests.add(controller);
    state[slot] = { status: 'loading', data: null };
    if (slot === 'incident') state.receipts = [];
    try {
      const raw = await request({ signal: controller.signal });
      if (started !== epoch || sequence !== reads[slot]) return 'superseded' as const;
      const data = parse(object(raw));
      if (slot === 'location') state.location = { status: 'recorded', data: data as Snapshot };
      else state.incident = { status: 'recorded', data: data as Incident };
      return 'recorded' as const;
    } catch (error) {
      if (started !== epoch || sequence !== reads[slot]) return 'superseded' as const;
      const reason = failure(error);
      if (reason === 'authentication' || reason === 'forbidden' || reason === 'missing') {
        invalidate(true);
        if (reason === 'authentication') { state.session = null; state.trip = null; state.invitation = null; retry = null; }
      }
      state[slot] = { status: ['authentication', 'forbidden', 'missing'].includes(reason!) ? 'denied' : 'unknown', data: null };
      return 'unavailable' as const;
    } finally { requests.delete(controller); }
  }
  return {
    getState() {
      return structuredClone({ ...state, privacy: operationalPrivacy({
        standingReceipt: state.invitation?.status ?? 'unknown', tripRevoked: state.tripRevoked,
      }) });
    },
    setSession(value: Session | null) {
      const next = value ? { actorId: uuid(value.actorId), view: value.view } : null;
      if (next && !['driver', 'contact'].includes(next.view)) throw new TypeError('Unknown view');
      invalidate(); state.session = next; state.trip = null; state.invitation = null; state.tripRevoked = false;
    },
    selectTrip(value: TripSelection) {
      session();
      const next = { id: uuid(value.id), driverId: uuid(value.driverId) };
      invalidate(); state.trip = next; state.tripRevoked = false;
    },
    inviteContact(value: SharingScope & { contactId: string; phone: string }) {
      const actor = session('driver');
      const body = { contactId: uuid(value.contactId), phone: value.phone, ...sharingScope(value) };
      if (body.contactId === actor.actorId || !/^\+[1-9]\d{6,14}$/.test(body.phone)) throw new TypeError('Invalid invitation destination');
      return write('invite', options => api.inviteContact(structuredClone(body), options), response => {
        match(response.status, 'pending');
        state.invitation = { id: uuid(response.id), driverId: actor.actorId, contactId: body.contactId,
          requested: { map: body.map, incident: body.incident }, accepted: null, status: 'pending' };
      });
    },
    acceptInvitation(hint: Pick<Invitation, 'id' | 'driverId' | 'contactId' | 'requested'>, choice: SharingScope) {
      const actor = session('contact');
      const id = uuid(hint.id); const driverId = uuid(hint.driverId); const contactId = uuid(hint.contactId);
      if (actor.actorId !== contactId || driverId === contactId) throw new TypeError('Invitation is for another identity');
      const requested = sharingScope(hint.requested); const body = narrowScope(requested, choice);
      return write('accept', options => api.acceptContact(id, structuredClone(body), options), response => {
        match(uuid(response.id), id); match(response.status, 'accepted');
        match(response.map, body.map); match(response.incident, body.incident);
        state.invitation = { id, driverId, contactId, requested, accepted: body, status: 'accepted' };
      });
    },
    revokeStanding(grantId: string) {
      session(); const id = uuid(grantId);
      invalidate(); // Conceal protected data before any revoke outcome, including an ambiguous write.
      return write('revoke-standing', options => api.revokeContact(id, options), response => {
        match(uuid(response.id), id); match(response.revoked, true);
        invalidate();
        if (state.invitation?.id === id) state.invitation = { ...state.invitation, status: 'revoked' };
      });
    },
    revokeTrip(grantId: string) {
      const selected = trip(); const id = uuid(grantId);
      invalidate();
      return write('revoke-trip', options => api.revokeTripContact(selected.id, id, options), response => {
        match(uuid(response.id), id); match(uuid(response.tripId), selected.id); match(response.revoked, true);
        invalidate();
        state.tripRevoked = true;
      });
    },
    loadLocation() {
      const selected = trip();
      return read('location', options => api.getTripSnapshot(selected.id, options), response => {
        match(uuid(response.tripId), selected.id);
        const readAt = instant(response.readAt);
        if (response.location === null) {
          match(response.freshness, 'unavailable'); match(response.ageMs, null);
          return { tripId: selected.id, readAt, location: null, ageMs: null, freshness: 'unavailable' } as Snapshot;
        }
        const point = object(response.location);
        for (const [field, minimum, maximum] of [['latitude', -90, 90], ['longitude', -180, 180], ['accuracy', 0, 100000]] as const) {
          if (typeof point[field] !== 'number' || !Number.isFinite(point[field]) || point[field] < minimum || point[field] > maximum) throw new TypeError('Invalid location');
        }
        if (!['fresh', 'stale'].includes(response.freshness as string) || typeof response.ageMs !== 'number'
          || !Number.isFinite(response.ageMs) || response.ageMs < 0) throw new TypeError('Invalid location age');
        return { tripId: selected.id, readAt, freshness: response.freshness, ageMs: response.ageMs,
          location: { capturedAt: instant(point.capturedAt), receivedAt: instant(point.receivedAt),
            latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy } } as Snapshot;
      });
    },
    loadIncident(incidentId: string) {
      const selected = trip(); const id = uuid(incidentId);
      return read('incident', options => api.getIncident(id, options), response => {
        match(uuid(response.id), id); match(uuid(response.tripId), selected.id); match(response.groupCapability, 'unavailable');
        if (!['active', 'resolved'].includes(response.status as string)) throw new TypeError('Invalid incident');
        const resolvedAt = response.resolvedAt === null ? null : instant(response.resolvedAt);
        if ((response.status === 'resolved') !== (resolvedAt !== null)) throw new TypeError('Contradictory incident status');
        return { id, tripId: selected.id, status: response.status, createdAt: instant(response.createdAt),
          resolvedAt, groupCapability: 'unavailable' } as Incident;
      });
    },
    acknowledge() {
      const id = activeIncident('contact'); const actor = session();
      return write('acknowledge', options => api.acknowledgeIncident(id, options), response => {
        match(uuid(response.id), id); match(response.status, 'active'); match(response.recorded, 'acknowledged');
        state.receipts.push({ actorId: actor.actorId, incidentId: id, recorded: 'acknowledged', action: null });
      });
    },
    reportAction(action: string) {
      const id = activeIncident('contact'); const actor = session();
      if (typeof action !== 'string' || !action.trim() || [...action].length > 300) throw new TypeError('Describe a reported action in 1–300 characters');
      return write('report-action', options => api.reportIncidentAction(id, { action }, options), response => {
        match(uuid(response.id), id); match(response.status, 'active'); match(response.recorded, 'action');
        state.receipts.push({ actorId: actor.actorId, incidentId: id, recorded: 'action', action });
      });
    },
    resolve() {
      const id = activeIncident('driver');
      invalidate();
      return write('resolve', options => api.resolveIncident(id, options), response => {
        match(uuid(response.id), id); match(response.status, 'resolved');
        // The write response has no resolution timestamp. Re-read before showing a resolved incident fact.
        state.incident = unread(); state.receipts = [];
      });
    },
    retryUncertainCommand() {
      if (!retry) throw new TypeError('No uncertain command to retry');
      return retry();
    },
  };
}
