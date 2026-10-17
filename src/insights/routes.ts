import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { problem } from '../contracts.js';
import { transaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { object } from '../api/schemas.js';
// shortcut: one aggregation zone and suppression count for the demo; per-country bands need their own evidence.
const TIME_ZONE = process.env.INSIGHTS_TIME_ZONE ?? 'America/Lima';
const MIN_COUNT = Math.max(3, Number(process.env.INSIGHTS_MIN_COUNT ?? 3) || 3); // never weaken public suppression below 3
const CELL = 0.05, DAY = 86400000;
const centre = (cell: number) => Number(((cell + 0.5) * CELL).toFixed(4));
export function insightRoutes(app: FastifyInstance, ctx: Context) {
  app.post('/v1/reports', { schema: { body: object({ kind: { enum: ['robo', 'intento_robo'] }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, occurredAt: { type: 'string', format: 'date-time' } }) } }, request => transaction(ctx.pool, client => idempotent(ctx, client, request, async () => {
    const body = request.body as { kind: string; latitude: number; longitude: number; occurredAt: string };
    const now = ctx.clock(); const at = Date.parse(body.occurredAt);
    if (at > now.getTime() + 30000 || at < now.getTime() - 365 * DAY) problem(400, 'occurred_at_out_of_bounds');
    const id = randomUUID();
    await client.query('INSERT INTO reports(id,reporter_id,kind,latitude,longitude,occurred_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, request.actor.id, body.kind, body.latitude, body.longitude, body.occurredAt, now]);
    return { id, kind: body.kind };
  })));
  app.get('/v1/insights/hotspots', { schema: { querystring: object({ days: { type: 'string', pattern: '^\\d{1,3}$' } }, []) } }, async request => {
    const days = Number((request.query as { days?: string }).days ?? 90);
    if (days < 1 || days > 365) problem(400, 'invalid_days');
    const now = ctx.clock();
    const rows = (await ctx.pool.query(`SELECT floor(latitude/$1)::int AS cy, floor(longitude/$1)::int AS cx, time_band(occurred_at,$2) AS band,
      count(*) FILTER (WHERE kind='robo')::int AS robo, count(*) FILTER (WHERE kind='intento_robo')::int AS intento, count(*)::int AS total, count(*) FILTER (WHERE synthetic)::int AS synthetic
      FROM security_events WHERE occurred_at > $3 AND occurred_at <= $4 GROUP BY 1,2,3 HAVING count(*) >= $5 ORDER BY total DESC,1,2,3`,
    [CELL, TIME_ZONE, new Date(now.getTime() - days * DAY), now, MIN_COUNT])).rows;
    const cells = rows.map(r => ({ lat: centre(r.cy), lon: centre(r.cx), band: r.band, robo: r.robo, intentoRobo: r.intento, total: r.total, synthetic: r.synthetic }));
    return { generatedAt: now.toISOString(), days, cellDegrees: CELL, minCount: MIN_COUNT, includesSynthetic: cells.some(c => c.synthetic > 0), cells };
  });
}
