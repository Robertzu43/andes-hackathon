import { narrowScope, operationalPrivacy, sharingScope, type SharingScope } from '../privacy/consent.ts';

// Semantic seam for lane45's authenticated transport; this module never owns tokens or fetch.
export interface ReadOptions { signal: AbortSignal }
export interface WriteOptions extends ReadOptions { idempotencyKey: string }
export interface ContactApi {
  inviteContact(body: SharingScope & { contactId: string; phone: string; role?: ContactRole }, options: WriteOptions): Promise<unknown>;
  acceptContact(id: string, body: SharingScope, options: WriteOptions): Promise<unknown>;
  revokeContact(id: string, options: WriteOptions): Promise<unknown>;
  revokeTripContact(tripId: string, grantId: string, options: WriteOptions): Promise<unknown>;
  getTripSnapshot(tripId: string, options: ReadOptions): Promise<unknown>;
  getIncident(id: string, options: ReadOptions): Promise<unknown>;
  getTripStatus(tripId: string, options: ReadOptions): Promise<unknown>;
  acknowledgeIncident(id: string, options: WriteOptions): Promise<unknown>;
  reportIncidentAction(id: string, body: { action: string }, options: WriteOptions): Promise<unknown>;
  resolveIncident(id: string, options: WriteOptions): Promise<unknown>;
}
export interface Session { actorId: string; view: 'driver' | 'contact' }
export type ContactRole = 'family' | 'colleague';
/** A caller-supplied invitation hint, NOT a grant read or proof of current consent. */
export interface Invitation {
  id: string; driverId: string; contactId: string; requested: SharingScope;
  accepted: SharingScope | null; status: 'pending' | 'accepted' | 'revoked';
}
interface TripSelection { id: string; driverId: string | null }
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
const CHECK_REASONS = ['arrival_overdue', 'silence', 'sharing_stopped'] as const;
const LABELS = ['robo', 'intento_robo', 'falsa_alarma', 'sin_senal', 'otro'] as const;
const DELIVERY_STATUSES = ['pending', 'claimed', 'authorized', 'accepted', 'rejected', 'unknown', 'delivered', 'cancelled', 'unavailable'] as const;
/** GET /v1/trips/:id/status (main, #74). Map-only contacts get check/incident null and no deliveries. */
export interface TripStatus {
  trip: { status: 'active' | 'arrived' | 'cancelled'; paused: boolean; expectedArrivalAt: string | null };
  check: { status: 'asking'; reason: typeof CHECK_REASONS[number]; askUntil: string } | null;
  /** `label` is absent when the transport's decoder drops it, which is not the same as no label (null). */
  incident: { id: string; trigger: 'sos' | 'missed_check'; checkReason: typeof CHECK_REASONS[number] | null;
    status: 'active' | 'resolved'; label?: typeof LABELS[number] | null; createdAt: string } | null;
  deliveries: { role: 'family' | 'colleague' | 'group'; channel: 'sms' | 'whatsapp' | 'voice' | 'group';
    status: typeof DELIVERY_STATUSES[number]; unavailableReason: string | null }[];
}
type ReadState<T> = { status: 'unread' | 'loading' | 'recorded' | 'denied' | 'unknown'; data: T | null;
  observation: { receivedAt: string; source: 'this-device'; current: false } | null };
type Operation = { kind: string; status: 'idle' | 'pending' | 'recorded' | 'rejected' | 'uncertain';
  failure: 'authentication' | 'forbidden' | 'missing' | 'conflict' | 'invalid' | 'unsupported' | 'server' | 'network' | null };
interface State {
  session: Session | null; trip: TripSelection | null; invitation: Invitation | null;
  location: ReadState<Snapshot>; incident: ReadState<Incident>; status: ReadState<TripStatus>;
  receipts: { actorId: string; incidentId: string; recorded: 'acknowledged' | 'action'; action: string | null }[];
  tripRevoked: boolean; operation: Operation;
}
const unread = <T>(): ReadState<T> => ({ status: 'unread', data: null, observation: null });
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
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new TypeError('Unexpected API value');
  return value as T;
}
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

/** Preserve source age as of the server read, without an unanchored client-clock estimate. */
export function locationAge(snapshot: Snapshot) {
  return { ageMs: snapshot.ageMs, asOf: 'server-read',
    serverFreshnessAtRead: snapshot.freshness, readAt: snapshot.readAt,
    live: false, currentAuthorization: 'requires-server-check' } as const;
}

/** Headless journey. Local view selection never grants server authority. */
export function createContactJourney(api: ContactApi, keyFactory: () => string = () => crypto.randomUUID(),
  receiptTime: () => string = () => new Date().toISOString()) {
  let state: State = { session: null, trip: null, invitation: null, location: unread(),
    incident: unread(), status: unread(), receipts: [], tripRevoked: false, operation: idle() };
  let epoch = 0;
  const requests = new Set<AbortController>();
  const readRequests = new Set<AbortController>();
  const reads = { location: 0, incident: 0, status: 0 };
  let retry: (() => Promise<'recorded' | 'superseded' | 'rejected' | 'uncertain'>) | null = null;
  function conceal() {
    reads.location++; reads.incident++; reads.status++;
    for (const request of readRequests) { request.abort(); requests.delete(request); }
    readRequests.clear();
    state.location = unread(); state.incident = unread(); state.status = unread(); state.receipts = [];
  }
  function invalidate(preserveUncertain = false) {
    const uncertain = preserveUncertain && state.operation.status === 'uncertain'
      ? { operation: state.operation, retry } : null;
    epoch++;
    for (const request of requests) request.abort();
    requests.clear();
    retry = null;
    conceal();
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
      requests.delete(controller);
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
  async function read<T>(slot: 'location' | 'incident' | 'status', request: (options: ReadOptions) => Promise<unknown>,
    parse: (body: Record<string, unknown>) => T) {
    session();
    if (state.operation.kind.startsWith('revoke') && ['pending', 'uncertain'].includes(state.operation.status)) {
      throw new TypeError('Wait for the revocation outcome before another protected read');
    }
    const started = epoch; const sequence = ++reads[slot];
    const controller = new AbortController(); requests.add(controller);
    readRequests.add(controller);
    state[slot] = { status: 'loading', data: null, observation: null };
    try {
      const raw = await request({ signal: controller.signal });
      if (started !== epoch || sequence !== reads[slot]) return 'superseded' as const;
      const data = parse(object(raw));
      const observation = { receivedAt: receiptTime(), source: 'this-device', current: false } as const;
      if (slot === 'location') state.location = { status: 'recorded', data: data as Snapshot, observation };
      else if (slot === 'incident') state.incident = { status: 'recorded', data: data as Incident, observation };
      else state.status = { status: 'recorded', data: data as TripStatus, observation };
      return 'recorded' as const;
    } catch (error) {
      if (started !== epoch || sequence !== reads[slot]) return 'superseded' as const;
      const reason = failure(error);
      if (reason === 'authentication') {
        invalidate();
        state.session = null; state.trip = null; state.invitation = null;
      } else if (slot === 'incident' && (reason === 'forbidden' || reason === 'missing')) {
        state.receipts = [];
      }
      state[slot] = { status: ['authentication', 'forbidden', 'missing'].includes(reason!) ? 'denied' : 'unknown', data: null, observation: null };
      return 'unavailable' as const;
    } finally { requests.delete(controller); readRequests.delete(controller); }
  }
  return {
    getState() {
      return structuredClone({ ...state, privacy: operationalPrivacy({
        standingReceipt: state.invitation?.status ?? 'unknown', tripRevoked: state.tripRevoked,
      }) });
    },
    /** Conceal denied catalog facts without cancelling or forgetting a command outcome. */
    concealProtectedFacts: conceal,
    setSession(value: Session | null) {
      const next = value ? { actorId: uuid(value.actorId), view: value.view } : null;
      if (next && !['driver', 'contact'].includes(next.view)) throw new TypeError('Unknown view');
      invalidate(); state.session = next; state.trip = null; state.invitation = null; state.tripRevoked = false;
    },
    selectTrip(value: { id: string; driverId: string }) {
      session();
      const next = { id: uuid(value.id), driverId: uuid(value.driverId) };
      invalidate(); state.trip = next; state.tripRevoked = false;
    },
    /** A contact's route reference supplies no driver identity or permission. */
    selectContactTrip(id: string) {
      session('contact');
      const next = { id: uuid(id), driverId: null };
      invalidate(); state.trip = next; state.tripRevoked = false;
    },
    inviteContact(value: SharingScope & { contactId: string; phone: string; role?: ContactRole }) {
      const actor = session('driver');
      // Without a role the server stores family (SMS, WhatsApp and voice); colleagues get SMS and WhatsApp.
      const role = value.role === undefined ? undefined : choice(value.role, ['family', 'colleague'] as const);
      const body = { contactId: uuid(value.contactId), phone: value.phone, ...sharingScope(value), ...(role ? { role } : {}) };
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
      conceal(); // Hide facts without replacing a pending or uncertain command and its original key.
      return write('revoke-standing', options => api.revokeContact(id, options), response => {
        match(uuid(response.id), id); match(response.revoked, true);
        invalidate();
        if (state.invitation?.id === id) state.invitation = { ...state.invitation, status: 'revoked' };
      });
    },
    revokeTrip(grantId: string) {
      const selected = trip(); const id = uuid(grantId);
      conceal();
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
    /** Status is the contact's way to discover a trip's incident and open check without a host reference. */
    loadStatus() {
      const selected = trip();
      return read('status', options => api.getTripStatus(selected.id, options), response => {
        const tripFacts = object(response.trip); const check = response.check === null ? null : object(response.check);
        const incident = response.incident === null ? null : object(response.incident);
        if (typeof tripFacts.paused !== 'boolean' || !Array.isArray(response.deliveries)
          || (!incident && response.deliveries.length)) throw new TypeError('Invalid trip status');
        return {
          trip: { status: choice(tripFacts.status, ['active', 'arrived', 'cancelled'] as const), paused: tripFacts.paused,
            expectedArrivalAt: tripFacts.expectedArrivalAt === null ? null : instant(tripFacts.expectedArrivalAt) },
          check: check && { status: choice(check.status, ['asking'] as const), reason: choice(check.reason, CHECK_REASONS),
            askUntil: instant(check.askUntil) },
          incident: incident && { id: uuid(incident.id), trigger: choice(incident.trigger, ['sos', 'missed_check'] as const),
            checkReason: incident.checkReason === null ? null : choice(incident.checkReason, CHECK_REASONS),
            status: choice(incident.status, ['active', 'resolved'] as const),
            ...(incident.label === undefined ? {} : { label: incident.label === null ? null : choice(incident.label, LABELS) }),
            createdAt: instant(incident.createdAt) },
          deliveries: response.deliveries.map(row => {
            const delivery = object(row);
            if (delivery.unavailableReason !== null && typeof delivery.unavailableReason !== 'string') throw new TypeError('Invalid delivery');
            return { role: choice(delivery.role, ['family', 'colleague', 'group'] as const),
              channel: choice(delivery.channel, ['sms', 'whatsapp', 'voice', 'group'] as const),
              status: choice(delivery.status, DELIVERY_STATUSES), unavailableReason: delivery.unavailableReason as string | null };
          }),
        } satisfies TripStatus;
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
      conceal();
      return write('resolve', options => api.resolveIncident(id, options), response => {
        match(uuid(response.id), id); match(response.status, 'resolved');
        // The write response has no resolution timestamp. Re-read before showing a resolved incident fact.
        conceal();
      });
    },
    retryUncertainCommand() {
      if (!retry) throw new TypeError('No uncertain command to retry');
      return retry();
    },
  };
}
