import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { problem } from './contracts.js';
import { transaction, type Context } from './db.js';
import { object } from './api/schemas.js';
import { DEMO_ISSUER } from './demo.js';
import { textPayload, type Outcome, type Provider } from './notifications/zavu.js';

// Calling-code prefixes, not numbering plans: +1 covers the entire NANP, including Canada and the Caribbean.
export const CALLING_CODES: Record<string, string> = {
  AR: '54', BR: '55', CL: '56', CO: '57', MX: '52', PE: '51', US: '1',
};

export interface DemoLimits {
  pepper: string;
  allowedCountries: string[];
  perNumberHourly: number;
  perIpHourly: number;
  smsDailyCap: number;
  alertsPerNumberDaily: number;
}

/** Live sends require both daily caps and a pepper; disabled sends allow these settings to be absent. */
export function demoLimits(env: NodeJS.ProcessEnv): DemoLimits {
  const live = env.ZAVU_LIVE_SEND === 'true';
  const count = (name: string, fallback?: number): number => {
    const raw = env[name];
    if (raw === undefined) {
      if (fallback === undefined) throw new Error(`DEMO_MODE live sends require ${name}`);
      return fallback;
    }
    if (!/^[1-9]\d{0,8}$/.test(raw)) throw new Error(`${name} must be a positive integer`);
    return Number(raw);
  };

  const allowedCountries = (env.DEMO_ALLOWED_COUNTRIES ?? 'PE').split(',').map(code => code.trim());
  if (allowedCountries.some(code => !Object.hasOwn(CALLING_CODES, code))) {
    throw new Error(`DEMO_ALLOWED_COUNTRIES may list only ${Object.keys(CALLING_CODES).join(',')}`);
  }
  // With sends disabled, a fresh throwaway pepper is sufficient.
  const pepper = env.DEMO_PHONE_PEPPER ?? (live ? '' : randomBytes(32).toString('hex'));
  if (pepper.length < 32) throw new Error('DEMO_PHONE_PEPPER must be a random secret of at least 32 characters');

  return {
    pepper,
    allowedCountries,
    perNumberHourly: count('DEMO_OTP_PER_NUMBER_HOURLY', 3),
    perIpHourly: count('DEMO_OTP_PER_IP_HOURLY', 5),
    smsDailyCap: count('DEMO_SMS_DAILY_CAP', live ? undefined : 0),
    alertsPerNumberDaily: count('DEMO_ALERTS_PER_NUMBER_DAILY', live ? undefined : 0),
  };
}

/** Every demo text starts with this: the code SMS below, and alert texts are checked at worker startup (src/worker.ts). */
export const DEMO_PREFIX = 'Demo de Tándem';
export type CodeSender = (to: string, text: string) => Promise<Outcome>;
/** Settings plus the code sender. `send: null` (ZAVU_LIVE_SEND=false) answers 503 before anything is counted. `code` is an
 * in-process test seam for createApp only; nothing reads a fixed code from the environment. */
export type DemoPhoneConfig = DemoLimits & { send: CodeSender | null; code?: () => string };
/** Codes go out on the qualified sender's SMS channel (sms_oneway when configured), outside alert qualification. */
export const zavuSender = (provider: Provider): CodeSender => (to, text) => provider.send(textPayload(provider.qualification, to, text, randomUUID()));
const E164 = /^\+[1-9]\d{6,14}$/, HOUR = 3600000, DAY = 86400000, CODE_MS = 600000, MAX_ATTEMPTS = 5;
export function demoPhoneRoutes(app: FastifyInstance, ctx: Context, config: DemoPhoneConfig) {
  const mac = (kind: string, value: string) => createHmac('sha256', config.pepper).update(`${kind}:${value}`).digest('hex');
  app.post('/v1/demo/phone/start', { schema: { body: object({ phone: { type: 'string' } }) } }, async (request, reply) => {
    const { phone } = request.body as { phone: string };
    if (!E164.test(phone)) problem(400, 'invalid_phone');
    if (!config.allowedCountries.some(country => phone.startsWith(`+${CALLING_CODES[country]}`))) problem(403, 'country_not_allowed');
    if (!config.send) return reply.code(503).send({ code: 'demo_sms_disabled' }); // counted against nothing
    const now = ctx.clock(), id = randomUUID(), expiresAt = new Date(now.getTime() + CODE_MS);
    const code = config.code?.() ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const phoneHmac = mac('phone', phone), ipHmac = mac('ip', request.ip);
    const refused = await transaction(ctx.pool, async client => {
      // ponytail: one global lock serializes code requests so no cap can be overshot; fine for one demo instance.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('demo_phone_start',0))");
      const used = (await client.query(`SELECT count(*)::int AS day, count(*) FILTER (WHERE created_at>$2 AND phone_hmac=$3)::int AS phone,
          count(*) FILTER (WHERE created_at>$2 AND ip_hmac=$4)::int AS ip FROM demo_phone_challenges WHERE created_at>$1`,
        [new Date(now.getTime() - DAY), new Date(now.getTime() - HOUR), phoneHmac, ipHmac])).rows[0];
      if (used.day >= config.smsDailyCap) return 'demo_budget_exhausted';
      if (used.phone >= config.perNumberHourly || used.ip >= config.perIpHourly) return 'rate_limited';
      await client.query('INSERT INTO demo_phone_challenges(id,identity_id,phone_hmac,ip_hmac,code_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, request.actor.id, phoneHmac, ipHmac, mac('code', `${id}:${code}`), now, expiresAt]);
      return null;
    });
    if (refused) problem(429, refused);
    // Sent after commit, never inside a transaction. A request counts even if the provider refuses it, so failures cannot be retried past the caps.
    const sent = await config.send(phone, `${DEMO_PREFIX}: tu código es ${code}`);
    if (sent.state === 'rejected') return reply.code(503).send({ code: 'demo_sms_disabled' });
    return reply.code(202).send({ expiresAt: expiresAt.toISOString() });
  });
  app.post('/v1/demo/phone/verify', { schema: { body: object({ phone: { type: 'string' }, code: { type: 'string' } }) } }, async request => {
    const { phone, code } = request.body as { phone: string; code: string };
    // Report failures after commit so a code mismatch cannot roll back its attempt.
    const failed = await transaction<'invalid_code' | 'code_expired' | 'too_many_attempts' | null>(ctx.pool, async client => {
      // Serialize with start before selecting: an in-flight issuance must commit before the latest check.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('demo_phone_start',0))");
      const challenge = (await client.query(`SELECT id,code_hash,expires_at,attempts FROM demo_phone_challenges
        WHERE identity_id=$1 AND phone_hmac=$2 ORDER BY issuance_order DESC LIMIT 1 FOR UPDATE`,
        [request.actor.id, mac('phone', phone)])).rows[0];
      if (!challenge) return 'invalid_code';
      const now = ctx.clock();
      if (challenge.attempts >= MAX_ATTEMPTS) return 'too_many_attempts';
      if (challenge.expires_at <= now) return 'code_expired';
      const match = timingSafeEqual(Buffer.from(mac('code', `${challenge.id}:${code}`), 'hex'),
        Buffer.from(challenge.code_hash, 'hex')) && /^\d{6}$/.test(code);
      // Retain the newest row after spending it, so an older code can never become current again.
      await client.query('UPDATE demo_phone_challenges SET attempts=attempts+1,expires_at=CASE WHEN $2 THEN $3 ELSE expires_at END WHERE id=$1',
        [challenge.id, match, now]);
      if (!match) return 'invalid_code';
      await client.query(`INSERT INTO demo_phone_verifications(identity_id,phone,verified_at) VALUES($1,$2,$3)
        ON CONFLICT(identity_id) DO UPDATE SET phone=excluded.phone,verified_at=excluded.verified_at`, [request.actor.id, phone, now]);
      await client.query('UPDATE identities SET phone=$2,phone_verified=true WHERE id=$1', [request.actor.id, phone]);
      return null;
    });
    if (failed) problem({ invalid_code: 400, code_expired: 410, too_many_attempts: 429 }[failed], failed);
    return { verified: true };
  });
}

/** Control runs this every ten minutes in demo mode. Retain only hashes/budget facts after 24 h idle. */
export async function purgeDemoWorlds(ctx: Context): Promise<void> {
  await transaction(ctx.pool, async client => {
    // Same first lock as start/verify: no OTP write can cross the scrub or revive a deleted challenge.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('demo_phone_start',0))");
    const worlds = (await client.query(`SELECT split_part(subject,':',1) AS world FROM identities WHERE issuer=$1
      GROUP BY 1 HAVING max(last_seen_at)<$2`, [DEMO_ISSUER, new Date(ctx.clock().getTime() - DAY)])).rows.map(row => row.world as string);
    if (!worlds.length) return;
    const candidates = (await client.query(`SELECT id FROM identities WHERE issuer=$1 AND split_part(subject,':',1)=ANY($2)`,
      [DEMO_ISSUER, worlds])).rows.map(row => row.id as string);
    // Revocation locks grant -> trips. Keep that order; stable grant keys permit SOS's FK KEY SHARE.
    await client.query(`SELECT id FROM contact_grants WHERE driver_id=ANY($1) OR contact_id=ANY($1)
      ORDER BY id FOR NO KEY UPDATE`, [candidates]);
    // Authorization holds trip -> job -> account until its payload commits. Finish it before scrubbing.
    await client.query(`SELECT t.id FROM trips t WHERE t.driver_id=ANY($1)
      OR EXISTS(SELECT 1 FROM jobs j WHERE j.trip_id=t.id AND j.recipient_id=ANY($1))
      OR EXISTS(SELECT 1 FROM trip_grants tg JOIN contact_grants g ON g.id=tg.grant_id
        WHERE tg.trip_id=t.id AND (g.driver_id=ANY($1) OR g.contact_id=ANY($1)))
      ORDER BY t.id FOR UPDATE`, [candidates]);
    // Auth commits presence before its route transaction. Lock every persona before a fresh statement:
    // an upsert committed ahead of us wins; an upsert queued behind us sees the already-scrubbed binding.
    await client.query(`SELECT id FROM identities WHERE issuer=$1 AND split_part(subject,':',1)=ANY($2)
      ORDER BY id FOR NO KEY UPDATE`, [DEMO_ISSUER, worlds]);
    const cutoff = new Date(ctx.clock().getTime() - DAY);
    const ids = (await client.query(`WITH idle AS (
        SELECT split_part(subject,':',1) AS world FROM identities WHERE issuer=$1 AND split_part(subject,':',1)=ANY($2)
        GROUP BY 1 HAVING max(last_seen_at)<$3
      ) SELECT i.id FROM identities i JOIN idle ON split_part(i.subject,':',1)=idle.world WHERE i.issuer=$1
        AND NOT EXISTS(SELECT 1 FROM demo_phone_challenges c JOIN identities owner ON owner.id=c.identity_id
          WHERE owner.issuer=$1 AND split_part(owner.subject,':',1)=idle.world AND c.created_at>$3)`,
      [DEMO_ISSUER, worlds, cutoff])).rows.map(row => row.id as string);
    // A start can timestamp its challenge after its auth presence. Defer the whole world until that
    // usage leaves the existing rolling 24 h cap; deleting it earlier would replenish the OTP budget.
    if (!ids.length) return;
    await client.query('DELETE FROM demo_phone_challenges WHERE identity_id=ANY($1)', [ids]);
    await client.query('DELETE FROM demo_phone_verifications WHERE identity_id=ANY($1)', [ids]);
    await client.query('UPDATE identities SET phone=NULL,phone_verified=false WHERE id=ANY($1) AND (phone IS NOT NULL OR phone_verified)', [ids]);
    // trip_grants/jobs reference these rows: anonymize without cascading away delivery evidence.
    await client.query("UPDATE contact_grants SET phone='' WHERE (driver_id=ANY($1) OR contact_id=ANY($1)) AND phone<>''", [ids]);
    await client.query(`UPDATE dispatch_attempts a SET payload=NULL FROM jobs j
      WHERE j.id=a.job_id AND j.recipient_id=ANY($1) AND a.payload IS NOT NULL`, [ids]);
  });
}
