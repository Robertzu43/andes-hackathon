# Issue #17: Prove pause and arrival rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rest, extension, arrival and cancellation authoritative; stop future affected authorizations while preserving previously authorized attempts and independent security incidents.

**Architecture:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects ECS/Fargate + RDS PostgreSQL + transactional outbox/SQS. A short transaction serializes lifecycle, grants, deadlines and attempt authorization. It releases SQL before external I/O. Arrival/cancellation stops live sharing and ordinary check-ins; an active security SOS continues under its independent consent until explicit incident resolution.

**Tech Stack:** TypeScript/Fastify, `pg`, PostgreSQL and Node test runner on the chosen AWS target; actual versions, deployment access and capacity still require #12 evidence. This update implements and deploys nothing.

**Spec:** [Product requirements](../../PLAN.md), [shared contracts and constraints](../specs/2026-10-17-robert-backend-contracts.md), [ownership](../../OWNERSHIP.md), and [original blockers](../../plan.json).

**Status:** Proposed/gated; planning only. Owner `Robertzu43`; original issue remains open. Original blockers: #16. Additional handoffs: #12 SQL coordination/timeout contract and outstanding final acceptance; #13/#22/#35 authoritative UI states; #27/#30 real-worker race reruns; #21 live-map HTTP polling integration. Source/test paths below are future files, not an assertion that runtime code exists.

## Global Constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- No forced visual/manual response while moving; audio is not presumed safe.
- Recheck current trip and sharing grants during every location read/update authorization; a response authorized before revocation may arrive afterward.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

- No new affected attempt authorization after committed closure/revocation/resolution; a previously authorized attempt may start or finish externally afterward. Closure does not wait for a slow/unknown provider.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.

## Review Focus

1. Arrival competes with ordinary attempt authorization; prior authorization may send later — Task 1 `arrival_authorization_order`.
2. Provider acceptance followed by crash/timeout is recorded as ambiguous, never recalled — Task 1 `ambiguous_attempt`.
3. Repeated/offline closure and restart resolve to one authoritative revision — Task 2 `closure_retry`.
4. Expired rest never asserts sleep/recovery or silently adds sharing recipients — Task 2 `expired_rest`.
5. New map reads and delayed uploads are denied after closure; in-flight authorized responses may arrive later — Task 2 `closed_map`.

---

## Execution gate and protocol

ADR-002 settles the design; #12 still must record concrete SQL lock timeout/pool bounds and final evidence before execution. The shared helper owns one short transaction and uses `pg_advisory_xact_lock(hashtextextended(tripId,0))`, with a transaction-local bounded `lock_timeout`. Hash collisions only serialize SQL decisions for unrelated trips. Commit/rollback releases coordination; return the client to its pool before any HTTP/SQS/provider call. Lost SQL connections are discarded, and an unconfirmed commit is not reported as successful. No global dispatch fence or provider connection is retained. #30 owns per-job attempts and #33 owns ambiguity reconciliation, independently of whether a trip can close.

### Task 1: Shared SQL authorization coordination and atomic trip closure

**Files:** Create `src/trips/coordination.ts`, `src/trips/lifecycle.ts`, `db/migrations/issue-17-lifecycle.sql`, `tests/issue-17.test.mjs`; modify `src/contacts/consent.ts` and `src/api/app.ts` through integrator.

**Interfaces:** Consume #14 `inTransaction`, #16 `Trip` and persisted deadlines/outbox/grants, plus baseline types. Define:

```ts
 // src/trips/coordination.ts: owns one short SQL-only transaction
 withTripTransaction<T>(ctx:AppContext,tripId:Id,work:(client:import('pg').PoolClient)=>Promise<T>):Promise<T>;
 // src/trips/lifecycle.ts
 type TripCommand = {kind:'arrive'|'cancel'}|{kind:'rest';until:Instant;tiredness:string|null}|{kind:'extend';until:Instant}|{kind:'resume';until:Instant};
 type LifecyclePolicy = {maxExtensionMs:number;maxRestMs:number};
 type CommandInput = {tripId:Id;expectedRevision:number;command:TripCommand};
 applyTripCommand(ctx:AppContext,actor:Actor,input:CommandInput,policy:LifecyclePolicy,key:string):Promise<Result<Trip>>;
```

Tests define local `lifecycleFixture(ctx)` returning two actors, a registered trip, pending deadline/outbox and accepted map/incident grants. Use barriers and separate PostgreSQL clients to force transaction order, not sleeps. A synthetic authorization log models only the #30 boundary until its actual attempt rows exist; this issue creates no dispatch-fence column. #27/#30 later rerun the tests with their workers; these acceptance handoffs do not alter original blockers.

- [ ] **Step 1: Write failing tests** `arrival_authorization_order`, `ambiguous_attempt`, rollback and cross-owner command. Stop-first denies an ordinary authorization; authorize-first commits a synthetic attempt, releases SQL, pauses the provider call, closes the trip successfully, then permits the prior call. Force the same ordering for contact revocation and explicit incident resolution. A slow/unknown attempt cannot block closure, grant revocation, map reads, another channel or another trip. Assert:

```js
assert.equal((await applyTripCommand(ctx,B,arrival,policy,'foreign')).code,'not_found');
assert.equal((await applyTripCommand(ctx,A,arrival,policy,'close')).value.state,'resolved');
assert.deepEqual(ordinaryAuthorizationsAfterClosure,[]);
assert.equal(priorAuthorizedCallStartedAfterClosure,true);
assert.equal(ambiguousAttempt.status,'unknown');
assert.equal(activeSecurityIncident.phase,'action_pending');
assert.equal(Number((await ctx.db.query("select count(*) from outbox where kind='trip.resolved' and state='pending'")).rows[0].count),1);
```

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-17.test.mjs`; expect missing coordination/lifecycle failures; require database configuration rather than skip races.
- [ ] **Step 3: Implement** the short transaction helper and arrival/cancel transitions. Recheck actor/revision/current state, set `Trip.state` to `resolved`/`cancelled`, increment revision, cancel check-in deadlines and ordinary work not yet authorized, revoke `live_map` grants and append event/`trip.resolved` intent once in the same transaction. Here `resolved` describes the trip, never an implicit SOS resolution. Keep independent incident consent and active security incidents intact. Preserve prior attempts as authorized/accepted/rejected/unknown for reconciliation; never label them all cancelled. Return truthful pending-attempt state through the incident/notification read model when available.
- [ ] Integrate #16 `revokeContact` with the same transaction-scoped coordination: take affected trip locks in sorted ID order within one short transaction before consent/grant/work writes. Recheck the affected trip set and serialize concurrent grant creation on the same contact-consent row, so a new grant cannot escape revocation. Revoke that contact's grants and cancel its not-yet-authorized work independently of Zavu; do not wait for the provider. Use the same lock order in grant creation. #29's explicit authenticated-driver incident resolution is a separate command; neither contact receipt nor arrival invokes it. Roll back all related writes together; API callers map transaction errors to `Result`.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-17.test.mjs`; require both forced transaction orders, independent closure during a paused provider call, preserved SOS, rollback and lost-connection uncertainty. Require database configuration rather than silently skipping races.
- [ ] **Step 5: Commit** only Task 1 implementation files with `git commit -m "feat: serialize trip closure with attempt authorization"` when implementation is performed.

### Task 2: Bounded rest/extension, replay and map termination

**Files:** Modify `src/trips/lifecycle.ts`, `src/api/app.ts`, `tests/issue-17.test.mjs`; create `docs/evidence/issue-17.md`.

**Interfaces:** Reuse `applyTripCommand` and #16 `readTrip`. `POST /v1/trips/:id/commands` takes `{expectedRevision,command}`, authenticated driver and `Idempotency-Key`, returns `Trip`. #21 `ingestLocations`/`readCurrentLocation` consume final trip state and grant revocation; #22 contact view polls its existing route rather than opening a persistent subscription.

- [ ] **Step 1: Write failing tests** `closure_retry`, `expired_rest`, `closed_map`, offline delayed command, extension bounds and contact acknowledgement. Synthetic policy values are explicitly test fixtures, never product safety defaults.

```js
const saved=await applyTripCommand(ctx,A,arrival,policy,'repeat');
assert.deepEqual(await applyTripCommand(ctx,A,arrival,policy,'repeat'),saved);
assert.equal((await applyTripCommand(ctx,A,{...arrival,command:{kind:'cancel'}},policy,'repeat')).code,'conflict');
assert.equal((await applyTripCommand(ctx,A,expiredRest,policy,'rest')).code,'invalid_input');
assert.equal(Number((await ctx.db.query("select count(*) from sharing_grants where scope='live_map' and revoked_at is null")).rows[0].count),0);
assert.equal(Number((await ctx.db.query("select count(*) from sharing_grants where scope='incident_response' and revoked_at is null")).rows[0].count),1);
assert.equal(restEvent.payload.recovered,undefined);
```

Add paired integration assertions when #21 exists: a contact page's next newly authorized poll/reconnect returns `not_found` after closure; delayed upload fails; a response authorized before closure may arrive afterward; clearing/aging the already-rendered marker is #22's UI acceptance. No copy already disclosed can be recalled. Until #21/#22 exist, these integrated tests and evidence remain explicitly pending, not replaced by row-count success.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-17.test.mjs`; expect missing rest/replay behavior failures.
- [ ] **Step 3: Implement** rest/extend/resume with finite evidence-approved bounds and a new durable deadline/revision in the same transaction. Record planned rest separately from actual reported start/end and attributed tiredness; elapsed time/parked telemetry cannot report recovery. Preserve existing recipients and scopes unless separately reconfirmed. Expired rest returns to the agreed unknown-status deadline path; no automatic wellbeing assertion or automatic lost-contact escalation until #11/#24 repeated-valid-opportunity policy is accepted. Deferred/paused/unavailable opportunities do not count as nonresponse and cannot burst on resume. Duplicate command replay returns the saved result; late offline revisions conflict and require authoritative refresh. A contact receipt never invokes a driver arrival transition.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-17.test.mjs`; restart the API/worker instance while preserving the isolated PostgreSQL schema, then replay and verify final state/deadline/event counts; call test-context `close()` only after the restart scenario ends. Later run #21 polling and #27/#30 worker suites on this same revision.
- [ ] **Step 5: Commit** `git add src/trips/lifecycle.ts src/api/app.ts tests/issue-17.test.mjs docs/evidence/issue-17.md` then `git commit -m "feat: bound trip rest and revoke live maps on closure"`.

## Acceptance and self-review

Record deterministic arrival/authorization replay, delayed offline closure, repeated taps, restart, expired pause and the retested failing race. A second observer checks identical state on Active Trip, Contact Response and Summary; contact/driver disagreement stays unresolved. #17 acceptance covers its independently reviewed persisted pending-work/coordination contract. Actual #27/#30 workers must later rerun this regression, including provider acceptance then ambiguous failure, before their acceptance and end-to-end release. Require downstream #21/#22 acceptance evidence for already-open map and reconnect behavior before claiming end-to-end map closure; #17 alone proves the durable state/grant revocation contract. Synthetic persisted work proves only the interim transaction contract, not production provider or device behavior.

Self-review: five risks map to test tasks; one short SQL coordination owner and an explicit authorization-to-send boundary; summaries/incident scope survive only their separate permissions; no promise of exactly-once delivery or recall. Original blocker #16 is preserved; later worker/UI integrations are acceptance handoffs, not a circular scaffold prerequisite.
