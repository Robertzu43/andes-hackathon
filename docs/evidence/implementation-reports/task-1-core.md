# Task 1 implementation report

Implemented authorized local engineering slice in isolated worktree `/Users/robertozuniga/.codex/worktrees/d923/andes-hackathon`, starting at `1503b01`. No cloud/provider/participant operations or issue closure.

## Scope and contract

Added pinned npm/TypeScript strict ESM runtime, Fastify API, pg SQL context/migration, jose trusted OIDC, focused trips/contacts/location/incidents modules, signed synthetic JWT + disposable real-PostgreSQL helpers/tests, environment example and exact worker/API contract in `docs/contracts/runtime.md`.

Exports: createApp(options) with close lifecycle; createContext(databaseUrl,clock?), migrate(pool), transaction(pool,SQLOnlyCallback), withTripTransaction(ctx,tripId,SQLOnlyCallback,pool?); Actor/Trip/Job/Outbox/Channel types. Command pool max6 and telemetry max2; connection/statement timeouts bounded; no network in SQL callbacks and no global dispatch fence.

Schema uses owned truck composite FK, raw/partial drafts, explicit confirmation, accepted standing contact scopes with verified trusted phone, selected per-trip grants, latest + bounded location history, one active SOS per trip, one incident/unique contact/channel job, explicit unavailable group fact and atomic jobs/outbox. Closure/resolve/revoke cancel pending/claimed affected work but preserve earlier authorized work and independent emergency/trip states. Production OIDC config required, no enabled auth bypass, channel support absent by default. Audio unsupported, no automatic nonresponse/fatigue logic.

Standing revoke added because standing acceptance must not silently reactivate on a later trip. It locks grant then existing trips ordered by UUID; confirmation locks draft then grants ordered by UUID before inserting a new trip. Existing-trip authorization locks trip and reads grants without row-locking them. Task 2 must preserve that order and recheck standing + trip revocation, accepted incident scope and verified phone. Both standing and per-trip revoke endpoints exist. Standing re-enrollment is intentionally absent; revoked consent cannot be restored by driver.

## RED / GREEN evidence

1. Tests written before executable production runtime. `source .superpowers/sdd/2026-10-17-aws-backend-execution/test-db.env; npm test` initially produced **0 pass / 6 fail**, all failing the explicit `missing executable API foundation` assertion. This was an absent-runtime RED, not six separate feature-level failures against a runnable baseline. Log: `/tmp/andes-task1-red.log` (untracked local).
2. Implemented minimal focused runtime and SQL. First build found a Fastify request decoration type error; fixed by declaring the request property without an invalid null Actor initializer. Then `npm run build` and PostgreSQL `npm test` produced **6 pass / 0 fail**.
3. Added existing-behavior regression coverage for fail-closed channel defaults, incident-only consent, repeat migration, transaction rollback, independent incident resolution and preservation of prior authorized jobs. These additions were GREEN immediately; they are regression coverage, not claimed RED cycles.
4. Standing revoke test was written before that capability: suite **9 pass / 1 fail**, HTTP **404 != expected 200** for revoke in a concurrent confirm/revoke scenario. Log `/tmp/andes-task1-standing-red.log`. Added standing SQL revocation and serialization; suite **10 pass / 0 fail**.
5. Initial pinned Fastify 5.6.1 npm audit found a high-severity advisory set. Updated exact pin to 5.12.7; `npm audit --omit=dev` reported **0 vulnerabilities**. Its stricter unknown error typing exposed a compile error, fixed with guarded FastifyError handling. Enabled noEmitOnError and made npm test build first so stale JS cannot mask compile failure.

Final verification commands/results are recorded below after the final run.

## What tests demonstrate

Real signed synthetic JWT signature, issuer, audience, expiry checks; driver/truck ownership and extra owner-body rejection; contact-only acceptance, requested scope/verified phone binding; raw incomplete draft cannot activate, explicit corrected confirmation and canonical idempotent replay/conflict; capture/receipt/read separation, newer-only latest, stale status, bounded batches/history and revoke denial; SQL outbox-insertion failure rolls back every SOS incident/job; six concurrent distinct-key SOS taps create exactly one active episode with three independent individual jobs and explicit group missing; contact ack/action does not resolve; trip closure preserves emergency and cancels only ordinary pending/claimed work; driver resolution preserves active trip/map and prior authorized attempts; default unsupported channels never enqueue; repeat migration/SQL rollback; concurrent standing revoke/confirmation blocks all current/future sharing.

## Limits and follow-on contract

- No AWS/SQS/worker/provider implementation in Task 1; Task 2 owns durable leases, attempts, reconciliation and real transport/provider boundary. No live external messages, device tests or efficacy claims.
- Synthetic freshness (120s), capture bounds, 500-sample/upload-time pruning and 15-minute job expiry are engineering bounds, not qualified safety policy. Independent retention/deletion scheduler is not implemented. Operational qualification remains a release gate.
- Authentication proves a trusted issuer's account/phone claims, not physical driver identity or phone hardware capability. Contact onboarding requires the target's registered server identity and out-of-band sharing of invitation ID; no bearer share-link issuance.
- SQL callbacks are documented as SQL-only; TypeScript cannot prevent a future caller from adding external I/O. Worker review must enforce it.
- Existing consent can't be re-enrolled after standing revoke in this minimal slice. A future onboarding flow must require fresh contact acceptance, never driver restoration.

## Final Task 1 verification (2026-10-17)

- Local runtime: Node v24.14.1 / npm 11.11.0; real PostgreSQL 18, disposable unique schemas over dedicated loopback test database. Parent runs final Node26 compatibility/integration gate.
- `npm ci --ignore-scripts`: success, 66 packages installed from lockfile, zero vulnerabilities.
- `npm run typecheck`: success, no diagnostics.
- `npm run build`: success, strict TypeScript emitted executable ES modules.
- `source .superpowers/sdd/2026-10-17-aws-backend-execution/test-db.env; npm test`: **10 tests, 10 pass, 0 fail**, about 1.03s; npm test rebuilds first.
- `npm audit --omit=dev`: **found 0 vulnerabilities**.
- `git diff --check`: success.
- `env -u TEST_DATABASE_URL npm test`: expected exit 1, explicit `TEST_DATABASE_URL is required (use a disposable PostgreSQL database)` assertion, not skipped tests.

No deployment, external provider call, phone collection or participant contact was performed. The test DB env and local logs are ignored/uncommitted; report contains no test credentials.

## Independent review fix round 1

The reviewer found two important concurrency defects in the initial Task 1 commit; the earlier lock narrative above omitted implicit foreign-key locks and is superseded by this section and the corrected runtime contract.

1. Standing revoke held a grant `FOR UPDATE` then waited for its trip. Concurrent SOS held the trip and inserted a job referencing the grant; PostgreSQL implicitly requested grant `KEY SHARE`. These conflict, producing a deadlock. Added a real PostgreSQL trigger/advisory barrier that pauses SOS after taking its trip lock, observes standing revoke waiting for the trip, then releases SOS into the actual FK insert. RED: expected HTTP `[200,200]`, observed `[200,500]`. Changed acceptance, confirmation and standing revoke to grant `FOR NO KEY UPDATE`, compatible with implicit FK `KEY SHARE` while still serializing consent updates. Focused GREEN: 1/1 pass.
2. Confirmation sorted caller UUID spellings, so uppercase `BBBB...` could sort before lowercase `aaaa...`, reversing two request lock orders for the same SQL UUIDs. Added a real row-lock barrier holding grant B: mixed-case confirmation queues first, lowercase confirmation queues second, then release B. RED: expected `[200,200]`, observed `[200,500]`. Normalize selected UUIDs to lowercase before duplicate validation, lock sorting and grant insertion. Case-alias duplicates now return 400 instead of reaching the SQL primary-key conflict. Focused GREEN: 1/1 pass.

Both regressions were RED before production changes (`/tmp/andes-task1-review-red.log`); they use real SQL locks and observed pg_stat_activity wait conditions rather than arbitrary scheduling sleeps or mocked database outcomes. Exact focused command: `npm run build` then `node --test --test-name-pattern='foreign-key insert|mixed-case grant' tests/core.test.mjs` with the isolated TEST_DATABASE_URL loaded. Corrected runtime docs explicitly explain implicit FK locks and the required compatible lock mode; no longer claim no trip-to-grant lock edge.

Fix-round final verification: `npm run typecheck` PASS; `npm run build` PASS; both focused SQL barrier regressions **2/2 PASS**; full `npm test` **12/12 PASS**, no skips/failures (about 1.03s); `git diff --check` PASS. No runtime dependency or schema migration changed in this fix. No push or unrelated plan/Zavu research staging.
