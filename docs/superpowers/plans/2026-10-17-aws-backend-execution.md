# AWS Durable Backend Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Robert explicitly authorized implementation; execute and review the following engineering tasks without another architecture-selection prompt.

**Goal:** Implement the runnable ADR-002 backend and reproducible AWS infrastructure, with real PostgreSQL fault/race tests and truthful integration boundaries.
**Architecture:** One modular TypeScript codebase; SQL is authority; outbox relays job IDs to SQS; independent channel authorization precedes provider I/O. ECS API/control/emergency/ordinary roles share an image.
**Tech Stack:** Node 24 target (local Node 26 must also pass), TypeScript strict/ESM, Fastify, pg, jose for verified OIDC, AWS SDK v3 SQS, native node:test. Plain CloudFormation avoids another runtime/tooling framework. Pin dependency versions and lockfile.
**Spec:** docs/architecture/ADR-002-aws-durable-dispatch.md.

## Global Constraints

- No external I/O holds a SQL transaction/client. No global dispatch fence.
- Stop/revoke prevents future affected authorization; previously authorized external work may complete later.
- Arrival does not resolve security SOS; individual SMS, WhatsApp and voice jobs are independent. No-response automatic escalation remains disabled without evidence-approved policy.
- SQL, real PostgreSQL races and durable recovery are required; test doubles apply only to external services. No fake provider delivery/capability claims.
- Authenticate every driver/contact operation. Ownership and accepted consent are checked server-side. No publicly enabled demo-auth bypass, secrets in logs or queue payloads with personal information.
- No deploy, paid resources, participant contact, real Zavu sends, issue closure or claimed device capability in this execution. These require actual access/evidence beyond the authorized code implementation.
- Preserve original issue ownership/blockers. Current explicit implementation authorization permits engineering code/tests; it does not waive original field-evidence or release acceptance.

## Review Focus

1. Duplicate requests and unknown commit/send outcomes: preserve IDs and uncertainty.
2. Revocation/arrival races with authorizations and stale location uploads: authorization-first vs stop-first.
3. Restart after outbox publish or provider acceptance: no lost durable work and no blind send replay.
4. Provider stall: other channels, reads and closure progress without pool starvation.
5. Infrastructure/operator mistakes: private DB, bounded pools/roles, TLS, retained state, disabled unqualified integrations.

### Task 1: Transactional trip, consent, location and SOS API

**Files:** package.json/lock, tsconfig.json, src/contracts.ts, src/db.ts, src/auth.ts, src/api/app.ts, src/server.ts, src/trips/*, src/contacts/*, src/location/*, src/incidents/*, db/migrations/001-core.sql, scripts/migrate.*, tests/helpers/*, tests/core.test.mjs, .env.example, .gitignore. Keep units focused; no giant single-file service.
**Interfaces:** Export createApp(options) Fastify factory and close lifecycle, createContext(databaseUrl,clock) with bounded pg pools, migrate(pool), withTripTransaction(ctx,tripId,SQL-only callback). Public routes: /health; authenticated truck/contact setup; POST /v1/trip-drafts and /:id/confirm; GET /v1/trips/:id; POST /v1/trips/:id/commands; POST /v1/trips/:id/locations; contact snapshot/revoke routes; POST /v1/trips/:id/sos; incident acknowledgement/action/driver-resolution routes. Export SQL models and persisted job/outbox schema for Task 2; write docs/contracts/runtime.md with exact implemented seams.

OIDC uses jose signature/issuer/audience/expiry verification with configured trusted JWKS; startup fails without production auth config. Tests use real signed synthetic JWTs/injected test key resolver, never an enabled production bypass. Auth subject maps to a server identity; body owner IDs cannot authorize. Contacts must accept under their own authenticated identity; phone destination must match a verified phone claim before real-send eligibility. Driver cannot accept on behalf of contact. Tokens/scopes for maps must be hashed and bounded, or authenticated contact read with direct accepted-grant lookup; choose authenticated contact reads for first implementation (no bearer share-link issuance until its secure onboarding is integrated).

Drafts preserve voice/text-derived untrusted input without activation; structured corrected fields and explicit confirmation required. This slice accepts text and corrected structured fields; audio transcription provider is unselected and must return an explicit unsupported capability, not fabricated transcript. Persist missing-field drafts and reject incomplete confirmation. No company/fleet dependency. Track country/locale/time zone without Peru default.

Implement idempotent mutations, driver/truck scope, explicit accepted map/incident consent, latest observation/freshness and bounded upload/history. Trip close atomically stops map/checkins/ordinary work while retaining SOS. SOS transaction creates one active incident per trip, one job per accepted unique recipient/channel and outbox entries (or explicit unavailable-channel facts under configured support); repeat taps/keys cannot duplicate. Real send enablement stays off pending qualified support; synthetic tests configure channels explicitly. Persist group capability missing, never replace it with individual messages. Basic check-in responses/pause states may be recorded, but never infer fatigue or enable automatic nonresponse escalation.

- [ ] Write tests first and record RED for ownership, contact acceptance, confirmation idempotency, location freshness/revoke, SOS rollback/duplicate active episode and independent trip/incident closure.
- [ ] Implement the smallest complete SQL/API path with boundary validation, parameterized SQL and transaction errors that roll back; migrations repeat safely.
- [ ] Run typecheck/build and node tests against disposable real PostgreSQL schemas; fail clearly if TEST_DATABASE_URL missing. Capture commands/results in Task 1 report. Commit only implemented scope.

### Task 2: Durable transport, independent attempts and verified provider boundary

**Files:** src/notifications/*, src/worker.ts, db/migrations/002-dispatch.sql if needed, tests/dispatch.test.mjs, tests/provider.test.mjs, tests/helpers/*, package scripts/dependencies, runtime contract. Integrate callback route in API through controller-approved shared edit.
**Interfaces:** Consume exact Task 1 schema/context/jobs/consent checks. Produce relayOnce, recoverWork, claim/authorize/run job, reconcile, bounded role loops and SQS transport adapter. Only IDs/version in queues; SQL owns due times/currentness. Emergency and ordinary roles with per-channel independent bounded concurrency and persisted quota/budget checks. SQL clients released before network. Unknown attempts reconcile read-only; never reset by lease/queue redelivery. New attempt only justified definitive rejection/nonacceptance and emitter quiescence, fresh authorization and budget.

Use official Zavu contract supplied in research report to implement optional disabled-by-default adapter and authenticated raw-body callback parsing. If an operation cannot be verified, fail closed for that operation and name capability missing. No generic invented endpoints/signatures. Disable send HTTP retries, classify network/5xx ambiguity conservatively, distinguish provider acceptance/delivery from contact action. Require explicit verified country/channel/locale manifest and live-send configuration. Synthetic transport/provider remain test-only, not startup defaults.

- [ ] Write failing tests for rollback/publish-ack loss, duplicate SQS, stale lease, authorize-first/stop-first, paused WhatsApp with independent SMS/voice/read/close, acceptance timeout, callback-before-response, scanner recovery and no blind DLQ replay.
- [ ] Implement and wire runtime control/emergency/ordinary commands, abortable shutdown and safe error handling. Scanner repairs SQL-tracked work if transport expires; no tight republish loop.
- [ ] Run focused tests then full suite/typecheck/build with real PostgreSQL. Commit and report tests, provider-source limits and runtime configuration.

### Task 3: Reproducible AWS deployment artifacts and local operation

**Files:** infra/template.yaml or .json, infra/README.md, Dockerfile, .dockerignore, compose.yaml, .github/workflows/ci.yml, tests/infra.test.mjs, scripts/demo.*, README.md, docs/evidence/backend-implementation.md.
**Interfaces:** Consume actual API/worker entrypoints and environment from Tasks 1–2. CloudFormation accepts explicit account-specific image URI, HTTPS certificate, OIDC settings, qualified provider secret/manifest inputs. ECS private tasks and RDS; public ALB HTTPS, HTTP redirect, health checks; no public database. Fargate roles API/control/emergency/ordinary, least privilege secrets/SQS access, distinct queues+DLQs, RDS encrypted Multi-AZ, bounded pools, logs/alarms, retained state/backups, audio S3 private encrypted lifecycle, and outputs. Two AZ target; cost-reduced demo must explicitly identify reduced availability. Do not create live resources. DB migration is a documented one-off task, never race-run at every app start. Protect credentials from template/env example/log output.

- [ ] Add meaningful infrastructure assertions for exposure, TLS, state retention, IAM queue isolation and actual process/environment wiring; validate CloudFormation schema with cfn-lint.
- [ ] Implement Docker and compose using pinned major runtime/DB; local PostgreSQL and external transport instructions are explicit. CI runs typecheck/build, actual database tests and infrastructure checks without credentials/live messages.
- [ ] After reviewing actual infrastructure wiring, create a readable architecture diagram image plus editable source, showing operating flow and explicit deployment/provider evidence limits; commit and push as requested by Robert.
- [ ] Add runnable local demonstration of confirmed trip, fresh/stale/revoked location, duplicate SOS and restart recovery using synthetic recipients/provider clearly labelled; no live send by default. Document commands, operational failures, secrets, costs, rollback and outstanding voice/mobile/provider evidence. Run full suite and demo. Commit report.

### Task 4: Final integration and independent whole-branch review

**Files:** Only fixes identified in integration/review; final evidence/report.
- [ ] Run complete local verification on final tree: install reproducibility, typecheck/build, PostgreSQL suite, infrastructure checks and demo.
- [ ] Fresh reviewer checks cross-task authorization, shutdown/recovery, secret logging, migration/startup and infrastructure wiring; fix important findings with tests and scoped re-review.
- [ ] Record engineering results separately from unverified AWS/device/provider operations. Leave issues open and branch/worktree reviewable; push each reviewed block to codex/aws-durable-backend under Robert’s subsequent explicit instruction. No deployment or merge.
