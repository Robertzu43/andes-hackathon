import { ApiError } from './errors.ts';
import type { ErrorKind, WriteOutcome } from './errors.ts';
import { MemorySession } from './session.ts';
import type { SessionLease } from './session.ts';
import * as decode from './responses.ts';
import type { Decoder } from './responses.ts';
import type * as T from './types.ts';
import { isUuid } from './uuid.ts';
import { demoPhoneCodes, decodeDemoPhoneStart, decodeDemoPhoneVerification } from './demo-phone.ts';
import { decodeContactInvitations, decodeContactTrips } from './recipient.ts';

export interface ApiClientConfig {
  /** Explicit trusted API/proxy base. No token, query, fragment, or userinfo in this URL. */
  baseUrl: string;
  session: MemorySession;
  fetch?: typeof globalThis.fetch;
  /** Engineering timeout only. It does not cancel a transaction at the server. */
  timeoutMs?: number;
}
const knownCodes = new Set(['invalid_request', 'idempotency_key_required', 'idempotency_conflict', 'unauthorized',
  'forbidden', 'internal_error', 'truck_not_owned', 'text_required', 'unsupported_audio', 'draft_not_found',
  'invalid_locale_or_time_zone', 'duplicate_contact_grants', 'draft_incomplete', 'draft_already_confirmed',
  'contact_not_accepted', 'trip_not_found', 'trip_closed', 'invalid_consent_request', 'contact_not_found',
  'contact_already_invited', 'grant_not_found', 'verified_phone_mismatch', 'invalid_consent_scope',
  'consent_revoked', 'already_accepted', 'location_stopped', 'capture_time_out_of_bounds', 'map_inactive',
  'incident_not_found', 'incident_resolved', 'demo_rate_limited', ...demoPhoneCodes]);
const catalogOperations = new Set(['getProfile', 'getBootstrap', 'listTrucks', 'listContacts', 'listTrips', 'listContactInvitations', 'listContactTrips']);

function resource(id: string): string {
  if (!isUuid(id)) {
    throw new ApiError('invalid_input');
  }
  return id.toLowerCase();
}
function normalizeTripInput(value: unknown): unknown {
  const body = value as T.DraftInput | T.ConfirmTripInput;
  if (body.fields?.expectedArrivalAt === undefined) return body;
  return { ...body, fields: { ...body.fields, expectedArrivalAt: decode.normalizeDate(body.fields.expectedArrivalAt) } };
}

/** Abort fan-in for older iOS: every attached listener is retired with the request. */
function combineSignals(signals: AbortSignal[]) {
  const controller = new AbortController();
  const detach: (() => void)[] = [];
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) { abort(); break; }
    signal.addEventListener('abort', abort, { once: true });
    detach.push(() => signal.removeEventListener('abort', abort));
  }
  return { signal: controller.signal, cleanup: () => { for (const remove of detach) remove(); } };
}

/** No retries, write queue, token refresh, provider calls, or synthetic-login fallback. */
export function createApiClient(config: ApiClientConfig) {
  let base: URL;
  try {
    base = new URL(config.baseUrl);
    if (base.username || base.password || base.search || base.hash) throw new Error();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) throw new Error();
    if (!base.pathname.endsWith('/')) base.pathname += '/';
  } catch { throw new ApiError('configuration'); }
  if (!(config.session instanceof MemorySession) || (config.fetch !== undefined && typeof config.fetch !== 'function')) {
    throw new ApiError('configuration');
  }
  const timeoutMs = config.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new ApiError('configuration');
  const transport = config.fetch ?? globalThis.fetch.bind(globalThis);
  const session = config.session;

  async function request<R>(operation: string, path: string | (() => string), decoder: Decoder<R>,
    options: T.RequestOptions = {}, mutation?: { body: unknown; key?: string; prepare?: (value: unknown) => unknown },
    policy: { actorless?: true; keyless?: true; successStatus?: 200 | 202 } = {}): Promise<R> {
    const writing = mutation !== undefined;
    let sent = false;
    const outcome = (): WriteOutcome => writing ? sent ? 'unknown' : 'not_sent' : 'not_applicable';
    const error = (kind: ErrorKind) => new ApiError(kind, { operation, outcome: outcome() });
    let url: URL;
    try { url = new URL(typeof path === 'function' ? path() : path, base); }
    catch { throw error('invalid_input'); }
    // Freeze serialized content before asynchronous fetch/response work or caller mutation.
    let body: string | undefined;
    if (mutation) {
      if (!policy.keyless && (typeof mutation.key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(mutation.key))) throw error('invalid_input');
      try { body = JSON.stringify(mutation.prepare ? mutation.prepare(mutation.body) : mutation.body); }
      catch { throw error('invalid_input'); }
      if (!body || new TextEncoder().encode(body).length > 128 * 1024) throw error('invalid_input');
    }
    if (options.signal?.aborted) throw error('cancelled');
    const capture = (): SessionLease => {
      try { return session.capture(); }
      catch (failure) { if (failure instanceof ApiError) throw error(failure.kind); throw failure; }
    };
    // The demo world is the one actorless exception: no bearer and no idempotency key.
    const lease = policy.actorless ? null : capture();
    let deadline: 'timeout' | 'session_expired' | null = null;
    const timerController = new AbortController();
    const combined = combineSignals([...(lease ? [lease.signal] : []), timerController.signal, ...(options.signal ? [options.signal] : [])]);
    const signal = combined.signal;
    const timer = setTimeout(() => { deadline = 'timeout'; timerController.abort(); }, timeoutMs);
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleExpiry(held: SessionLease) {
      expiryTimer = setTimeout(() => {
        // Refresh may extend credentials, never the independent request timeout.
        if (session.remainingMs(held) > 0) { scheduleExpiry(held); return; }
        deadline = 'session_expired'; timerController.abort();
      }, session.remainingMs(held));
    }
    if (lease) scheduleExpiry(lease);
    function ensureActive() {
      if (lease && !session.isCurrent(lease)) throw error(session.snapshot().status === 'expired' ? 'session_expired' : 'session_changed');
      if (options.signal?.aborted) throw error('cancelled');
      if (deadline) throw error(deadline);
    }
    try {
      ensureActive();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (lease) headers.Authorization = lease.authorization;
      if (mutation) {
        headers['Content-Type'] = 'application/json';
        if (!policy.keyless) headers['Idempotency-Key'] = mutation.key!;
      }
      sent = true;
      const response = await transport(url, {
        method: writing ? 'POST' : 'GET', headers, body, signal,
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (response.status !== (policy.successStatus ?? 200)) {
        const missingEndpoint = response.status === 404 && catalogOperations.has(operation);
        const kind: ErrorKind = missingEndpoint ? 'unsupported' : ({ 400: 'invalid_input', 401: 'unauthenticated', 403: 'forbidden',
          404: 'not_found', 409: 'conflict', 422: 'unsupported' } as Record<number, ErrorKind>)[response.status]
          ?? (response.status >= 500 ? 'server' : response.status >= 200 && response.status < 300 ? 'invalid_response' : 'http');
        let code = kind as string;
        // A known refusal remains a refusal even if cancellation races its error body.
        if (response.status === 401 && lease) session.invalidate(lease);
        try {
          const raw: unknown = await response.json();
          if (raw && typeof raw === 'object' && 'code' in raw && typeof raw.code === 'string' && knownCodes.has(raw.code)) code = raw.code;
        } catch { /* Error pages/transport details are never exposed to UI or logs. */ }
        if (!(response.status >= 400 && response.status < 500)) ensureActive();
        if (missingEndpoint) code = 'endpoint_unavailable';
        throw new ApiError(kind, { status: response.status, operation, code,
          outcome: writing ? response.status >= 400 && response.status < 500 ? 'rejected' : 'unknown' : 'not_applicable' });
      }
      ensureActive();
      let value: unknown;
      try {
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error();
        value = await response.json();
      } catch { ensureActive(); throw error('invalid_response'); }
      ensureActive();
      try { return decoder(value); } catch { throw error('invalid_response'); }
    } catch (failure) {
      if (failure instanceof ApiError) throw failure;
      ensureActive();
      throw error('network');
    } finally { clearTimeout(timer); clearTimeout(expiryTimer); combined.cleanup(); }
  }
  const write = <R>(operation: string, path: string | (() => string), body: unknown, decoder: Decoder<R>, options: T.WriteOptions,
    prepare?: (value: unknown) => unknown) => request(operation, path, decoder, options, { body, key: options?.idempotencyKey, prepare });

  return {
    getIdentity: (options?: T.RequestOptions) => request('getIdentity', 'v1/me', decode.id, options),
    createDemoSession: (options: T.DemoSessionOptions) => {
      if (options?.demo !== true) return Promise.reject(new ApiError('invalid_input', { operation: 'createDemoSession' }));
      return request('createDemoSession', 'v1/demo/session', decode.demoWorld, options, { body: {} }, { actorless: true, keyless: true });
    },
    startDemoPhone: (body: { phone: string }, options?: T.RequestOptions) =>
      request('startDemoPhone', 'v1/demo/phone/start', decodeDemoPhoneStart, options, { body }, { keyless: true, successStatus: 202 }),
    verifyDemoPhone: (body: { phone: string; code: string }, options?: T.RequestOptions) =>
      request('verifyDemoPhone', 'v1/demo/phone/verify', decodeDemoPhoneVerification, options, { body }, { keyless: true }),
    listContactInvitations: (options?: T.RequestOptions) =>
      request('listContactInvitations', 'v1/contact/invitations', decodeContactInvitations, options),
    listContactTrips: (options?: T.RequestOptions) =>
      request('listContactTrips', 'v1/contact/trips', decodeContactTrips, options),
    getProfile: (options?: T.RequestOptions) => request('getProfile', 'v1/profile', decode.profile, options),
    getBootstrap: (options?: T.RequestOptions) => request('getBootstrap', 'v1/bootstrap', decode.bootstrap, options),
    listTrucks: (options?: T.RequestOptions) => request('listTrucks', 'v1/trucks', decode.trucks, options),
    listContacts: (options?: T.RequestOptions) => request('listContacts', 'v1/contacts', decode.contacts, options),
    listTrips: (options?: T.RequestOptions) => request('listTrips', 'v1/trips', decode.trips, options),
    createTruck: (body: { label: string }, options: T.WriteOptions) => write('createTruck', 'v1/trucks', body, decode.id, options),
    inviteContact: (body: T.InvitationInput, options: T.WriteOptions) => write('inviteContact', 'v1/contacts', body, decode.pending, options),
    acceptContact: (id: T.UUID, body: T.ConsentScopes, options: T.WriteOptions) =>
      write('acceptContact', () => `v1/contacts/${resource(id)}/accept`, body, decode.accepted, options),
    revokeContact: (id: T.UUID, options: T.WriteOptions) => write('revokeContact', () => `v1/contacts/${resource(id)}/revoke`, {}, decode.revoked, options),
    createDraft: (body: T.DraftInput, options: T.WriteOptions) => write('createDraft', 'v1/trip-drafts', body, decode.draft, options, normalizeTripInput),
    confirmTrip: (id: T.UUID, body: T.ConfirmTripInput, options: T.WriteOptions) =>
      write('confirmTrip', () => `v1/trip-drafts/${resource(id)}/confirm`, body, decode.confirmed, options, normalizeTripInput),
    getTrip: (id: T.UUID, options?: T.RequestOptions) => request('getTrip', () => `v1/trips/${resource(id)}`, decode.trip, options),
    getTripStatus: (id: T.UUID, options?: T.RequestOptions) => request('getTripStatus', () => `v1/trips/${resource(id)}/status`, decode.tripStatus, options),
    setSharing: (id: T.UUID, body: T.SharingInput, options: T.WriteOptions) =>
      write('setSharing', () => `v1/trips/${resource(id)}/sharing`, body, decode.sharing, options),
    commandTrip: (id: T.UUID, type: T.TripCommand, options: T.WriteOptions) =>
      write('commandTrip', () => `v1/trips/${resource(id)}/commands`, { type }, decode.command, options),
    uploadLocations: (id: T.UUID, observations: T.LocationObservation[], options: T.WriteOptions) =>
      write('uploadLocations', () => `v1/trips/${resource(id)}/locations`, { observations }, decode.uploaded, options),
    getSnapshot: (id: T.UUID, options?: T.RequestOptions) => request('getSnapshot', () => `v1/trips/${resource(id)}/snapshot`, decode.snapshot, options),
    revokeTripContact: (tripId: T.UUID, grantId: T.UUID, options: T.WriteOptions) =>
      write('revokeTripContact', () => `v1/trips/${resource(tripId)}/contacts/${resource(grantId)}/revoke`, {}, decode.tripRevoked, options),
    reportSos: (id: T.UUID, options: T.WriteOptions) => write('reportSos', () => `v1/trips/${resource(id)}/sos`, {}, decode.sos, options),
    getIncident: (id: T.UUID, options?: T.RequestOptions) => request('getIncident', () => `v1/incidents/${resource(id)}`, decode.incident, options),
    acknowledgeIncident: (id: T.UUID, options: T.WriteOptions) =>
      write('acknowledgeIncident', () => `v1/incidents/${resource(id)}/acknowledgements`, {}, decode.acknowledgement, options),
    reportAction: (id: T.UUID, action: string, options: T.WriteOptions) =>
      write('reportAction', () => `v1/incidents/${resource(id)}/actions`, { action }, decode.action, options),
    resolveIncident: (id: T.UUID, options: T.WriteOptions) =>
      write('resolveIncident', () => `v1/incidents/${resource(id)}/resolve`, {}, decode.resolution, options),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;

/** Call once per explicit intent, never inside a retry loop. */
export function createIdempotencyKey(): string { return globalThis.crypto.randomUUID(); }
