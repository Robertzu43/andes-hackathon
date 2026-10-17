# Issue #20: Qualify road and time context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach only evidence-supported time and road context while keeping uncertain matches unknown and deadlines independent.

**Architecture:** A pure qualifier consumes approved location/time evidence and optional cached map candidates. Provider retrieval sits outside deadline execution; source/version/confidence are retained and geometry cannot diagnose fatigue, sleep or crime.

**Tech Stack:** Version candidates, gated on #12; architecture follows ADR-002: Node.js 24 LTS, TypeScript strict/ESM, Fastify 5, `pg`, PostgreSQL 18, `node:test` and `node:assert/strict`; AWS topology is selected in ADR-002; exact versions and implementation/evidence readiness remain gated.

**Spec:** [Product requirements](../../PLAN.md), [shared contracts and constraints](../specs/2026-10-17-robert-backend-contracts.md), [ownership](../../OWNERSHIP.md), and [original blockers](../../plan.json).

**Status:** Proposed/gated; planning only. Owner `Robertzu43`; original issue remains open. Original blockers: #19. Additional handoffs: #9 position/lifecycle limits; #12 accepted country/route support and map provider; #18 location/event types; independently reviewed route labels from Sebastian. Source/test paths below are future files, not an assertion that runtime code exists.

## Global Constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- No forced visual/manual response while moving; audio is not presumed safe.
- Recheck current trip and sharing grants for every location read/update delivery; revocation affects existing subscriptions as well as new requests.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Parallel roads inside the accuracy region remain ambiguous — Task 1 `parallel_roads`.
2. Poor/missing GPS or absent map coverage yields unknown context — Task 1 `unknown_map`.
3. Passing a petrol station never becomes reported rest or a safe-stop guarantee — Task 1 `passing_station`.
4. Cross-border/zone changes use observed evidence without changing deadlines — Task 1 `cross_zone`.
5. Slow/failing enrichment cannot delay the existing deadline path — Task 2 `map_timeout`.

---

## Execution gates and data contract

#12 must choose a map source only after #19/#9 trace accuracy is known and document actual SDK/API, coverage, caching/licensing, limits and timeout budget in `docs/evidence/issue-20-provider.md`. Extend Task 2 with exact verified calls before implementing/enabling a real provider; this plan contains no invented map endpoint. #12/#19 freeze the match criterion and freshness bounds in `docs/contracts/context.md` using reviewed locations, not a synthetic confidence threshold. Missing policy or provider evidence disables enrichment while existing deadlines continue.

### Task 1: Pure conservative time/road qualification

**Files:** Create `src/context/context.ts`, `tests/issue-20.test.mjs`, `tests/fixtures/issue-20-context.json`, `docs/contracts/context.md`.

**Interfaces:** Consume #18 `StoredLocation` and `EvidenceContext`, #16 `Trip`, baseline `Instant/Result`. Define in `context.ts`:

```ts
 type RoadCandidate = {segmentId:string;distanceM:number;source:string;version:string;confidence:number|null;curves:string[];mappedRestStops:string[]};
 type ContextPolicy = {maxSampleAgeMs:number;maxAccuracyM:number;maxClockSkewMs:number;minConfidence:number};
 type ContextInput = {sample:StoredLocation|null;now:Instant;startedAt:Instant;lastReportedBreakAt:Instant|null;zoneEvidence:{zone:string;source:string;observedAt:Instant}|null;countryEvidence:EvidenceContext;mapCandidates:RoadCandidate[]|null;mapCoverage:'supported'|'unsupported'|'unknown'};
 type QualifiedContext = {observedAt:Instant|null;localHour:number|null;elapsedTripMs:number;sinceReportedBreakMs:number|null;country:EvidenceContext;road:{segmentId:string;source:string;version:string;confidence:number;curves:string[];mappedRestStops:string[]}|null;reason:'qualified'|'missing_position'|'stale_position'|'uncertain_position'|'ambiguous_match'|'unsupported_map'|'unknown_zone';wellbeing:'unknown'};
 qualifyContext(input:ContextInput,policy:ContextPolicy):Result<QualifiedContext>;
```

`minConfidence` is meaningful only for the selected provider/version and approved criterion; no generic risk score. `zoneEvidence` needs independent location-to-zone provenance; device zone alone is insufficient. Use standard `Intl.DateTimeFormat` with explicit IANA zone and the sample's observed instant; unknown zone yields null local hour. Elapsed trip time uses server registration time; time since reported break is null if absent/future/contradictory, and neither implies continuous driving.

- [ ] **Step 1: Write failing tests** all Task 1 Review Focus cases, DST/offset transitions, absent break and impossible future timestamps. Fixtures hand-label one clear segment, parallel candidates, a station pass and unknown country; their numerical thresholds are marked synthetic test data.

```js
assert.equal(qualifyContext(parallel,policy).value.road,null);
assert.equal(qualifyContext(parallel,policy).value.reason,'ambiguous_match');
assert.equal(qualifyContext(noMap,policy).value.road,null);
assert.equal(qualifyContext(passingStation,policy).value.sinceReportedBreakMs,null);
assert.equal(qualifyContext(passingStation,policy).value.wellbeing,'unknown');
assert.equal(qualifyContext(unknownZone,policy).value.localHour,null);
assert.equal(qualifyContext(crossZone,policy).value.localHour,14); // fixed fixture UTC instant/zone
```

Define `parallel`, `noMap`, `passingStation`, `unknownZone`, `crossZone` and `policy` by importing JSON fixture literals; expected hours are hand-calculated and specified in that fixture. Include valid `America/Lima` and `America/Sao_Paulo` cases without making either the default. Invalid IANA zones must not throw through deadline processing.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-20.test.mjs`; expect missing qualifier/failing conservative-match assertions.
- [ ] **Step 3: Implement** finite-bound validation, nullable time context and uncertainty-aware candidate selection. Accept a single supported candidate only if the reviewed criterion places it within position uncertainty and excludes competing candidates; otherwise return null road. Keep curves and mapped rest stops as map facts, never proof of stopping, safe parking, sleep, theft or justification to force a response. Never modify a `Trip.deadlineAt` from local-hour derivation.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-20.test.mjs`; require all labelled cases and no date mutation; reject any criterion whose success needs more precision than #19 supports.
- [ ] **Step 5: Commit** `git add src/context/context.ts tests/issue-20.test.mjs tests/fixtures/issue-20-context.json docs/contracts/context.md` then `git commit -m "feat: qualify conservative road and time context"`.

### Task 2: Cached/bounded provider enrichment with deadline isolation

**Files:** Create `src/context/enrichment.ts`, `db/migrations/issue-20-context.sql`, `docs/evidence/issue-20.md`; modify `tests/issue-20.test.mjs`, `docs/contracts/context.md`.

**Interfaces:**

```ts
 type MapLookup = {sample:StoredLocation;country:string};
 type MapResult = {candidates:RoadCandidate[];source:string;version:string;coverage:'supported'|'unsupported'|'unknown'};
 type MapProvider = {lookup(input:MapLookup,signal:AbortSignal):Promise<Result<MapResult>>};
 type EnrichmentPolicy = {timeoutMs:number;cacheTtlMs:number};
 enrichContext(ctx:AppContext,provider:MapProvider,input:ContextInput,contextPolicy:ContextPolicy,enrichmentPolicy:EnrichmentPolicy):Promise<Result<QualifiedContext>>;
```

Cache only under the approved provider/version and qualified spatial cell contract; include country/coverage and expiration, never reuse across an incompatible route or accuracy envelope. #12 must specify cell precision from position/retention evidence before caching real observations. No precise participant route or whole provider response in logs. No map dependency in `deadlines` creation, claiming or dispatch; workers consume last qualified context or unknown.

- [ ] **Step 1: Write failing tests** `map_timeout`, stale cache/provider-version mismatch, independent deadline availability and zero lookups for unsupported input. Define `slowProvider` locally as a promise controlled by a test barrier that observes `AbortSignal`; use deterministic clock advancement rather than elapsed real sleeps.

```js
assert.equal(timedOut.value.road,null);
assert.equal(timedOut.value.wellbeing,'unknown');
assert.equal(providerAbortObserved,true);
assert.equal(deadlineAfterEnrichment.due_at.toISOString(),deadlineBeforeEnrichment.due_at.toISOString());
assert.equal(versionMismatchReused,false);
assert.ok(providerCalls<=1);
```

`deadlineBeforeEnrichment`/`deadlineAfterEnrichment` come from real PostgreSQL rows registered through #16; `providerCalls` and `providerAbortObserved` are fake-provider logs owned by this test. Test no-location and unsupported-country paths with zero provider calls. If the provider cannot cancel, detach its late result safely and do not cache it as current.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-20.test.mjs`; expect absent enrichment/timeout behavior failures.
- [ ] **Step 3: Implement** bounded cache/lookup with validated response size/types and abortable timeout, returning unknown context on failure. Use one cached lookup per qualified input within actual provider limits; omit batching and speculative prefetch until measured need justifies them. Write qualified context/source/version to restricted operational rows; source expiry cannot silently refresh sample age. Keep enrichment optional and asynchronous relative to urgent deadline execution.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-20.test.mjs`; timeout, cache-expiry and deadline invariance pass; run actual map adapter checks only after the provider evidence gate is satisfied.
- [ ] **Step 5: Commit** explicit Task 2 files with `git commit -m "feat: bound optional map enrichment and preserve deadlines"`.

## Acceptance and self-review

Compare representative qualified traces against independently reviewed ground truth: parallel roads, poor GPS, station pass, cross-zone/cross-border trips and unknown mappings. Record supported country/route/provider-version combinations and reject unsupported precise matches in `docs/evidence/issue-20.md`. The independent reviewer must verify uncertainty bounds and no false rest/safe-stop claim; synthetic fixtures cannot qualify real map accuracy or coverage. Give #23 conservative context/unknown fixtures without promoting geometry to a safety-risk score.

Self-review: all five failure modes are pinned; provider-specific code stays gated; source/version and null context are explicit; the deadline path has no map await. Context does not infer wellbeing or silently update arrival time.
