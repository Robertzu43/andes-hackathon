# Security checks and incident data — design

Date: 2026-10-17. Status: approved by Robert in brainstorming (parts 1 and 2). Target: the demo for Hack the Andes (judged 2026-10-18). Builds on the backend branch `codex/aws-durable-backend` (Fastify + PostgreSQL + outbox → SQS → Zavu). Paths below refer to that branch.

## Product in one line

*Si te asaltan y no puedes avisar, ANDES avisa por ti.* A server-owned security check notices when a driver goes silent or is overdue, asks once, then alerts family and colleague drivers at the same time. Every incident becomes a labelled data point that feeds a hotspot map for law enforcement and simple advice for drivers.

## Part 1 — Security checks and alerts (backend agent)

### Data (`db/migrations/003-security-checks.sql`)

- `trips.expected_arrival_at timestamptz NULL`, filled from a new optional draft field `expectedArrivalAt` (ISO instant) in `DraftFields`/`fieldsSchema`. When null, only silence/sharing checks apply.
- `trips.sharing_stopped_at timestamptz NULL`.
- `contact_grants.role text NOT NULL DEFAULT 'family' CHECK (role IN ('family','colleague'))`; `POST /v1/contacts` accepts optional `role`.
- `incidents.trigger text NOT NULL DEFAULT 'sos' CHECK (trigger IN ('sos','missed_check'))` and `incidents.check_reason text NULL CHECK (check_reason IN ('arrival_overdue','silence','sharing_stopped'))`.
- New table:

```sql
CREATE TABLE security_checks (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips,
  reason text NOT NULL CHECK (reason IN ('arrival_overdue','silence','sharing_stopped')),
  status text NOT NULL CHECK (status IN ('asking','ok','escalated','cancelled')),
  signal_at timestamptz NOT NULL, -- last_signal_at when the check opened; used in the alert text
  created_at timestamptz NOT NULL, ask_until timestamptz NOT NULL,
  closed_at timestamptz, incident_id uuid REFERENCES incidents
);
CREATE UNIQUE INDEX one_open_check ON security_checks(trip_id) WHERE status = 'asking';
```

### Signals

`last_signal_at = greatest(latest_locations.received_at, last 'checkin_ok' trip_event, trips.created_at)`.

A trip is eligible when `status='active' AND checkins_active AND NOT paused` and it has no open check and no active incident. The sweeper opens a check for the first matching reason:

1. `sharing_stopped`: `sharing_stopped_at > last_signal_at`.
2. `silence`: `now - last_signal_at > SILENCE_MS`.
3. `arrival_overdue`: `expected_arrival_at IS NOT NULL AND now > greatest(expected_arrival_at, last checkin_ok) + ARRIVAL_GRACE_MS`.

Opening a check sets `status='asking'`, `signal_at = last_signal_at`, `ask_until = now + ASK_GRACE_MS`. Closing rules for an `asking` check:

- Driver `checkin_ok` (existing `POST /v1/trips/:id/commands`) → `ok`. It also moves `last_signal_at`, so the same reason does not reopen immediately.
- Arrival, cancel or pause → `cancelled`. Pause suspends further checks (existing `checkins_active=false`).
- SOS → `escalated` with the SOS `incident_id` (in the SOS transaction), so no second incident is created.
- At escalation time, if the trip already has an active incident, attach to it (`escalated`, that `incident_id`) instead of creating one; `one_active_incident` must never be hit.

SOS is never suspended.

### Sweeper

`checkOnce(ctx, support)` in a new `src/checks/sweep.ts`, added to `control()` in `src/worker.ts` as `loop(() => checkOnce(ctx, support), CHECK_SWEEP_MS, signal)`. Each trip is handled in its own short `withTripTransaction` (SQL only, no provider I/O) inside its own try/catch, so one failing trip never blocks the others, and a restart loses nothing: all state is in PostgreSQL. Open checks past `ask_until` escalate: create the incident with `trigger='missed_check'`, `check_reason=<reason>`, actor and `incidents.driver_id` = `trip.driver_id` (`authorizeJob` invalidates jobs otherwise), fan out jobs, mark the check `escalated` with `incident_id`.

### Fan-out (shared by SOS and escalation)

Extract the job creation now inline in `POST /v1/trips/:id/sos` (`src/incidents/routes.ts`) into `createIncident(client, trip, actorId, trigger, checkReason, support)`. All jobs are created in parallel (`due_at = now`):

| Recipient | Channels |
|---|---|
| `role='family'` with accepted incident grant | sms, whatsapp, voice |
| `role='colleague'` with accepted incident grant | sms, whatsapp |
| Driver group | existing `group` job, `unavailable` / `group_support_unverified` until Zavu group support is verified |

The existing per-channel `unavailable` reasons, unique `(incident, recipient, channel)` index and outbox stay unchanged. An SOS while a `missed_check` incident is active records `sos_report`, sets `trigger='sos'`, supersedes unsent missed-check jobs and sends a new SOS-worded wave (review fix for #74; see `docs/contracts/runtime.md`).

### Message wording (`authorizeJob` summary in `src/notifications/dispatch.ts`)

Replace the trip/driver UUIDs with the truck label and a maps link, but **keep `Incidente {incidentId}`**: since `0eb515c` it is how a recipient finds the incident to read (`GET /v1/incidents/:id`), acknowledge and act on it (`docs/contracts/runtime.md`). If `CONTACT_APP_URL` is set, also append `Ver: {CONTACT_APP_URL}/incidents/{incidentId}`.

Zavu builds SMS/voice as `${entry.text} ${summary}` (`src/notifications/zavu.ts:70`), so the brand prefix comes from the qualification `text`. The summaries below have no prefix. Set the qualification `text` to `ANDES:`, not `ANDES: estado sin confirmar.`. WhatsApp sends the whole summary in one template variable, so the approved template must be generic. Spanish summaries:

- `sos`: `ALERTA: el conductor del camión {truck} pidió ayuda (posible robo). Incidente {incidentId}. Última ubicación hace {age} (±{acc} m): https://maps.google.com/?q={lat},{lon}. Llámalo. Si no responde, llama al {emergency}.`
- `missed_check`: `el conductor del camión {truck} no confirmó su estado ({reasonText}). Incidente {incidentId}. Última ubicación hace {age} (±{acc} m): {link}. No sabemos qué pasó. Llámalo; si no responde, llama al {emergency}.`
- `reasonText`: `arrival_overdue` → `no llegó a la hora prevista`; `silence` → `sin señal desde {security_checks.signal_at in trip time zone, HH:MM}`; `sharing_stopped` → `dejó de compartir su ubicación`.
- No location → `ubicación no disponible`. `{emergency}` comes from `EMERGENCY_NUMBERS` (JSON, e.g. `{"PE":"105","BR":"190"}`) by `trips.country`; missing → omit the sentence. `authorizeJob` runs in the emergency/ordinary delivery workers, so set it there.
- Alerts are Spanish-only for the demo, including pt-BR trips. `ponytail:` add pt-BR summaries when a Brazilian corridor is tested.
- Update `tests/dispatch.test.mjs` (lines ~14-15, 38-39) for the new summary. The ID regex currently expects `Incidente <uuid>;`; the new template ends with a period. Line 39's `doesNotMatch(summary, /última ubicación/)` is case-sensitive and would silently pass against `Última ubicación`. Make it assert no `maps.google.com` link, so alerts after closure still prove they carry no new coordinates.

### New endpoints

- `POST /v1/trips/:id/sharing` `{state:'stopped'|'resumed', reason:'user'|'page_hidden'|'permission_denied'|'error'}`. Driver only, `idempotent()` like other mutations. `stopped` sets `sharing_stopped_at`; `resumed` clears it; both append a trip_event with `kind='sharing_stopped:<reason>'` or `'sharing_resumed'` (`trip_events` has no detail column). Needed because the phone adapter (PR #52) can stop sharing silently.
- `GET /v1/trips/:id/status`, for the driver and contacts with an accepted, unrevoked grant on the trip; it drives both screens:

```json
{ "trip": {"status":"active","paused":false,"expectedArrivalAt":"…|null"},
  "check": {"status":"asking","reason":"silence","askUntil":"…"} ,
  "incident": {"id":"…","trigger":"missed_check","checkReason":"silence","status":"active","createdAt":"…"},
  "deliveries": [{"role":"family","channel":"sms","status":"accepted","unavailableReason":null}],
  "location": {"freshness":"stale","ageMs":183000,"capturedAt":"…","accuracy":30} }
```

`check` is the open check, else null. `incident` is the **latest** incident on the trip (active or resolved), else null; this is how the driver UI learns a resolved incident's ID to label it. Part 1 does not return `label`; part 2 adds `incident.label` after both are merged. `location` follows the existing snapshot rules (map grant or driver; else omitted). `deliveries` never contains phone numbers or recipient IDs. The driver page polls this to show the large "Estoy bien" prompt while `check.status='asking'`.

### Settings

Environment variables, demo values in parentheses: `SILENCE_MS` (120000), `ASK_GRACE_MS` (60000), `ARRIVAL_GRACE_MS` (120000), `CHECK_SWEEP_MS` (5000), `EMERGENCY_NUMBERS`. These are demo values so the check fires on stage, not evidence-backed safety thresholds (#11 thresholds stay unset). The worker needs the same `channelSupport` configuration as the API.

### Tests (`tests/checks.test.mjs`, real PostgreSQL, fake clock)

Silence opens a check; `checkin_ok` closes it and does not reopen at once; unanswered check escalates once with family 3 jobs + colleague 2 jobs + group unavailable; arrival and pause cancel an open check; pause prevents new checks; SOS during `asking` closes the check with the SOS incident and creates one incident only; escalation with an existing active incident attaches instead of failing; `sharing stopped` opens a check immediately; sweeper restart mid-escalation creates no duplicate incident; one failing trip does not stop the sweep for others; status endpoint denies a revoked contact and hides phone numbers.

## Part 2 — Incident data (this session)

### Data (`db/migrations/004-insights.sql`)

- `incidents` gains `latitude, longitude, accuracy double precision NULL`, `located_at timestamptz NULL`, filled by a `BEFORE INSERT` trigger from `latest_locations` for the trip. This keeps part 2 independent of part 1 code.
- `incidents` gains `label text NULL CHECK (label IN ('robo','intento_robo','falsa_alarma','sin_senal','otro'))`, `labeled_at timestamptz`, `labeled_by uuid REFERENCES identities`.
- New table:

```sql
CREATE TABLE reports (
  id uuid PRIMARY KEY, reporter_id uuid NOT NULL REFERENCES identities,
  kind text NOT NULL CHECK (kind IN ('robo','intento_robo')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  synthetic boolean NOT NULL DEFAULT false
);
```

- View `security_events(kind, latitude, longitude, occurred_at, synthetic)`: incidents labelled `robo`/`intento_robo` with a location (`occurred_at = incidents.created_at`, the alert time; `located_at` may be older), `UNION ALL` reports. `falsa_alarma`, `sin_senal` and `otro` never enter it.

### Endpoints (`src/insights/routes.ts`)

Both mutations use `idempotent()` (Idempotency-Key header). Query parameters arrive as strings (`coerceTypes:false`), so declare them as string patterns and parse them. The incident lookup is copied into this file rather than exported from `src/incidents/routes.ts`, which part 1 rewrites.

- `POST /v1/incidents/:id/label` `{label}`: trip owner only; allowed while active or resolved; relabel overwrites and records `labeled_at/by`.
- `POST /v1/reports` `{kind, latitude, longitude, occurredAt}`: any authenticated identity; `occurredAt` not in the future and at most 365 days old. Reported while stopped (enforced in the UI only).
- After both parts merge: add `label` to `incident` in `GET /v1/trips/:id/status`.
- `GET /v1/insights/hotspots?days=90` (1–365). **Public** (added to the auth exemption in `src/api/app.ts`), aggregate only:
  - cell = `floor(lat / 0.05)`, `floor(lon / 0.05)` (~5.5 km), returned as the cell centre;
  - band = `noche` when the local hour in `INSIGHTS_TIME_ZONE` is 22–05, else `dia`;
  - rows `{lat, lon, band, robo, intentoRobo, total, synthetic}` (all counts of distinct people, not events, per Robert on 2026-10-17; `synthetic` = how many of `total` are demo people) only where `total >= INSIGHTS_MIN_COUNT` (3);
  - envelope `{generatedAt, days, cellDegrees, minCount, includesSynthetic, cells}`. No IDs, drivers, routes or timestamps per event.
- `GET /v1/insights/advice?lat=&lon=&locale=es|pt-BR`, authenticated: counts distinct people behind `security_events` in the 3×3 cells around the point, current band, last 90 days. If the count is at least the minimum it returns `{level:'caution', count, robo, intentoRobo, band, text}`, otherwise `{level:'none'}`. An attempt is not a robbery, so the text names the two apart and leaves out a kind with no events. Spanish text: `{count} personas reportaron robos o intentos de robo en esta zona de {noche|día} (últimos 90 días). Si puedes, detente en un lugar concurrido y seguro.` A Brazilian Portuguese version is included as well. The driver page shows it as a banner or voice prompt that needs no tap.

`ponytail:` the advice is a count rule, not a model; it becomes a model once real labelled data exists. Time bands use one configured zone (default `America/Lima`); per-event zones come later.

### Seed (`scripts/seed-demo.mjs`)

About 40 `synthetic=true` reports from a `seed/demo` identity, clustered along the Panamericana Sur south of Lima (Lurín, Chilca, Cañete), mostly at night. Any page that shows hotspots must say `incluye datos de demostración` when `includesSynthetic` is true.

### Tests (`tests/insights.test.mjs`, real PostgreSQL)

Cells below the minimum are suppressed; band boundaries at 21:59/22:00/05:59/06:00 local; `falsa_alarma`/`sin_senal` excluded; label is owner-only; advice turns to `caution` at the threshold; the trigger copies the latest location; the hotspot response contains no identifiers.

## Out of scope for the demo

Dead-zone map from `sin_senal` labels, route deviation/unexpected-stop triggers, driver display names, trained models, law-enforcement accounts, per-country time zones.

## Ownership and integration

- Backend agent: part 1 (migration 003, sweeper, fan-out extraction, wording, sharing and status endpoints).
- This session: part 2 on a branch from `codex/aws-durable-backend` (migration 004, insights routes, seed, tests). It touches shared files only to register `insightRoutes` and add the public-route exemption in `src/api/app.ts`.
- Sebastian: screens consume `GET /v1/trips/:id/status`, `GET /v1/insights/advice` and `GET /v1/insights/hotspots`.
