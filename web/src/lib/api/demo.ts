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
