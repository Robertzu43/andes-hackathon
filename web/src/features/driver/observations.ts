import { createQueuedTripPhoneObservations } from '@phone-observations/trip-sharing.mjs';
import type { Capture, CaptureOptions, ObservationEvent, ReviewedContext } from '@phone-observations/trip-sharing.mjs';
import { openObservationStores, openObservationQueue, createLocationUploader, createObservationPipeline } from '../../lib/observations/index.mjs';
import type { ObservationStores, ObservationQueue, LocationUploader, ObservationPipeline } from '../../lib/observations/index.mjs';
import { createIdempotencyKey } from '../../lib/api/client.ts';
import type { ApiClient } from '../../lib/api/client.ts';
import type { MemorySession, SessionLease } from '../../lib/api/session.ts';
import { ApiError } from '../../lib/api/errors.ts';
import type { SharingInput } from '../../lib/api/types.ts';

export interface TripObservationSnapshot {
  ready: boolean;
  acquisition: 'idle' | 'unavailable' | 'acquiring' | 'stopped' | 'disposed';
  reason: string | null;
  storage: 'preparing' | 'available' | 'unavailable';
  wakeLock: 'unknown' | 'requested' | 'held' | 'released' | 'unavailable';
  sharing: {
    outcome: 'not_sent' | 'pending' | 'receipt' | 'unknown' | 'rejected';
    state: SharingInput['state'] | null;
    reason: SharingInput['reason'] | null;
  };
}

/** Owns capture and its durable queue for one in-memory identity and trip. */
export function createTripObservationHost({ tripId, revision, session, api, baseUrl,
  reviewedContext = null, captureOptions = {},
}: {
  tripId: string; revision: string; session: MemorySession; api: Pick<ApiClient, 'setSharing'>;
  baseUrl: string; reviewedContext?: ReviewedContext | null; captureOptions?: CaptureOptions;
}) {
  if (![tripId, revision].every(value => typeof value === 'string' && value.length > 0 && value.length <= 160)) {
    throw new TypeError('A bounded tripId and revision are required');
  }
  // Copy only the adapter's existing dependencies. Never forward gate/sink overrides.
  const options = { mode: captureOptions.mode ?? 'device', platform: captureOptions.platform, clock: captureOptions.clock };
  const listeners = new Set<() => void>();
  let snapshot: TripObservationSnapshot = Object.freeze({ ready: false, acquisition: 'idle', reason: null,
    storage: 'preparing', wakeLock: 'unknown', sharing: Object.freeze({ outcome: 'not_sent', state: null, reason: null }) });
  let stores: ObservationStores | null = null;
  let queue: ObservationQueue | null = null;
  let pipeline: ObservationPipeline | null = null;
  let uploader: LocationUploader | null = null;
  let capture: Capture | null = null;
  let ownerLease: SessionLease | null = null;
  let accessLease: SessionLease | null = null;
  let active = false;
  let retired = false;
  let disposed = false;
  let writeVersion = 0;
  let dispatchedWriteVersion: number | null = null;
  let sharingWrite: Promise<void> = Promise.resolve();
  let retirement: Promise<unknown> = Promise.resolve();
  let disposal: Promise<void> | null = null;
  let unsubscribe = () => {};
  const transport = globalThis.fetch.bind(globalThis);

  function update(patch: Partial<TripObservationSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...patch,
      ...(patch.sharing ? { sharing: Object.freeze(patch.sharing) } : {}) });
    for (const listener of [...listeners]) { try { listener(); } catch { /* Independent subscribers. */ } }
  }
  const current = () => !retired && ownerLease !== null && session.isCurrent(ownerLease);

  function retire() {
    if (retired) return;
    retired = true;
    active = false;
    writeVersion++;
    capture?.stopSharing(); capture = null;
    uploader?.stop();
    update({ ready: false, acquisition: 'unavailable', reason: 'session-retired', wakeLock: 'released',
      storage: snapshot.storage === 'preparing' ? 'unavailable' : snapshot.storage,
      sharing: { outcome: 'not_sent', state: null, reason: null } });
    // Preparation may still own an opening database. Keep it open until the
    // retiring owner is wiped, even when no pipeline has been constructed yet.
    retirement = (async () => {
      if (pipeline) await pipeline.signOut();
      else {
        await preparation;
        if (identity.status === 'authenticated') await queue?.wipeUser(identity.subject);
      }
      stores?.close();
    })();
    void retirement.catch(() => { if (!disposed) update({ storage: 'unavailable' }); });
    unsubscribe();
  }

  async function writeSharing(body: SharingInput) {
    if (!current() || disposed) return;
    const version = ++writeVersion;
    const idempotencyKey = createIdempotencyKey();
    update({ sharing: { outcome: 'pending', ...body } });
    if (!current() || disposed || version !== writeVersion) return;
    try {
      dispatchedWriteVersion = version;
      const receipt = await api.setSharing(tripId, body, { idempotencyKey });
      if (!current() || disposed || version !== writeVersion) return;
      update({ sharing: { outcome: receipt.id === tripId && receipt.sharing === body.state ? 'receipt' : 'unknown', ...body } });
    } catch (error) {
      if (!current() || disposed || version !== writeVersion) return;
      const outcome = error instanceof ApiError && ['not_sent', 'rejected'].includes(error.outcome)
        ? error.outcome as 'not_sent' | 'rejected' : 'unknown';
      update({ sharing: { outcome, ...body } });
    }
    // Ambiguity is retained as a fact. Sharing writes have no automatic replay.
  }

  function dispatchSharing(body: SharingInput) {
    const version = writeVersion + 1;
    const writing = writeSharing(body);
    // A subscriber can issue a newer intent while writeSharing notifies it.
    if (writeVersion === version) sharingWrite = writing;
    return writing;
  }

  function stop(reason: SharingInput['reason']) {
    if (!active || retired || disposed) return sharingWrite;
    active = false; // Invalidate before the adapter synchronously emits session-stop.
    capture?.stopSharing(); capture = null;
    update({ acquisition: 'stopped', reason, wakeLock: 'released' });
    return dispatchSharing({ state: 'stopped', reason });
  }

  function storageFailed() {
    if (retired || disposed || snapshot.storage === 'unavailable') return;
    void stop('error');
    uploader?.stop();
    update({ ready: false, storage: 'unavailable', acquisition: 'unavailable', reason: 'storage-unavailable' });
  }

  function observe(event: ObservationEvent) {
    if (retired || disposed) return;
    pipeline?.sink(event);
    const data = event.data ?? {};
    if (event.type === 'wake-lock' && ['requested', 'held', 'released', 'unavailable'].includes(String(data.state))) {
      update({ wakeLock: data.state as TripObservationSnapshot['wakeLock'] });
    }
    if (!active) return;
    if (event.type === 'geolocation') void pipeline?.flush().catch(storageFailed);
    else if (event.type === 'permission' && data.stream === 'geolocation' && ['denied', 'revoked'].includes(String(data.state))) {
      void stop('permission_denied');
    } else if (event.type === 'geolocation-error') void stop(data.code === 1 ? 'permission_denied' : 'error');
    else if (event.type === 'acquisition-error' || event.type === 'acquisition-timeout') void stop('error');
    else if (event.type === 'session-stop' && data.reason !== 'explicit-stop') {
      void stop(['visibility-lost', 'pagehide', 'freeze'].includes(String(data.reason)) ? 'page_hidden' : 'error');
    }
  }

  const identity = session.snapshot();
  if (identity.status === 'authenticated') ownerLease = session.capture();
  else update({ acquisition: 'unavailable', reason: 'session-unavailable', storage: 'unavailable' });
  unsubscribe = session.subscribe(() => { if (ownerLease && !session.isCurrent(ownerLease)) retire(); });

  // Preparation never receives, stores or replays a native user event.
  const preparation = (async () => {
    if (!ownerLease || identity.status !== 'authenticated') return;
    const opened = await openObservationStores();
    if (!opened.ok) { if (!disposed && !retired) storageFailed(); return; }
    stores = opened.stores;
    if (disposed && !retired) { stores.close(); return; }
    try {
      queue = await openObservationQueue(stores);
      if (disposed || retired) return;
      if (!current()) { retire(); return; }
      uploader = createLocationUploader({ queue, baseUrl,
        async getAccessToken() {
          if (!current()) return null;
          accessLease = session.capture();
          return session.isCurrent(accessLease) ? accessLease.authorization.slice('Bearer '.length) : null;
        },
        fetchImpl: (input, init) => {
          // Recheck after the uploader's asynchronous queue reads, at dispatch.
          if (!current() || !accessLease || !session.isCredentialCurrent(accessLease)) {
            return Promise.reject(new ApiError('session_changed'));
          }
          return transport(input, init);
        },
      });
      pipeline = createObservationPipeline({ queue, uploader, ownerSubject: identity.subject, onError: storageFailed });
      update({ ready: reviewedContext !== null, storage: 'available',
        ...(reviewedContext === null ? { acquisition: 'unavailable', reason: 'unqualified' } : {}) });
    } catch { storageFailed(); }
    finally { if (disposed && !retired) stores.close(); }
  })();

  async function startSharing(event: Event) {
    if (disposed || retired || !current()) return;
    if (snapshot.storage !== 'available' || !pipeline) {
      update({ acquisition: 'unavailable', reason: 'storage-unavailable' }); return;
    }
    if (active) return;
    if (!event) { update({ acquisition: 'unavailable', reason: 'trusted-dispatch-required' }); return; }
    const consent = { granted: true as const, tripId, reference: createIdempotencyKey() };
    const next = createQueuedTripPhoneObservations({ ...options, trip: { tripId, revision }, reviewedContext,
      locationConsent: consent, pipeline: { ...pipeline, sink: observe } });
    capture = next;
    active = true;
    // This MUST precede the first await: currentTarget/eventPhase expire when
    // dispatch ends. The real adapter owns native trusted-event validation.
    const result = next.startSharing(event);
    if (!active || !current() || disposed) { next.stopSharing(); return; }
    if (!result.ok) {
      active = false;
      next.stopSharing(); capture = null; // Drop the closure holding this consent.
      update({ acquisition: 'unavailable', reason: result.reason ?? 'capture-unavailable' });
      return;
    }
    update({ acquisition: 'acquiring', reason: null });
    if (!active || !current() || disposed) return;
    await dispatchSharing({ state: 'resumed', reason: 'user' });
  }

  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    active = false;
    const sharing = snapshot.sharing.outcome === 'pending'
      ? { ...snapshot.sharing, outcome: dispatchedWriteVersion === writeVersion ? 'unknown' as const : 'not_sent' as const }
      : snapshot.sharing;
    writeVersion++;
    unsubscribe();
    capture?.stopSharing(); capture = null;
    uploader?.stop();
    const stopped = pipeline?.stop();
    disposal = (async () => {
      await preparation;
      await stopped;
      await retirement.catch(() => {});
      stores?.close();
      listeners.clear();
    })();
    update({ ready: false, acquisition: 'disposed', wakeLock: 'released', sharing });
    return disposal;
  }

  return { startSharing, stopSharing: () => stop('user'), getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, dispose };
}
