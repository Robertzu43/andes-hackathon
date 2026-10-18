import type { ApiClient } from './client.ts';
import { ApiError } from './errors.ts';
import { createSessionGateway } from './gateway.ts';
import type { MemorySession, SessionCredentials } from './session.ts';
import type { DemoPersona } from './types.ts';

/**
 * Explicit synthetic-demo acquisition only. Each begin creates a new world once;
 * there is no external-login fallback, persona cache, persistence or retry.
 */
export function createDemoSessionGateway(config: {
  api: Pick<ApiClient, 'createDemoSession' | 'getIdentity'>;
  session: MemorySession;
  persona: DemoPersona;
}) {
  const { api, session, persona } = config;
  if (!['driver', 'family', 'colleague'].includes(persona)) throw new ApiError('configuration');
  let expectedId: string | null = null;
  return createSessionGateway({ session, mode: 'demo',
    api: { async getIdentity(options) {
      const identity = await api.getIdentity(options);
      if (!expectedId || identity.id.toLowerCase() !== expectedId.toLowerCase()) {
        throw new ApiError('invalid_response', { operation: 'getIdentity', outcome: 'not_applicable' });
      }
      return identity;
    } },
    async acquire({ signal }): Promise<SessionCredentials> {
      expectedId = null;
      const startedAt = Date.now();
      const world = await api.createDemoSession({ demo: true, signal });
      if (signal.aborted) throw new ApiError('cancelled', { operation: 'createDemoSession', outcome: 'unknown' });
      const selected = world[persona];
      try {
        // Unverified claims supply metadata/expiry only. They never authenticate:
        // the actual backend must verify the token and /me must match the persona.
        const payload = selected.token.split('.')[1]!;
        const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        if (!claims || typeof claims !== 'object') throw new Error();
        const c = claims as Record<string, unknown>;
        if (c.iss !== 'https://demo.andes.invalid' || c.aud !== 'andes-demo'
          || typeof c.sub !== 'string'
          || !new RegExp(`^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:${persona}$`, 'i').test(c.sub)
          || typeof c.exp !== 'number' || !Number.isSafeInteger(c.exp) || c.exp <= 0) throw new Error();
        const expiresAt = Math.min(c.exp * 1000, startedAt + world.expiresInSeconds * 1000);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error();
        expectedId = selected.id;
        return { issuer: c.iss, subject: c.sub, accessToken: selected.token, expiresAt };
      } catch { throw new ApiError('invalid_response', { operation: 'createDemoSession', outcome: 'unknown' }); }
    },
  });
}
