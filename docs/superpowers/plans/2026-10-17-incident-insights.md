# Incident Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every labelled robbery incident and driver report into a public, suppressed hotspot aggregate (for law enforcement) and a simple caution advice for drivers.

**Architecture:** One migration adds incident labels, a location snapshot trigger, a `reports` table, a `security_events` view and a `time_band` SQL function. One route file (`src/insights/routes.ts`) adds label, report, hotspot and advice endpoints; aggregation is plain SQL over the view. A seed script inserts clearly synthetic demo reports.

**Tech Stack:** Node 24+ (local 26), TypeScript strict ESM, Fastify 5, `pg`, PostgreSQL 18, `node:test`.

**Spec:** `/Users/robertozuniga/Desktop/andes-hackathon/docs/superpowers/specs/2026-10-17-security-checks-incident-data-design.md`, part 2 (commit `8ccffde` on branch `docs/voice-trip-live-sharing`).

**Worktree:** `/Users/robertozuniga/.config/superpowers/worktrees/andes-hackathon/incident-insights`, branch `feat/incident-insights` from `codex/aws-durable-backend` at `ebc8fb1`. Baseline: 47 tests pass.

**Test database:** a disposable PostgreSQL is running at `postgresql://andes@127.0.0.1:54329/andes_test`. Every test command below is:

```bash
npm run build && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test node --test tests/insights.test.mjs
```

Each test runs in its own schema (`tests/helpers/runtime.mjs`), with the clock fixed at `2026-10-17T12:00:00Z` (07:00 in Lima, band `dia`).

**Codebase conventions to follow:**
- Code is dense, single-purpose, no comments except short `shortcut:`/`ponytail:` notes.
- `problem(status, code)` throws HTTP errors.
- `idempotent()` wraps every mutation and requires an `Idempotency-Key` header (the test helper `f.req` sends one).
- Schemas use the helpers in `src/api/schemas.ts`. Ajv runs with `coerceTypes:false`, so query parameters must be string schemas that you parse yourself.

## File structure

| File | Responsibility |
|---|---|
| `db/migrations/004-insights.sql` (create) | Incident location/label columns, snapshot trigger, `reports`, `security_events`, `time_band()` |
| `src/insights/routes.ts` (create) | `POST /v1/incidents/:id/label`, `POST /v1/reports`, `GET /v1/insights/hotspots` (public), `GET /v1/insights/advice` |
| `src/api/app.ts` (modify) | Register `insightRoutes`; exempt `/v1/insights/hotspots` from auth |
| `tests/insights.test.mjs` (create) | All behaviour checks for this plan |
| `scripts/seed-demo.mjs` (create) | Synthetic Panamericana Sur reports, guarded by `SEED_DEMO=1` |
| `package.json` (modify) | `seed:demo` script |
| `docs/contracts/runtime.md` (modify) | Document the four endpoints for the frontend |

Tasks 2 → 3 are sequential (same files). Task 4 touches only the seed, package.json and docs, so it runs in parallel with tasks 2–3 **in its own worktree** (`~/.config/superpowers/worktrees/andes-hackathon/incident-insights-seed`, branch `feat/incident-insights-seed` from the task 1 commit) to avoid sharing a git index and `dist/`; it is merged back after task 3. Commit with explicit paths (`git commit -m … -- <paths>`). Expect a small `docs/contracts/runtime.md` merge conflict with part 1 later.

---

### Task 1: Migration 004 and incident location snapshot

**Files:**
- Create: `db/migrations/004-insights.sql`
- Create: `tests/insights.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/insights.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/runtime.mjs';

async function sosAt(f, latitude, longitude) {
  const trip = await f.trip();
  assert.equal((await f.req('POST', `/v1/trips/${trip}/locations`, { observations: [{ capturedAt: '2026-10-17T11:58:00Z', latitude: 0, longitude: 0, accuracy: 99 }, { capturedAt: '2026-10-17T11:59:00Z', latitude, longitude, accuracy: 20 }] })).status, 200);
  const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {}); assert.equal(sos.status, 200);
  return sos.body.id;
}

// Without the snapshot an incident's place is lost once location history is pruned, so hotspots would be empty.
test('incident creation copies the latest trip location for later aggregation', async t => {
  const f = await fixture(t); const id = await sosAt(f, -12.325, -76.775);
  const row = (await f.ctx.pool.query('SELECT latitude,longitude,accuracy,located_at FROM incidents WHERE id=$1', [id])).rows[0];
  assert.deepEqual([row.latitude, row.longitude, row.accuracy, row.located_at.toISOString()], [-12.325, -76.775, 20, '2026-10-17T11:59:00.000Z']);
  const bare = await f.req('POST', `/v1/trips/${await f.trip()}/sos`, {});
  assert.equal((await f.ctx.pool.query('SELECT latitude FROM incidents WHERE id=$1', [bare.body.id])).rows[0].latitude, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test node --test tests/insights.test.mjs`
Expected: FAIL with `column "latitude" does not exist`.

- [ ] **Step 3: Write the migration**

Create `db/migrations/004-insights.sql`:

```sql
ALTER TABLE incidents ADD COLUMN latitude double precision, ADD COLUMN longitude double precision,
  ADD COLUMN accuracy double precision, ADD COLUMN located_at timestamptz,
  ADD COLUMN label text CHECK (label IN ('robo','intento_robo','falsa_alarma','sin_senal','otro')),
  ADD COLUMN labeled_at timestamptz, ADD COLUMN labeled_by uuid REFERENCES identities;
CREATE FUNCTION incident_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT latitude, longitude, accuracy, captured_at INTO NEW.latitude, NEW.longitude, NEW.accuracy, NEW.located_at
    FROM latest_locations WHERE trip_id = NEW.trip_id;
  RETURN NEW;
END $$;
CREATE TRIGGER incident_location BEFORE INSERT ON incidents FOR EACH ROW EXECUTE FUNCTION incident_location();
CREATE TABLE reports (
  id uuid PRIMARY KEY, reporter_id uuid NOT NULL REFERENCES identities,
  kind text NOT NULL CHECK (kind IN ('robo','intento_robo')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  synthetic boolean NOT NULL DEFAULT false
);
CREATE INDEX reports_time ON reports(occurred_at);
CREATE VIEW security_events AS
  SELECT label AS kind, latitude, longitude, created_at AS occurred_at, false AS synthetic FROM incidents
    WHERE label IN ('robo','intento_robo') AND latitude IS NOT NULL
  UNION ALL SELECT kind, latitude, longitude, occurred_at, synthetic FROM reports;
CREATE FUNCTION time_band(t timestamptz, tz text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN extract(hour FROM t AT TIME ZONE tz) >= 22 OR extract(hour FROM t AT TIME ZONE tz) < 6 THEN 'noche' ELSE 'dia' END
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test node --test tests/insights.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test npm test`
Expected: 48 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/004-insights.sql tests/insights.test.mjs
git commit -m "feat(insights): Snapshot incident location and add reports schema"
```

---

### Task 2: Reports and public hotspots

**Files:**
- Create: `src/insights/routes.ts`
- Modify: `src/api/app.ts` (auth exemption at line ~19; route registration at line ~35)
- Modify: `tests/insights.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/insights.test.mjs`:

```js
const report = (f, kind, latitude, longitude, occurredAt, jwt = f.driver) => f.req('POST', '/v1/reports', { kind, latitude, longitude, occurredAt }, jwt);
async function hotspots(f, query = '') { const r = await f.app.inject({ method: 'GET', url: `/v1/insights/hotspots${query}` }); return { status: r.statusCode, body: r.json() }; }

// Accepting future/stale or anonymous reports would let anyone fabricate hotspots.
test('reports reject future, stale, unknown-kind or unauthenticated submissions', async t => {
  const f = await fixture(t);
  assert.equal((await report(f, 'robo', 0, 0, '2026-10-17T12:01:00Z')).status, 400);
  assert.equal((await report(f, 'robo', 0, 0, '2025-10-16T11:59:00Z')).status, 400);
  assert.equal((await report(f, 'secuestro', 0, 0, '2026-10-17T11:00:00Z')).status, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/reports', payload: { kind: 'robo', latitude: 0, longitude: 0, occurredAt: '2026-10-17T11:00:00Z' } })).statusCode, 401);
  assert.equal((await report(f, 'robo', 0, 0, '2026-10-17T11:00:00Z')).status, 200);
});

// Returning small cells or identifiers would expose individual drivers to anyone with the public link.
test('hotspots are public aggregates: suppressed below the minimum, synthetic counted, no identifiers', async t => {
  const f = await fixture(t); const night = '2026-10-16T04:30:00Z'; // 23:30 in Lima
  const posted = [];
  for (let i = 0; i < 3; i++) posted.push((await report(f, 'robo', -12.525, -76.725, night)).body.id);
  for (let i = 0; i < 2; i++) posted.push((await report(f, 'intento_robo', -13.075, -76.375, night)).body.id);
  await f.ctx.pool.query(`INSERT INTO reports VALUES(gen_random_uuid(),$1,'intento_robo',-12.52,-76.72,$2,$2,true)`, [f.me.id, night]);
  const response = await hotspots(f);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.cells, [{ lat: -12.525, lon: -76.725, band: 'noche', robo: 3, intentoRobo: 1, total: 4, synthetic: 1 }]);
  assert.equal(response.body.includesSynthetic, true); assert.equal(response.body.minCount, 3); assert.equal(response.body.days, 90);
  const text = JSON.stringify(response.body);
  for (const secret of [...posted, f.me.id, night]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.equal((await hotspots(f, '?days=0')).status, 400);
  assert.equal((await hotspots(f, '?days=abc')).status, 400);
  assert.deepEqual((await hotspots(f, '?days=1')).body.cells, []);
});

// An off-by-one hour would move events into the wrong band and change the advice drivers get.
test('time bands split at 22:00 and 06:00 local time', async t => {
  const f = await fixture(t);
  const cases = [['2026-10-16T02:59:00Z', -12.325, -76.775], ['2026-10-16T03:00:00Z', -12.325, -76.775], ['2026-10-16T10:59:00Z', -13.075, -76.375], ['2026-10-16T11:00:00Z', -13.075, -76.375]];
  for (const [when, lat, lon] of cases) for (let i = 0; i < 3; i++) assert.equal((await report(f, 'robo', lat, lon, when)).status, 200);
  const cells = (await hotspots(f)).body.cells.map(c => `${c.lat},${c.lon},${c.band},${c.total}`).sort();
  assert.deepEqual(cells, ['-12.325,-76.775,dia,3', '-12.325,-76.775,noche,3', '-13.075,-76.375,dia,3', '-13.075,-76.375,noche,3']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test node --test tests/insights.test.mjs`
Expected: the three new tests FAIL (404 for `/v1/reports`, 401 for hotspots); task 1's test still passes.

- [ ] **Step 3: Create `src/insights/routes.ts`**

```ts
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
```

- [ ] **Step 4: Register the routes and exempt hotspots from auth in `src/api/app.ts`**

Add the import next to the other route imports:

```ts
import { insightRoutes } from '../insights/routes.js';
```

Change the exemption line inside the `onRequest` hook from:

```ts
    if (request.routeOptions.url === '/health' || (callbackConfig && request.routeOptions.url === '/v1/callbacks/zavu')) return;
```

to:

```ts
    if (request.routeOptions.url === '/health' || request.routeOptions.url === '/v1/insights/hotspots' || (callbackConfig && request.routeOptions.url === '/v1/callbacks/zavu')) return;
```

Change the registration line from:

```ts
  tripRoutes(app, ctx); contactRoutes(app, ctx); locationRoutes(app, ctx); incidentRoutes(app, ctx, channelSupport);
```

to:

```ts
  tripRoutes(app, ctx); contactRoutes(app, ctx); locationRoutes(app, ctx); incidentRoutes(app, ctx, channelSupport); insightRoutes(app, ctx);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test node --test tests/insights.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/insights/routes.ts src/api/app.ts tests/insights.test.mjs
git commit -m "feat(insights): Accept driver reports and publish suppressed hotspots"
```

---

### Task 3: Incident labels and driver advice

**Files:**
- Modify: `src/insights/routes.ts`
- Modify: `tests/insights.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/insights.test.mjs`:

```js
// Letting contacts/strangers label, or counting false alarms and dead zones, would put non-robberies on the police map.
test('only the driver labels incidents and only robbery labels enter hotspots', async t => {
  const f = await fixture(t);
  const ids = [await sosAt(f, -12.325, -76.775), await sosAt(f, -12.326, -76.776), await sosAt(f, -12.324, -76.774)];
  const label = (id, value, jwt) => f.req('POST', `/v1/incidents/${id}/label`, { label: value }, jwt);
  assert.equal((await label(ids[0], 'robo', f.stranger)).status, 403);
  assert.equal((await label(ids[0], 'robo', f.contact)).status, 403);
  assert.equal((await label(ids[0], 'secuestro')).status, 400);
  assert.equal((await f.req('POST', '/v1/incidents/00000000-0000-4000-8000-000000000000/label', { label: 'robo' })).status, 404);
  for (const id of ids) assert.equal((await label(id, 'robo')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells.map(c => [c.lat, c.lon, c.band, c.robo, c.total]), [[-12.325, -76.775, 'dia', 3, 3]]);
  assert.equal((await label(ids[2], 'sin_senal')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  assert.equal((await label(ids[2], 'falsa_alarma')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells, []);
  assert.equal((await f.req('POST', `/v1/incidents/${ids[2]}/resolve`, {})).status, 200);
  assert.equal((await label(ids[2], 'intento_robo')).status, 200);
  assert.deepEqual((await hotspots(f)).body.cells.map(c => [c.robo, c.intentoRobo, c.total]), [[2, 1, 3]]);
});

// Advice from the wrong band, too far away or below the minimum would warn drivers without basis.
test('advice turns to caution at the minimum count in the current band and needs a signed driver', async t => {
  const f = await fixture(t); const day = '2026-10-10T17:00:00Z'; // 12:00 in Lima: same band as the fixture clock
  const advice = query => f.req('GET', `/v1/insights/advice${query}`);
  for (let i = 0; i < 2; i++) await report(f, 'robo', -12.525, -76.725, day);
  for (let i = 0; i < 3; i++) await report(f, 'robo', -12.525, -76.725, '2026-10-11T04:00:00Z'); // 23:00 in Lima
  assert.deepEqual((await advice('?lat=-12.47&lon=-76.68')).body, { level: 'none' });
  await report(f, 'intento_robo', -12.525, -76.725, day);
  assert.deepEqual((await advice('?lat=-12.47&lon=-76.68')).body, { level: 'caution', count: 3, includesSynthetic: false, band: 'dia', text: '3 reportes de robo en esta zona de día (últimos 90 días). Si puedes, detente en un lugar concurrido y seguro.' });
  assert.match((await advice('?lat=-12.47&lon=-76.68&locale=pt-BR')).body.text, /^3 relatos de roubo nesta região durante o dia/);
  assert.deepEqual((await advice('?lat=-12.37&lon=-76.68')).body, { level: 'none' });
  assert.equal((await advice('?lat=95&lon=0')).status, 400);
  assert.equal((await advice('?lat=abc&lon=0')).status, 400);
  assert.equal((await f.app.inject({ method: 'GET', url: '/v1/insights/advice?lat=0&lon=0' })).statusCode, 401);
});
```

Note: `-12.47` is one cell north of the `-12.525` cell and `-76.68` one cell east of `-76.725`, so it is inside the 3×3 neighbourhood; `-12.37` is three cells away.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test node --test tests/insights.test.mjs`
Expected: the two new tests FAIL with 404s; the four earlier tests pass.

- [ ] **Step 3: Add label and advice routes to `src/insights/routes.ts`**

Replace the imports and constants at the top of the file with:

```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { owner, problem } from '../contracts.js';
import { transaction, withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { idParams, object } from '../api/schemas.js';
// shortcut: one aggregation zone and suppression count for the demo; per-country bands need their own evidence.
const TIME_ZONE = process.env.INSIGHTS_TIME_ZONE ?? 'America/Lima';
const MIN_COUNT = Math.max(3, Number(process.env.INSIGHTS_MIN_COUNT ?? 3) || 3); // never weaken public suppression below 3
const CELL = 0.05, DAY = 86400000;
const decimal = { type: 'string', maxLength: 32, pattern: '^-?\\d{1,3}(\\.\\d+)?$' }; // raw browser coordinates can carry 15+ decimals
const centre = (cell: number) => Number(((cell + 0.5) * CELL).toFixed(4));
// ponytail: a count rule, not a model; replace once real labelled incidents exist.
const adviceText = {
  es: (n: number, night: boolean) => `${n} reportes de robo en esta zona de ${night ? 'noche' : 'día'} (últimos 90 días). Si puedes, detente en un lugar concurrido y seguro.`,
  'pt-BR': (n: number, night: boolean) => `${n} relatos de roubo nesta região ${night ? 'à noite' : 'durante o dia'} (últimos 90 dias). Se puder, pare em um local movimentado e seguro.`
};
```

Add these routes inside `insightRoutes`, before `app.post('/v1/reports', …)`:

```ts
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
```

Add this route after the hotspots route:

```ts
  app.get('/v1/insights/advice', { schema: { querystring: object({ lat: decimal, lon: decimal, locale: { enum: ['es', 'pt-BR'] } }, ['lat', 'lon']) } }, async request => {
    const query = request.query as { lat: string; lon: string; locale?: 'es' | 'pt-BR' };
    const lat = Number(query.lat), lon = Number(query.lon);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) problem(400, 'invalid_coordinates');
    const now = ctx.clock();
    const row = (await ctx.pool.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE synthetic)::int AS synthetic, time_band($4,$3) AS band FROM security_events
      WHERE abs(floor(latitude/$5) - floor($1::float8/$5)) <= 1 AND abs(floor(longitude/$5) - floor($2::float8/$5)) <= 1
        AND occurred_at > $6 AND occurred_at <= $4 AND time_band(occurred_at,$3) = time_band($4,$3)`,
    [lat, lon, TIME_ZONE, now, CELL, new Date(now.getTime() - 90 * DAY)])).rows[0];
    if (row.n < MIN_COUNT) return { level: 'none' };
    return { level: 'caution', count: row.n, includesSynthetic: row.synthetic > 0, band: row.band, text: adviceText[query.locale ?? 'es'](row.n, row.band === 'noche') };
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test node --test tests/insights.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite and the typechecker**

Run: `npm run typecheck && TEST_DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_test npm test`
Expected: no type errors; 53 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/insights/routes.ts tests/insights.test.mjs
git commit -m "feat(insights): Let drivers label incidents and receive area advice"
```

---

### Task 4: Demo seed and runtime contract (parallel with tasks 2–3, own worktree)

**Files:**
- Create: `scripts/seed-demo.mjs`
- Modify: `package.json` (`scripts`)
- Modify: `docs/contracts/runtime.md` (append a section)

- [ ] **Step 1: Create `scripts/seed-demo.mjs`**

```js
import { randomUUID } from 'node:crypto';
import { createContext, databaseConfig, transaction } from '../dist/db.js';
// Synthetic demo reports on the Panamericana Sur, flagged synthetic so every view can label them as demo data.
if (process.env.SEED_DEMO !== '1') { process.stderr.write('Set SEED_DEMO=1 to insert synthetic demo reports\n'); process.exit(1); }
const clusters = [
  { lat: -12.325, lon: -76.775, night: 12, day: 4 }, // Lurín / Punta Hermosa
  { lat: -12.525, lon: -76.725, night: 9, day: 3 }, // Chilca
  { lat: -13.075, lon: -76.375, night: 7, day: 3 }, // Cañete
  { lat: -12.175, lon: -76.975, night: 1, day: 0 }, // single reports stay below the suppression count
  { lat: -12.725, lon: -76.625, night: 0, day: 1 },
];
const now = Date.now(); const rows = [];
for (const c of clusters) for (let i = 0; i < c.night + c.day; i++) {
  const at = new Date(now - (i * 3 + 1) * 86400000);
  at.setUTCHours(i < c.night ? 4 + (i % 3) : 19, 30 * (i % 2), 0, 0); // 23:00–01:30 or 14:00–14:30 in Lima
  rows.push([i % 4 === 3 ? 'intento_robo' : 'robo', c.lat + ((i % 5) - 2) * 0.004, c.lon + ((i % 3) - 1) * 0.004, at]);
}
const ctx = createContext(databaseConfig(), undefined, 2);
try {
  await transaction(ctx.pool, async client => {
    const seeder = (await client.query(`INSERT INTO identities(id,issuer,subject) VALUES($1,'seed','demo') ON CONFLICT(issuer,subject) DO UPDATE SET subject=excluded.subject RETURNING id`, [randomUUID()])).rows[0].id;
    await client.query('DELETE FROM reports WHERE reporter_id=$1 AND synthetic', [seeder]);
    for (const [kind, lat, lon, at] of rows) await client.query('INSERT INTO reports VALUES($1,$2,$3,$4,$5,$6,now(),true)', [randomUUID(), seeder, kind, lat, lon, at]);
  });
  console.log(`Seeded ${rows.length} synthetic reports`);
} finally { await ctx.close(); }
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after `"migrate": "node scripts/migrate.mjs",` add:

```json
    "seed:demo": "node scripts/seed-demo.mjs",
```

- [ ] **Step 3: Verify the seed against a scratch database**

Run:

```bash
createdb -h 127.0.0.1 -p 54329 -U andes andes_seed_check
npm run build
DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_seed_check npm run migrate
SEED_DEMO=1 DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_seed_check npm run seed:demo
SEED_DEMO=1 DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_seed_check npm run seed:demo
psql -h 127.0.0.1 -p 54329 -U andes -d andes_seed_check -Atc "SELECT count(*), count(*) FILTER (WHERE synthetic) FROM reports"
DATABASE_URL=postgresql://andes@127.0.0.1:54329/andes_seed_check npm run seed:demo; echo "exit=$?"
dropdb -h 127.0.0.1 -p 54329 -U andes andes_seed_check
```

Expected:
- Each seed run prints `Seeded 40 synthetic reports`.
- The count query prints `40|40`: the second run replaced the first instead of doubling it.
- The run without `SEED_DEMO` prints the refusal and `exit=1`.

- [ ] **Step 4: Document the endpoints in `docs/contracts/runtime.md`**

Read the file first and match its heading level and style, then append a section titled `Incident data and insights`. It documents:

- **`POST /v1/incidents/:id/label`.** Trip owner only; body `{label}` with `robo|intento_robo|falsa_alarma|sin_senal|otro`; allowed on active or resolved incidents; relabelling overwrites.
- **`POST /v1/reports`.** Any signed identity; body `{kind: robo|intento_robo, latitude, longitude, occurredAt}`. `occurredAt` may be at most 30 s in the future and at most 365 days old.
- **`GET /v1/insights/hotspots?days=1..365`.** Public, no auth. Envelope `{generatedAt, days, cellDegrees, minCount, includesSynthetic, cells:[{lat, lon, band: dia|noche, robo, intentoRobo, total, synthetic}]}`. Cells that hold fewer than `minCount` events are suppressed. There are no identifiers. Show `incluye datos de demostración` when `includesSynthetic`.
- **`GET /v1/insights/advice?lat=&lon=&locale=es|pt-BR`.** Signed. Returns `{level:'none'}` or `{level:'caution', count, band, text}`. It looks at the 3×3 cells around the point, in the current time band, over the last 90 days.
- **Settings.** `INSIGHTS_TIME_ZONE` (default `America/Lima`), `INSIGHTS_MIN_COUNT` (default 3, never below 3), and `SEED_DEMO=1 npm run seed:demo` for synthetic demo data.
- **Location.** Incidents copy the trip's latest location when they are created. `falsa_alarma`, `sin_senal` and `otro` labels never reach hotspots or advice.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demo.mjs package.json docs/contracts/runtime.md
git commit -m "feat(insights): Add synthetic demo seed and document insights contract"
```

---

## After both parts merge (not in this plan)

Add `label` to `incident` in part 1's `GET /v1/trips/:id/status`, and assert it in that endpoint's test.
