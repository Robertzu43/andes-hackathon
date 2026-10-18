# Issue #28: Compare benefit and burden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Reproduce current-practice, fixed-policy and adaptive-policy comparisons on independently labelled held-out scenarios without claiming efficacy from synthetic runs.

**Architecture:** Read a frozen, versioned evaluation dataset, calculate transparent SQL denominators and report stratified paired cluster intervals. A pure evaluator applies preregistered limits, preserving inconclusive/adverse outcomes;
no auto-tuning or live policy switch.

**Tech Stack:** Proposed Node.js 24 LTS, TypeScript strict/ESM, PostgreSQL 18 read-only SQL, `node:test`, `node:assert/strict`; #12-approved baseline and #14 foundation.

**Spec:** `docs/PLAN.md`, “Compare benefit and burden”; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Owner/status:** Robertzu43; original issue open, blocked by #27. Proposed/gated; #11 must freeze numeric acceptance/analysis criteria, #24 supplies independent attention evidence, #25 supplies raw clocks/denominators. #26 can run offline
first; real adaptive activation waits for this evidence gate.

## Global Constraints

- No forced visual/manual response while moving; audio is not presumed safe.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Different opportunity counts manufacture benefit — Task 1 asserts paired scenario completeness and opportunity-based useful-status rates.
2. Coverage gaps or unknown context disappear from exposure — Task 1 asserts retained registered time and distinct null-context strata.
3. Holdout leaks through the same driver/journey — Task 2 asserts split overlap rejection before evaluation.
4. Tiny/zero-exposure data gives a confident answer — Task 2 asserts null rates or inconclusive, never a zero-error pass.
5. Aggregate gain hides distraction or cluster harm — Task 2 asserts per-stratum limits and adverse outcomes stop acceptance.

---

### Task 1: Freeze records and reproduce the three-arm metrics

**Files:** Create `src/checkins/comparison.ts`, `analysis/issue-28-comparison.sql`, `tests/issue-28.test.mjs`, `tests/fixtures/issue-28-scenarios.json`.
**Consumes:** `Id`, `Locale`, `Result<T>`; #25 raw opportunity/measurement semantics. SQL reads a typed JSON recordset of the same records; no participant-table migration or duplicate analytics store.
**Produces:** Complete types in `src/checkins/comparison.ts`:

```ts
export type Arm = 'current_practice' | 'fixed' | 'adaptive';
export type EvaluationRow = {
  scenarioId: string; driverId: Id; journeyId: Id; routeId: string | null; timeCluster: string | null;
  country: string | null; locale: Locale; arm: Arm; split: 'development' | 'holdout';
  evidenceTier: 'synthetic' | 'stationary' | 'simulator' | 'pilot';
  independentLabelRef: string; order: number; eligibleOpportunities: number;
  usefulStatuses: number; prompts: number; unnecessaryEscalations: number;
  deliveredUnanswered: number; missedActionable: number; activeTripMs: number;
  coverageGapMs: number; attention: Record<string, number>;
};
export type Metric = 'useful_per_opportunity' | 'prompts_per_hour' |
  'unnecessary_per_hour' | 'unanswered_per_opportunity' | 'missed_per_opportunity';
export type ArmMetrics = { arm: Arm; stratum: string; rates: Record<Metric, number | null> };
export type EvaluationContract = {
  version: string; preregistrationRef: string; datasetHash: string;
  splitUnit: 'driver' | 'journey'; confidenceLevel: number;
  bootstrapReplicates: number; seed: number; minClusters: number;
  minUsefulGain: number; maxUnnecessaryPerHour: number;
  maxMissedPerOpportunity: number; maxPromptsPerHour: number;
  attentionLimits: Record<string, {unit: string; max: number}>;
};
export type Comparison = {
  comparator: 'current_practice' | 'fixed'; stratum: string; metric: Metric;
  adaptiveMinusComparator: number | null; lower: number | null; upper: number | null;
};
export type Evaluation = {
  contractVersion: string; datasetHash: string; metrics: ArmMetrics[];
  comparisons: Comparison[]; decision: 'supported' | 'fixed_only' | 'stop_moving' | 'inconclusive';
  reasons: string[]; evidenceTier: EvaluationRow['evidenceTier'];
};
export function comparePolicies(rows: readonly EvaluationRow[], contract: EvaluationContract): Result<Evaluation>;
```

Stratum is JSON.stringify([country,locale,routeId,timeCluster]); preserve null components as unknown in the evidence report. Missing time-zone mapping yields timeCluster=null, never UTC midnight; a missing country/route stays null. Attention keys/units are frozen by #24 (for example eyes-off-road duration, task errors, interaction time and driving-performance
indicators), not invented default limits. `usefulStatuses` requires independent judgement that information changed an appropriate contact decision; clicks do not count. Dataset hashing is SHA-256 over UTF-8 JSON rows sorted by
scenarioId/arm with fixed property order as defined above.

- [ ] **Step 1: Write failing arithmetic tests.** Construct synthetic balanced current/fixed/adaptive rows for identical scenario sets and counts; each row has 4 eligible opportunities and 2 registered active hours including 0.5 hour
  coverage gap. Adaptive useful=2, prompts=4, unnecessary=1, unanswered=1, missed=0. Assert SQL and evaluator independently equal useful_per_opportunity=0.5, prompts_per_hour=2, unnecessary_per_hour=0.5, unanswered_per_opportunity=0.25 and
  missed_per_opportunity=0. Assert coverage gap does not reduce 2-hour exposure. A second route/time stratum stays separate; missing arm/scenario rejects invalid_input. Useful>eligible, negative counts/exposure, gap>active time and
  duplicate scenario/arm reject invalid_input. Add a complete three-arm scenario with country/routeId/timeCluster=null; assert its activeTripMs remains in exposure, its JSON null stratum remains separate from known country/route/time strata, and no Peru/UTC/hour-0 default appears. Null geography is accepted analytical input, not dropped or treated as known support evidence.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-28.test.mjs`.** Expect missing SQL/export failure; require disposable PostgreSQL for the read-only SQL verification.
- [ ] **Step 3: Implement rate aggregation and SQL.** Sum counts/exposure within arm/stratum; divide useful/unanswered/missed by eligible opportunities, prompts/unnecessary by activeTripMs/3600000. Return null for zero denominator. Keep
  zero coverage data as missingness, not excluded exposure. Preserve unknown-context groups with null-safe joins; never filter these rows from registered exposure. SQL uses parameterized JSON input and is a reproducibility check, not an unrestricted data export. Preserve raw fixture rows and failed cases.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-28.test.mjs`.** Expect exact rational fixture rates from both calculations; no live provider or participant data needed.
- [ ] **Step 5: Commit the four task files.** `git add src/checkins/comparison.ts analysis/issue-28-comparison.sql tests/issue-28.test.mjs tests/fixtures/issue-28-scenarios.json` then `git commit -m "feat: reproduce check-in benefit and
  burden metrics"`.

### Task 2: Enforce held-out analysis and explicit evidence decisions

**Files:** Extend `src/checkins/comparison.ts`, `tests/issue-28.test.mjs`, fixture JSON; create `docs/evidence/issue-28.md`.
**Consumes/produces:** Task 1 interfaces; #11 preregistered numeric criteria, independently labelled scenarios and #24 attention observations. No #26 policy mutation.

- [ ] **Step 1: Add failing evaluation assertions.** Assert same driver across splits rejects when splitUnit=driver; same journey rejects for journey split. Evaluating holdout excludes all development rows from estimates and bootstrap.
  Reordered input with the same canonical hash and seed gives identical output. Hash mismatch rejects. Zero denominator/fewer than minClusters yields inconclusive and null intervals; a bootstrap resample with zero metric denominator also yields an inconclusive decision and null affected interval, never silently discarding that replicate; synthetic data never yields supported. Missing attention
  dimension, independent label, counterbalance order or preregistration returns invalid_input. Assert adverse attention exceeds its supplied bound => stop_moving; no useful gain with sufficient data => fixed_only; a harmful route stratum
  cannot be hidden by a positive pooled total. Assert a dataset with unknown country/route/time retains metrics and adds unknown_context with decision inconclusive; attention-limit violations still take stop_moving precedence.
- [ ] **Step 2: Run `npm run build && node --test tests/issue-28.test.mjs`.** Expect missing split/interval/decision checks to fail.
- [ ] **Step 3: Complete `comparePolicies` with preregistered paired cluster resampling.** Resample whole splitUnit clusters with replacement within each stratum, preserving all three arms of every cluster and their exposure; calculate
  adaptive-minus-comparator rates against both baselines. Use xorshift32 with nonzero uint32 seed (shifts 13,17,5), sorted cluster ids, and percentile order statistics at floor((replicates-1)*tailProbability). Confidence
  level/replicates/minClusters come from the frozen contract; no data-driven switching. Resample cluster attention means likewise and use their upper bounds for attention acceptance. Reject mixed evidence tiers and absent pairing; preserve
  observed order for independent counterbalance review. Require every stratum/comparator's useful-gain lower bound to meet minUsefulGain and every adaptive burden/missed/attention upper bound to meet contract limits before supported. Upper
  bounds for absolute adaptive rates come from the same resamples. Evidence that crosses limits is inconclusive; a clearly insufficient useful-gain upper bound yields fixed_only. An observed attention-limit violation yields stop_moving.
  Missing/too-small evidence never supports adaptation. If any resample has a zero denominator for a required rate, retain that undefined outcome, return null for its interval and inconclusive with reason undefined_resample; do not filter replicates or resample until a convenient denominator appears. Unknown country/route/time context retains reported metrics/exposure but adds reason unknown_context and leaves acceptance inconclusive unless an observed attention violation requires stop_moving; it cannot establish country-specific support.
- [ ] **Step 4: Run `npm run build && node --test tests/issue-28.test.mjs`; have a second analyst reproduce frozen raw data, hashes, SQL, intervals and decisions.** Evidence record must name counterbalanced stationary/simulator protocol,
  independent labels, whole-driver/journey split, preregistered contract, failures, cluster counts and external reviewer disposition. Pilot observations stay a separate tier. Missing evidence keeps issue open; AI code review does not
  replace independent human assessment. Do not tune on holdout or claim fewer robberies/crashes.
- [ ] **Step 5: Commit comparison/tests/fixture/evidence only.** `git add src/checkins/comparison.ts tests/issue-28.test.mjs tests/fixtures/issue-28-scenarios.json docs/evidence/issue-28.md` then `git commit -m "feat: gate adaptation on
  held-out comparison evidence"`.

**Self-review:** All five review cases have explicit assertions; all issue-owned types and statistical choices are defined. Unknown context retains exposure; synthetic arithmetic is reproducible, not efficacy evidence. Numeric limits, real human attention evidence and
external acceptance remain gates.
