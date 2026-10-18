# Issue #30: Prove durable notification jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist notification work atomically and execute it in a restartable worker without confirming ambiguous or obsolete sends.

**Architecture:** Persist incidents/jobs/publication intents atomically in PostgreSQL; relay job IDs/versions to separate emergency/ordinary SQS Standard queues. Consumers authorize each job in a short transaction and release SQL before one provider invocation. Synthetic ports qualify internal crash behavior while real integration remains gated by #10/#31.

**Tech Stack:** AWS ECS/Fargate, RDS PostgreSQL, SQS Standard (`emergency`/`ordinary` with separate DLQs); TypeScript/Fastify API and workers. Node.js 24 LTS, Fastify 5 and PostgreSQL 18 remain proposed versions to qualify/pin under #12; `pg`, `node:test`, `node:assert/strict`. No infrastructure or runtime is implemented by this plan revision.

**Spec:** Product: `docs/PLAN.md`, “Prove durable notification jobs · #30”; contract baseline: `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Status and gates:** Proposed plan only; owner `Robertzu43`, original issue state `open`, original blockers `#29` unchanged. Planning/synthetic engineering readiness does not authorize provider activation, deployment, spending, participant contact or issue closure. User-selected execution: subagent-driven, one reviewed issue slice at a time after plan review.

**Additional handoffs:** #12 supplies AWS runtime, reserved pools/concurrency and restart/timeout bounds; #14 provides transactions/test context; #16 owns initial outbox; #17 owns `withTripTransaction`; #27 owns deadlines and generation, including `isDeadlineIntentCurrent(client:PoolClient,intent:OutboxIntent):Promise<boolean>` from `src/checkins/deadlines.ts`. #29 owns incident/source facts; #29/#31 create SOS jobs through this API in the original authenticated command transaction; ordinary intent consumers use the same enqueue path. #33 adds bounded technical retries and read-only reconciliation; this issue’s synthetic port already exercises reconciliation outcomes. Downstream integrations trigger regression checks, not new original blockers. The integrator owns package script/route/migration registration.

**Authoritative decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) replaces earlier provider-call session locks, global dispatch fences and promises of no physical send after closure. This plan is a design, not executed tests or runtime readiness.

## Global Constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- A relevant committed closure/revocation/resolution stops new affected attempt authorizations. A previously authorized attempt may start or finish later; preserve it as in flight/unknown until reconciled. No provider I/O holds a SQL connection or transaction.
- Arrival/cancellation stops map publication and ordinary work; it does not resolve an open SOS. Incident resolution is a separate authenticated driver action. ACK/read/answered-call does not cancel other required channels.
- Explicit SOS makes WhatsApp, SMS and voice independently eligible immediately for each deduplicated opted-in individual recipient. Unsupported cells are explicit missing capabilities; group membership grants no individual SMS/voice consent.
- PostgreSQL is authoritative; transactional outbox publishes only IDs/versions to SQS Standard emergency/ordinary queues. Redelivery, DLQ redrive and expired leases never authorize a blind replay of an ambiguous attempt.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.
- Trip mutation, revision, audit event and required outbox intent commit on the same PostgreSQL client/transaction.
- Do not promise exactly-once provider delivery.

**Deadline provenance rule:** Invoke #27 `isDeadlineIntentCurrent` only for deadline-derived work with both deadlineId and generation present. Partial/malformed provenance is rejected. Explicit-help/fatigue intents and their notification jobs have neither field; validate their authenticated source, current trip/incident and recipient consent directly, without waiting for or requiring an expired check-in. Add an unsolicited-help-before-any-expiry test that reaches the eligible notification path.

## Review Focus

1. Commit/rollback and lost SQS publish acknowledgement — Task 1 `outbox_transport_duplicates`.
2. Redelivery or stale claims cannot authorize two attempts — Task 2 `authorization_is_exclusive`.
3. Paused WhatsApp leaves SMS/voice, map, revocation and another trip progressing — Task 2 `channels_progress_independently`.
4. Closure-first blocks affected authorization; authorization-first can send later — Task 2 `authorization_closure_ordering`.
5. Crash after authorization/acceptance and DLQ redrive preserve ambiguity — Task 2 `unknown_is_not_replayed`.

### Task 1: Persist jobs and publish recoverable transport references

**Files:** Create `src/notifications/port.ts`, `src/notifications/jobs.ts`, `src/notifications/relay.ts`, `db/migrations/issue-30-notification-jobs.sql`, `tests/issue-30.test.mjs`. Extend #16 outbox only where necessary. Integrator owns migration/worker registration.

**Interfaces:** Common `Id`, `Instant`, `Locale`, `Result`, `AppContext`; #16 `OutboxIntent` and #17 `withTripTransaction<T>(ctx:AppContext,tripId:Id,work:(client:PoolClient)=>Promise<T>):Promise<T>`. The latter owns BEGIN/COMMIT/ROLLBACK, stable-order transaction-scoped locks and connection release; callback performs SQL only. Errors map at the caller boundary.

```ts
type Channel = 'whatsapp' | 'sms' | 'voice';
type QueueClass = 'emergency' | 'ordinary';
type NotificationJob = {id:Id;version:number;intentId:Id;tripId:Id;incidentId:Id;
  stage:string;recipientId:Id;channel:Channel;queueClass:QueueClass;
  policyVersion:string;dueAt:Instant;authorizeBefore:Instant|null;
  deadlineId:Id|null;generation:number|null};
type JobReference = {jobId:Id;jobVersion:number};
type JobInput = Omit<NotificationJob,'id'|'version'|'intentId'>;
enqueueNotificationJobs(client:PoolClient,intentId:Id,jobs:JobInput[]):Promise<NotificationJob[]>;
type QueuePublisher = {publish(queueClass:QueueClass,reference:JobReference):Promise<void>};
relayNotificationOutboxOnce(ctx:AppContext,publisher:QueuePublisher,
  workerId:Id,leaseMs:number):Promise<'idle'|'published'|'pending'>;
recoverNotificationPublications(ctx:AppContext,limit:number):Promise<number>;
```

- [ ] **Step 1: Add failing tests** `sos_transaction_boundaries`, `outbox_transport_duplicates`, `duplicate_job_key`, `publication_recovery`. Assert rollback leaves zero incidents/jobs/publications; SOS commit leaves one active episode and one job per qualified recipient/channel plus publication intents. Duplicate source requests return the original IDs; changed-content idempotency keys conflict. Lost publish response causes another identical ID/version publication, not a new provider attempt. No destination, message body, audio, token or coordinates enter SQS. A committed publication that never progresses is recovered from SQL without creating another logical job.
- [ ] **Step 2: Run** `npm run build && node --test tests/issue-30.test.mjs`; expect missing exports/assertions. Missing disposable `TEST_DATABASE_URL` is a setup failure. Use deterministic local transport fixtures; these are not AWS operational evidence.
- [ ] **Step 3: Implement** the interfaces. Enqueue in the caller's incident transaction with semantic uniqueness `(incident_id,stage,recipient_id,channel,policy_version)`; `intentId` records provenance but distinct report IDs for one active SOS do not duplicate its jobs. Store immutable job-content hashes; retries add attempts to the same job. Relay claims outbox with a short lease, commits/releases SQL, publishes IDs/versions, then marks acceptance in a new short transaction. Reuse the same reference after unknown publish outcome. Scanner repairs missing/stalled publication from DB truth; it must not reset attempt state. Emergency and ordinary queues/DLQs are configured separately by #12, using one protocol. SQS deduplication is never a correctness assumption.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-30.test.mjs` again; require atomicity, duplicates and recovery tests to pass. Record the synthetic transport boundary in `docs/evidence/issue-30.md`.
- [ ] **Step 5: Commit** only Task 1 files and approved registration with message `feat: persist jobs and relay durable references` during a separately authorized implementation.

### Task 2: Authorize once per job and send without a database connection

**Files:** Create `src/notifications/worker.ts`, `src/notifications/health.ts`; modify `src/notifications/port.ts`, `src/notifications/jobs.ts`, `tests/issue-30.test.mjs`, `docs/evidence/issue-30.md`. Integrator wires `src/worker.ts` role commands for control, emergency consumer and ordinary consumer; #12 owns Fargate supervision and actual SQS adapter configuration.

```ts
type PreparedDispatch = {attemptId:Id;channel:Channel;destination:string;locale:Locale;
  templateKey:string;fields:Record<string,string>;upstreamKey:string|null};
type SendOutcome = {state:'accepted';providerId:string} |
  {state:'rejected';code:string;permanent:boolean;retryAfterMs:number|null} |
  {state:'unknown';providerId:string|null;reason:string};
type ReconcileOutcome = {state:'known';outcome:SendOutcome} | {state:'unknown'};
type ProviderPort = {send(request:PreparedDispatch):Promise<SendOutcome>;
  reconcile(input:{attemptId:Id;providerId:string|null;upstreamKey:string|null}):Promise<ReconcileOutcome>};
type PrepareDispatch = (client:PoolClient,job:NotificationJob,
  attemptId:Id)=>Promise<Result<PreparedDispatch>>;
type ClaimedJob = {job:NotificationJob;claimToken:Id;workerId:Id;leaseUntil:Instant};
claimNotificationJob(ctx:AppContext,reference:JobReference,
  workerId:Id,leaseMs:number):Promise<ClaimedJob|null>;
type Authorization = {kind:'authorized';attemptId:Id;claimToken:Id;request:PreparedDispatch} |
  {kind:'obsolete'|'reconcile'|'busy';reason:string};
authorizeNotificationAttempt(ctx:AppContext,claim:ClaimedJob,
  prepare:PrepareDispatch):Promise<Authorization>;
type AttemptOutcome = SendOutcome | {state:'not_sent';reason:string};
recordSendOutcome(ctx:AppContext,attemptId:Id,claimToken:Id,outcome:AttemptOutcome):Promise<void>;
runNotificationOnce(ctx:AppContext,provider:ProviderPort,prepare:PrepareDispatch,
  reference:JobReference,workerId:Id,bounds:{claimLeaseMs:number;providerTimeoutMs:number})
  :Promise<'obsolete'|'busy'|'accepted'|'rejected'|'unknown'|'reconcile'>;
notificationHealth(ctx:AppContext):Promise<{pending:number;oldestDueAt:Instant|null;
  ambiguous:number;expiredLeases:number;overdueDeadlines:number}>;
```

`ProviderPort.reconcile` is read-only status lookup; it never calls send. V1 does not replay an ambiguous operation with the same upstream key. A future replay feature needs a separately qualified immutable encrypted payload/recovery contract. `PrepareDispatch` performs SQL/local formatting only; #31 supplies the qualified implementation. Group transport is a separate gated #34 job/adapter contract, not an individual-channel value.

- [ ] **Step 1: Add failing tests** `authorization_is_exclusive`, `channels_progress_independently`, `authorization_closure_ordering`, `unknown_is_not_replayed`, `callback_before_http_result`, `stale_claim_cannot_authorize` and `shutdown_preserves_work`. Use real PostgreSQL and explicit barriers; no timing sleeps. Assert exactly one authorized attempt and one invocation for concurrent deliveries of a job. Pause WhatsApp after authorization and assert SMS/voice, another trip, map and contact revocation progress with no connection retained by WhatsApp. Revoke/resolve first: affected future authorization is obsolete and zero calls occur. Authorize first, then revoke/resolve, then release sender: the call may occur after closure and the UI retains in-flight/unknown status. Trip arrival leaves an open SOS eligible with separate incident consent and no newly read map coordinates; ordinary jobs become obsolete. ACK cancels zero required channel jobs.

  Crash before authorization allows reclaim with a new token; the old token cannot authorize. Crash after authorization, lost DB connection, acceptance-timeout and DLQ redrive leave the attempt unknown and ensure durable reconciliation with zero automatic replay. A verified callback before HTTP completion survives a late unknown/accepted HTTP result without delivery regression. Shutdown stops new claims and preserves unfinished ambiguity; leases never prove the old sender cannot call.
- [ ] **Step 2: Run** `npm run build && node --test tests/issue-30.test.mjs`; expect new race/lifecycle assertions to fail.
- [ ] **Step 3: Implement** the interfaces. Claim only the referenced current job/version. In `withTripTransaction`, lock trip/grants/job in stable order, compare worker/token/lease, current source/incident, consent/channel eligibility, cancellation, due/expiry and persisted budgets; check #27 currentness only for complete deadline provenance. Create one durable `authorized` attempt, snapshot minimum permitted payload, persist its hash and provider-key correlation, then commit/release SQL. Only that winning consumer invokes send once, with hidden SDK/HTTP retries disabled. An affirmative local decision with proof no call occurred may record `not_sent`; a crash after authorization is conservatively `unknown`. Record accepted/rejected/unknown afterward in a separate transaction, preserving more informative verified receipts. Never maintain a global trip fence or block closure on a paused/unknown sender.

  Redelivery that finds authorized/unknown work ensures durable reconciliation before deleting the SQS message; SQL scanner recovers it if transport disappears. Deleting/visibility-expiring a transport message neither settles nor reauthorizes the attempt. Emergency/ordinary services have separate concurrency, with per-channel slots and bounded DB pools; shared account quota is still a possible cross-channel limit. A new attempt after ambiguity requires definitive applicable nonacceptance plus old-emitter quiescence and fresh authorization (#33). Unknown outcomes must not be converted to pending by lease expiry, SQS redrive or timeout.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-30.test.mjs`, then affected #17/#29 integration tests. Record restart/crash traces, SQL connection release and per-channel progress. Actual AWS delivery, IAM, DLQ, restart and capacity tests remain #12 evidence, not implied by synthetic success.
- [ ] **Step 5: Commit** exact Task 2 files and integrator-approved registration with message `feat: authorize independent notification attempts` during implementation.

**Original acceptance gate:** Work survives worker loss, obsolete authorizations stop, and ambiguity remains observable/reconciled. Require actual runtime restart/supervisor traces from #12 and provider acceptance/ambiguity traces using a separately authorized #10-approved adapter with frozen official operations. Synthetic tests alone do not close #30. Later #31–33 integration checks are regressions, not additional original blockers. If the approved adapter cannot supply original traces before #31, record the evidence/order conflict and leave #30 open. Health exposes stuck deadlines and jobs; no exactly-once or operational-readiness claim.

**Self-review:** The previous serialized send/fence protocol is retired. Tests cover commit/publication gaps, authorization ordering, per-channel independence, ambiguous crash recovery and callback ordering. Real AWS/provider qualification and measured capacity remain outstanding.
