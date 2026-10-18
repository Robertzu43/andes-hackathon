# Issue #27: Prove deadline and race handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist versioned deadlines across restarts and racing trip changes; emit lost-contact intents only when an accepted policy has evidence of repeated valid nonresponse.

**Architecture:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects ECS/Fargate + RDS PostgreSQL + transactional outbox/SQS. Extend #16 deadline rows and process due work in #17's short SQL transaction shared with lifecycle, grants and attempt authorization. Commit/release before publishing IDs to SQS; this processor never calls a notification provider. #29 materializes incidents and #30 authorizes individual attempts independently.

**Tech Stack:** TypeScript, PostgreSQL, `pg` and Node test runner on the chosen AWS target. #12 still validates versions, supervision, SQL timeout/pool bounds and measured scheduler lag; no deployment is performed by this plan update.

**Spec:** `docs/PLAN.md`, “Prove deadline and race handling”; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Owner/status:** Robertzu43; original issue open, blocked by #26. Proposed/gated; executable integration also needs #14/#16/#17. This issue closes on its deadline/current-intent seam and real restart/lag evidence; #30 later reruns the seam
against its dispatcher. That later regression is not a new blocker or a claim of provider proof.

**Policy execution gate:** Automatic nonresponse escalation remains disabled until #11/#24 define and validate audiences, repeated-valid-opportunity criteria and bounded timing. A timer alone cannot establish repeated verification. Persist deferred, paused, channel-unavailable and valid-nonresponse opportunity states; suppressed/unavailable attempts never consume the gate. Curves, refuelling, unavailable audio and resume must not create an expiry burst. Distinct trip/arrival/coverage-loss policies remain explicit. Tests below use synthetic accepted-policy scenarios and never enable a production safety policy.

## Global Constraints

- No new affected attempt authorization after committed closure/revocation/resolution or generation invalidation. Previously authorized attempts may call externally afterward; their ambiguity cannot block lifecycle commands.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Arrival/cancellation races expiry — Task 1 asserts either serialized history with no new intent after closure.
2. Worker dies before/after commit — Task 1 asserts replay emits exactly one durable intent and misses no deadline.
3. Extension races an already queued intent — Task 2 asserts generation invalidation before new attempt authorization.
4. Long outage/duplicate workers — Task 1 asserts every policy-eligible transition once without manufacturing missed opportunities and reports actual lag.
5. Help followed by late OK — Task 2 asserts deadline processing cannot resolve or replace active help.

---

### Task 1: Extend persisted deadlines and process expiry atomically

**Files:** Create `src/checkins/deadlines.ts`, `db/migrations/issue-27-deadline-generations.sql`, `tests/issue-27.test.mjs`; modify `src/worker.ts` only through the integrator to invoke the processor using the #12 accepted supervision
contract.
**Consumes:** Common `AppContext`, `Actor`, `Id`, `Instant`, `Result<T>`, `EventEnvelope`; #23 `FixedPolicy`;  #16 `OutboxIntent` from `src/trips/registration.ts`; #17
`withTripTransaction<T>(ctx:AppContext,tripId:Id,work:(client:PoolClient)=>Promise<T>):Promise<T>`; #14 `createTestContext()`. The helper owns the SQL transaction; callbacks must not nest it or perform external I/O.
**Existing schema:** #16 `deadlines(id,trip_id,trip_revision,due_at,state)`, `outbox(id,trip_id,trip_revision,kind,payload,state)`, `trip_events(event_id,trip_id,revision,envelope)`. Extend these records; never create competing tables.
**Produces:** Complete issue types/signatures in `src/checkins/deadlines.ts`:

```ts
export type Deadline = {
  id: Id; tripId: Id; tripRevision: number; generation: number;
  dueAt: Instant; state: 'pending' | 'expired' | 'cancelled';
  policyVersion: string; lastSeenAt: Instant | null;
};
export type ArmDeadline = {
  deadlineId: Id; tripId: Id; expectedRevision: number; idempotencyKey: string;
  scheduledAt: Instant; dueAt: Instant; policyVersion: string; lastSeenAt: Instant | null;
};
export type ExpiryRun = { expired: Id[]; ignored: Id[]; maxLagMs: number | null };
export function armDeadline(ctx: AppContext, actor: Actor, input: ArmDeadline, policy: FixedPolicy): Promise<Result<Deadline>>;
export function expireDueDeadlines(ctx: AppContext, limit: number): Promise<Result<ExpiryRun>>;
export function isDeadlineIntentCurrent(client: import('pg').PoolClient, intent: OutboxIntent): Promise<boolean>;
```

Arm dueAt is the already justified grace deadline, not a new scheduling default. The worker supplies the frozen #23 FixedPolicy, never a driver body; require matching policyVersion, dueAt >= scheduledAt and dueAt - scheduledAt <=
policy.graceMs before persistence. scheduledAt is the accepted check-in due time. `lastSeenAt` is qualified server-known observation time, not wellbeing. SQL lock timeout is shared #12 infrastructure configuration, never a safety promise. Processing checks the accepted policy version and recorded qualifying opportunities; it does not infer them from elapsed time.

- [ ] **Step 1: Write failing PostgreSQL tests.** Use synthetic fixed clock at 00:01:00, deadline 00:00:30, fixture-only lag=30000ms, isolated #14 schema and #16 trip fixtures. Provide an explicitly enabled synthetic policy and independently recorded repeated-valid-nonresponse opportunities. Record expected histories independently; assert:

```js
assert.equal(first.value.expired.length, 1);
assert.deepEqual(replay.value.expired, []);
assert.equal(rawOutbox.filter(x => x.kind === 'checkin.lost_contact_required').length, 1);
assert.equal(rawIntent.payload.basis, 'unable_to_confirm_status');
assert.equal(first.value.maxLagMs, 30000);
assert.equal(closedTripIntentCount, 0);
assert.equal(rollbackEventCount, 0); assert.equal(rollbackIntentCount, 0);
assert.equal(otherDriverArm.code, 'not_found');
```

Use a separate PostgreSQL client and barrier-controlled transaction/lock to race expiry versus #17 arrival/cancellation in both orders; no sleeps. Terminate a test worker connection before commit and restart; assert the pending deadline
survives. Repeat after commit; assert no duplicate intent. Run two processors concurrently and a backlog spanning an outage; each eligible generation emits once, closed trips never do, and maxLagMs reflects clock minus actual dueAt. With policy disabled or only deferred/paused/unavailable opportunities, assert zero escalation intents. Add curve-at-expiry, refuelling pause/resume, unavailable audio and no-burst-after-resume cases; missed wall-clock intervals never become synthetic opportunities. Absent
TEST_DATABASE_URL fails clearly.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-27.test.mjs`.** Expect missing exports/schema failure.
- [ ] **Step 3: Implement types, migration and the two processing exports.** Add generation/policy_version/last_seen_at columns; backfill only from an accepted recorded schedule, leaving unknown old rows inactive for explicit
  reconciliation. Scan pending due candidates in dueAt/id order; use the shared short transaction and acquire trip coordination before deadline row locks. Reread lifecycle/revision/deadline, policy enablement and recorded opportunity eligibility. In an eligible synthetic/accepted-policy case, atomically expire, increment trip revision, append EventEnvelope and insert
  OutboxIntent with kind `checkin.lost_contact_required`. Payload is `{deadlineId,generation,basis:'unable_to_confirm_status',lastSeenAt,lastSeenAgeMs}`; unavailable last-seen age is null. Unique (deadlineId,generation,kind) outbox index
  prevents duplicates. Disabled/ineligible automatic escalation never creates this intent; preserve deferred/paused/unavailable states for later valid opportunities without an immediate backlog burst. Preserve policyVersion. Do not invalidate a required deadline merely because unrelated trip revision advanced; check current trip lifecycle and deadline generation.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-27.test.mjs`.** Expect atomicity/restart/race assertions pass; inspect committed event and outbox histories, not only return values.
- [ ] **Step 5: Commit scoped implementation/test files and integrator-owned worker change.** `git add src/checkins/deadlines.ts db/migrations/issue-27-deadline-generations.sql tests/issue-27.test.mjs src/worker.ts` then `git commit -m
  "feat: persist and replay bounded check-in deadlines"`.

### Task 2: Invalidate stale intents and prove the dispatch boundary

**Files:** Extend `src/checkins/deadlines.ts`, `src/checkins/service.ts`, `tests/issue-27.test.mjs`; create `docs/evidence/issue-27.md`. A synthetic consumer exercises the exported current-intent seam now. Integrator reruns these tests against #30 when it exists; do
not create a second dispatcher.
**Consumes/produces:** Task 1 signatures; `isDeadlineIntentCurrent` must run on the client inside #17's shared short transaction, including #30's authorization transaction. It accepts the original checkin.lost_contact_required and downstream notification.required intents carrying the same deadlineId/generation; validate those provenance fields rather than rejecting on the changed kind. It returns true only for active/resting trip and matching expired deadline generation and currently enabled/eligible policy; #29 propagates source
deadline/generation into notification intents.

- [ ] **Step 1: Add failing extension/help assertions.** Arm extends the same deadline id with expectedRevision and stable idempotencyKey, increments generation, and cancels not-yet-authorized superseded work in the same transaction. Assert old
  generation fails `isDeadlineIntentCurrent`, new dueAt survives restart, same key/body replays, altered key/body conflicts, and stale expectedRevision conflicts. Persist #26's active explicit-help event then deliver stale OK; assert the
  help event remains authoritative, no resolved event appears and deadline processing does not replace help with an OK state. Use a synthetic downstream consumer with a send counter behind a barrier: committed extension/arrival before authorization yields zero authorizations/calls; authorization committed first releases SQL, then extension/arrival commits while the synthetic sender is paused, and that prior call may begin afterward. Retain it in history without claiming recall; preserve open security SOS and independent incident jobs in both orders. Repeat against #30 later without claiming the synthetic counter proves provider behavior.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-27.test.mjs`.** Expect extension/current-intent assertions fail before implementation. The current-intent seam suite runs now without #30; record its provider/reconciliation
  scope as untested, not as a passed integration test.
- [ ] **Step 3: Implement `armDeadline` invalidation and `isDeadlineIntentCurrent`; record the evidence gate.** Arm requires owner, current revision, valid UTC times and policy bounds; it must not cancel explicit-help intents. Unknown
  in-flight sends remain unknown for #30/#33 reconciliation. Closed trips reject rearming. Emit audit kind `deadline` with matching payload kind and phase scheduled/cancelled as appropriate; outbox commands stay separate from audit payloads. Extend #26 refreshPromptInTransaction to increment generation and cancel superseded not-yet-authorized deadline work exactly once when prompt identity rotates; both armDeadline and the existing #16/#17/#26 schedule mutations use this same-client hook inside the same short trip transaction. Do not increment generation a second time in armDeadline. This closes the fresh-OK versus queued-expiry race atomically without generating a second schedule. Record measured scheduler lag, runtime restart guarantees and external expected-transition review; do not fabricate a passing lag limit.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-27.test.mjs` and rerun #17 cancellation tests against this actual deadline worker.** Require zero new obsolete authorizations/missed policy-eligible transitions in the defined suite and measured
  lag within #12/#11's accepted contract. Real hosting/restart and external reviewer evidence remain required; AI review alone is insufficient.
- [ ] **Step 5: Commit only Task 2 files; record the later #30 regression in the acceptance record.** `git add src/checkins/deadlines.ts src/checkins/service.ts tests/issue-27.test.mjs docs/evidence/issue-27.md` then `git commit -m "fix: invalidate superseded
  deadline intents"`.

**Self-review:** Every review focus has a deterministic assertion; deadline and notification execution are separate; #16 rows/#17 short transaction coordination are reused; SQL is released before external I/O and no global dispatch fence exists. Provider ambiguity is preserved. This plan does not claim production scheduler reliability
from fixtures.
