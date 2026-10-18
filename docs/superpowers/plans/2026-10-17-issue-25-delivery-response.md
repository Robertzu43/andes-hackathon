# Issue #25: Separate delivery from response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Persist distinct prompt clocks and reproduce operational intervals without pretending delivery proves perception.

**Architecture:** Append attributed events under idempotency, then derive a small measurement view from raw events. Missingness and clock uncertainty remain explicit and never become a fatigue score.

**Tech Stack:** Proposed Node.js 24 LTS, TypeScript strict/ESM, PostgreSQL 18, `pg`, `node:test`, `node:assert/strict`; #12 must accept the baseline before implementation.

**Spec:** `docs/PLAN.md`, section “Separate delivery from response”; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; ownership/blockers: `docs/plan.json`.

**Owner/status:** Robertzu43; original issue open, blocked by #24. Proposed plan only; preserve that dependency and status. Engineering checks, evidence acceptance and issue closure are distinct.

## Global Constraints

- No forced visual/manual response while moving; audio is not presumed safe.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Delivery is absent or unknown — Task 1 asserts a null interval and an explicit censoring reason.
2. Network/idle delay looks like slow response — Task 1 asserts separate server/client clocks and no tiredness classification.
3. Duplicate event IDs conflict or repeat — Task 1 asserts stable replay and conflict on altered payload.
4. Impossible or uncertain clock order — Task 1 asserts invalid-order flag or interval bounds, never a clamped zero.
5. Suppressed opportunities or unknown geography disappear from denominators — Task 2 asserts retained totals and separate null-context strata.

---

### Task 1: Store and derive independent prompt timestamps

**Files:** Create `src/checkins/measurements.ts`, `db/migrations/issue-25-checkin-measurements.sql`, `tests/issue-25.test.mjs`.
**Consumes:** `AppContext`, `Actor`, `Id`, `Instant`, `Locale`, `Result<T>`, `EventEnvelope`; #14 `createTestContext()` and #16 trip ownership. Integrator orders migration; no manifest/API edits by this task.
**Produces:** Complete issue types/signatures in `src/checkins/measurements.ts`:

```ts
export type ClockStamp = { at: Instant; uncertaintyMs: number; clock: 'server' | 'provider' | 'client' | 'observer' };
export type MeasurementKind = 'scheduled' | 'dispatched' | 'provider_accepted' |
  'delivered' | 'independently_observed' | 'client_response' | 'server_received';
export type PromptMeasurement = {
  eventId: Id; promptId: Id | null; tripId: Id; kind: MeasurementKind;
  stamp: ClockStamp; recordedAt: Instant; sourceRef: string;
};
export type Opportunity = {
  opportunityId: Id; tripId: Id; promptId: Id | null; policyVersion: string; eligible: boolean;
  suppressed: boolean; deferralReason: string | null; localHour: number | null;
  segmentId: string | null; country: string | null; locale: Locale; timeZone: string | null;
};
export type Interval = { lowerMs: number; upperMs: number };
export type PromptIntervals = {
  promptId: Id; deliveryToResponse: Interval | null; perceptionToResponse: Interval | null;
  serverReceiptDelay: Interval | null;
  status: 'observed' | 'delivery_missing' | 'unanswered_delivered' | 'response_without_delivery' | 'invalid_clock_order';
  censoredAt: Instant | null;
};
export function appendMeasurement(ctx: AppContext, actor: Actor, input: Omit<PromptMeasurement, 'recordedAt'>): Promise<Result<PromptMeasurement>>;
export function appendMeasurementInTransaction(client: import('pg').PoolClient, actor: Actor, input: Omit<PromptMeasurement, 'recordedAt'>, recordedAt: Instant): Promise<Result<PromptMeasurement>>;
export function recordOpportunityInTransaction(client: import('pg').PoolClient, actor: Actor, input: Opportunity): Promise<Result<Opportunity>>;
export function recordOpportunity(ctx: AppContext, actor: Actor, input: Opportunity): Promise<Result<Opportunity>>;
export function derivePromptIntervals(promptId: Id, events: readonly PromptMeasurement[], cutoff: Instant): Result<PromptIntervals>;
```

The client-level helpers enforce identical validation/ownership/idempotency without starting or committing a transaction; wrappers acquire a client and own the transaction. The server supplies recordedAt. Nullable promptId is permitted only for unsolicited client_response/server_received report observations; they remain raw evidence and never enter prompted-response denominators.

Provider/observer stamps are admitted only through verified internal adapters; a driver-facing body cannot assert provider delivery or independent observation. These functions are internal authenticated service boundaries, not new public
routes. Client response and server receipt share prompt identity but retain separate events. `recordedAt` is stamped by server clock at persistence, never accepted from request input; same-id replay returns the original server stamp. A server_received stamp also comes from the server clock.

- [ ] **Step 1: Write failing tests.** Define synthetic UTC times at 0/10/15/20 seconds and independent raw fixtures; all timing values are fixture-only. Test delivered at 10±2 seconds and client response at 15±1 seconds yields:

```js
assert.deepEqual(intervals.deliveryToResponse, {lowerMs:2000, upperMs:8000});
assert.equal(intervals.perceptionToResponse, null);
assert.equal(noDelivery.deliveryToResponse, null);
assert.equal(noDelivery.status, 'response_without_delivery');
assert.equal(unanswered.status, 'unanswered_delivered');
assert.equal(impossible.status, 'invalid_clock_order');
assert.equal(impossible.deliveryToResponse, null);
assert.deepEqual(replayed.value, first.value);
assert.equal(changedSameId.code, 'conflict');
assert.equal(otherDriver.code, 'not_found');
assert.equal(unsolicitedServerReceipt.value.promptId, null);
assert.equal(deliveryWithoutPrompt.code, 'invalid_input');
```

Implement fixture setup in this test file using `createTestContext`; create driver-owned trip/opportunity/prompt rows through the accepted #16 fixture contract. Explicitly test idle/delayed server receipt changes serverReceiptDelay but not
client response time. Same-id replay with a changed stamp, clock domain or sourceRef conflicts; caller-supplied recordedAt is rejected and cannot backdate an event. Observer timestamp alone enables perception interval; delivery never does. Preserve finite bounds crossing zero as uncertainty, but wholly negative upper bound is invalid; NaN/negative uncertainty rejects.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-25.test.mjs`.** Expect missing exports/schema to fail. Require disposable `TEST_DATABASE_URL`; missing database is a clear failure.
- [ ] **Step 3: Implement the declared exports and migration.** Append events with unique eventId, payload-conflict checks and trip-owner scope; reject caller-owned recordedAt fields and use same-client transactions. Retain competing events without choosing a convenient response:
  repeated kind with distinct eventId uses earliest authenticated observation by recordedAt/eventId for the interval, while retaining all raw events for audit. Subtract timestamps with summed uncertainties; do not invent delivery. Ignore
  events recorded after cutoff in this reproducible view; exclude null-prompt unsolicited report observations from prompted intervals and retain them in raw records; return explicit censoring at cutoff for unanswered/delivery-missing records.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-25.test.mjs`.** Expect replay, trust-boundary and arithmetic assertions pass against PostgreSQL.
- [ ] **Step 5: Commit the three task files.** `git add src/checkins/measurements.ts db/migrations/issue-25-checkin-measurements.sql tests/issue-25.test.mjs` then `git commit -m "feat: separate check-in delivery and response clocks"`.

### Task 2: Reproduce denominators and retain missingness

**Files:** Create `analysis/issue-25-intervals.sql`, `docs/evidence/issue-25.md`; extend `tests/issue-25.test.mjs`.
**Consumes:** Task 1 measurement/opportunity tables. **Produces:** SQL rows grouped by policy_version/local_hour/segment_id/country/locale/time_zone with eligible_opportunities, suppressed_opportunities, delivered_unanswered, delivery_missing and interval bounds;
no new TypeScript types.

- [ ] **Step 1: Add a labelled six-opportunity fixture.** Four eligible, two ineligible; of the eligible, one safely suppressed, one delivered unanswered, one delivered/responded and one delivery missing. Assert SQL
  eligible_opportunities=4, suppressed_opportunities=1, delivered_unanswered=1, delivery_missing=1, and one observed delivery-response interval. Keep suppression separate from delivery failure. Assert a second policy/segment does not merge
  into the first group. Add an eligible unknown-context opportunity with localHour/segmentId/country/timeZone=null; assert it persists unchanged and increments eligible totals without becoming Peru, UTC, hour 0 or a known segment. Assert known hour 0 and unknown hour occupy different groups.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-25.test.mjs`.** Expect the missing SQL result assertions to fail.
- [ ] **Step 3: Implement the read-only SQL and acceptance record.** Join by opportunity/prompt identity without fanout; nullable promptId represents opportunities that never dispatch. Task 1 migration enforces unique non-null promptId;
  appendMeasurement checks its opportunity and trip association. Group null context explicitly; use null-safe joins when combining aggregates, never COALESCE to a country/zone/hour default or filter unknown strata away. Validate known localHour as an integer 0–23; missing geography does not invalidate the opportunity. Record raw event checksums, cutoff, queries and units.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-25.test.mjs`; request second-analyst reproduction from raw events.** Record country/language/device limitations and missing evidence. Independent reproduction, #24 safe
  interaction and external reviewer disposition gate closure; AI review does not replace them.
- [ ] **Step 5: Commit the SQL, updated tests and evidence record.** `git add analysis/issue-25-intervals.sql tests/issue-25.test.mjs docs/evidence/issue-25.md` then `git commit -m "test: reproduce check-in intervals and missingness"`.

**Self-review:** Five review cases have owned assertions; operational delivery and independently observed perception stay distinct; nullable context retains its own denominators. No driver-risk score or provider activation is added. Real analyst/device evidence remains gated.
