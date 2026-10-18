# Issue 42 Bias and Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Expose policy/coverage bias and suppress unsafe analytical outputs before any later aggregate release.

**Architecture:** Reproducible checks over valid #40 data and #41 measures. Partition by entire drivers or prespecified journey/route-time blocks; no predictive danger model or public ranking.

**Tech Stack:** Proposed TypeScript/node:test and existing analysis modules.

**Spec:** `docs/PLAN.md` #42; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; #40/#41 analysis contracts.

## Global Constraints

- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Same driver appears in train/evaluation: reject the split (Task 1).
2. More prompts on curves create an apparent hotspot: stratify by policy/delivery/exposure (Task 1).
3. Sparse country cells: suppress and do not rank (Task 2).
4. A total minus visible cells reveals a suppressed cell: suppress complementary outputs too (Task 2).
5. Withdrawn source export or absent review: block release even if calculations pass (Task 2).

---

**Existing blocker:** #41. #39 privacy choices and #11 evaluation contract supply the applicable boundaries; later conditional phase. The author cannot be the sole methodology/privacy reviewer.

### Task 1: Pin holdouts and policy sensitivity

**Files:** Create `src/analysis/bias.ts`, `tests/issue-42.test.mjs`, `tests/fixtures/policy-bias.json`, `docs/analysis/evaluation-manifest.json`.

**Interfaces:** Consume `ContributionRow` and `describeRates`. Export `validateHoldout(training: readonly ContributionRow[], evaluation: readonly ContributionRow[]): Result<{trainingDrivers:number;evaluationDrivers:number}>` and `comparePolicyStrata(rows: readonly ContributionRow[]): Result<{stratum:string;summary:RateSummary}[]>`. Stratum key is the tuple `[country,locale,policyVersion,routeCell]`, preserving nulls explicitly; record delivery/coverage differences rather than diagnosing danger.

- [ ] Create a fixture with equal within-policy nonresponse rates but unequal prompting exposure across two route cells. Supply driver-disjoint development/evaluation sets plus a deliberate shared-driver failure. Assertions:

```js
assert.equal(validateHoldout(trainWithDriverA, evaluationWithDriverA).ok, false);
assert.equal(validateHoldout(driverAOnly, driverBOnly).ok, true);
assert.equal(strata.find(x => x.stratum === keyA).summary.nonresponsePerDelivered, 0.25);
assert.equal(strata.find(x => x.stratum === keyB).summary.nonresponsePerDelivered, 0.25);
```

- [ ] Run `npm run build && node --test tests/issue-42.test.mjs`; expect missing modules/behavior.
- [ ] Implement the two functions and freeze dataset/export hash, selected partition rule, development/evaluation IDs, policy versions and exclusions in the manifest before inspecting held-out results. Reject overlap instead of silently moving drivers. Add missing-response sensitivity bounds: treat unknown delivery/outcome as unknown, and show how extremes change interpretation without inserting invented labels.
- [ ] Run the issue tests; assert policy/country strata remain separate, unknown-country rows stay unknown, and a policy-generated count difference never produces a crime/fatigue risk label.
- [ ] Commit with `feat(#42): check holdouts and policy sensitivity`.

### Task 2: Enforce aggregate release eligibility

**Files:** Create `src/analysis/release.ts`, `docs/evidence/issue-42.md`; modify issue tests and manifest.

**Interfaces:** Define `AggregateCell={key:string;independentDrivers:number;value:number|null;sourceExportIds:string[]}` and `ReleasePolicy={minimumDrivers:number;approvedReviewerRefs:string[];validExportIds:string[];allowTotals:boolean}`. Export `prepareAggregateRelease(cells: readonly AggregateCell[], policy: ReleasePolicy): Result<{cells:AggregateCell[];suppressedKeys:string[];withheldTotals:boolean}>`. The minimum and release dimensions require independent privacy review under #39/#42; fixture values are not anonymity claims.

- [ ] Add a three-driver minimum fixture only for testing: a two-driver cell is suppressed; an otherwise eligible cell with an invalidated export blocks the release; no reviewer references blocks release. If any cell is suppressed, withhold totals and other complementary aggregates capable of reconstructing it; use the simplest safe choice of withholding all totals for that release.
- [ ] Run the issue command and observe missing release behavior.
- [ ] Implement release preparation, keeping raw suppressed values out of returned/public output. Reject totals requests if lineage/complementary disclosure cannot be checked. Mark sensitive sparse comparisons unranked; no claim that thresholding proves anonymity.
- [ ] Assert the two-driver key appears only in `suppressedKeys`, its value is absent from `cells`, `withheldTotals===true`, and invalid export/missing review return `ok:false`. Have an independent analyst/privacy reviewer reproduce findings and record their actual disposition.
- [ ] Commit with `feat(#42): gate aggregate outputs on privacy and lineage`.

**Acceptance:** Reproducible sensitivity and suppression results plus independent methodology/privacy review. #43 owns wording and authorisation to share; this issue never publishes automatically.

**Subagent boundary:** One implementer plus fresh reviewer for leakage/statistical errors. An AI review is supplementary and cannot supply external privacy approval.
