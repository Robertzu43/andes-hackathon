import { bindJourneySession, createContactApi, type ApiClient, type MemorySession } from '../../lib/api/index.ts';
import type { ContactList, InvitationInput } from '../../lib/api/index.ts';
import type { SessionGateway } from '../../foundation/index.ts';
import { createContactJourney } from './journey.ts';

export interface ContactHost {
  api: ApiClient;
  session: MemorySession;
  gateway: SessionGateway;
  /** An untrusted reference only. The incident GET must verify its trip and current access. */
  incidentReference?: (tripId: string) => string | null;
  /** A reference permits only a server-authorized revoke, never a protected read. */
  grantReference?: (tripId: string) => string | null;
}
export type ViewFailure = 'authentication' | 'forbidden' | 'missing' | 'conflict' | 'invalid' | 'unavailable';
function classify(error: unknown): ViewFailure {
  const status = (error as { status?: number })?.status;
  return status === 401 ? 'authentication' : status === 403 ? 'forbidden' : status === 404 ? 'missing'
    : status === 409 ? 'conflict' : status === 400 || status === 422 || error instanceof TypeError ? 'invalid' : 'unavailable';
}

/** Feature-owned observation bridge. HTTP, credentials and verified actor binding remain in45. */
export function createContactView(host: ContactHost, view: 'driver' | 'contact', tripId?: string) {
  const journey = createContactJourney(createContactApi(host.api));
  type Journey = ReturnType<typeof journey.getState>;
  type Snapshot = {
    status: 'closed' | 'verifying' | 'ready' | 'error';
    failure: ViewFailure | null;
    journey: Journey;
    catalog: { status: 'unread' | 'loading' | 'ready' | 'error'; data: ContactList | null; failure: ViewFailure | null };
  };
  let snapshot: Snapshot = { status: 'closed', failure: null, journey: journey.getState(),
    catalog: { status: 'unread', data: null, failure: null } };
  const listeners = new Set<() => void>();
  let generation = 0;
  let catalogSequence = 0;
  let read: AbortController | null = null;
  let binding: ReturnType<typeof bindJourneySession> | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = true;
  function publish(patch: Partial<Snapshot> = {}) {
    snapshot = { ...snapshot, ...patch, journey: journey.getState() };
    for (const listener of listeners) listener();
  }
  function clear(status: Snapshot['status'] = 'closed') {
    generation++; read?.abort(); read = null;
    journey.setSession(null);
    publish({ status, failure: null, catalog: { status: 'unread', data: null, failure: null } });
  }
  async function loadContacts() {
    if (stopped || snapshot.status !== 'ready' || view !== 'driver'
      || snapshot.journey.operation.kind.startsWith('revoke')
        && ['pending', 'uncertain'].includes(snapshot.journey.operation.status)) return;
    const started = generation; const sequence = ++catalogSequence;
    read?.abort(); const controller = new AbortController(); read = controller;
    publish({ catalog: { status: 'loading', data: null, failure: null } });
    try {
      const data = await host.api.listContacts({ signal: controller.signal });
      if (stopped || started !== generation || sequence !== catalogSequence) return;
      publish({ catalog: { status: 'ready', data, failure: null } });
    } catch (error) {
      if (stopped || started !== generation || sequence !== catalogSequence) return;
      const failure = classify(error);
      // Owner catalog denial also retires earlier receipts, not just its rows.
      if (failure === 'forbidden' || failure === 'missing') {
        const actor = journey.getState().session;
        journey.setSession(actor);
      }
      publish({ catalog: { status: 'error', data: null, failure } });
    } finally { if (read === controller) read = null; }
  }
  async function perform(action: () => Promise<unknown>, conceal = false) {
    if (stopped || snapshot.status !== 'ready') return;
    if (!conceal && journey.getState().operation.status === 'pending') return;
    const started = generation;
    if (conceal) {
      read?.abort(); read = null; catalogSequence++;
      snapshot = { ...snapshot, catalog: { status: 'unread', data: null, failure: null } };
    }
    try {
      const result = action();
      publish({ failure: null });
      await result;
    } catch (error) {
      if (!stopped && started === generation) publish({ failure: classify(error) });
    } finally { if (!stopped && started === generation) publish(); }
  }
  function start() {
    if (!stopped) return;
    stopped = false;
    const activate = () => {
      const state = host.gateway.getSnapshot().state;
      if (state !== 'authenticated') {
        binding?.dispose(); binding = null;
        clear(); return;
      }
      if (binding) return;
      binding = bindJourneySession(host.session, host.api, actorId => {
        generation++; read?.abort(); read = null;
        journey.setSession(actorId ? { actorId, view } : null);
        if (actorId && tripId && view === 'contact') journey.selectContactTrip(tripId);
        publish({ status: actorId ? 'ready' : 'verifying', failure: null,
          catalog: { status: 'unread', data: null, failure: null } });
      });
      const current = binding;
      void current.activate().then(async () => {
        if (stopped || binding !== current) return;
        if (view === 'driver') await loadContacts();
        else if (tripId) {
          await perform(() => journey.loadLocation());
          if (stopped || binding !== current) return;
          const reference = host.incidentReference?.(tripId);
          if (reference) await perform(() => journey.loadIncident(reference));
        }
      }).catch(error => {
        if (stopped || binding !== current) return;
        clear('error'); publish({ failure: classify(error) });
      });
    };
    unsubscribe = host.gateway.subscribe(activate);
    activate();
  }
  function stop() {
    if (stopped) return;
    stopped = true; unsubscribe?.(); unsubscribe = null;
    binding?.dispose(); binding = null; clear();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start, stop, loadContacts,
    restart() { stop(); start(); },
    invite: (body: InvitationInput) => perform(() => journey.inviteContact(body)),
    revokeStanding: (id: string) => perform(() => journey.revokeStanding(id), true),
    revokeTrip: () => {
      const reference = tripId ? host.grantReference?.(tripId) : null;
      return reference ? perform(() => journey.revokeTrip(reference), true) : Promise.resolve();
    },
    loadLocation: () => perform(() => journey.loadLocation()),
    loadIncident: () => {
      const reference = tripId ? host.incidentReference?.(tripId) : null;
      return reference ? perform(() => journey.loadIncident(reference)) : Promise.resolve();
    },
    acknowledge: () => perform(() => journey.acknowledge()),
    reportAction: (action: string) => perform(() => journey.reportAction(action)),
    retry: () => perform(() => journey.retryUncertainCommand()),
  };
}
export type ContactView = ReturnType<typeof createContactView>;
