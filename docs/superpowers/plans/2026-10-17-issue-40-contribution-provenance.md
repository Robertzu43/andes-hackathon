# Issue 40 Contribution Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Produce a minimal consented analytical dataset without conflating operational events, self-reports and corroborated outcomes.

**Architecture:** An explicit export from the existing database, not a streaming platform or new service. Consent and source lineage remain traceable; derived rows can be withdrawn.

**Tech Stack:** Proposed TypeScript, pg/PostgreSQL and node:test; prerequisite #12 must accept the baseline first.

**Spec:** `docs/PLAN.md` #40; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`.

## Global Constraints

- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Withdrawn/expired consent cannot produce new rows (Task 1 consent-window fixture).
2. Duplicate source events do not multiply exposure or reports (Task 1 uniqueness assertions).
3. Missing country/zone stays unknown rather than inheriting a phone prefix (Task 1 null provenance fixture).
4. Withdrawal after an export invalidates affected derived artifacts (Task 2 lineage assertions).
5. An incident alert is not a corroborated robbery/fatigue outcome (Task 1 report-tier assertions).

---

**Existing blocker:** #39. Later conditional phase: driver-value, consent/privacy and country-specific retention gates must pass; not part of the minimum hackathon demo. A synthetic fixture implementation is engineering-only and cannot close this issue.

### Task 1: Build the consent-filtered export

**Files:** Create `src/analysis/contribution.ts`, `tests/issue-40.test.mjs`, `tests/fixtures/contribution.json`, `db/migrations/issue-40-contribution-lineage.sql`. Consume #18 event exports; do not duplicate its schema.

**Interfaces:** Define and export `ContributionRow` in `src/analysis/contribution.ts`:

```ts
type ContributionRow = {
  sourceEventId: string; driverKey: string; tripKey: string; consentVersion: string;
  kind: 'exposure'|'prompt'|'fatigue_report'|'security_report'|'rest_report'|'corroborated_outcome';
  country: string|null; locale: 'es'|'pt-BR'; zone: string|null; routeCell: string|null;
  policyVersion: string; observedAt: string|null; receivedAt: string;
  eligible: boolean|null; suppressed: boolean|null;
  delivery: 'delivered'|'unknown'|'failed'|null;
  responded: boolean|null; responseAt: string|null;
  registeredMs: number; locationCoveredMs: number;
  exposureStart: string|null; exposureEnd: string|null;
  evidenceTier: 'observation'|'self_report'|'corroborated';
  sourceRef: string; corroborationRef: string|null;
};
type ContributionBatch = { exportId: string; rows: ContributionRow[]; excluded: {sourceEventId:string;reason:string}[] };
function exportContributions(ctx: AppContext, exportId: string, until: Instant): Promise<Result<ContributionBatch>>;
```

Pseudonymous keys use a scoped secret and version recorded in restricted storage; source mappings remain restricted and deletable. #39 must specify consent effective/withdrawal intervals, retention, route coarsening and allowed purposes before enabling a real-data export. Exposure rows are unique non-overlapping half-open intervals `[exposureStart, exposureEnd)` within each trip; registeredMs equals their duration. All non-exposure rows have zero exposure durations and null exposure bounds. Preserve missing source times rather than substituting receipt time.

- [ ] Write the fixtures and failing tests using local fixtures imported from `tests/fixtures/contribution.json` and database rows seeded by the test itself. Include consent-active, withdrawn, conflicting reports, duplicate event and unknown geography. Assert these expected properties:

```js
assert.equal(batch.rows.some(r => r.sourceEventId === withdrawnEventId), false);
assert.equal(new Set(batch.rows.map(r => r.sourceEventId)).size, batch.rows.length);
assert.equal(unknownCountryRow.country, null);
assert.equal(securityReport.evidenceTier, 'self_report');
assert.equal(securityReport.corroborationRef, null);
assert.equal(batch.rows.some(r => 'latitude' in r || 'phone' in r || 'token' in r), false);
```

- [ ] Run `npm run build && node --test tests/issue-40.test.mjs`; expect failure because the export module is absent or the stated assertions fail, not a missing database silently skipped.
- [ ] Implement `exportContributions` with parameterized queries, explicit exclusions and a consistent snapshot/consent check. Store export membership and invalidation state in the migration. Reject overlapping/negative exposure rather than silently summing it; restricted provenance refs must not become public URLs. No live dataset auto-export or publication.
- [ ] Run the same command; expect all listed assertions PASS and no raw coordinates/identifiers in exported rows.
- [ ] Commit source, test, fixture and migration with `feat(#40): export consented observations with lineage`.

### Task 2: Propagate withdrawal to derived artifacts

**Files:** Modify `src/analysis/contribution.ts`, `tests/issue-40.test.mjs`; create `docs/evidence/issue-40.md`.

**Interfaces:** Add `withdrawContribution(ctx: AppContext, driverId: Id, consentVersion: string): Promise<Result<{ invalidatedExportIds: string[] }>>`. #39's authorised withdrawal handler invokes it; it is not a public unauthenticated driver-ID endpoint. Downstream #41/#42 runs consume only still-valid exports and record their source export IDs.

- [ ] Add a withdrawal test that exports, withdraws, repeats withdrawal and tries to reuse the export: affected rows are removed or made inaccessible according to #39, dependent exports are invalid, rerun is idempotent, another driver's export stays valid. Assert `result.value.invalidatedExportIds.includes(exportId) === true` and a new export has no withdrawn rows.
- [ ] Run the issue command and observe the expected missing withdrawal behavior.
- [ ] Implement transactional withdrawal/invalidation plus a restricted artifact register. Define how already-downloaded artifacts are notified/deleted under #39; do not promise remote recall or erase unrelated operational records whose retention has another authorised basis.
- [ ] Run the issue tests; inspect a redacted raw-to-export reconciliation with a second analyst and record unresolved deletion limitations.
- [ ] Commit the changes with `feat(#40): invalidate derived contributions on withdrawal`.

**Acceptance:** Second analyst reconstructs inclusion/exclusion and source/consent lineage; privacy reviewer accepts the actual storage/export controls. No acceptance from pseudonymisation alone.

**Subagent boundary:** One implementer for both persistence tasks; fresh reviewer checks source-to-export leakage and withdrawal. Can draft alongside #41, but implementation #41 remains blocked by #40 acceptance.
