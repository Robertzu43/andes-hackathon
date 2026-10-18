import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { problem, type Actor } from './contracts.js';
export interface AuthConfig { issuer: string; audience: string; jwksUrl?: string; keyResolver?: JWTVerifyGetKey }
export function authenticator(config: AuthConfig) {
  if (!config?.issuer || !config.audience || (!config.jwksUrl && !config.keyResolver)) throw new Error('Trusted OIDC issuer, audience and JWKS required');
  if (config.jwksUrl && new URL(config.jwksUrl).protocol !== 'https:') throw new Error('OIDC JWKS must use HTTPS');
  const key = config.keyResolver ?? createRemoteJWKSet(new URL(config.jwksUrl!));
  return async (authorization: string | undefined, pool: pg.Pool): Promise<Actor> => {
    if (!authorization?.startsWith('Bearer ')) problem(401, 'unauthorized');
    let payload;
    try {
      ({ payload } = await jwtVerify(authorization.slice(7), key, { issuer: config.issuer, audience: config.audience,
        algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iss', 'aud'] }));
    } catch { problem(401, 'unauthorized'); }
    if (!payload.sub || payload.sub.length > 256) problem(401, 'unauthorized');
    const phone = typeof payload.phone_number === 'string' && /^\+[1-9]\d{6,14}$/.test(payload.phone_number) ? payload.phone_number : null;
    const verified = phone !== null && payload.phone_number_verified === true;
    // Only a verified phone claim updates the stored binding; a token without one (or unverified) never
    // downgrades it, which would cancel that contact's SOS jobs. Unchanged rows are not rewritten.
    const row = (await pool.query(`INSERT INTO identities(id,issuer,subject,phone,phone_verified) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(issuer,subject) DO UPDATE SET phone=excluded.phone,phone_verified=true
      WHERE excluded.phone_verified AND (identities.phone IS DISTINCT FROM excluded.phone OR NOT identities.phone_verified) RETURNING id`,
    [randomUUID(), config.issuer, payload.sub, phone, verified])).rows[0]
      ?? (await pool.query('SELECT id FROM identities WHERE issuer=$1 AND subject=$2', [config.issuer, payload.sub])).rows[0];
    return { id: row.id, phone, phoneVerified: verified };
  };
}
