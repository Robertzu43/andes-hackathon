# Issue 41 Rates and Intervals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Calculate reproducible descriptive rates with correct exposure, missingness and driver-clustered uncertainty.

**Architecture:** Pure calculation over valid #40 export rows; no warehouse or dashboard required. Report each country/language/policy/route stratum before any justified pooled result.

**Tech Stack:** Proposed TypeScript and node:test; no new service or numerical dependency unless #12/#11 methodological review justifies it.

**Spec:** `docs/PLAN.md` #41; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; #40 `ContributionRow` contract.

## Global Constraints

- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.

## Review Focus

1. Zero delivered prompts: response/nonresponse rates are null, not zero (Task 1).
2. Outage exposure: registered hours remain in operational denominators while covered hours are separate (Task 1).
3. Duplicate/overlapping exposure and negative durations: reject invalid data (Task 1).
4. Many trips from one driver: no false independent-person sample size or meaningful cluster interval (Task 2).
5. Unknown delivery and uncorroborated reports: retain their counts separately (Task 1).

---

**Existing blocker:** #40. Real-data method and display wording require the independent analyst and evidence contract; later phase, not required for the live safety demo.

### Task 1: Compute hand-checkable rates and missingness

**Files:** Create `src/analysis/rates.ts`, `tests/issue-41.test.mjs`, `tests/fixtures/rates.json`, `docs/analysis/metrics.md`.

**Interfaces:** Consume `ContributionRow` from #40. Export `describeRates(rows: readonly ContributionRow[]): Result<RateSummary>` with:

```ts
type RateSummary = {
  drivers: number; trips: number; registeredHours: number; coveredHours: number;
  delivered: number; unknownDelivery: number; failedDelivery: number;
  eligible: number; suppressed: number; unansweredDelivered: number;
  nonresponsePerDelivered: number|null;
  fatigueReports: number; securityReports: number; corroboratedOutcomes: number;
  fatigueReportsPerRegisteredHour: number|null;
};
```

Rows must come from one declared comparable stratum; a wrapper groups by country/locale/policyVersion/routeCell before calling the function. Do not pool unknown country with a known country. No security-risk rate without an approved independent outcome/exposure mapping. #28 retains responsibility for useful-action delay/burden comparison; this function does not redefine it.

- [ ] Define a synthetic fixture with 2 drivers, 3 trips, 4 registered hours, 1 location-covered hour, 4 delivered prompts (1 unanswered), 2 unknown deliveries and 2 fatigue reports. Give exposure only to unique exposure rows. Add zero-denominator, duplicate-ID, negative-duration and overlap cases. Expected assertions:

```js
assert.equal(summary.drivers, 2);
assert.equal(summary.registeredHours, 4);
assert.equal(summary.coveredHours, 1);
assert.equal(summary.nonresponsePerDelivered, 0.25);
assert.equal(summary.unknownDelivery, 2);
assert.equal(summary.fatigueReportsPerRegisteredHour, 0.5);
assert.equal(emptySummary.nonresponsePerDelivered, null);
assert.equal(invalidResult.ok, false);
```

- [ ] Run `npm run build && node --test tests/issue-41.test.mjs`; expect missing rates implementation or assertion failures.
- [ ] Implement `describeRates` with explicit invalid-input results; document each numerator/denominator, interval boundaries, exclusions and self-report wording in `docs/analysis/metrics.md`. Validate coverage does not exceed registered exposure and response times are interpretable; uncertain timing must be excluded with a reason, not corrected by guessing.
- [ ] Run the same command; expect all assertions PASS and manually reconcile the fixture counts.
- [ ] Commit with `feat(#41): calculate exposure-aware descriptive rates`.

### Task 2: Estimate uncertainty at driver level

**Files:** Modify `src/analysis/rates.ts`, `tests/issue-41.test.mjs`, `docs/analysis/metrics.md`; create `docs/evidence/issue-41.md`.

**Interfaces:** Export `clusterInterval(rows: readonly ContributionRow[], config: IntervalConfig): Result<IntervalResult>`; `IntervalConfig={metric:'nonresponsePerDelivered'|'fatigueReportsPerRegisteredHour', confidence:number, resamples:number, seed:number}`; `IntervalResult={estimate:number|null, lower:number|null, upper:number|null, independentDrivers:number, reason:string|null}`. Reject confidence outside (0,1), nonpositive/noninteger resamples and unsafe integer seed. #11/independent methodology review freezes actual values before outcome inspection.

- [ ] Write tests for one driver, zero denominator, deterministic repeated seed and whole-driver resampling. Use confidence 0.95, 100 resamples and seed 7 only as synthetic test settings. The fixture has two drivers with different trip counts; every bootstrap draw carries all rows for each sampled driver, including exposure and numerator. Test that duplicate draws are treated as resampling weights, not rejected as duplicate source events.
- [ ] Run the issue command and observe the expected absent interval behavior.
- [ ] Implement deterministic seeded driver-cluster bootstrap: sort driver keys, draw the original number of drivers with replacement per replicate, and weight each chosen driver's entire numerator/exposure totals. Use a uint32 linear generator `state=(Math.imul(1664525,state)+1013904223)>>>0`, uniform `state/4294967296`, with initial `seed>>>0`; use sorted nearest-rank quantiles at `(1-confidence)/2` and `1-(1-confidence)/2`. Record the algorithm/version in `metrics.md`. Return null bounds with reason `insufficient_independent_drivers` for fewer than two drivers; any undefined replicate ratio yields reason `undefined_resample_denominator` and null bounds rather than silently dropping draws. These are reproducible proposed method choices subject to independent review, not efficacy claims.
- [ ] Assert repeated same-seed results deep-equal; bounds contain known fixture limits; one-driver bounds are null; interval driver count is 2 despite 3 trips. Have a second analyst reproduce the hand-labelled example and inspect sensitivity before accepting real results.
- [ ] Commit with `feat(#41): report driver-clustered uncertainty`.

**Acceptance:** Second analyst reproduces raw-to-result calculations and exclusions; all outward measures include coverage and uncertainty. Original #41 independent criterion remains mandatory.

**Subagent boundary:** One implementer, fresh statistical/code reviewer. Review algorithms against hand calculations, not against the same implementation copied into tests. Do not parallelize changes to the #40 row contract.
