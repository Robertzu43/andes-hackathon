import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import type { MemorySession } from './session.ts';
import type { RequestOptions, WriteOptions, InvitationInput, ConsentScopes, UUID } from './types.ts';

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
  const reset = () => { generation += 1; setActor(null); };
  reset();
  const unsubscribe = session.subscribe(() => {
    // An earlier listener can dispose this binding during a notification snapshot.
    if (!disposed) reset();
  });
  return {
    async activate(options?: RequestOptions) {
      if (disposed) throw new ApiError('session_changed', { operation: 'activateJourney' });
      reset();
      const started = generation;
      const lease = session.capture();
      const identity = await api.getIdentity(options);
      if (disposed || started !== generation || !session.isCurrent(lease)) {
        throw new ApiError('session_changed', { operation: 'activateJourney' });
      }
      setActor(identity.id);
      return identity;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      reset();
    },
  };
}
