# Final incident recipient fix — 2026-10-17

Base: `412196e`, branch `codex/aws-durable-backend`.

## Finding and scope

Frozen alert summaries identified the trip, driver and creation time but omitted the incident UUID required by acknowledgement/action routes. Contacts also had no authenticated incident read route.

Changed only the shared dispatch summary, incident routes, two regression tests, runtime contract and backend implementation evidence. No schema, dependency, infrastructure, architecture image/SVG, provider adapter, group, audio or public link changes. Existing compatible standing-grant locks, sends-off read reconciliation and non-superuser bootstrap are preserved.

## Implementation

- SMS, WhatsApp and voice frozen summaries now include the exact `Incidente <UUID>;` label. Existing approved-template/text payload builders carry the same summary. Previously frozen payloads remain immutable.
- `GET /v1/incidents/:id` uses existing authentication/no-store middleware and command pool. It looks up the trip ID, takes the existing trip transaction lock, reads the current incident and checks owning driver or current accepted standing/trip incident consent. The shared consent predicate also serves acknowledgement/action routes. SQL/state only; no external I/O occurs in the transaction.
- The response exposes only `id`, `tripId`, `status`, `createdAt`, `resolvedAt`, and the existing `groupCapability: unavailable`. Arrival/map closure does not deny an otherwise consented incident read. No payload, phone, recipient list, coordinates or unrelated trip detail is returned.

## TDD evidence

Environment: Node `24.14.1`, npm `11.11.0`, disposable PostgreSQL 18; test connection sourced from local ignored `test-db.env` without printing its contents. Tests create unique schemas and use real PostgreSQL and signed JWTs. Only external provider/queue boundaries use synthetic fixtures; no live calls.

Focused command (after sourcing the local test DB environment):

```sh
npm run build && node --test --test-name-pattern='recipient discovers incident|incident reads and acknowledgements' tests/dispatch.test.mjs
```

RED: build exited 0; tests exited 1, 0 passed / 2 failed / 0 skipped. First failure: `recipient-facing summary must identify the exact incident` (missing explicit label in stored SMS payload). Second failure: incident read expected 200 but returned 404 (missing route). These were behavior failures, not setup errors.

GREEN: same command exited 0; 2 passed / 0 failed / 0 skipped. The recipient flow obtains its UUID from the immutable stored SMS provider payload using the explicit `Incidente` label, never the driver's SOS response. It checks the exact minimal read response, driver read, unrelated/unauthenticated denial, no-store, invalid/missing IDs, attributed acknowledgement/action, unchanged channel job states/versions, active SOS after arrival, denied map read, incident reads and acknowledgements after arrival, later WhatsApp/voice payloads with the same UUID and no coordinates, immutable earlier SMS payload, actual trip revocation denying new reads/ack/actions, and resolved driver metadata. A second regression independently checks standing revocation, trip revocation, missing accepted incident scope and missing acceptance; each denies read and acknowledgement while preserving driver access.

## Full verification

After GREEN, ran the following full command (with the local test DB environment sourced):

```sh
npm run typecheck && npm run build && npm test && npm run demo
```

Exit 0. Typecheck and standalone build passed. `npm test` rebuilt and passed **47 tests, 0 failed, 0 skipped** (reported duration 4399.730542 ms). This includes existing grant-lock/deadlock, sends-off read-only reconciliation, non-superuser bootstrap, infrastructure and provider-boundary regressions. Demo passed signed identity/confirmed trip, simulated fresh/stale clock, duplicate SOS, actual child-process exit/restart recovery, no resend of ambiguous authorization, and revocation. Demo is synthetic, not live provider/SQS/device evidence.

`git diff --check` passed. Architecture SVG XML parsing passed; SVG/PNG remain byte-for-byte unchanged from the base. No deployment, push, live provider/cloud calls, additional agent or independent reviewer was used for this fix.

## Remaining limits

Previously authorized payloads can still finish after closure/revocation as documented. No live provider/template qualification or AWS deployment was attempted. No frontend contact screen was added; this change supplies the authenticated backend contract only.
