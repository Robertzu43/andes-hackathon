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
  const demo = process.env.DEMO_MODE === 'true'; // same switch as demo-persona sign-in: personas are free to mint, so their data is demo data
  // The only view of the data anyone gets: fixed windows ending on the hour; real events need MIN_COUNT distinct
  // contributors in a cell and band on their own; seeded rows are added on top and never help reach it.
  // ponytail: recomputed per request; cache per (days, hour) if public traffic grows.
  async function publicCells(days: number, now: Date) {
    const end = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
    const rows = (await ctx.pool.query(`SELECT cy, cx, band, sum(robo)::int AS robo, sum(intento)::int AS intento, sum(n)::int AS total, coalesce(sum(n) FILTER (WHERE synthetic), 0)::int AS synthetic
      FROM (SELECT floor(latitude/$1)::int AS cy, floor(longitude/$1)::int AS cx, time_band(occurred_at,$2) AS band, synthetic,
          count(*) FILTER (WHERE kind='robo') AS robo, count(*) FILTER (WHERE kind='intento_robo') AS intento, count(*) AS n
        FROM security_events WHERE occurred_at > $3 AND occurred_at <= $4 GROUP BY 1,2,3,4 HAVING synthetic OR count(DISTINCT contributor) >= $5::int) s
      GROUP BY 1,2,3 HAVING sum(n) >= $5::int ORDER BY total DESC,1,2,3`,
    [CELL, TIME_ZONE, new Date(end.getTime() - days * DAY), end, MIN_COUNT])).rows;
    return rows.map(r => ({ cy: r.cy as number, cx: r.cx as number, band: r.band as string, robo: r.robo as number, intentoRobo: r.intento as number, total: r.total as number, synthetic: (demo ? r.total : r.synthetic) as number }));
  }
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
    await client.query('INSERT INTO reports(id,reporter_id,kind,latitude,longitude,occurred_at,created_at,synthetic) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, request.actor.id, body.kind, body.latitude, body.longitude, new Date(at), now, demo]);
    return { id, kind: body.kind };
  })));
  app.get('/v1/insights/hotspots', { schema: { querystring: object({ days: { enum: ['7', '30', '90', '365'] } }, []) } }, async request => {
    const days = Number((request.query as { days?: string }).days ?? 90); const now = ctx.clock();
    const cells = (await publicCells(days, now)).map(({ cy, cx, ...cell }) => ({ lat: centre(cy), lon: centre(cx), ...cell }));
    return { generatedAt: now.toISOString(), days, cellDegrees: CELL, minCount: MIN_COUNT, includesSynthetic: cells.some(c => c.synthetic > 0), cells };
  });
  app.get('/v1/insights/advice', { schema: { querystring: object({ lat: decimal, lon: decimal, locale: { type: 'string', maxLength: 35 } }, ['lat', 'lon']) } }, async request => {
    const query = request.query as { lat: string; lon: string; locale?: string };
    const lat = Number(query.lat), lon = Number(query.lon);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) problem(400, 'invalid_coordinates');
    const now = ctx.clock(); const band = (await ctx.pool.query('SELECT time_band($1,$2) AS band', [now, TIME_ZONE])).rows[0].band as string;
    // Advice sums only cells the public map already shows, so it can never locate or time a hidden report.
    const cy = Math.floor(lat / CELL), cx = Math.floor(lon / CELL);
    const near = (await publicCells(90, now)).filter(c => c.band === band && Math.abs(c.cy - cy) <= 1 && Math.abs(c.cx - cx) <= 1);
    const count = near.reduce((sum, c) => sum + c.total, 0);
    if (!count) return { level: 'none' };
    return { level: 'caution', count, includesSynthetic: near.some(c => c.synthetic > 0), band, text: adviceText[query.locale?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'es'](count, band === 'noche') };
  });
}
