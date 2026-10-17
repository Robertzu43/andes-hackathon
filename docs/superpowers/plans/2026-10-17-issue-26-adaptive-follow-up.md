# Issue #26: Test adaptive follow-up rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Replay explicit, attributed check-in states with bounded follow-up and retain the fixed policy unless evidence supports adaptation.

**Architecture:** A pure function wraps #23's fixed policy with explicit help/rest transitions and a tightly bounded cadence change. Offline replay is separate from permission to enable live adaptation; no learned risk score or
phone-derived diagnosis.

**Tech Stack:** Proposed Node.js 24 LTS, TypeScript strict/ESM, `node:test`, `node:assert/strict`; baseline accepted under #12 and foundation from #14.

**Spec:** `docs/PLAN.md`, “Test adaptive follow-up rules”; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; ownership/blockers in `docs/plan.json`.

**Owner/status:** Robertzu43; original issue open, blocked by #25. Proposed/gated plan; #23 supplies policy types, #11 frozen bounds, #24 interaction acceptance, #28 held-out comparison. Do not change original dependencies/status.

**Brainstorming clarification — design not frozen:** The tiredness-to-shorter-cadence rule below is a provisional offline candidate, not an accepted fatigue intervention. Robert wants no invented sleepiness alert threshold. Reconsider it during #12 product/design review; repeated prompts/calls must not be presented as keeping a sleepy driver safe to continue. Explicit robbery/kidnapping SOS, attributed tiredness/rest requests and missing OK replies remain distinct.

**Contextual-policy revision required before execution:** Context adaptation must cover eligibility, declared stops and repeated valid attempts, not only a shorter cadence after tiredness. Reassess context before each attempt; suppress rather than accumulate prompts in curves/stops. No automatic fuel-stop diagnosis from POI proximity. Preserve SOS independently. Revise the service/types/tests below after the contextual policy is agreed; no current pure-policy test establishes this behavior.

## Global Constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- No forced visual/manual response while moving; audio is not presumed safe.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Late OK after a newer help request — Task 1 asserts urgent help survives stale input.
2. Passenger/unattributed response — Task 1 asserts no driver reassurance or deadline reset.
3. Careful driver ignores a curve prompt — Task 1 asserts defer without fatigue/security inference.
4. Response arrives after arrival or phone goes offline — Task 1 asserts closed no-op versus uncertain bounded expiry.
5. Repeated tired reports ratchet prompt burden — Task 2 asserts bounds/reminder budget and rejects unsupported live adaptation.

---

### Task 1: Preserve explicit report meaning and event order

**Files:** Create `src/checkins/adaptation.ts`, `tests/issue-26.test.mjs`.
**Consumes:** `Instant`, `Result<T>` from `src/contracts.ts`; `FixedPolicy`, `PolicyInput`, `PolicyDecision`, `evaluateFixedPolicy(policy, input)` from `src/checkins/policy.ts` (#23).
**Produces:** Complete issue-owned types and pure exports in `src/checkins/adaptation.ts`:

```ts
export type AdaptivePolicy = {
  fixed: FixedPolicy; version: string; minCadenceMs: number; maxCadenceMs: number;
  tiredCadenceMs: number; evaluationContractRef: string;
  liveAcceptanceRef: string | null;
};
export type AdaptiveInput = {
  baseline: PolicyInput; reportAt: Instant | null;
  respondent: 'driver' | 'other' | 'unknown';
  latestHelpAt: Instant | null; lastAcceptedReportAt: Instant | null;
  authorisedContactUpdate: boolean; purpose: 'offline_replay' | 'live';
};
export type AdaptiveResult = {
  decision: PolicyDecision; nextCadenceMs: number;
  contactIntent: 'none' | 'fatigue_support' | 'explicit_help';
  reportDisposition: 'accepted' | 'stale' | 'unattributed' | 'none';
};
export function evaluateAdaptivePolicy(policy: AdaptivePolicy, input: AdaptiveInput): Result<AdaptiveResult>;
```

This adjusts the earlier proposed return type: consumers use `AdaptiveResult.decision` for #23's reusable decision. Persisted active help is cleared only by #29 resolution, not by this pure function. Contact intents are attributed requests,
not provider deliveries or evidence of robbery/sleep.

- [ ] **Step 1: Write failing tests.** Define the #23 synthetic fixed policy/input locally; use dated help at 00:02 and OK at 00:01. All time values are fixtures, not safety limits. Assert:

```js
assert.equal(lateOk.value.decision.action, 'urgent_help');
assert.equal(lateOk.value.reportDisposition, 'stale');
assert.equal(passengerOk.value.reportDisposition, 'unattributed');
assert.equal(passengerOk.value.decision.graceDeadline, originalGraceDeadline);
assert.equal(curveIgnored.value.decision.action, 'defer');
assert.equal(afterArrival.value.decision.action, 'none');
assert.equal(offlineExpired.value.decision.action, 'lost_contact');
assert.equal(tiredMoving.value.contactIntent, 'fatigue_support');
assert.equal(tiredMoving.value.decision.action, 'defer');
assert.equal(tiredWithoutConsent.value.contactIntent, 'none');
```

Named cases also cover all seven #23 CheckinState members: fresh driver OK returns fixed cadence but does not reset grace on this event; tired self-report offers rest only when stationary; explicit help urgent even when moving;
unanswered-delivered and delivery-unknown remain distinct inputs with unknown-status fallback; planned rest honors only the agreed dueAt. Explicit help from another actor remains attributed help rather than discarded; no request to collect
proof. Closed state overrides historical help.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-26.test.mjs`.** Expect missing module/export failure before implementation.
- [ ] **Step 3: Implement `evaluateAdaptivePolicy` in `src/checkins/adaptation.ts`.** Reject malformed timestamps; compare server-accepted causal order recorded in reportAt/lastAcceptedReportAt, never unqualified phone clocks. Resolve
  closed state first, then latched active help, then report freshness/attribution, then #23 safe-opportunity rules. Fresh explicit help latches urgent output; driver tiredness creates fatigue_support only with authorisedContactUpdate.
  Unattributed/stale OK cannot change deadlines or cadence. Keep all original report facts for the event caller; this function does not mutate them.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-26.test.mjs`.** Expect every scenario assertion pass with independently handwritten expected actions.
- [ ] **Step 5: Commit the two task files.** `git add src/checkins/adaptation.ts tests/issue-26.test.mjs` then `git commit -m "feat: preserve bounded attributed check-in transitions"`.

### Task 2: Gate and bound the only adaptive rule

**Files:** Extend `src/checkins/adaptation.ts`, `tests/issue-26.test.mjs`; create `docs/evidence/issue-26.md`.
**Consumes/produces:** Task 1 interfaces unchanged. The sole candidate adaptation selects tiredCadenceMs after an accepted driver tired report; other states use fixed cadence. No additional features.

- [ ] **Step 1: Add failing bound/gate assertions.** Fixture minCadenceMs=60000, maxCadenceMs=120000, tiredCadenceMs=60000, fixed cadence=90000; explicit fixture evidence reference. Assert tiredCadence outside [min,max] rejects
  invalid_input, fractional/negative durations reject, max<min rejects, absent evaluationContractRef rejects, and live purpose without liveAcceptanceRef returns unsupported. Replay 20 tired reports and assert every nextCadenceMs remains
  60000 and remindersRemaining never exceeds the original maximum; no report increments reminder budget. Fresh OK returns 90000. Offline evaluation can run with missing live acceptance but cannot authorize dispatch.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-26.test.mjs`.** Expect bound/live-gate cases to fail until implemented.
- [ ] **Step 3: Implement bounded selection and record its evidence contract.** #11 must justify actual cadence bounds; #24 accepts interaction mode; #28 evaluates whole-driver/journey holdout benefit and burden against fixed/current
  practice. Configure liveAcceptanceRef only from the externally accepted frozen record; validating a string is not proving acceptance. Record rejected rules, failures and the simpler-policy fallback. This issue can finish its offline
  rule/replay evidence without closing #28; #28 is the later live-activation gate, not a replacement for the original dependency graph. No live adaptive enablement before all evidence gates pass.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-26.test.mjs`; review the independent held-out comparison when available.** Small/inconsistent evidence stays inconclusive; increased burden or noise-only reclassification keeps
  fixed policy. AI engineering review does not substitute for human-factors/external acceptance.
- [ ] **Step 5: Commit the three task files.** `git add src/checkins/adaptation.ts tests/issue-26.test.mjs docs/evidence/issue-26.md` then `git commit -m "feat: gate adaptive cadence on bounded evidence"`.

### Task 3: Wire driver reports and the current prompt into the backend

**Files:** Create `src/checkins/service.ts`, `db/migrations/issue-26-checkin-state.sql`; extend `tests/issue-26.test.mjs`, `docs/evidence/issue-26.md`; integrator modifies `src/api/app.ts`, `src/trips/registration.ts`, `src/trips/lifecycle.ts` for the shared transaction hook.
**Consumes:** Common `AppContext`, `Actor`, `Id`, `Instant`, `Result<T>`, `EventEnvelope`; #17 `withTripTransaction` (owns the transaction; no nested transaction); #25 `appendMeasurementInTransaction`/`recordOpportunityInTransaction`; #16 trip/deadline/outbox and idempotency storage; Tasks 1–2 policy functions; OutboxIntent from src/trips/registration.ts. SQL-only effects are injected for synthetic testing; production SOS acceptance requires #29/#30/#31 integration in the same transaction.
**Produces:** Define these complete public types and exports in `src/checkins/service.ts`:

```ts
export type ReportEffects = { materializeSecurityHelp(client: import('pg').PoolClient, intent: OutboxIntent): Promise<Result<void>> };
export type CheckinConfig = { fixed: FixedPolicy; adaptive: AdaptivePolicy | null };
export type DriverCheckin = {
  tripId: Id; expectedRevision: number; idempotencyKey: string;
  report: 'ok' | 'tired' | 'help'; promptId: Id | null;
  clientResponse: { at: Instant; uncertaintyMs: number } | null;
};
export type CheckinSnapshot = {
  tripId: Id; revision: number; promptId: Id | null; decision: PolicyDecision;
  observation: 'ok_self_report' | 'tired_self_report' | 'explicit_help' | 'unknown';
  lastAcceptedAt: Instant | null;
};
export type CheckinReceipt = { reportId: Id; acceptedAt: Instant; disposition: 'accepted' | 'stale'; snapshot: CheckinSnapshot };
export function getCheckin(ctx: AppContext, actor: Actor, tripId: Id, config: CheckinConfig): Promise<Result<CheckinSnapshot>>;
export function submitCheckin(ctx: AppContext, actor: Actor, input: DriverCheckin, config: CheckinConfig, effects: ReportEffects): Promise<Result<CheckinReceipt>>;
export function refreshPromptInTransaction(client: import('pg').PoolClient, actor: Actor, tripId: Id, policy: FixedPolicy, acceptedAt: Instant): Promise<Result<Id | null>>;
```

`GET /v1/trips/:id/checkin` returns the authenticated, read-only snapshot for #24 polling. `POST /v1/trips/:id/checkins` accepts `{expectedRevision,report,promptId,clientResponse}`, takes `Idempotency-Key` as input.idempotencyKey, and returns CheckinReceipt. Authentication supplies Actor; body driverId/provider/perception/source fields are rejected. Common HTTP/error mappings apply. OK requires the current persisted promptId; unsolicited tired/help use null. A supplied promptId for tired/help must belong to this trip, but an old own-trip prompt cannot suppress an explicit help request. There is no requirement to wait for a prompt before requesting help/rest.

Migration adds `deadlines.prompt_id` UUID and `prompt_due_at` timestamptz; #25 opportunity storage links each promptId exactly once. `refreshPromptInTransaction` derives check-in due time from the accepted deadline minus fixed.graceMs, rotates the promptId only when that schedule changes, and records the corresponding opportunity with nullable context and truthful eligibility/suppression. It never advances a deadline. #16 registration and #17 rest/extend/resume call it on their existing client after writing the accepted schedule; backfill existing active schedules once under the same lock. Closed trips return null. GET does not generate IDs, send prompts or count delivery. Frozen server evidence selects the policy. GET derives opportunity only from current #9/#19-qualified interaction evidence; missing/stale context defaults to unknown, never stationary from parked telemetry or an absent speed sample. Scheduling alone is not evidence of a safe eligible opportunity; unsafe/unknown context suppresses ordinary interaction. Polling makes no browser-background, audio-safety or delivery promise.

- [ ] **Step 1: Write failing API/transaction tests.** Authenticate two drivers and seed a supported synthetic fixed policy/current prompt using the accepted #16 fixture. Assert GET repeats the same promptId and frozen due/grace without writes; missing/stale device context yields opportunity unknown and decision defer, never an implicitly stationary prompt; another owner gets 404. Assert OK with null/wrong/old prompt fails, while unsolicited help/tired with null prompt succeeds; forged driverId/provider/perception/recordedAt fields fail. Force a stale revision to conflict; reuse the same idempotency key/body returns the exact saved reportId/acceptedAt, while altered body conflicts. Assert clientResponse is stored as uncertain client time, never causal server time. Commit help, then submit OK using the refreshed revision/current prompt: assert disposition stale, explicit_help persists and no resolution or deadline extension occurs. Fault-inject after measurement but before outbox: assert report, measurement, revision and intent all roll back. Tired without current sharing authorization has no fatigue intent; authorized tired has exactly one. Help emits one security-help source intent and invokes the SQL effect in the same transaction; inject effect failure and assert report/incident/jobs/outbox all roll back. End-to-end tests with #29–31 must prove accepted SOS has incident plus channel jobs or explicit unavailable-channel facts. Concurrent distinct keys for the same active SOS converge on one incident and channel-job set. Fresh OK advances only to the agreed bounded next schedule and rotates promptId; repeat the old key and assert no second advance. Assert #17 arrival/cancellation races serialize against reports and preserve closed state.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-26.test.mjs`.** Expect missing routes/service/migration failures; missing TEST_DATABASE_URL fails clearly.
- [ ] **Step 3: Implement declared functions and routes.** Inside #17 withTripTransaction (no external I/O): recheck ownership/lifecycle/revision, return saved same-key result before new writes, timestamp causal acceptance with ctx.clock.now, evaluate the fixed policy unless live adaptation is externally accepted, and retain active-help precedence. Append audit `kind:'driver_checkin'`, payload `{kind:'driver_checkin',report,promptId,acceptedAt,disposition}` with source driver; write server_received measurement and optional client_response via #25's client helper. Generate independent measurement event IDs; the audit event ID is receipt.reportId. Unsolicited measurements keep promptId null. On accepted fresh prompted OK only, set next check-in due to acceptedAt + selected bounded cadence and deadline state pending/grace to due + fixed.graceMs, then refresh prompt identity; never clear an active help state. Tired/help do not silently extend grace or require continued interaction while moving. Write `incident.security_help_required` for help and `incident.fatigue_rest_required` for tired with current authorization; payload `{reportId,report,acceptedAt,promptId,basis:'driver_report'}`, where report matches help/tired. Any failed client helper Result must become a domain abort before withTripTransaction commits; map the abort at the API boundary and roll back the whole transaction. Persist revision/audit/measurements/source intents/idempotency result together. #29 materializes security help synchronously through effects.materializeSecurityHelp on this same client before commit, with the #31 planner persisting #30 jobs/outbox. Any error aborts all writes. Return accepted only when that succeeds; pending/unavailable-channel facts are explicit and acceptance is not delivery. For non-SOS intents, asynchronous materialization remains possible. No provider call occurs here.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-26.test.mjs` `npm run build && node --test tests/issue-16.test.mjs tests/issue-17.test.mjs`.** Verify rollback/replay through raw SQL and barrier-controlled races. #27 later arms/consumes this persisted schedule and reuses refreshPromptInTransaction; its regression is downstream work, not a circular closure prerequisite. #24 physical interaction evidence and actual enabled-policy gates remain separate from engineering route correctness.
- [ ] **Step 5: Commit only the named Task 3 files after integrator review.** `git add src/checkins/service.ts db/migrations/issue-26-checkin-state.sql tests/issue-26.test.mjs docs/evidence/issue-26.md src/api/app.ts src/trips/registration.ts src/trips/lifecycle.ts` then `git commit -m "feat: connect driver check-in reports and prompt state"`.

**Self-review:** All five review cases have assertions; Task 3 supplies authenticated report/prompt routes and atomic measurement/outbox integration; #23 types are reused, all new types are defined, and #28 evaluates rather than fabricates efficacy. Timing constants are fixtures only. No UI, provider send or inferred robbery/sleep
state is added.
