# Issue #33: Bound retries and reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound per-job technical retries, reconcile ambiguous attempts without replay, and expose exhausted or unknown delivery without authorizing obsolete work.

**Architecture:** Keep retry policy pure and persist its decisions on the existing job/attempt records. Reconciliation uses only verified provider capabilities; every new attempt re-enters #30’s short transactional authorization. Required channels are independent initial jobs, not a failure-triggered fallback chain.

**Tech Stack:** AWS ECS/Fargate, RDS PostgreSQL, SQS Standard (`emergency`/`ordinary` with separate DLQs); TypeScript/Fastify API and workers. Node.js 24 LTS, Fastify 5 and PostgreSQL 18 remain proposed versions to qualify/pin under #12; `pg`, `node:test`, `node:assert/strict`. No infrastructure or runtime is implemented by this plan revision.

**Spec:** Product: `docs/PLAN.md`, “Bound retries and reconciliation · #33”; contract baseline: `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Status and gates:** Proposed plan only; owner `Robertzu43`, original issue state `open`, original blockers `#32` unchanged. Planning/synthetic engineering readiness does not authorize provider activation, deployment, spending, participant contact or issue closure. User-selected execution: subagent-driven, one reviewed issue slice at a time after plan review.

**Additional handoffs:** #10/#31 freeze provider rate limits, idempotency and status-query operations; #11 supplies bounded policy/deadlines; #12 supplies worker/time bounds; #17 closure ordering, #27 deadline generation, #29 action state, #30 jobs/port, #31 routing and #32 receipts are inputs. Reuse #30’s outbox/SQS emergency and ordinary transport; no per-retry queue or independent source of truth.

**Confirmed retry scope:** All three individual SOS channels become eligible immediately. A slow or unknown WhatsApp attempt does not gate SMS/voice. ACK/read/answered-call does not cancel required sends; separate driver incident resolution or recipient revocation stops new affected authorization. Arrival only stops ordinary work/map access. Technical retries do not substitute for missing required channel support.

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

## Review Focus

1. Acceptance-timeout, no lookup and stale “not found” preserve unknown — Task 1 `unknown_is_not_retryable`.
2. Permanent rejection, throttle and persisted budget bounds stop storms — Task 1 `bounded_retry_decisions`.
3. Ambiguous channel does not suppress other required channels — Task 2 `required_channels_are_independent`.
4. Arrival, resolution and revocation have different retry effects — Task 2 `retry_authorization_scope`.
5. Restart, duplicate receipts and transport recovery preserve budget/attempt identity — Task 2 `recovery_preserves_unknown_and_budget`.

### Task 1: Decide bounded per-job retries from durable facts

**Files:** Create `src/notifications/retry-policy.ts`, `tests/issue-33.test.mjs`, `docs/contracts/retry-policy.md`. The contract records policy provenance, limits, channel/account evidence, authorization expiry and stop reasons; no unsupported numerical safety defaults.

**Interfaces:** Consume #30 `SendOutcome` and `NotificationJob`, common `Instant`. `authorizationEligible` means the relevant incident/source/grant remains valid, not merely “trip active”; the final decision still requires #30 transactional revalidation.

```ts
type RetryPolicy = {version:string;maxAttemptsPerJob:number;maxAttemptsPerIncident:number;
  backoffMs:number[];authorizeBefore:Instant;maxProviderCallsInFlight:number};
type RetryFacts = {now:Instant;authorizationEligible:boolean;attemptsForJob:number;
  attemptsForIncident:number;lastOutcome:SendOutcome|null;lastAttemptAt:Instant|null;
  ambiguousAttempt:boolean;reconciliation:'not_needed'|'pending'|'unknown'|'known';
  definitiveNonacceptance:boolean;workerQuiesced:boolean;providerNotBefore:Instant|null};
type RetryDecision = {kind:'wait';dueAt:Instant;reason:string} |
  {kind:'reconcile'|'retry'|'obsolete'|'exhausted'|'settled'|'intervention';reason:string};
decideRetry(policy:RetryPolicy,facts:RetryFacts):RetryDecision;
```

`authorizeBefore` is the deadline for new authorization, not a promise that an already authorized paused emitter cannot call later. V1 performs read-only reconciliation only, even if an upstream key exists. Replaying an ambiguous operation with that key is out of scope until a separately qualified immutable encrypted payload/recovery contract exists.

- [ ] **Step 1: Write failing tests** `unknown_is_not_retryable`, `not_found_without_quiescence`, `bounded_retry_decisions`, `authorization_deadline_boundary`, `accepted_is_settled`. Use explicitly synthetic max attempts `2`, backoff `[1000]` and cutoff `2026-10-17T12:00:30Z`; test zero/negative/nonfinite values and backoff overflow. Assert acceptance-timeout with pending query yields `reconcile`; permanently unavailable lookup yields `intervention`; “not found” with unquiesced sender cannot yield `retry`; even quiescence without definitive applicable nonacceptance is insufficient. A proven retryable rejection or definitive nonacceptance plus quiescence may retry within limits. Accepted is settled, permanent rejection/exhausted limits/cutoff are exhausted, irrelevant grants/incident are obsolete, and throttle produces the later bounded due time. No fixture may imply delivery failure merely from lookup absence or lease expiry.
- [ ] **Step 2: Run** `npm run build && node --test tests/issue-33.test.mjs`; expect missing export or assertion failures.
- [ ] **Step 3: Implement** `decideRetry`. Validate policy before use; preserve a reason for every decision. Distinguish known rejection from ambiguity. Ambiguity needs definitive applicable nonacceptance and old-emitter quiescence before another attempt; a provider's nonauthoritative “not found” is not enough. Prefer read-only lookup/callback recovery where possible; otherwise retain intervention/unknown. Honor persisted per-job and incident budgets, finite positive backoff and account throttle, never scheduling a new authorization at/after cutoff. Stop new affected work after cancellation/incident resolution/revocation while preserving earlier outcomes. Retry eligibility must never clear an attempt's unknown fact or imply useful action.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-33.test.mjs`; require deterministic boundary and uncertainty tests to pass; label all numeric fixtures synthetic.
- [ ] **Step 5: Commit** exact Task 1 files with message `feat: bound per-job retry authorization` during implementation.

### Task 2: Reconcile outside SQL and apply decisions transactionally

**Files:** Create `src/notifications/reconciliation.ts`, `db/migrations/issue-33-retry-decisions.sql`; modify `src/notifications/worker.ts`, `src/notifications/jobs.ts`, `src/notifications/health.ts`, `tests/issue-33.test.mjs`; create `docs/evidence/issue-33.md`. Integrator registers the control worker loop in `src/worker.ts`.

**Interfaces:** Consume #30 `ProviderPort.reconcile` (read-only), `runNotificationOnce`, job/outbox APIs; #31 eligibility, #32 immutable receipts, #17 `withTripTransaction<T>(ctx:AppContext,tripId:Id,work:(client:PoolClient)=>Promise<T>):Promise<T>`, and #27 `isDeadlineIntentCurrent(client,intent)` only for complete provenance.

```ts
reconcileNotification(ctx:AppContext,provider:ProviderPort,
  attemptId:Id,policy:RetryPolicy):Promise<Result<RetryDecision>>;
applyRetryDecision(client:PoolClient,job:NotificationJob,
  decision:RetryDecision,decisionKey:string):Promise<void>;
```

- [ ] **Step 1: Add failing tests** `retry_authorization_scope`, `recovery_preserves_unknown_and_budget`, `concurrent_reconciliation_once`, `account_throttle_is_shared`, `required_channels_are_independent`, `unknown_does_not_block_closure` and `redrive_is_not_permission_to_send`. Use real PostgreSQL and barriers to pause the original sender after authorization, redeliver/redrive to a second worker, close/revoke and resume: closure commits independently and only the original authorized attempt may invoke once later. For ordinary work arrival blocks future authorization; for open SOS arrival permits remaining channels with incident consent but withholds new map coordinates. Separate incident resolution and recipient revocation prevent new affected authorization. ACK cancels none. Unknown WhatsApp never blocks first SMS/voice attempts.

  Restart without resetting persisted attempt/incident budget; duplicate callbacks/reconcilers create one decision. Delete a transport message after durable reconciliation scheduling and prove the SQL scanner still recovers the attempt. Return “not found” while the original emitter is paused and assert zero new attempts; later authoritative rejection plus verified emitter quiescence permits a newly authorized attempt only within policy. Acceptance-timeout followed by verified acceptance settles without another send. Unknown remains visible when other channels exhaust; never label overall delivery definitively failed while any outcome is unknown.
- [ ] **Step 2: Run** `npm run build && node --test tests/issue-33.test.mjs`; expect new persistence/race failures. Missing disposable `TEST_DATABASE_URL` is an error.
- [ ] **Step 3: Implement** the signatures. Claim reconciliation work in a short SQL transaction, release the connection before provider lookup, then persist immutable evidence and idempotent decisions in a new transaction. Correlate only configured provider/account/attempt keys; callbacks can arrive before or during lookup and later weaker results must not regress them. Apply decisions under shared trip transaction after rechecking relevant state, consent, channel support and complete deadline provenance. Reserve persisted budget/account capacity atomically at authorization; retries never reset counts. Queue due retry references via the same transactional outbox/appropriate queue class, then use #30's authorization path. A stale scheduled decision is never a send permit.

  SQL scanner recovers abandoned reconciliation independently of SQS visibility/DLQ. A scanner or lease expiry does not prove worker quiescence. Runtime evidence must establish that the old emitter cannot still invoke; without it and definitive nonacceptance the job remains unresolved for intervention. Record inability only when all required outcomes are definitively exhausted/unavailable; preserve unknown alongside per-channel outcomes and keep action unknown unless #29 has attributed action evidence. Never block unrelated channels, map revocation or incident resolution waiting for an ambiguous attempt. Separate emergency capacity from ordinary load and account throttles; shared upstream account limits may still constrain all channels.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-33.test.mjs` and affected #17/#30 race tests. Record timeout, callback, redrive, restart, shutdown/quiescence and query traces. Official reconciliation/quiescence evidence remains blocked on #10/#12/#31; synthetic tests cannot qualify it.
- [ ] **Step 5: Commit** exact Task 2 files and approved worker registration with message `feat: reconcile without replaying ambiguous sends` during implementation.

**Original acceptance gate:** Keep acceptance-timeout, duplicate callback, queue restart, exhausted recipients and arrival-during-retry fault traces. Every attempt retains its reason and known/unknown outcome. ADR-002 revises the former physical-send guarantee to no new affected authorization after committed resolution, and explicitly tests earlier authorized work completing later. Official provider limits/read-only reconciliation evidence and justified #11 policy are required before activation or #33 closure. Unsupported recovery remains intervention, not an invented fallback or claim of certainty.

**Self-review:** Independent required channels replace the old fallback chain; there is no global fence or unresolved-closure dependency. Tests preserve budgets, authorization ordering and ambiguity through crashes and transport loss. Real provider/runtime recovery and production safety policy remain unvalidated.
