import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { problem } from '../contracts.js';
import { transaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { object } from '../api/schemas.js';
// shortcut: one aggregation zone for the demo; per-country bands need their own evidence.
const TIME_ZONE = process.env.INSIGHTS_TIME_ZONE ?? 'America/Lima';
const MIN_COUNT = Math.max(3, Number(process.env.INSIGHTS_MIN_COUNT ?? 3) || 3); // never weaken public suppression below 3
if (!Number.isInteger(MIN_COUNT)) throw new Error('INSIGHTS_MIN_COUNT must be an integer');
new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE }); // an unknown zone fails at startup, not on every request
const CELL = 0.05, HOUR = 3600000, DAY = 86400000;
const centre = (cell: number) => Number(((cell + 0.5) * CELL).toFixed(4));
export function insightRoutes(app: FastifyInstance, ctx: Context) {
  app.post('/v1/reports', { schema: { body: object({ kind: { enum: ['robo', 'intento_robo'] }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, occurredAt: { type: 'string', format: 'date-time' } }) } }, request => transaction(ctx.pool, client => idempotent(ctx, client, request, async () => {
    const body = request.body as { kind: string; latitude: number; longitude: number; occurredAt: string };
    const now = ctx.clock(); const at = Date.parse(body.occurredAt);
    if (!(at <= now.getTime() + 30000 && at >= now.getTime() - 365 * DAY)) problem(400, 'occurred_at_out_of_bounds');
    const id = randomUUID();
    await client.query('INSERT INTO reports(id,reporter_id,kind,latitude,longitude,occurred_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, request.actor.id, body.kind, body.latitude, body.longitude, new Date(at), now]);
    return { id, kind: body.kind };
  })));
  app.get('/v1/insights/hotspots', { schema: { querystring: object({ days: { enum: ['7', '30', '90', '365'] } }, []) } }, async request => {
    const days = Number((request.query as { days?: string }).days ?? 90);
    // Fixed windows ending on the hour, so diffing public counts cannot pin an event's exact time.
    const now = ctx.clock(); const end = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
    // Real events need MIN_COUNT distinct contributors on their own; seeded rows are added on top and never help reach it.
    const rows = (await ctx.pool.query(`SELECT cy, cx, band, sum(robo)::int AS robo, sum(intento)::int AS intento, sum(n)::int AS total, coalesce(sum(n) FILTER (WHERE synthetic), 0)::int AS synthetic
      FROM (SELECT floor(latitude/$1)::int AS cy, floor(longitude/$1)::int AS cx, time_band(occurred_at,$2) AS band, synthetic,
          count(*) FILTER (WHERE kind='robo') AS robo, count(*) FILTER (WHERE kind='intento_robo') AS intento, count(*) AS n
        FROM security_events WHERE occurred_at > $3 AND occurred_at <= $4 GROUP BY 1,2,3,4 HAVING synthetic OR count(DISTINCT contributor) >= $5::int) s
      GROUP BY 1,2,3 HAVING sum(n) >= $5::int ORDER BY total DESC,1,2,3`,
    [CELL, TIME_ZONE, new Date(end.getTime() - days * DAY), end, MIN_COUNT])).rows;
    const cells = rows.map(r => ({ lat: centre(r.cy), lon: centre(r.cx), band: r.band, robo: r.robo, intentoRobo: r.intento, total: r.total, synthetic: r.synthetic }));
    return { generatedAt: now.toISOString(), days, cellDegrees: CELL, minCount: MIN_COUNT, includesSynthetic: cells.some(c => c.synthetic > 0), cells };
  });
}
