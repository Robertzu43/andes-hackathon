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
// IANA names only: PostgreSQL reads offsets such as '-05:00' with the POSIX sign, the opposite of ISO 8601.
if (!/^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/.test(TIME_ZONE)) throw new Error('INSIGHTS_TIME_ZONE must be an IANA zone name');
new Intl.DateTimeFormat('en', { timeZone: TIME_ZONE }); // an unknown zone fails at startup, not on every request
const CELL = 0.05, HOUR = 3600000, DAY = 86400000, WINDOW_DAYS = 90;
const REPORTS_PER_DAY = 5; // ponytail: fixed per-identity budget against report flooding; tune with real reporting rates
const decimal = { type: 'string', maxLength: 32, pattern: '^-?\\d{1,3}(\\.\\d+)?$' }; // raw browser coordinates can carry 15+ decimals
const centre = (cell: number) => Number(((cell + 0.5) * CELL).toFixed(4));
// ponytail: a count rule, not a model; replace once real labelled incidents exist.
// Counts are people (published cells have at least 3, so always plural). An attempt is not a robbery, so the two are
// always named apart, and a kind nobody reported is left out.
const adviceText = {
  es: (people: number, robo: number, intento: number, night: boolean) => `${people} personas reportaron ${[robo && 'robos', intento && 'intentos de robo'].filter(Boolean).join(' o ')} en esta zona de ${night ? 'noche' : 'día'} (últimos 90 días). Si puedes, detente en un lugar concurrido y seguro.`,
  'pt-BR': (people: number, robo: number, intento: number, night: boolean) => `${people} pessoas relataram ${[robo && 'roubos', intento && 'tentativas de roubo'].filter(Boolean).join(' ou ')} nesta região ${night ? 'à noite' : 'durante o dia'} (últimos 90 dias). Se puder, pare em um local movimentado e seguro.`
};
const demoNotice = { es: ' Incluye datos de demostración.', 'pt-BR': ' Inclui dados de demonstração.' };
// Contributor IDs per cell stay in memory so advice can count a person once across neighbouring cells; they are never sent.
type Cell = { cy: number; cx: number; band: string; robo: string[]; intento: string[]; all: string[]; synthetic: string[] };
const people = (cells: Cell[], pick: (cell: Cell) => string[]) => new Set(cells.flatMap(pick)).size;
// `demo` is true only when demo-persona sign-in is on: personas are free to mint, so their data is demo data.
export function insightRoutes(app: FastifyInstance, ctx: Context, demo = false) {
  // The only view of the data anyone gets: one fixed 90-day window ending on the hour (a single window leaves nothing to
  // subtract). Every number is distinct people (the incident's driver, or the reporter), never events: one person filing
  // ten times counts once. Real events need MIN_COUNT distinct phone-verified people in a cell and band on their own;
  // seeded rows are added on top and never help reach it, and a published cell has MIN_COUNT people in all. Computed once
  // per hour and shared by every caller, so public traffic cannot load the SOS pool, and labels, relabels and backdated
  // reports all surface together at the next hour.
  let cached: { hour: number; cells: Promise<Cell[]> } | null = null;
  function publicCells(now: Date): Promise<Cell[]> {
    const hour = Math.floor(now.getTime() / HOUR);
    if (cached?.hour !== hour) {
      const cells = computeCells(new Date(hour * HOUR));
      cells.catch(() => { if (cached?.cells === cells) cached = null; }); // a failed query is retried by the next caller
      cached = { hour, cells };
    }
    return cached.cells;
  }
  async function computeCells(end: Date): Promise<Cell[]> {
    const rows = (await ctx.pool.query(`WITH s AS (SELECT floor(e.latitude/$1)::int AS cy, floor(e.longitude/$1)::int AS cx,
          time_band(e.occurred_at,$2) AS band, e.kind, e.synthetic, e.contributor, i.phone_verified
        FROM security_events e JOIN identities i ON i.id = e.contributor WHERE e.occurred_at > $3 AND e.occurred_at <= $4),
      real AS (SELECT cy, cx, band FROM s WHERE NOT synthetic AND phone_verified GROUP BY 1,2,3 HAVING count(DISTINCT contributor) >= $5::int)
      SELECT cy, cx, band, array_agg(DISTINCT contributor) AS everyone,
        coalesce(array_agg(DISTINCT contributor) FILTER (WHERE kind='robo'), '{}') AS robo,
        coalesce(array_agg(DISTINCT contributor) FILTER (WHERE kind='intento_robo'), '{}') AS intento,
        coalesce(array_agg(DISTINCT contributor) FILTER (WHERE synthetic), '{}') AS synthetic
      FROM s WHERE synthetic OR (cy, cx, band) IN (SELECT cy, cx, band FROM real)
      GROUP BY 1,2,3 HAVING count(DISTINCT contributor) >= $5::int ORDER BY count(DISTINCT contributor) DESC,1,2,3`,
    [CELL, TIME_ZONE, new Date(end.getTime() - WINDOW_DAYS * DAY), end, MIN_COUNT])).rows;
    return rows.map(r => ({ cy: r.cy, cx: r.cx, band: r.band, robo: r.robo, intento: r.intento, all: r.everyone, synthetic: r.synthetic }));
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
    // The budget is per identity, so concurrent requests with different idempotency keys queue here until the count is current.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('reports:' || $1, 0))`, [request.actor.id]);
    if ((await client.query('SELECT count(*)::int AS n FROM reports WHERE reporter_id=$1 AND created_at > $2', [request.actor.id, new Date(now.getTime() - DAY)])).rows[0].n >= REPORTS_PER_DAY) problem(429, 'report_rate_limited');
    const id = randomUUID();
    await client.query('INSERT INTO reports(id,reporter_id,kind,latitude,longitude,occurred_at,created_at,synthetic) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, request.actor.id, body.kind, body.latitude, body.longitude, new Date(at), now, demo]);
    return { id, kind: body.kind };
  })));
  app.get('/v1/insights/hotspots', async () => {
    const now = ctx.clock();
    const cells = (await publicCells(now)).map(c => ({ lat: centre(c.cy), lon: centre(c.cx), band: c.band, robo: c.robo.length, intentoRobo: c.intento.length, total: c.all.length, synthetic: c.synthetic.length }));
    return { generatedAt: now.toISOString(), days: WINDOW_DAYS, cellDegrees: CELL, minCount: MIN_COUNT, includesSynthetic: cells.some(c => c.synthetic > 0), cells };
  });
  app.get('/v1/insights/advice', { schema: { querystring: object({ lat: decimal, lon: decimal, locale: { type: 'string', maxLength: 35 } }, ['lat', 'lon']) } }, async request => {
    const query = request.query as { lat: string; lon: string; locale?: string };
    const lat = Number(query.lat), lon = Number(query.lon);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) problem(400, 'invalid_coordinates');
    const now = ctx.clock(); const band = (await ctx.pool.query('SELECT time_band($1,$2) AS band', [now, TIME_ZONE])).rows[0].band as string;
    // Advice counts people only in cells the public map already shows, so it can never locate or time a hidden report.
    const cy = Math.floor(lat / CELL), cx = Math.floor(lon / CELL);
    const near = (await publicCells(now)).filter(c => c.band === band && Math.abs(c.cy - cy) <= 1 && Math.abs(c.cx - cx) <= 1);
    const count = people(near, c => c.all), robo = people(near, c => c.robo), intentoRobo = people(near, c => c.intento);
    if (!count) return { level: 'none' };
    const locale = query.locale?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'es', includesSynthetic = near.some(c => c.synthetic.length > 0);
    return { level: 'caution', count, robo, intentoRobo, includesSynthetic, band, text: adviceText[locale](count, robo, intentoRobo, band === 'noche') + (includesSynthetic ? demoNotice[locale] : '') };
  });
}
