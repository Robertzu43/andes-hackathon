import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import { createSessionGateway } from './gateway.ts';
import type { MemorySession, SessionCredentials } from './session.ts';
import type { DemoPersona, DemoWorld } from './types.ts';
import { isUuid } from './uuid.ts';

type Minted = { world: DemoWorld; startedAt: number };

/**
 * One synthetic world, minted on first use and reused until its declared lifetime ends.
 * Share it between persona gateways so contacts reach the driver's trip; reusing it on
 * a second begin() keeps an active trip and SOS reachable. Memory only: never persisted.
 */
export function createDemoWorld(api: Pick<ApiClient, 'createDemoSession'>) {
  let held: Promise<Minted> | null = null;
  let current: Minted | null = null;
  return {
    get(): Promise<Minted> {
      if (current && Date.now() >= current.startedAt + current.world.expiresInSeconds * 1000) drop(current.world);
      if (!held) {
        const startedAt = Date.now();
        const minting = api.createDemoSession({ demo: true }).then(world => (current = { world, startedAt }));
        held = minting;
        minting.catch(() => { if (held === minting) held = null; });
      }
      return held;
    },
    /** Forget a world the server no longer accepts; the next get() mints a new one. */
    drop,
  };
  function drop(world: DemoWorld) {
    if (current?.world === world) { held = null; current = null; }
  }
}
export type DemoWorldSource = ReturnType<typeof createDemoWorld>;

/**
 * Explicit synthetic-demo acquisition only: no external-login fallback, persistence or retry.
 */
export function createDemoSessionGateway(config: {
  api: Pick<ApiClient, 'createDemoSession' | 'getIdentity'>;
  session: MemorySession;
  persona: DemoPersona;
  world?: DemoWorldSource;
}) {
  const { api, session, persona } = config;
  if (!['driver', 'family', 'colleague'].includes(persona)) throw new ApiError('configuration');
  const shared = config.world ?? createDemoWorld(api);
  let expectedId: string | null = null;
  let used: DemoWorld | null = null;
  return createSessionGateway({ session, mode: 'demo',
    api: { async getIdentity(options) {
      let identity;
      try { identity = await api.getIdentity(options); }
      catch (error) {
        // Tokens die with a server restart; let the next begin() mint a world that works.
        if (used && error instanceof ApiError && error.status === 401) shared.drop(used);
        throw error;
      }
      if (!expectedId || identity.id.toLowerCase() !== expectedId.toLowerCase()) {
        throw new ApiError('invalid_response', { operation: 'getIdentity', outcome: 'not_applicable' });
      }
      return identity;
    } },
    async acquire({ signal }): Promise<SessionCredentials> {
      expectedId = null;
      const { world, startedAt } = await shared.get();
      if (signal.aborted) throw new ApiError('cancelled', { operation: 'createDemoSession', outcome: 'unknown' });
      used = world;
      const selected = world[persona];
      try {
        // Unverified claims supply metadata/expiry only. They never authenticate:
        // the actual backend must verify the token and /me must match the persona.
        const payload = selected.token.split('.')[1]!;
        const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        if (!claims || typeof claims !== 'object') throw new Error();
        const c = claims as Record<string, unknown>;
        if (c.iss !== 'https://demo.andes.invalid' || c.aud !== 'andes-demo'
          || typeof c.sub !== 'string' || !c.sub.endsWith(`:${persona}`) || !isUuid(c.sub.slice(0, -persona.length - 1))
          || typeof c.exp !== 'number' || !Number.isSafeInteger(c.exp) || c.exp <= 0) throw new Error();
        const expiresAt = Math.min(c.exp * 1000, startedAt + world.expiresInSeconds * 1000);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error();
        expectedId = selected.id;
        return { issuer: c.iss, subject: c.sub, accessToken: selected.token, expiresAt };
      } catch {
        shared.drop(world); // An unusable world must not be reused on the next begin().
        throw new ApiError('invalid_response', { operation: 'createDemoSession', outcome: 'unknown' });
      }
    },
  });
}

/**
 * Consume a family invitation, never mint a world. Claims constrain acquisition only;
 * /me authenticates the credential. The recipient catalog must separately establish
 * grant membership before consent; a UUID-shaped route proves no ownership.
 */
export function createInvitationSession(config: {
  api: Pick<ApiClient, 'getIdentity'>;
  session: MemorySession;
  location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history: Pick<History, 'state' | 'replaceState'>;
}): import('./gateway.ts').SessionGateway {
  const { api, session, location, history } = config;
  // Run synchronously, even for malformed input, before creating any asynchronous work.
  const fragment = location.hash;
  history.replaceState(history.state, '', location.pathname + location.search);
  let held = invitationCredentials(location.pathname, fragment);
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function retire() { held = null; clearTimeout(expiry); expiry = undefined; }
  if (held) {
    expiry = setTimeout(retire, Math.max(0, held.expiresAt - Date.now()));
    (expiry as unknown as { unref?: () => void }).unref?.();
  }
  // This gateway must never authenticate using a driver's already-local world.
  session.clear();
  const gateway = createSessionGateway({ api, session, mode: 'demo', release: retire,
    async acquire({ signal }) {
      const credentials = held;
      retire(); // A credential is handed to MemorySession at most once.
      if (signal.aborted || !credentials || credentials.expiresAt <= Date.now()) throw new ApiError('unauthenticated');
      return credentials;
    },
  });
  return { ...gateway,
    end() { retire(); gateway.end?.(); },
    dispose() { retire(); gateway.dispose(); },
  };
}

function invitationCredentials(pathname: string, fragment: string): SessionCredentials | null {
  try {
    const path = /^\/contact\/invitations\/([^/]+)$/.exec(pathname);
    if (!path || !isUuid(path[1]) || fragment.length > 16_387 || !fragment.startsWith('#')) return null;
    const entries = [...new URLSearchParams(fragment.slice(1))];
    if (entries.length !== 1 || entries[0]?.[0] !== 't') return null;
    const token = entries[0][1];
    if (token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const payload = token.split('.')[1]!;
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    const c = claims as Record<string, unknown>;
    if (c.iss !== 'https://demo.andes.invalid' || c.aud !== 'andes-demo'
      || typeof c.sub !== 'string' || !c.sub.endsWith(':family') || !isUuid(c.sub.slice(0, -7))
      || typeof c.exp !== 'number' || !Number.isSafeInteger(c.exp) || c.exp <= 0) return null;
    const expiresAt = c.exp * 1000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 7_200_000) return null;
    return { issuer: c.iss, subject: c.sub, accessToken: token, expiresAt };
  } catch { return null; }
}
