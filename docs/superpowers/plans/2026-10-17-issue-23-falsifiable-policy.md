# Issue #23: Specify a falsifiable policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Define the smallest fixed, falsifiable policy and a versioned rule contract reused by adaptation and deadlines.

**Architecture:** A pure decision function has no delivery side effects. Freeze a human-readable rule table and evidence-backed bounds before real evaluation; no opaque score.

**Tech Stack:** Proposed Node.js 24 LTS, TypeScript strict/ESM, PostgreSQL 18, `pg`, `node:test`, `node:assert/strict`; #12 must accept the baseline before implementation.

**Spec:** `docs/PLAN.md`, section “Specify a falsifiable policy”; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; ownership/blockers: `docs/plan.json`.

**Owner/status:** Robertzu43; original issue open, blocked by #3. Proposed plan only; preserve that dependency and status. Engineering checks, evidence acceptance and issue closure are distinct.

**Brainstorming clarification — design not frozen:** Robert explicitly rejects an invented sleepiness/check-in threshold. A missed OK is unknown status; an OK does not validate ongoing wakefulness. Numeric production cadence/grace remain unset. The security SOS for reported robbery/kidnapping is independent of those timers; the fatigue intervention and missed-check-in escalation are still being brainstormed.

**Contextual-policy revision required before execution:** Robert requires contextual opportunities and repeated valid verification before a non-response alarm. Defer on curves; pause for declared refuelling/out-of-truck stops; do not count deferred/unheard/unavailable prompts as failed replies. The fixed-cadence/grace-expiry contract below is retained only as an offline comparator and must be rewritten before live implementation. In particular, unconditional lost_contact on grace expiry does not satisfy the new requirement. No universal cadence/count is chosen. Define context evidence, pause/resume, distinct attempt identities and bounded opportunity-aware escalation during design.

## Global Constraints

- No forced visual/manual response while moving; audio is not presumed safe.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Moving or unknown road context never demands a response — Task 1 asserts defer and unchanged reminder count.
2. A pause is different from unanswered delivery — Task 1 asserts planned-rest deferral without a lost-contact diagnosis.
3. Missing bounds cannot silently become defaults — Task 1 asserts invalid_input for absent/invalid bounds.
4. Late OK cannot provide indefinite reassurance — Task 1 asserts it does not reset a fixed deadline.
5. Closed trips and exhausted reminder budgets never prompt — Task 1 asserts no-op/bounded grace.

---

### Task 1: Freeze and test the fixed decision contract

**Files:** Create `src/checkins/policy.ts`, `tests/issue-23.test.mjs`, `docs/contracts/checkin-policy.md`.
**Consumes:** `Id`, `Instant`, `TripState`, `Result<T>` from `src/contracts.ts`; #14 build/test foundation. No API route/export-barrel changes.
**Produces:** These complete public types and signature in `src/checkins/policy.ts`:

```ts
export type FixedPolicy = {
  version: string; cadenceMs: number; graceMs: number; maxReminders: number;
  boundsEvidenceRef: string; safeTimingEvidenceRef: string;
};
export type CheckinState = 'awaiting' | 'ok_self_report' | 'tired_self_report' |
  'explicit_help' | 'unanswered_delivered' | 'delivery_unknown' | 'planned_rest';
export type PolicyInput = {
  tripId: Id; tripState: TripState; now: Instant; dueAt: Instant;
  graceDeadline: Instant; state: CheckinState; remindersSent: number;
  opportunity: 'stationary_verified' | 'moving' | 'unknown';
  lastReportAt: Instant | null;
};
export type PolicyDecision = {
  policyVersion: string;
  action: 'none' | 'defer' | 'prompt' | 'await_grace' | 'lost_contact' |
    'offer_rest' | 'urgent_help';
  reason: 'closed' | 'not_due' | 'unsafe_opportunity' | 'planned_rest' |
    'eligible' | 'reminder_limit' | 'grace_expired' | 'self_report' | 'explicit_help';
  dueAt: Instant; graceDeadline: Instant; remindersRemaining: number;
};
export function evaluateFixedPolicy(policy: FixedPolicy, input: PolicyInput): Result<PolicyDecision>;
```

- [ ] **Step 1: Write failing tests with fixed synthetic inputs.** In the test file define `policy` with cadenceMs=60000, graceMs=30000, maxReminders=1 and fixture evidence references; define `base` at 2026-01-01T00:01:00.000Z, dueAt equal
  to now, graceDeadline 30 seconds later, active, awaiting, stationary_verified, zero reminders. These are arithmetic fixtures only. Use named tests and assertions:

```js
assert.equal(evaluateFixedPolicy(policy, base).value.action, 'prompt');
for (const opportunity of ['moving', 'unknown']) {
  const r = evaluateFixedPolicy(policy, {...base, opportunity}).value;
  assert.equal(r.action, 'defer'); assert.equal(r.remindersRemaining, 1);
}
assert.equal(evaluateFixedPolicy(policy, {...base, state:'planned_rest', dueAt:'2026-01-01T00:01:20.000Z'}).value.reason, 'planned_rest');
assert.equal(evaluateFixedPolicy({...policy, graceMs:NaN}, base).code, 'invalid_input');
assert.equal(evaluateFixedPolicy({...policy, boundsEvidenceRef:''}, base).code, 'invalid_input');
assert.equal(evaluateFixedPolicy(policy, {...base, tripState:'resolved'}).value.action, 'none');
assert.equal(evaluateFixedPolicy(policy, {...base, remindersSent:1}).value.action, 'await_grace');
```

Also assert negative/fractional reminder counts and malformed/inverted instants reject; cancelled behaves as resolved; before-due returns none. At graceDeadline exact equality, unanswered_delivered and delivery_unknown return lost_contact
with unchanged deadlines. A stale OK leaves dueAt/graceDeadline unchanged. Explicit help is urgent even while moving; it requests no further driver interaction. Tired reports remain attributed and defer interaction while moving. Rest never
silently authorizes an unlimited deadline extension.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-23.test.mjs`.** Expect missing policy export/tests to fail before implementation; missing #14 foundation is a gate, not a passing skip.
- [ ] **Step 3: Implement `evaluateFixedPolicy` and its types in `src/checkins/policy.ts`.** Validate finite positive integer durations, nonnegative integer maximum/reminders, valid UTC instants and nonempty version/evidence references;
  require dueAt <= graceDeadline <= dueAt + graceMs. Reject a future lastReportAt relative to now. Add direct assertions for these rejected inputs. Priority: closed; explicit help; planned rest before dueAt; grace expiry for every non-help
  state after any planned rest; unsafe opportunity; not due; remaining prompt; exhausted budget. After planned rest reaches dueAt, treat it as awaiting with the existing bounded grace. Unsafe opportunity suppresses prompts, never server
  expiry. Report timestamps do not rewrite deadlines. A tired stationary report yields offer_rest. Compute remaining budget without increasing it. Document every row, safe timing rationale, bounded fallback and why an OK is only
  time-specific self-report in `docs/contracts/checkin-policy.md`.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-23.test.mjs`.** Expect all assertions pass; inspect table coverage against every action/reason pair used.
- [ ] **Step 5: Commit only the task files.** `git add src/checkins/policy.ts tests/issue-23.test.mjs docs/contracts/checkin-policy.md` then `git commit -m "feat: define bounded fixed check-in policy"`.

### Task 2: Record the falsification and evidence gate

**Files:** Create `docs/evidence/issue-23.md`; update `docs/contracts/checkin-policy.md` only with accepted evidence-backed bounds.
**Consumes/produces:** The Task 1 rule table and #11 frozen evidence contract; an acceptance record, no new runtime interface.

- [ ] **Step 1: Write the acceptance checklist.** Require incident timelines, #9 device limits, STPA hazards, every action's timing rationale, fixed schedule and existing-contact baselines, and externally accepted cadence/grace/reminder
  values. Assert each rule has a test and evidence reference; unresolved items say missing.
- [ ] **Step 2: Compare it with available evidence.** Missing #3/#11 or #24 safe-interaction evidence must leave real activation/evaluation gated. A nonempty evidence reference alone does not establish acceptance.
- [ ] **Step 3: Record supported and rejected rules and explicit change/stop criteria.** Stop moving interaction on distraction; reject increasing prompts or failure to outperform the simpler safe arrangement. Keep the smallest
  stationary/planned-stop policy until moving interaction is independently accepted.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-23.test.mjs` and have the designated external reviewer inspect the table and raw evidence.** AI code review is not independent human-factors validation; absent disposition leaves
  issue open.
- [ ] **Step 5: Commit the evidence record and accepted contract revision.** `git add docs/evidence/issue-23.md docs/contracts/checkin-policy.md` then `git commit -m "docs: record fixed policy evidence gate"`.

**Self-review:** All five review cases have Task 1 assertions; all public types are defined; no cadence is asserted safe. No provider, UI, scheduler or risk score is added. Real evidence remains required before closure.
