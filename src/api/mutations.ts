import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { problem } from '../contracts.js';
import type { Context } from '../db.js';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function idempotent<T>(ctx: Context, client: pg.PoolClient, request: FastifyRequest, operation: () => Promise<T>): Promise<T> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key)) problem(400, 'idempotency_key_required');
  const scope = `${request.method} ${request.routeOptions.url} ${JSON.stringify(request.params)}`;
  const hash = createHash('sha256').update(canonical(request.body)).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${request.actor.id}:${scope}:${key}`]);
  const existing = (await client.query('SELECT request_hash,response FROM idempotency WHERE actor_id=$1 AND scope=$2 AND key=$3', [request.actor.id, scope, key])).rows[0];
  if (existing) { if (existing.request_hash !== hash) problem(409, 'idempotency_conflict'); return existing.response; }
  const result = await operation();
  await client.query('INSERT INTO idempotency VALUES($1,$2,$3,$4,$5,$6)', [request.actor.id, scope, key, hash, JSON.stringify(result), ctx.clock()]);
  return result;
}
