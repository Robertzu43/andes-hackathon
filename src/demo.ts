import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair, SignJWT } from 'jose';
import type { AuthConfig } from './auth.js';
import { problem } from './contracts.js';
import { transaction, type Context } from './db.js';
import { empty } from './api/schemas.js';
import { loadQualification } from './notifications/zavu.js';
export interface DemoIssuer { auth: AuthConfig; tripCountries: string[]; sign(subject: string, expiresAt: number): Promise<string> }
export const DEMO_ISSUER = 'https://demo.andes.invalid';
const issuer = DEMO_ISSUER, audience = 'andes-demo', LIFETIME_SECONDS = 7200;
// Fictional +1-555-01xx numbers. The family persona has none: its contact verifies their own number by SMS code
// (POST /v1/demo/phone/verify), the only way a demo persona gets a number dispatch accepts.
const synthetic = { driver: '+15555550101', family: null, colleague: '+15555550103' } as const;
type Persona = keyof typeof synthetic;
/** ponytail: in-memory key; tokens die on restart and the demo must run one instance. */
export async function demoIssuer(env: NodeJS.ProcessEnv): Promise<DemoIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  return {
    auth: { issuer, audience, keyResolver: async () => publicKey, presence: true },
    // The trip form offers only countries with Zavu channel entries, live or not. DEMO_ALLOWED_COUNTRIES is about codes.
    tripCountries: [...new Set(loadQualification(env)?.entries.map(entry => entry.country) ?? [])].sort(),
    // The session route is anonymous: tokens carry no phone claim.
    sign: (subject, expiresAt) => new SignJWT({}).setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime(expiresAt).sign(privateKey)
  };
}
export function demoRoutes(app: FastifyInstance, ctx: Context, demo: DemoIssuer) {
  // Personas invite only within their own world, so worlds cannot pool a verified number onto one trip.
  app.addHook('preHandler', async request => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/v1/contacts') return;
    const worlds = (await ctx.pool.query("SELECT count(DISTINCT split_part(subject,':',1))::int AS n FROM identities WHERE id IN ($1,$2)", [request.actor.id, (request.body as { contactId: string }).contactId])).rows[0].n;
    if (worlds > 1) problem(403, 'demo_world_boundary');
  });
  let windowStart = 0, created = 0;
  app.post('/v1/demo/session', { schema: { body: empty } }, async () => {
    const now = ctx.clock().getTime();
    if (now - windowStart > 60000) { windowStart = now; created = 0; }
    // ponytail: one global limit for a single demo instance; per-client limits if this outlives the event.
    if (++created > 30) problem(429, 'demo_rate_limited');
    const world = randomUUID();
    const ids: Record<Persona, string> = { driver: randomUUID(), family: randomUUID(), colleague: randomUUID() };
    const colleagueGrant = randomUUID();
    await transaction(ctx.pool, async client => {
      for (const key of Object.keys(synthetic) as Persona[]) await client.query('INSERT INTO identities(id,issuer,subject,phone,phone_verified,synthetic,last_seen_at) VALUES($1,$2,$3,$4,$5,true,$6)',
        [ids[key], issuer, `${world}:${key}`, synthetic[key], synthetic[key] !== null, ctx.clock()]);
      // No truck and no family grant: the guided journey creates both. The colleague keeps its fictional number and an
      // accepted grant, and never verifies by SMS code, so its alerts show as not allowed.
      await client.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,role)
        VALUES($1,$2,$3,$4,true,true,true,true,$5,'colleague')`, [colleagueGrant, ids.driver, ids.colleague, synthetic.colleague, ctx.clock()]);
    });
    // Verification checks exp against the real clock, so expiresAt does too.
    const exp = Math.floor(Date.now() / 1000) + LIFETIME_SECONDS;
    const token = (key: Persona) => demo.sign(`${world}:${key}`, exp);
    return { synthetic: true, expiresInSeconds: LIFETIME_SECONDS, expiresAt: new Date(exp * 1000).toISOString(), tripCountries: demo.tripCountries,
      driver: { id: ids.driver, token: await token('driver') },
      family: { id: ids.family, token: await token('family') },
      colleague: { id: ids.colleague, token: await token('colleague'), grantId: colleagueGrant } };
  });
}
