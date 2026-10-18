import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { problem } from './contracts.js';
import { transaction, type Context } from './db.js';
import { object } from './api/schemas.js';
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
const E164 = /^\+[1-9]\d{6,14}$/, HOUR = 3600000, DAY = 86400000, CODE_MS = 600000;
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
}
