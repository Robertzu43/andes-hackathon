import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair, SignJWT } from 'jose';
import type { AuthConfig } from './auth.js';
import { problem } from './contracts.js';
import { transaction, type Context } from './db.js';
import { empty } from './api/schemas.js';
export interface DemoIssuer { auth: AuthConfig; phones: Record<Persona, string>; sign(subject: string, phone: string): Promise<string> }
const issuer = 'https://demo.andes.invalid', audience = 'andes-demo';
// Fictional +1-555-01xx numbers; with live sends, only the consented DEMO_LIVE_PHONE replaces the family number.
const synthetic = { driver: '+15555550101', family: '+15555550102', colleague: '+15555550103' } as const;
type Persona = keyof typeof synthetic;
/** ponytail: in-memory key; tokens die on restart and the demo must run one instance. */
export async function demoIssuer(env: NodeJS.ProcessEnv): Promise<DemoIssuer> {
  const live = env.DEMO_LIVE_PHONE;
  if (env.ZAVU_LIVE_SEND === 'true' && !/^\+[1-9]\d{6,14}$/.test(live ?? '')) throw new Error('DEMO_MODE live sends need DEMO_LIVE_PHONE, the one consented E.164 number');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  return {
    auth: { issuer, audience, keyResolver: async () => publicKey },
    phones: { ...synthetic, ...(env.ZAVU_LIVE_SEND === 'true' ? { family: live! } : {}) },
    sign: (subject, phone) => new SignJWT({ phone_number: phone, phone_number_verified: true }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime('2h').sign(privateKey)
  };
}
export function demoRoutes(app: FastifyInstance, ctx: Context, demo: DemoIssuer) {
  const people = demo.phones;
  // Personas invite only within their own world, so worlds cannot pool their consented phone onto one trip.
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
    const truckId = randomUUID(), grants = { family: randomUUID(), colleague: randomUUID() };
    await transaction(ctx.pool, async client => {
      for (const key of Object.keys(people) as Persona[]) await client.query('INSERT INTO identities(id,issuer,subject,phone,phone_verified) VALUES($1,$2,$3,$4,true)', [ids[key], issuer, `${world}:${key}`, people[key]]);
      await client.query('INSERT INTO trucks VALUES($1,$2,$3)', [truckId, ids.driver, 'ABC-123 (demo)']);
      for (const role of ['family', 'colleague'] as const) await client.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,role)
        VALUES($1,$2,$3,$4,true,true,true,true,$5,$6)`, [grants[role], ids.driver, ids[role], people[role], ctx.clock(), role]);
    });
    const token = (key: Persona) => demo.sign(`${world}:${key}`, people[key]);
    return { synthetic: true, expiresInSeconds: 7200,
      driver: { id: ids.driver, token: await token('driver'), truckId },
      family: { id: ids.family, token: await token('family'), grantId: grants.family },
      colleague: { id: ids.colleague, token: await token('colleague'), grantId: grants.colleague } };
  });
}
