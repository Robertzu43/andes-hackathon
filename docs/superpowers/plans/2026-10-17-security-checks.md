# Security Checks (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a driver goes silent, stops sharing location or is overdue, the server asks once ("Estoy bien") and then alerts family (SMS, WhatsApp, call) and colleagues (SMS, WhatsApp) at the same time. Two new endpoints drive the driver and contact screens.

**Architecture:** One migration adds trip timing fields, contact roles, incident triggers and a `security_checks` table. A SQL-only sweeper (`checkOnce`) runs in the control worker and handles each trip in its own short `withTripTransaction`, so restarts lose nothing. SOS and escalation share one `createIncident` fan-out. Alert text is built by a pure `alertSummary` function. Automatic checks run only when all four timing variables are set (demo values, not evidence-backed thresholds).

**Tech Stack:** TypeScript 5.9 (ESM, strict), Fastify 5, pg 8, PostgreSQL 15+ (tests use 18), Node test runner against compiled `dist/`.

**Spec:** `docs/superpowers/specs/2026-10-17-security-checks-incident-data-design.md`, Part 1. **Owner:** `andes-hackathon-a4` on branch `hackathon/delivery`. Part 2 (`feat/incident-insights`) owns migration 004, `src/insights/**`, and two lines in `src/api/app.ts`. Do not touch them.

**Deliberate deviations from the spec (all small).** The code review after implementation tightened `arrival_overdue` to count from the driver's last action; the sweeper code below is the final version.

**Deviations:**
- `createIncident(client, trip, trigger, checkReason, support, now)` has no `actorId`: `incidents.driver_id` is always `trip.driver_id` (the SOS route already enforces owner), and callers record their own `sos_report` event.
- A driver `resume` command and an incident resolution also count as signs of life. Resuming after a long rest, or resolving a false alarm, then does not immediately open a new check and send a second round of alerts.
- `infra/template.json` (the production design) deliberately does not set the check timings, so automatic escalation stays off there until #11 supplies evidence-backed values. Only the demo deployment sets them.
- `GET /v1/trips/:id/status` shows `incident`/`deliveries` only to the driver or incident-scope contacts, and `location` only to the driver or map-scope contacts, matching the existing grant scopes.

**Commands** (from the worktree root):
- Test DB: `export TEST_DATABASE_URL=postgresql://andes@127.0.0.1:55432/andes_test` (any disposable PostgreSQL works).
- One file: `npm run build && node --test tests/checks.test.mjs`
- Everything: `npm test`

---

## File structure

| File | Responsibility |
|---|---|
| `db/migrations/003-security-checks.sql` (create) | New columns and the `security_checks` table |
| `src/contracts.ts` (modify) | `CheckReason`, `expectedArrivalAt`, new trip fields |
| `src/api/schemas.ts` (modify) | `expectedArrivalAt` in `fieldsSchema` |
| `src/trips/routes.ts` (modify) | Store `expected_arrival_at`; commands close the open check |
| `src/contacts/routes.ts` (modify) | Optional `role` on invitations |
| `src/incidents/create.ts` (create) | `createIncident`: incident + role-based jobs + outbox, SQL only |
| `src/incidents/routes.ts` (modify) | SOS uses `createIncident`, closes the open check, upgrades `missed_check` → `sos` |
| `src/checks/sweep.ts` (create) | `checkConfig`, `checkOnce` |
| `src/checks/routes.ts` (create) | `POST /v1/trips/:id/sharing`, `GET /v1/trips/:id/status` |
| `src/location/routes.ts` (modify) | Export `latestLocation` for reuse by status |
| `src/notifications/wording.ts` (create) | Pure `alertSummary` |
| `src/notifications/dispatch.ts` (modify) | `authorizeJob` uses `alertSummary` |
| `src/worker.ts` (modify) | `control()` runs the sweeper when configured |
| `src/api/app.ts` (modify) | Register `checkRoutes` (own line, not adjacent to Part 2's lines) |
| `tests/checks.test.mjs` (create) | All Part 1 behavior |
| `tests/dispatch.test.mjs` (modify) | Four assertions that depended on the old summary text |
| `docs/contracts/runtime.md` (modify) | Document Part 1 |

---

### Task 1: Migration, contracts, trip arrival time and contact role

**Files:**
- Create: `db/migrations/003-security-checks.sql`
- Modify: `src/contracts.ts`, `src/api/schemas.ts:7`, `src/trips/routes.ts:46-47`, `src/contacts/routes.ts:8-15`
- Test: `tests/checks.test.mjs` (create)

- [ ] **Step 1: Write the failing test.** Create `tests/checks.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';

export async function contactFor(f, subject, role) {
  const jwt = await f.token(subject);
  const id = (await f.req('GET', '/v1/me', undefined, jwt)).body.id;
  const invitation = await f.req('POST', '/v1/contacts', {contactId: id, phone: '+5511999990000', map: true, incident: true, ...(role ? {role} : {})});
  assert.equal(invitation.status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${invitation.body.id}/accept`, {map: true, incident: true}, jwt)).status, 200);
  return {jwt, id, grant: invitation.body.id};
}

test('drafts keep an optional expected arrival; invitations take a family or colleague role', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family');
  const colleague = await contactFor(f, 'colleague', 'colleague');
  const roles = (await f.ctx.pool.query('SELECT id,role FROM contact_grants ORDER BY role')).rows;
  assert.deepEqual(roles, [{id: colleague.grant, role: 'colleague'}, {id: family.grant, role: 'family'}]);
  const other = await f.token('other');
  const otherId = (await f.req('GET', '/v1/me', undefined, other)).body.id;
  assert.equal((await f.req('POST', '/v1/contacts', {contactId: otherId, phone: '+5511999990000', map: true, incident: true, role: 'boss'})).status, 400);
  const draft = await f.draft({expectedArrivalAt: '2026-10-17T18:00:00Z'});
  assert.equal(draft.status, 200);
  const trip = await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [family.grant]});
  assert.equal(trip.status, 200);
  const row = (await f.ctx.pool.query('SELECT expected_arrival_at,sharing_stopped_at FROM trips WHERE id=$1', [trip.body.id])).rows[0];
  assert.deepEqual(row, {expected_arrival_at: new Date('2026-10-17T18:00:00Z'), sharing_stopped_at: null});
  assert.equal((await f.draft({expectedArrivalAt: 'tomorrow'})).status, 400);
});
```

- [ ] **Step 2: Run it to verify it fails.** `npm run build && node --test tests/checks.test.mjs`. Expected: FAIL (400 on `role`, or a missing `expected_arrival_at` column).

- [ ] **Step 3: Write the migration** `db/migrations/003-security-checks.sql`:

```sql
ALTER TABLE trips ADD COLUMN expected_arrival_at timestamptz, ADD COLUMN sharing_stopped_at timestamptz;
ALTER TABLE contact_grants ADD COLUMN role text NOT NULL DEFAULT 'family' CHECK (role IN ('family','colleague'));
ALTER TABLE incidents
  ADD COLUMN trigger text NOT NULL DEFAULT 'sos' CHECK (trigger IN ('sos','missed_check')),
  ADD COLUMN check_reason text CHECK (check_reason IN ('arrival_overdue','silence','sharing_stopped'));
CREATE TABLE security_checks (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips,
  reason text NOT NULL CHECK (reason IN ('arrival_overdue','silence','sharing_stopped')),
  status text NOT NULL CHECK (status IN ('asking','ok','escalated','cancelled')),
  signal_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL, ask_until timestamptz NOT NULL,
  closed_at timestamptz, incident_id uuid REFERENCES incidents
);
CREATE UNIQUE INDEX one_open_check ON security_checks(trip_id) WHERE status = 'asking';
```

- [ ] **Step 4: Contracts.** In `src/contracts.ts`:
  - add `export type CheckReason = 'arrival_overdue' | 'silence' | 'sharing_stopped';`;
  - add `expected_arrival_at: Date | null; sharing_stopped_at: Date | null;` to `Trip`;
  - add `expectedArrivalAt?: string` to `DraftFields`.

  In `src/api/schemas.ts`, add `expectedArrivalAt: { type: 'string', format: 'date-time' }` to the `fieldsSchema` properties (the location route already relies on `format: 'date-time'`).

- [ ] **Step 5: Store the arrival time.** In `src/trips/routes.ts`, replace the trip INSERT in `/confirm`:

```ts
      await client.query(`INSERT INTO trips(id,driver_id,truck_id,origin,destination,country,locale,time_zone,created_at,expected_arrival_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, request.actor.id, fields.truckId, fields.origin, fields.destination, fields.country, fields.locale, fields.timeZone, ctx.clock(), fields.expectedArrivalAt ?? null]);
```

- [ ] **Step 6: Contact role.** In `src/contacts/routes.ts`, `POST /v1/contacts`:
  - schema body becomes `object({ contactId: uuid, phone: {...unchanged}, ...scopeChoices, role: { enum: ['family', 'colleague'] } }, ['contactId', 'phone', 'map', 'incident'])`;
  - add `role?: 'family' | 'colleague'` to the body type;
  - the INSERT becomes `INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,role) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(driver_id,contact_id) DO NOTHING` with `body.role ?? 'family'` as `$7`.

- [ ] **Step 7: Run the test to verify it passes.** `npm run build && node --test tests/checks.test.mjs`. Expected: PASS. Then `npm test`; expected: all existing tests still pass.

- [ ] **Step 8: Commit.**

```bash
git add db/migrations/003-security-checks.sql src/contracts.ts src/api/schemas.ts src/trips/routes.ts src/contacts/routes.ts tests/checks.test.mjs
git commit -m "feat(checks): Add security check schema, arrival time and contact roles"
```

---

### Task 2: Shared incident fan-out with roles; SOS closes the open check

**Files:**
- Create: `src/incidents/create.ts`
- Modify: `src/incidents/routes.ts:10-31`
- Test: `tests/checks.test.mjs`

- [ ] **Step 1: Write the failing tests.** Append to `tests/checks.test.mjs`:

```js
export const jobsOf = async (f, incident) => (await f.ctx.pool.query(`SELECT COALESCE(cg.role,'group') AS role,j.channel,j.status,j.unavailable_reason
  FROM jobs j LEFT JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 ORDER BY role,j.channel`, [incident])).rows;
const pending = (role, channel) => ({role, channel, status: 'pending', unavailable_reason: null});
export const expectedFanOut = [pending('colleague', 'sms'), pending('colleague', 'whatsapp'), pending('family', 'sms'), pending('family', 'voice'), pending('family', 'whatsapp'),
  {role: 'group', channel: 'group', status: 'unavailable', unavailable_reason: 'group_support_unverified'}];

test('SOS alerts family on three channels, colleagues on two and records the group as unavailable', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family'); const colleague = await contactFor(f, 'colleague', 'colleague');
  const trip = await f.trip([family.grant, colleague.grant]);
  const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {});
  assert.equal(sos.status, 200);
  assert.deepEqual(await jobsOf(f, sos.body.id), expectedFanOut);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n, 5);
  assert.deepEqual((await f.ctx.pool.query('SELECT trigger,check_reason FROM incidents')).rows, [{trigger: 'sos', check_reason: null}]);
});

test('SOS while a check is asking closes it with the SOS incident; SOS upgrades a missed-check incident without new sends', async t => {
  const f = await fixture(t); const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  await f.ctx.pool.query("INSERT INTO security_checks VALUES(gen_random_uuid(),$1,'silence','asking',$2,$2,$2,NULL,NULL)", [trip, f.ctx.clock()]);
  const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  assert.deepEqual((await f.ctx.pool.query('SELECT status,incident_id FROM security_checks')).rows, [{status: 'escalated', incident_id: sos}]);

  const g = await fixture(t); const other = await contactFor(g, 'family'); const second = await g.trip([other.grant]);
  await g.ctx.pool.query("INSERT INTO incidents(id,trip_id,driver_id,created_at,trigger,check_reason) VALUES(gen_random_uuid(),$1,$2,$3,'missed_check','silence')", [second, g.me.id, g.ctx.clock()]);
  const upgraded = (await g.req('POST', `/v1/trips/${second}/sos`, {})).body.id;
  assert.deepEqual((await g.ctx.pool.query('SELECT id,trigger FROM incidents')).rows, [{id: upgraded, trigger: 'sos'}]);
  assert.equal((await g.ctx.pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n, 0);
});
```

- [ ] **Step 2: Run them to verify they fail.** `npm run build && node --test tests/checks.test.mjs`. Expected: the first fails on colleague `voice` being present; the second fails on the check still being `asking`.

- [ ] **Step 3: Create** `src/incidents/create.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ChannelSupport, CheckReason, Trip } from '../contracts.js';
const channelsByRole = { family: ['sms', 'whatsapp', 'voice'], colleague: ['sms', 'whatsapp'] } as const;
/** SQL-only, inside the caller's trip transaction: incident, per-recipient/channel jobs and outbox commit together. */
export async function createIncident(client: pg.PoolClient, trip: Trip, trigger: 'sos' | 'missed_check', checkReason: CheckReason | null, support: ChannelSupport[], now: Date): Promise<string> {
  const id = randomUUID();
  await client.query('INSERT INTO incidents(id,trip_id,driver_id,created_at,trigger,check_reason) VALUES($1,$2,$3,$4,$5,$6)', [id, trip.id, trip.driver_id, now, trigger, checkReason]);
  const grants = (await client.query(`SELECT cg.id,cg.contact_id,cg.phone,cg.role,i.phone AS verified_phone,i.phone_verified FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id JOIN identities i ON i.id=cg.contact_id WHERE tg.trip_id=$1 AND tg.revoked_at IS NULL AND cg.accepted_at IS NOT NULL AND cg.revoked_at IS NULL AND cg.incident_accepted`, [trip.id])).rows;
  for (const grant of grants) for (const channel of channelsByRole[grant.role as keyof typeof channelsByRole]) {
    const enabled = support.some(s => s.channel === channel && s.country === trip.country && s.locale === trip.locale);
    const reason = !grant.phone_verified || grant.phone !== grant.verified_phone ? 'verified_phone_mismatch' : !enabled ? 'country_channel_locale_unqualified' : null;
    const jobId = randomUUID();
    // shortcut: 15-minute synthetic dispatch lifetime; qualify channel deadlines before live enablement.
    await client.query(`INSERT INTO jobs(id,trip_id,incident_id,grant_id,recipient_id,channel,class,status,unavailable_reason,created_at,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,'emergency',$7,$8,$9,$9,$10)`,
      [jobId, trip.id, id, grant.id, grant.contact_id, channel, reason ? 'unavailable' : 'pending', reason, now, new Date(now.getTime() + 900000)]);
    if (!reason) await client.query('INSERT INTO outbox(id,job_id,job_version,class,created_at,next_publish_at) VALUES($1,$2,1,\'emergency\',$3,$3)', [randomUUID(), jobId, now]);
  }
  await client.query(`INSERT INTO jobs(id,trip_id,incident_id,channel,class,status,unavailable_reason,created_at,due_at) VALUES($1,$2,$3,'group','emergency','unavailable','group_support_unverified',$4,$4)`, [randomUUID(), trip.id, id, now]);
  return id;
}
```

- [ ] **Step 4: Rewrite the SOS handler body** in `src/incidents/routes.ts` (inside `idempotent`), and add `import { createIncident } from './create.js';`:

```ts
      let incident = (await client.query("SELECT id,trigger FROM incidents WHERE trip_id=$1 AND status='active'", [trip.id])).rows[0];
      if (!incident) incident = { id: await createIncident(client, trip, 'sos', null, support, ctx.clock()) };
      // ponytail: pending missed-check jobs pick up SOS wording at authorization; re-notify sent ones later.
      else if (incident.trigger === 'missed_check') await client.query("UPDATE incidents SET trigger='sos' WHERE id=$1", [incident.id]);
      await client.query("UPDATE security_checks SET status='escalated',incident_id=$2,closed_at=$3 WHERE trip_id=$1 AND status='asking'", [trip.id, incident.id, ctx.clock()]);
      await client.query("INSERT INTO incident_events VALUES($1,$2,$3,'sos_report',NULL,$4)", [randomUUID(), incident.id, request.actor.id, ctx.clock()]);
      return { id: incident.id, tripId: trip.id, status: 'active', groupCapability: 'unavailable' };
```

- [ ] **Step 5: Run the tests to verify they pass.** `npm run build && node --test tests/checks.test.mjs`, then `npm test`. Expected: PASS, no regressions (existing fixtures default to `family`).

- [ ] **Step 6: Commit.**

```bash
git add src/incidents/create.ts src/incidents/routes.ts tests/checks.test.mjs
git commit -m "feat(incidents): Share role-based alert fan-out between SOS and checks"
```

---

### Task 3: Sweeper, and commands that close the open check

**Files:**
- Create: `src/checks/sweep.ts`
- Modify: `src/trips/routes.ts` (commands handler)
- Test: `tests/checks.test.mjs`

- [ ] **Step 1: Write the failing tests.** Append:

```js
const support = ['sms', 'whatsapp', 'voice'].map(channel => ({channel, country: 'BR', locale: 'pt-BR'}));
export const cfg = {silenceMs: 120000, askGraceMs: 60000, arrivalGraceMs: 120000, sweepMs: 5000};
export async function sweep(f, config = cfg) { const {checkOnce} = await import('../dist/checks/sweep.js'); await checkOnce(f.ctx, support, config); }
export const checksOf = async (f, trip) => (await f.ctx.pool.query('SELECT reason,status,incident_id FROM security_checks WHERE trip_id=$1 ORDER BY created_at,status', [trip])).rows;
const asking = reason => ({reason, status: 'asking', incident_id: null});

test('check timings are all-or-nothing and positive', async () => {
  const {checkConfig} = await import('../dist/checks/sweep.js');
  assert.equal(checkConfig({}), null);
  assert.throws(() => checkConfig({SILENCE_MS: '120000'}), /Complete check timing/);
  assert.throws(() => checkConfig({SILENCE_MS: '0', ASK_GRACE_MS: '1', ARRIVAL_GRACE_MS: '1', CHECK_SWEEP_MS: '1'}), /Complete check timing/);
  assert.deepEqual(checkConfig({SILENCE_MS: '120000', ASK_GRACE_MS: '60000', ARRIVAL_GRACE_MS: '120000', CHECK_SWEEP_MS: '5000'}), cfg);
});

test('silence opens one check; OK closes it and the same reason does not reopen at once', async t => {
  const f = await fixture(t); const trip = await f.trip();
  f.advance(120000); await sweep(f); assert.deepEqual(await checksOf(f, trip), []);
  f.advance(1); await sweep(f); await sweep(f); assert.deepEqual(await checksOf(f, trip), [asking('silence')]);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'checkin_ok'})).status, 200);
  await sweep(f); assert.deepEqual(await checksOf(f, trip), [{reason: 'silence', status: 'ok', incident_id: null}]);
  f.advance(120001); await sweep(f); assert.deepEqual((await checksOf(f, trip)).map(c => c.status), ['ok', 'asking']);
});

test('a location upload, resume or incident resolution counts as a sign of life', async t => {
  const f = await fixture(t); const trip = await f.trip();
  f.advance(100000);
  await f.req('POST', `/v1/trips/${trip}/locations`, {observations: [{capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 9}]});
  f.advance(100000); await sweep(f); assert.deepEqual(await checksOf(f, trip), []);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'pause'}); f.advance(500000);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'resume'}); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), []);
  const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  f.advance(500000); assert.equal((await f.req('POST', `/v1/incidents/${sos}/resolve`, {})).status, 200); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), []);
});

test('an unanswered check escalates once to family (3 channels), colleague (2) and an unavailable group', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family'); const colleague = await contactFor(f, 'colleague', 'colleague');
  const trip = await f.trip([family.grant, colleague.grant]);
  f.advance(120001); await sweep(f); f.advance(59999); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), [asking('silence')]);
  f.advance(1); await Promise.all([sweep(f), sweep(f)]); await sweep(f);
  const incidents = (await f.ctx.pool.query('SELECT id,driver_id,trigger,check_reason,status FROM incidents')).rows;
  assert.equal(incidents.length, 1);
  assert.deepEqual({...incidents[0], id: undefined}, {id: undefined, driver_id: f.me.id, trigger: 'missed_check', check_reason: 'silence', status: 'active'});
  assert.deepEqual(await checksOf(f, trip), [{reason: 'silence', status: 'escalated', incident_id: incidents[0].id}]);
  assert.deepEqual(await jobsOf(f, incidents[0].id), expectedFanOut);
});

test('arrival and pause cancel an open check; a paused trip gets no new check', async t => {
  const f = await fixture(t); const arriving = await f.trip(); const pausing = await f.trip();
  f.advance(120001); await sweep(f);
  await f.req('POST', `/v1/trips/${arriving}/commands`, {type: 'arrived'});
  await f.req('POST', `/v1/trips/${pausing}/commands`, {type: 'pause'});
  f.advance(600000); await sweep(f);
  assert.deepEqual(await checksOf(f, arriving), [{reason: 'silence', status: 'cancelled', incident_id: null}]);
  assert.deepEqual(await checksOf(f, pausing), [{reason: 'silence', status: 'cancelled', incident_id: null}]);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM incidents')).rows[0].n, 0);
});

test('escalation attaches to an already active incident instead of creating a second one', async t => {
  const f = await fixture(t); const trip = await f.trip();
  f.advance(120001); await sweep(f);
  const id = (await f.ctx.pool.query("INSERT INTO incidents(id,trip_id,driver_id,created_at) VALUES(gen_random_uuid(),$1,$2,$3) RETURNING id", [trip, f.me.id, f.ctx.clock()])).rows[0].id;
  f.advance(60000); await sweep(f);
  assert.deepEqual(await checksOf(f, trip), [{reason: 'silence', status: 'escalated', incident_id: id}]);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM incidents')).rows[0].n, 1);
});

test('arrival overdue opens a check after the grace period', async t => {
  const f = await fixture(t);
  const draft = await f.draft({expectedArrivalAt: '2026-10-17T12:30:00Z'});
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: []})).body.id;
  const quiet = {...cfg, silenceMs: 86400000};
  f.advance(32 * 60000); await sweep(f, quiet); assert.deepEqual(await checksOf(f, trip), []);
  f.advance(1); await sweep(f, quiet); assert.deepEqual(await checksOf(f, trip), [asking('arrival_overdue')]);
});

test('one failing trip does not stop the sweep for the others', async t => {
  const f = await fixture(t); const broken = await f.trip(); const healthy = await f.trip();
  await f.ctx.pool.query(`CREATE FUNCTION fail_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.trip_id = '${broken}' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
  await f.ctx.pool.query('CREATE TRIGGER fail_check BEFORE INSERT ON security_checks FOR EACH ROW EXECUTE FUNCTION fail_check()');
  f.advance(120001); await sweep(f);
  assert.deepEqual(await checksOf(f, broken), []);
  assert.deepEqual(await checksOf(f, healthy), [asking('silence')]);
});
```

- [ ] **Step 2: Run them to verify they fail.** `npm run build && node --test tests/checks.test.mjs`. Expected: FAIL with `Cannot find module '.../dist/checks/sweep.js'`.

- [ ] **Step 3: Create** `src/checks/sweep.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ChannelSupport, Trip } from '../contracts.js';
import { withTripTransaction, type Context } from '../db.js';
import { createIncident } from '../incidents/create.js';
export interface CheckConfig { silenceMs: number; askGraceMs: number; arrivalGraceMs: number; sweepMs: number }
/** Demo timings, not evidence-backed safety thresholds: automatic checks stay off unless all four are set. */
export function checkConfig(env: NodeJS.ProcessEnv): CheckConfig | null {
  const raw = [env.SILENCE_MS, env.ASK_GRACE_MS, env.ARRIVAL_GRACE_MS, env.CHECK_SWEEP_MS];
  if (raw.every(value => value === undefined)) return null;
  const [silenceMs, askGraceMs, arrivalGraceMs, sweepMs] = raw.map(Number) as [number, number, number, number];
  if ([silenceMs, askGraceMs, arrivalGraceMs, sweepMs].some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Complete check timing configuration required');
  return { silenceMs, askGraceMs, arrivalGraceMs, sweepMs };
}
/** Trips that should open a check now. Sign of life: location receipt, OK/resume command, incident resolution, or trip start. */
async function dueReasons(db: pg.Pool | pg.PoolClient, now: Date, config: CheckConfig, tripId: string | null = null) {
  return (await db.query(`WITH s AS (
      SELECT t.id, t.sharing_stopped_at, t.expected_arrival_at, greatest(t.created_at, l.received_at, e.signal_at, r.resolved_at) AS signal_at,
        greatest(t.created_at, e.signal_at, r.resolved_at) AS driver_at
      FROM trips t LEFT JOIN latest_locations l ON l.trip_id=t.id
      LEFT JOIN LATERAL (SELECT max(created_at) FILTER (WHERE kind IN ('checkin_ok','resume')) AS signal_at
        FROM trip_events WHERE trip_id=t.id) e ON true
      LEFT JOIN LATERAL (SELECT max(resolved_at) AS resolved_at FROM incidents WHERE trip_id=t.id) r ON true
      WHERE t.status='active' AND t.checkins_active AND NOT t.paused AND ($3::uuid IS NULL OR t.id=$3)
        AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.trip_id=t.id AND i.status='active')
        AND NOT EXISTS (SELECT 1 FROM security_checks c WHERE c.trip_id=t.id AND c.status='asking'))
    SELECT id, signal_at, CASE
      WHEN sharing_stopped_at > signal_at THEN 'sharing_stopped'
      WHEN signal_at < $1 THEN 'silence'
      -- Overdue counts from the later of the expected arrival and the driver's last action (start, OK, resume, resolution).
      WHEN expected_arrival_at IS NOT NULL AND greatest(expected_arrival_at, driver_at) < $2 THEN 'arrival_overdue' END AS reason
    FROM s`, [new Date(now.getTime() - config.silenceMs), new Date(now.getTime() - config.arrivalGraceMs), tripId])).rows.filter(row => row.reason);
}
async function sweepTrip(client: pg.PoolClient, trip: Trip, now: Date, config: CheckConfig, support: ChannelSupport[]) {
  const check = (await client.query("SELECT * FROM security_checks WHERE trip_id=$1 AND status='asking' FOR UPDATE", [trip.id])).rows[0];
  if (check) {
    if (check.ask_until > now) return;
    // Commands already cancel open checks on close/pause; this guards any other path.
    if (trip.status !== 'active' || trip.paused) { await client.query("UPDATE security_checks SET status='cancelled',closed_at=$2 WHERE id=$1", [check.id, now]); return; }
    const active = (await client.query("SELECT id FROM incidents WHERE trip_id=$1 AND status='active'", [trip.id])).rows[0];
    const incidentId = active?.id ?? await createIncident(client, trip, 'missed_check', check.reason, support, now);
    await client.query("UPDATE security_checks SET status='escalated',incident_id=$2,closed_at=$3 WHERE id=$1", [check.id, incidentId, now]);
    return;
  }
  const [due] = await dueReasons(client, now, config, trip.id);
  if (due) await client.query("INSERT INTO security_checks(id,trip_id,reason,status,signal_at,created_at,ask_until) VALUES($1,$2,$3,'asking',$4,$5,$6)",
    [randomUUID(), trip.id, due.reason, due.signal_at, now, new Date(now.getTime() + config.askGraceMs)]);
}
/** SQL-only: each trip in its own short transaction, so one failure or a restart never loses or duplicates work. */
export async function checkOnce(ctx: Context, support: ChannelSupport[], config: CheckConfig): Promise<void> {
  const now = ctx.clock();
  // ponytail: scans every active trip each sweep; add a due-time index when trips reach the thousands.
  const expired = (await ctx.pool.query("SELECT trip_id FROM security_checks WHERE status='asking' AND ask_until<=$1", [now])).rows.map(row => row.trip_id as string);
  const opening = (await dueReasons(ctx.pool, now, config)).map(row => row.id as string);
  for (const tripId of new Set([...expired, ...opening])) {
    try { await withTripTransaction(ctx, tripId, (client, trip) => sweepTrip(client, trip, now, config, support)); }
    catch { process.stderr.write('Security check failed for one trip\n'); }
  }
}
```

- [ ] **Step 4: Commands close the open check.** In `src/trips/routes.ts`, inside the commands handler, just before the `INSERT INTO trip_events`:

```ts
      const closing = type === 'checkin_ok' ? 'ok' : ['arrived', 'cancel', 'pause'].includes(type) ? 'cancelled' : null;
      if (closing) await client.query("UPDATE security_checks SET status=$2,closed_at=$3 WHERE trip_id=$1 AND status='asking'", [trip.id, closing, ctx.clock()]);
```

- [ ] **Step 5: Run the tests to verify they pass.** `npm run build && node --test tests/checks.test.mjs`, then `npm test`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/checks/sweep.ts src/trips/routes.ts tests/checks.test.mjs
git commit -m "feat(checks): Open, close and escalate security checks in a durable sweeper"
```

---

### Task 4: Sharing and status endpoints

**Files:**
- Create: `src/checks/routes.ts`
- Modify: `src/location/routes.ts` (export `latestLocation`), `src/api/app.ts` (register)
- Test: `tests/checks.test.mjs`

- [ ] **Step 1: Write the failing tests.** Append:

```js
test('sharing stopped opens a check at once; resume clears it; both are audited', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(1000);
  const stop = await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'page_hidden'}, f.driver, 'stop-1');
  assert.deepEqual(stop, {status: 200, body: {id: trip, sharing: 'stopped'}});
  assert.deepEqual(await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'page_hidden'}, f.driver, 'stop-1'), stop);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'bored'})).status, 400);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'user'}, f.stranger)).status, 403);
  await sweep(f); assert.deepEqual(await checksOf(f, trip), [asking('sharing_stopped')]);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'resumed', reason: 'user'})).status, 200);
  assert.equal((await f.ctx.pool.query('SELECT sharing_stopped_at FROM trips WHERE id=$1', [trip])).rows[0].sharing_stopped_at, null);
  assert.deepEqual((await f.ctx.pool.query('SELECT kind FROM trip_events WHERE trip_id=$1 ORDER BY created_at,kind', [trip])).rows.map(r => r.kind), ['sharing_resumed', 'sharing_stopped:page_hidden']);
  await f.req('POST', `/v1/trips/${trip}/commands`, {type: 'arrived'});
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sharing`, {state: 'stopped', reason: 'user'})).status, 409);
});

test('status drives both screens without phone numbers and follows grant scopes', async t => {
  const f = await fixture(t); const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  const path = `/v1/trips/${trip}/status`;
  const quiet = await f.req('GET', path);
  assert.deepEqual(quiet, {status: 200, body: {trip: {status: 'active', paused: false, expectedArrivalAt: null}, check: null, incident: null, deliveries: [],
    location: {freshness: 'unavailable', ageMs: null, capturedAt: null, accuracy: null}}});
  await f.req('POST', `/v1/trips/${trip}/locations`, {observations: [{capturedAt: f.ctx.clock().toISOString(), latitude: -12, longitude: -77, accuracy: 30}]});
  f.advance(120001); await sweep(f);
  const askingStatus = (await f.req('GET', path, undefined, family.jwt)).body;
  assert.deepEqual(askingStatus.check, {status: 'asking', reason: 'silence', askUntil: '2026-10-17T12:03:00.001Z'});
  assert.deepEqual(askingStatus.location, {freshness: 'stale', ageMs: 120001, capturedAt: '2026-10-17T12:00:00.000Z', accuracy: 30});
  f.advance(60000); await sweep(f);
  const alerted = (await f.req('GET', path, undefined, family.jwt)).body;
  assert.equal(alerted.check, null);
  assert.deepEqual({...alerted.incident, id: typeof alerted.incident.id}, {id: 'string', trigger: 'missed_check', checkReason: 'silence', status: 'active', createdAt: '2026-10-17T12:03:00.001Z'});
  assert.deepEqual(alerted.deliveries.map(d => `${d.role}:${d.channel}:${d.status}`), ['family:sms:pending', 'family:voice:pending', 'family:whatsapp:pending', 'group:group:unavailable']);
  assert.doesNotMatch(JSON.stringify(alerted), /\+55|contact|recipient/);
  await f.ctx.pool.query('UPDATE contact_grants SET map_accepted=false');
  assert.equal((await f.req('GET', path, undefined, family.jwt)).body.location, undefined);
  assert.equal((await f.req('GET', path, undefined, f.stranger)).status, 403);
  await f.req('POST', `/v1/trips/${trip}/contacts/${family.grant}/revoke`, {}, family.jwt);
  assert.equal((await f.req('GET', path, undefined, family.jwt)).status, 403);
});
```

- [ ] **Step 2: Run them to verify they fail.** `npm run build && node --test tests/checks.test.mjs`. Expected: FAIL with 404 on `/sharing` and `/status`.

- [ ] **Step 3: Export the location read.** In `src/location/routes.ts`, add above `locationRoutes`, then use it in `/snapshot` (`const { location, freshness, ageMs } = await latestLocation(client, trip.id, now)`, keeping the existing response shape):

```ts
export async function latestLocation(client: pg.PoolClient, tripId: string, now: Date) {
  const row = (await client.query('SELECT * FROM latest_locations WHERE trip_id=$1', [tripId])).rows[0];
  if (!row) return { location: null, freshness: 'unavailable' as const, ageMs: null };
  const ageMs = Math.max(0, now.getTime() - row.captured_at.getTime());
  return { location: { capturedAt: row.captured_at.toISOString(), receivedAt: row.received_at.toISOString(), latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy },
    freshness: ageMs <= 120000 ? 'fresh' as const : 'stale' as const, ageMs };
}
```

(Add `import type pg from 'pg';`.)

- [ ] **Step 4: Create** `src/checks/routes.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { owner, problem } from '../contracts.js';
import { withTripTransaction, type Context } from '../db.js';
import { idempotent } from '../api/mutations.js';
import { idParams, object } from '../api/schemas.js';
import { latestLocation } from '../location/routes.js';
export function checkRoutes(app: FastifyInstance, ctx: Context) {
  app.post('/v1/trips/:id/sharing', { schema: { params: idParams, body: object({ state: { enum: ['stopped', 'resumed'] }, reason: { enum: ['user', 'page_hidden', 'permission_denied', 'error'] } }) } }, request => withTripTransaction(ctx, (request.params as { id: string }).id, async (client, trip) => {
    owner(trip, request.actor);
    return idempotent(ctx, client, request, async () => {
      if (trip.status !== 'active') problem(409, 'trip_closed');
      const { state, reason } = request.body as { state: 'stopped' | 'resumed'; reason: string };
      await client.query(`UPDATE trips SET sharing_stopped_at=${state === 'stopped' ? 'COALESCE(sharing_stopped_at,$2)' : 'NULL'} WHERE id=$1`, state === 'stopped' ? [trip.id, ctx.clock()] : [trip.id]);
      await client.query('INSERT INTO trip_events VALUES($1,$2,$3,$4,$5)', [randomUUID(), trip.id, request.actor.id, state === 'stopped' ? `sharing_stopped:${reason}` : 'sharing_resumed', ctx.clock()]);
      return { id: trip.id, sharing: state };
    });
  }));
  app.get('/v1/trips/:id/status', { schema: { params: idParams } }, request => withTripTransaction(ctx, (request.params as { id: string }).id, async (client, trip) => {
    const driver = trip.driver_id === request.actor.id;
    const grant = driver ? null : (await client.query(`SELECT cg.map_accepted,cg.incident_accepted FROM trip_grants tg JOIN contact_grants cg ON cg.id=tg.grant_id
      WHERE tg.trip_id=$1 AND tg.revoked_at IS NULL AND cg.contact_id=$2 AND cg.accepted_at IS NOT NULL AND cg.revoked_at IS NULL`, [trip.id, request.actor.id])).rows[0];
    if (!driver && !grant) problem(403, 'forbidden');
    const now = ctx.clock();
    const check = (await client.query("SELECT reason,ask_until FROM security_checks WHERE trip_id=$1 AND status='asking'", [trip.id])).rows[0];
    const incident = driver || grant.incident_accepted ? (await client.query('SELECT id,trigger,check_reason,status,created_at FROM incidents WHERE trip_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [trip.id])).rows[0] : undefined;
    const deliveries = incident ? (await client.query(`SELECT COALESCE(cg.role,'group') AS role,j.channel,j.status,j.unavailable_reason FROM jobs j
      LEFT JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 ORDER BY role,j.channel`, [incident.id])).rows : [];
    let location;
    if (trip.map_active && (driver || grant.map_accepted)) {
      const latest = await latestLocation(client, trip.id, now);
      location = { freshness: latest.freshness, ageMs: latest.ageMs, capturedAt: latest.location?.capturedAt ?? null, accuracy: latest.location?.accuracy ?? null };
    }
    return {
      trip: { status: trip.status, paused: trip.paused, expectedArrivalAt: trip.expected_arrival_at?.toISOString() ?? null },
      check: check ? { status: 'asking', reason: check.reason, askUntil: check.ask_until.toISOString() } : null,
      incident: incident ? { id: incident.id, trigger: incident.trigger, checkReason: incident.check_reason, status: incident.status, createdAt: incident.created_at.toISOString() } : null,
      deliveries: deliveries.map(d => ({ role: d.role, channel: d.channel, status: d.status, unavailableReason: d.unavailable_reason })),
      location
    };
  }, ctx.telemetryPool));
}
```

- [ ] **Step 5: Register the routes.** In `src/api/app.ts`, add `import { checkRoutes } from '../checks/routes.js';` directly **after line 1** (the `callbackRoutes` import), and add `checkRoutes(app, ctx);` as its own line directly **before** `app.get('/v1/me', ...)`. Do not edit the onRequest exemption line or the route-registration line; Part 2 changes those.

- [ ] **Step 6: Run the tests to verify they pass.** `npm run build && node --test tests/checks.test.mjs`, then `npm test`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/checks/routes.ts src/location/routes.ts src/api/app.ts tests/checks.test.mjs
git commit -m "feat(checks): Add sharing state and trip status endpoints"
```

---

### Task 5: Alert wording

**Files:**
- Create: `src/notifications/wording.ts`
- Modify: `src/notifications/dispatch.ts` (summary block in `authorizeJob`), `tests/dispatch.test.mjs:14,39,93,95`
- Test: `tests/checks.test.mjs`

- [ ] **Step 1: Write the failing tests.** Append:

```js
test('alert wording names the truck, keeps the incident ID and never invents location', async () => {
  const {alertSummary} = await import('../dist/notifications/wording.js');
  const now = new Date('2026-10-17T12:05:00Z');
  const base = {truck: 'ABC-123', country: 'PE', timeZone: 'America/Lima', now, signalAt: null,
    location: {latitude: -12.1, longitude: -77.03, accuracy: 18.4, captured_at: new Date('2026-10-17T12:02:00Z')}};
  const env = {EMERGENCY_NUMBERS: '{"PE":"105"}', CONTACT_APP_URL: 'https://andes.example'};
  assert.equal(alertSummary({...base, incident: {id: 'i-1', trigger: 'sos', check_reason: null}}, env),
    'ALERTA: el conductor del camión ABC-123 pidió ayuda (posible robo). Incidente i-1. Última ubicación hace 3 min (±18 m): https://maps.google.com/?q=-12.1,-77.03. Llámalo. Si no responde, llama al 105. Ver: https://andes.example/incidents/i-1');
  assert.equal(alertSummary({...base, location: null, signalAt: new Date('2026-10-17T11:58:00Z'), incident: {id: 'i-2', trigger: 'missed_check', check_reason: 'silence'}}, {}),
    'el conductor del camión ABC-123 no confirmó su estado (sin señal desde 06:58). Incidente i-2. Última ubicación no disponible. No sabemos qué pasó. Llámalo.');
  assert.match(alertSummary({...base, incident: {id: 'i-3', trigger: 'missed_check', check_reason: 'arrival_overdue'}}, env), /no llegó a la hora prevista\). Incidente i-3\..*Llámalo; si no responde, llama al 105\./);
  assert.match(alertSummary({...base, incident: {id: 'i-4', trigger: 'missed_check', check_reason: 'sharing_stopped'}}, {}), /dejó de compartir su ubicación/);
  assert.match(alertSummary({...base, location: {...base.location, captured_at: new Date('2026-10-17T10:00:00Z')}, incident: {id: 'i-5', trigger: 'sos', check_reason: null}}, {}), /hace 2 h 5 min/);
});
```

- [ ] **Step 2: Run it to verify it fails.** `npm run build && node --test tests/checks.test.mjs`. Expected: FAIL with `Cannot find module '.../dist/notifications/wording.js'`.

- [ ] **Step 3: Create** `src/notifications/wording.ts`:

```ts
interface AlertInput {
  truck: string; country: string; timeZone: string; now: Date; signalAt: Date | null;
  incident: { id: string; trigger: string; check_reason: string | null } | null;
  location: { latitude: number; longitude: number; accuracy: number; captured_at: Date } | null;
}
function age(ms: number) {
  const minutes = Math.round(Math.max(0, ms) / 60000);
  if (minutes < 1) return `${Math.round(Math.max(0, ms) / 1000)} s`;
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
function emergencyNumber(country: string, env: NodeJS.ProcessEnv): string | null {
  try { const number = JSON.parse(env.EMERGENCY_NUMBERS ?? '{}')[country]; return typeof number === 'string' && /^\d{2,15}$/.test(number) ? number : null; }
  catch { return null; }
}
/** Spanish-only for the demo. ponytail: add pt-BR summaries when a Brazilian corridor is tested. */
export function alertSummary(input: AlertInput, env: NodeJS.ProcessEnv = process.env): string {
  const { truck, incident, location, now } = input;
  const where = location ? `Última ubicación hace ${age(now.getTime() - location.captured_at.getTime())} (±${Math.round(location.accuracy)} m): https://maps.google.com/?q=${location.latitude},${location.longitude}.` : 'Última ubicación no disponible.';
  const emergency = emergencyNumber(input.country, env);
  const view = incident && env.CONTACT_APP_URL ? ` Ver: ${env.CONTACT_APP_URL}/incidents/${incident.id}` : '';
  if (incident?.trigger === 'sos') return `ALERTA: el conductor del camión ${truck} pidió ayuda (posible robo). Incidente ${incident.id}. ${where} Llámalo.${emergency ? ` Si no responde, llama al ${emergency}.` : ''}${view}`;
  const local = input.signalAt ? new Intl.DateTimeFormat('es', { timeZone: input.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(input.signalAt) : null;
  const reason = { arrival_overdue: 'no llegó a la hora prevista', silence: `sin señal desde ${local ?? 'hace un rato'}`, sharing_stopped: 'dejó de compartir su ubicación' }[incident?.check_reason ?? ''];
  return `el conductor del camión ${truck} no confirmó su estado${reason ? ` (${reason})` : ''}.${incident ? ` Incidente ${incident.id}.` : ''} ${where} No sabemos qué pasó. Llámalo${emergency ? `; si no responde, llama al ${emergency}` : ''}.${view}`;
}
```

- [ ] **Step 4: Use it in `authorizeJob`.** In `src/notifications/dispatch.ts`, add `import { alertSummary } from './wording.js';`, then replace the lines from `const locationText = ...` through `const summary = ...` (keep the `const location = ...` line above them) with:

```ts
    const truck = (await client.query('SELECT label FROM trucks WHERE id=$1', [trip.truck_id])).rows[0]!.label as string;
    const check = incident?.trigger === 'missed_check' ? (await client.query('SELECT signal_at FROM security_checks WHERE incident_id=$1 ORDER BY created_at LIMIT 1', [incident.id])).rows[0] : null;
    const summary = alertSummary({ truck, country: trip.country, timeZone: trip.time_zone, now, signalAt: check?.signal_at ?? null, incident: incident ?? null, location: location ?? null });
```

- [ ] **Step 5: Update the four old-text assertions** in `tests/dispatch.test.mjs`:
  - line 14: regex `/Incidente ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12});/` → same pattern ending in `\./` instead of `;/`.
  - line 39: `` summary.includes(`Incidente ${id};`) `` → `` summary.includes(`Incidente ${id}.`) ``, and `assert.doesNotMatch(summary,/última ubicación/)` → `assert.doesNotMatch(summary,/maps\.google\.com/)`. The old check was case-sensitive and would silently pass against `Última`.
  - line 93: `assert.match(JSON.stringify(first.payload),/2026-10-17/)` → `assert.match(JSON.stringify(first.payload),/maps\.google\.com\/\?q=-12,-77/)`.
  - line 95: `assert.doesNotMatch(JSON.stringify(second.payload),/última ubicación -12,-77/)` → `assert.doesNotMatch(JSON.stringify(second.payload),/maps\.google\.com/)`.

- [ ] **Step 6: Add an integration assertion** at the end of the escalation test in `tests/checks.test.mjs` (`'an unanswered check escalates once…'`), proving a real escalated job carries the new text:

```js
  const {authorizeJob, claimJob} = await import('../dist/notifications/dispatch.js');
  const {provider} = await import('./helpers/dispatch.mjs');
  const job = (await f.ctx.pool.query("SELECT j.id AS \"jobId\",j.version,j.class FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 AND cg.role='family' AND j.channel='sms'", [incidents[0].id])).rows[0];
  const attempt = await authorizeJob(f.ctx, await claimJob(f.ctx, job, 'checks-test'), provider());
  assert.match(attempt.payload.text, /^ANDES: estado sin confirmar\. el conductor del camión SYNTHETIC truck no confirmó su estado \(sin señal desde 09:00\)\. Incidente [0-9a-f-]{36}\. Última ubicación no disponible\./);
```

- [ ] **Step 7: Run everything.** `npm test`. Expected: PASS (all old tests plus `checks.test.mjs`).

- [ ] **Step 8: Commit.**

```bash
git add src/notifications/wording.ts src/notifications/dispatch.ts tests/dispatch.test.mjs tests/checks.test.mjs
git commit -m "feat(alerts): Name the truck and reason in alert text, keep incident IDs"
```

---

### Task 6: Run the sweeper in the control worker; document

**Files:**
- Modify: `src/worker.ts`, `docs/contracts/runtime.md`, `.env.example`
- Test: `tests/checks.test.mjs`

- [ ] **Step 1: Write the failing test.** Append:

```js
test('the control worker runs the sweeper only when check timings are configured', async t => {
  const f = await fixture(t); const trip = await f.trip(); f.advance(120001);
  const {control} = await import('../dist/worker.js');
  const {provider} = await import('./helpers/dispatch.mjs');
  const quiet = new AbortController(); const off = control(f.ctx, {async publish() {}}, provider(), quiet.signal);
  await new Promise(resolve => setTimeout(resolve, 50)); quiet.abort(); await off;
  assert.deepEqual(await checksOf(f, trip), []);
  const abort = new AbortController(); const running = control(f.ctx, {async publish() {}}, provider(), abort.signal, {...cfg, sweepMs: 10});
  for (let i = 0; i < 100 && !(await checksOf(f, trip)).length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  abort.abort(); await running;
  assert.deepEqual(await checksOf(f, trip), [asking('silence')]);
});
```

- [ ] **Step 2: Run it to verify it fails.** `npm run build && node --test tests/checks.test.mjs`. Expected: the second assertion FAILS (no check is opened).

- [ ] **Step 3: Wire the worker.** In `src/worker.ts`:
  - import `checkConfig`, `checkOnce` and `type CheckConfig` from `./checks/sweep.js`;
  - change the signature to `control(ctx, transport, provider, signal, checks: CheckConfig | null = null)`;
  - inside `control`, add `const support = provider?.qualification.live ? provider.qualification.entries : [];` (the same rule as `src/server.ts`), and append `...(checks ? [loop(() => checkOnce(ctx, support, checks), checks.sweepMs, signal)] : [])` to the `Promise.all` array;
  - in `startWorker`, call `control(ctx, transport, provider, abort.signal, checkConfig(env))`. Calling `checkConfig(env)` before connecting makes a partial configuration fail at startup.

- [ ] **Step 4: Document.**
  - In `docs/contracts/runtime.md`, replace "No live delivery, audio transcription or automatic nonresponse escalation is enabled." with: "No live delivery or audio transcription is enabled. Automatic missed-check escalation runs only when all four check timings are configured (see Security checks)."
  - Append a `## Security checks (Part 1)` section covering:
    - the three reasons;
    - the closing rules (OK → ok; arrival, cancel or pause → cancelled; SOS → escalated with the SOS incident);
    - escalation fan-out by role;
    - `POST /v1/trips/:id/sharing` and `GET /v1/trips/:id/status`, with their shapes;
    - the variables `SILENCE_MS`, `ASK_GRACE_MS`, `ARRIVAL_GRACE_MS`, `CHECK_SWEEP_MS` (demo values 120000/60000/120000/5000, not safety thresholds; all or none), `EMERGENCY_NUMBERS` and `CONTACT_APP_URL` (delivery workers);
    - the note that WhatsApp qualification `text` should be `ANDES:`.
  - In `.env.example`, add the six variables commented out, with the demo values.

- [ ] **Step 5: Run everything.** `npm test` and `npm run demo`. Expected: all pass; the demo output is unchanged.

- [ ] **Step 6: Commit.**

```bash
git add src/worker.ts docs/contracts/runtime.md .env.example tests/checks.test.mjs
git commit -m "feat(checks): Run security checks in the control worker when configured"
```
