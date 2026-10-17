// Transparent binding for the frozen lane45 API; no retry/session logic is added here.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IDS, OPERATIONS } from '../fixtures.mjs';

export const reviewedCandidate = 'a20060b5b3a61e1d210febe77ccc62069afed364';

export async function createApiDriver({ baseUrl, fetchImpl }) {
  const root = process.env.ANDES_REVIEW_API_ROOT;
  if (!root) throw new TypeError('ANDES_REVIEW_API_ROOT must name the archived candidate');
  const { MemorySession, createApiClient } = await import(pathToFileURL(resolve(root, 'web/src/lib/api/index.ts')).href);
  const session = new MemorySession();
  const api = createApiClient({ baseUrl, session, fetch: fetchImpl });
  return {
    setSession(value) {
      session.setCredentials({ issuer: 'https://identity.synthetic.invalid', subject: value.userId,
        accessToken: value.token, expiresAt: Date.now() + 60_000 });
    },
    clearSession() { session.clear(); },
    dispose() { session.clear(); },
    async call(request) {
      const op = OPERATIONS.find(item => item.method === request.method && item.path === request.path);
      if (!op) throw new TypeError('No reviewed operation binding');
      const options = { idempotencyKey: request.idempotencyKey, signal: request.signal };
      const calls = {
        identity: () => api.getIdentity(options),
        createTruck: () => api.createTruck(request.body, options),
        inviteContact: () => api.inviteContact(request.body, options),
        acceptContact: () => api.acceptContact(IDS.grant, request.body, options),
        revokeStanding: () => api.revokeContact(IDS.grant, options),
        createDraft: () => api.createDraft(request.body, options),
        confirmTrip: () => api.confirmTrip(IDS.trip, request.body, options),
        command: () => api.commandTrip(IDS.trip, request.body.type, options),
        uploadLocations: () => api.uploadLocations(IDS.trip, request.body.observations, options),
        snapshot: () => api.getSnapshot(IDS.trip, options),
        revokeTrip: () => api.revokeTripContact(IDS.trip, IDS.grant, options),
        sos: () => api.reportSos(IDS.trip, options),
        incident: () => api.getIncident(IDS.incident, options),
        acknowledge: () => api.acknowledgeIncident(IDS.incident, options),
        action: () => api.reportAction(IDS.incident, request.body.action, options),
        resolve: () => api.resolveIncident(IDS.incident, options),
      };
      try { return await calls[op.name](); }
      catch (error) {
        // Project the candidate's existing facts; never manufacture an outcome.
        const kind = error.status !== null && error.status !== undefined ? 'http'
          : ['unauthenticated', 'session_expired', 'session_changed'].includes(error.kind) ? 'session'
          : error.kind === 'cancelled' ? 'aborted'
          : error.kind === 'invalid_response' ? 'protocol' : error.kind;
        throw { kind, status: error.status, code: error.code, ambiguous: error.outcome === 'unknown' };
      }
    },
  };
}
