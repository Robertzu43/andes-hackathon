import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import type { MemorySession, SessionCredentials } from './session.ts';

/** Token-free structural boundary supplied by foundation49; no React dependency. */
export interface GatewaySnapshot {
  readonly state: 'unconfigured' | 'signed-out' | 'connecting' | 'authenticated' | 'expired' | 'error';
  readonly mode: 'external' | 'demo';
}
export interface SessionGatewayConfig {
  session: MemorySession;
  api: Pick<ApiClient, 'getIdentity'>;
  mode: 'external' | 'demo';
  /** Explicit trusted provider/test injection. No built-in login or synthetic fallback. */
  acquire?: (options: { signal: AbortSignal }) => Promise<SessionCredentials>;
  release?: () => void | Promise<void>;
}

export function createSessionGateway(config: SessionGatewayConfig) {
  if (!['external', 'demo'].includes(config.mode)
    || (config.acquire !== undefined && typeof config.acquire !== 'function')
    || (config.release !== undefined && typeof config.release !== 'function')) throw new ApiError('configuration');
  const { session, api, acquire, release, mode } = config;
  let snapshot: Readonly<GatewaySnapshot> = Object.freeze({ state: acquire ? 'signed-out' : 'unconfigured', mode });
  const listeners = new Set<() => void>();
  let generation = 0;
  let disposed = false;
  let ownTransition = false;
  let active: { generation: number; abort: AbortController } | null = null;
  let pending: Promise<void> | null = null;
  function publish(state: GatewaySnapshot['state']) {
    if (snapshot.state === state) return;
    snapshot = Object.freeze({ state, mode });
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* A view must not affect session authority or other listeners. */ }
    }
  }
  function changeSession(action: () => void) {
    ownTransition = true;
    try { action(); } finally { ownTransition = false; }
  }
  function cancel() {
    generation += 1;
    const previous = active;
    active = null;
    pending = null;
    previous?.abort.abort();
  }
  const unsubscribe = session.subscribe(() => {
    if (ownTransition || disposed) return;
    cancel();
    publish(session.snapshot().status === 'expired' ? 'expired' : acquire ? 'signed-out' : 'unconfigured');
  });

  function begin(): Promise<void> {
    if (disposed || !acquire) return Promise.resolve();
    if (pending) return pending;
    const run = { generation: ++generation, abort: new AbortController() };
    active = run;
    const current = () => !disposed && active === run && generation === run.generation;
    // Defer execution so even a synchronous provider failure cannot strand pending.
    const task = Promise.resolve().then(async () => {
      try {
        if (!current()) return;
        const credentials = await acquire!({ signal: run.abort.signal });
        if (!current()) return;
        changeSession(() => session.setCredentials(credentials));
        const lease = session.capture();
        await api.getIdentity({ signal: run.abort.signal });
        if (current() && session.isCurrent(lease)) publish('authenticated');
      } catch {
        // Provider exceptions may contain credentials; expose only a fixed state.
        if (current()) { changeSession(() => session.clear()); publish('error'); }
      } finally {
        if (active === run) { active = null; pending = null; }
      }
    });
    pending = task;
    changeSession(() => session.clear());
    if (current()) publish('connecting');
    return task;
  }
  function end() {
    if (disposed) return;
    cancel();
    const endedAt = generation;
    changeSession(() => session.clear());
    publish(acquire ? 'signed-out' : 'unconfigured');
    if (release) {
      try {
        Promise.resolve(release()).catch(() => {
          if (!disposed && generation === endedAt) publish('error');
        });
      } catch { if (!disposed && generation === endedAt) publish('error'); }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed || typeof listener !== 'function' || listeners.size >= 32) throw new ApiError('invalid_input');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ...(acquire ? { begin, end } : {}),
    /** Call on application teardown. Clears locally and never invokes external logout. */
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel(); unsubscribe(); listeners.clear();
      changeSession(() => session.clear());
      snapshot = Object.freeze({ state: acquire ? 'signed-out' : 'unconfigured', mode });
    },
  };
}
export type SessionGateway = ReturnType<typeof createSessionGateway>;
