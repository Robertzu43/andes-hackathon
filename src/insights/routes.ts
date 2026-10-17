import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { owner, problem } from '../contracts.js';
import { transaction, withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { idParams, object } from '../api/schemas.js';
// shortcut: one aggregation zone for the demo; per-country bands need their own evidence.
const TIME_ZONE = process.env.INSIGHTS_TIME_ZONE ?? 'America/Lima';
const MIN_COUNT = Math.max(3, Number(process.env.INSIGHTS_MIN_COUNT ?? 3) || 3); // never weaken public suppression below 3
if (!Number.isInteger(MIN_COUNT)) throw new Error('INSIGHTS_MIN_COUNT must be an integer');
new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE }); // an unknown zone fails at startup, not on every request
const CELL = 0.05, HOUR = 3600000, DAY = 86400000;
const decimal = { type: 'string', maxLength: 32, pattern: '^-?\\d{1,3}(\\.\\d+)?$' }; // raw browser coordinates can carry 15+ decimals
const centre = (cell: number) => Number(((cell + 0.5) * CELL).toFixed(4));
// ponytail: a count rule, not a model; replace once real labelled incidents exist.
const adviceText = {
  es: (n: number, night: boolean) => `${n} reportes de robo en esta zona de ${night ? 'noche' : 'día'} (últimos 90 días). Si puedes, detente en un lugar concurrido y seguro.`,
  'pt-BR': (n: number, night: boolean) => `${n} relatos de roubo nesta região ${night ? 'à noite' : 'durante o dia'} (últimos 90 dias). Se puder, pare em um local movimentado e seguro.`
};
export function insightRoutes(app: FastifyInstance, ctx: Context) {
  const map = readFileSync(new URL('../../public/mapa.html', import.meta.url)); // read once; a missing file fails at startup
  app.get('/mapa', async (_request, reply) => reply.type('text/html; charset=utf-8').send(map));
  app.post('/v1/incidents/:id/label', { schema: { params: idParams, body: object({ label: { enum: ['robo', 'intento_robo', 'falsa_alarma', 'sin_senal', 'otro'] } }) } }, async request => {
    const id = (request.params as { id: string }).id;
    const row = (await ctx.pool.query('SELECT trip_id FROM incidents WHERE id=$1', [id])).rows[0];
    if (!row) problem(404, 'incident_not_found');
    return withTripTransaction(ctx, row.trip_id, async (client, trip) => {
      owner(trip, request.actor);
      await client.query('SELECT id FROM incidents WHERE id=$1 FOR UPDATE', [id]);
      return idempotent(ctx, client, request, async () => {
        const { label } = request.body as { label: string };
        await client.query('UPDATE incidents SET label=$2,labeled_at=$3,labeled_by=$4 WHERE id=$1', [id, label, ctx.clock(), request.actor.id]);
        return { id, label };
      });
    });
  });
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
  app.get('/v1/insights/advice', { schema: { querystring: object({ lat: decimal, lon: decimal, locale: { enum: ['es', 'pt-BR'] } }, ['lat', 'lon']) } }, async request => {
    const query = request.query as { lat: string; lon: string; locale?: 'es' | 'pt-BR' };
    const lat = Number(query.lat), lon = Number(query.lon);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) problem(400, 'invalid_coordinates');
    const now = ctx.clock();
    const row = (await ctx.pool.query(`SELECT count(*) FILTER (WHERE NOT synthetic)::int AS reported, count(DISTINCT contributor) FILTER (WHERE NOT synthetic)::int AS people,
        count(*) FILTER (WHERE synthetic)::int AS seeded, time_band($4,$3) AS band FROM security_events
      WHERE abs(floor(latitude/$5) - floor($1::float8/$5)) <= 1 AND abs(floor(longitude/$5) - floor($2::float8/$5)) <= 1
        AND occurred_at > $6 AND occurred_at <= $4 AND time_band(occurred_at,$3) = time_band($4,$3)`,
    [lat, lon, TIME_ZONE, now, CELL, new Date(now.getTime() - 90 * DAY)])).rows[0];
    // Same rule as hotspots: real reports count only with enough distinct contributors; seeded rows are flagged.
    const reported = row.people >= MIN_COUNT ? row.reported : 0, seeded = row.seeded >= MIN_COUNT ? row.seeded : 0;
    if (reported + seeded === 0) return { level: 'none' };
    return { level: 'caution', count: reported + seeded, includesSynthetic: seeded > 0, band: row.band, text: adviceText[query.locale ?? 'es'](reported + seeded, row.band === 'noche') };
  });
}
