import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import type { MemorySession, SessionLease } from './session.ts';
import type { RequestOptions, WriteOptions, InvitationInput, ConsentScopes, IdResponse, UUID } from './types.ts';

/** Structural ContactApi facade for PR62/a8466d5; feature implementation stays in its own lane. */
export function createContactApi(api: ApiClient) {
  return {
    inviteContact: (body: InvitationInput, options: WriteOptions) => api.inviteContact(body, options),
    acceptContact: (id: UUID, body: ConsentScopes, options: WriteOptions) => api.acceptContact(id, body, options),
    revokeContact: (id: UUID, options: WriteOptions) => api.revokeContact(id, options),
    revokeTripContact: (tripId: UUID, grantId: UUID, options: WriteOptions) => api.revokeTripContact(tripId, grantId, options),
    getTripSnapshot: (id: UUID, options: RequestOptions) => api.getSnapshot(id, options),
    getIncident: (id: UUID, options: RequestOptions) => api.getIncident(id, options),
    acknowledgeIncident: (id: UUID, options: WriteOptions) => api.acknowledgeIncident(id, options),
    reportIncidentAction: (id: UUID, body: { action: string }, options: WriteOptions) => api.reportAction(id, body.action, options),
    resolveIncident: (id: UUID, options: WriteOptions) => api.resolveIncident(id, options),
  };
}
export type ContactJourneyApi = ReturnType<typeof createContactApi>;

/**
 * Bind caller-owned controller context to verified /v1/me, never an OIDC subject or role hint.
 * setActor(null) must synchronously clear that controller's protected views and pending intents.
 */
export function bindJourneySession(session: MemorySession, api: Pick<ApiClient, 'getIdentity'>,
  setActor: (actorId: UUID | null) => void) {
  let generation = 0;
  let disposed = false;
  let bound: UUID | null = null;
  let pending: { generation: number; lease: SessionLease; signal?: AbortSignal; promise: Promise<IdResponse> } | null = null;
  const clearActor = () => { bound = null; setActor(null); };
  const reset = () => { generation += 1; pending = null; clearActor(); };
  reset();
  const unsubscribe = session.subscribe(() => {
    // An earlier listener can dispose this binding during a notification snapshot.
    if (!disposed) reset();
  });
  return {
    activate(options?: RequestOptions): Promise<IdResponse> {
      try {
        if (disposed) throw new ApiError('session_changed', { operation: 'activateJourney' });
        const lease = session.capture();
        if (pending && pending.generation === generation && pending.signal === options?.signal
          && session.isCredentialCurrent(pending.lease)) return pending.promise;
        let resolve!: (identity: IdResponse) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<IdResponse>((done, fail) => { resolve = done; reject = fail; });
        const run = { generation: ++generation, lease, signal: options?.signal, promise };
        pending = run;
        function ensureCurrent() {
          if (disposed || run.generation !== generation || !session.isCurrent(lease)) {
            throw new ApiError('session_changed', { operation: 'activateJourney' });
          }
        }
        void (async () => {
          try {
            // Verify before touching the controller: same-actor reactivation preserves SOS facts.
            // Account replacement, clear, current 401 and expiry reset through the subscription.
            const identity = await api.getIdentity(options);
            ensureCurrent();
            if (identity.id.toLowerCase() !== bound?.toLowerCase()) {
              if (bound !== null) { clearActor(); ensureCurrent(); }
              setActor(identity.id);
              ensureCurrent();
              bound = identity.id;
            }
            resolve(identity);
          } catch (error) { reject(error); }
          finally { if (pending === run) pending = null; }
        })();
        return promise;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      reset();
    },
  };
}
