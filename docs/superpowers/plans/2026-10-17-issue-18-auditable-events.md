# Issue #18: Define auditable trip events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide versioned event contracts that preserve source, uncertainty, permissions and separate reports from observations and corroborated outcomes.

**Architecture:** Extend #12’s provisional envelope already used by #16; do not replace trip registration or retroactively mutate events. Typed payload validation, labelled fixtures and SQL reconciliation give an independent engineer enough information to reproduce timelines and denominators.

**Tech Stack:** Version candidates, gated on #12; architecture follows ADR-002: Node.js 24 LTS, TypeScript strict/ESM, Fastify 5, `pg`, PostgreSQL 18, `node:test` and `node:assert/strict`; AWS topology is selected in ADR-002; exact versions and implementation/evidence readiness remain gated.

**Spec:** [Product requirements](../../PLAN.md), [shared contracts and constraints](../specs/2026-10-17-robert-backend-contracts.md), [ownership](../../OWNERSHIP.md), and [original blockers](../../plan.json).

**Status:** Proposed/gated; planning only. Owner `Robertzu43`; original issue remains open. Original blockers: #2. Additional handoffs: #12 frozen provisional envelope; #16/#17 emitted events; #19 client session/sample emission; #25 delivery facts; #29 report/action states; #40 later analytical provenance. Source/test paths below are future files, not an assertion that runtime code exists.

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

1. Duplicate/reordered events do not double-count or overwrite later observations — Task 1 `ordered_identity`.
2. Device clock skew or missing zone produces uncertain latency, not invented precision — Task 1 `clock_uncertainty`.
3. Conflicting reports and telemetry never become confirmed sleep/crime — Task 1 `contradictory_reports`.
4. Offset/country changes do not move an agreed deadline — Task 2 `zone_change`.
5. Draft proposals, confirmed fields and revoked grants remain distinct and redact sensitive inputs — Task 2 `privacy_provenance`.

---

## Execution boundary and dictionary

#12 freezes contract version `1` for the initial implementation; this number versions a schema, not a safety policy. Use #16 `trip_events` storage and extend it through the integrator. `docs/contracts/events-v1.md` defines each field, units, null meaning, permitted source, access scope, retention and denominator eligibility. Country strings must be validated ISO country identifiers; known local zones are IANA identifiers and offsets are explicit minutes. Do not derive any country from phone prefix. Retention durations remain gated on the operational consent contract.

### Task 1: Typed event union and trusted ingestion

**Files:** Create `src/events/events.ts`, `db/migrations/issue-18-events.sql`, `tests/issue-18.test.mjs`, `tests/fixtures/issue-18-events.json`, `docs/contracts/events-v1.md`; modify `src/contracts.ts` only through integrator if #12 accepts additions.

**Interfaces:** Consume `EventEnvelope`, `Result`, `Actor`, `AppContext`, #14 `inTransaction`; define additional types in `events.ts`:

```ts
 type EvidenceContext = {country:string|null;locale:Locale|null;zone:string|null;offsetMinutes:number|null;provenance:'driver'|'device'|'provider'|'unknown';uncertainty:string|null};
 type EventMeta = {schemaVersion:1;clockEvidence:'verified'|'unknown';sessionId:Id|null;sequence:number|null;truckId:Id;context:EvidenceContext;visibility:'driver'|'accepted_contacts'|'restricted';accuracyM:number|null;sampleAgeMs:number|null};
 type ReportKind = 'fatigue'|'sleepiness'|'security_concern'|'attempted_robbery'|'robbery_theft'|'kidnapping'|'help_request';
 type ReportPayload = {reportId:Id;reportKind:ReportKind;reporterRole:'driver'|'contact';reportedAction:string|null;verification:'reported'|'disputed';evidenceRef:Id|null};
 type EventPayload =
   {kind:'driver_checkin';report:'ok'|'tired'|'help';promptId:Id|null;acceptedAt:Instant;disposition:'accepted'|'stale'}|
   {kind:'measurement';measurementId:Id}|
   {kind:'trip';action:'registered'|'rested'|'extended'|'resumed'|'resolved'|'cancelled';state:TripState;deadlineAt:Instant}|
   {kind:'deadline';deadlineId:Id;generation:number;phase:'scheduled'|'due'|'grace'|'expired'|'cancelled'}|
   {kind:'incident';incidentId:Id;phase:'active'|'checkin_due'|'grace'|'escalating'|'action_pending'|'resolved';sourceEventId:Id}|
   {kind:'notification';incidentId:Id;attemptId:Id|null;fact:'requested'|'queued'|'accepted'|'delivered'|'failed'|'answered'|'unknown'|'unable_to_deliver'|'no_contact_available'}|
   {kind:'observation';fact:'device_liveness'|'location';sampleId:Id|null}|
   {kind:'checkin';fact:'scheduled'|'send_accepted'|'delivery_observed'|'response'|'wellbeing_reported';relatedId:Id;value:string|null}|
   {kind:'report';report:ReportPayload}|
   {kind:'rest';phase:'planned'|'started'|'ended';reportedAt:Instant|null;tiredness:string|null}|
   {kind:'outcome';relatedReportId:Id;verdict:'corroborated'|'contradicted'|'unknown';evidenceRef:Id|null}|
   {kind:'draft';draftId:Id;draftRevision:number;modality:'audio'|'text';stage:'proposed'|'confirmed';fields:Record<string,unknown>}|
   {kind:'grant';grantId:Id;recipientId:Id;scope:'live_map'|'incident_response';expiresAt:Instant;revokedAt:Instant|null};
 type AuditEvent = EventEnvelope & {meta:EventMeta;payload:EventPayload};
 validateEvent(input:unknown):Result<AuditEvent>;
 appendEvent(client:import('pg').PoolClient,event:AuditEvent):Promise<Result<{eventId:Id;duplicate:boolean}>>;
 deriveLatency(event:AuditEvent):{ms:number|null;certainty:'measured'|'uncertain'};
```

The server authenticates actor and assigns `receivedAt`, `source`, visibility and permitted payload category; callers cannot self-assert provider acceptance or independent outcome. `appendEvent` is an internal transaction helper, not a public unguarded API. It parameterizes all SQL and verifies immutable duplicate payloads; same ID/different payload conflicts. Store independent outcomes in restricted `observer_outcomes` with source-evidence references, linked to events; server rules cannot write corroboration. Grant/draft/coordinate payload schemas are strict allowlists, not arbitrary JSON passthrough. Require `envelope.kind===payload.kind`; lifecycle/registration/deadline/incident/notification facts are server-source, raw device observations device-source, driver/contact reports attributed to that source, `driver_checkin` only driver-source, measurement references retaining the verified #25 source, and verified receipt facts provider-source. Only the restricted observer-import path can produce outcome facts. A source/kind combination outside the dictionary is rejected.

Domain audit records are separate from `OutboxIntent` commands: `trip.registered`, `trip.resolved`, `checkin.lost_contact_required`, `incident.security_help_required`, `incident.fatigue_rest_required` and `notification.required` are outbox kinds with their owning issue's payload schema, not `AuditEvent` union members. #16 emits audit `{kind:'trip',payload:{kind:'trip',action:'registered',state:'active',deadlineAt}}`; #17 uses the matching lifecycle action. Integrator updates those emitters plus #25/#27/#29–#33 projections to this dictionary; no generic JSON bypass. Existing provisional raw envelopes remain immutable: create a compatible read projection that derives missing metadata from the trip and marks unavailable context/clock provenance unknown. Test old/new rows together before routing consumers to that projection.

- [ ] **Step 1: Write failing tests** `ordered_identity`, `clock_uncertainty`, `contradictory_reports` and forged sources. JSON fixtures contain fixed synthetic IDs/times, es/pt-BR and labelled expected values; define `baseEvent`, `futureSource`, `report`, `duplicate` locally from those fixtures.

```js
assert.equal(validateEvent({...baseEvent,payload:{kind:'report',report:{...report,verification:'confirmed'}}}).ok,false);
assert.deepEqual(deriveLatency(futureSource),{ms:null,certainty:'uncertain'});
assert.equal((await appendEvent(client,baseEvent)).value.duplicate,false);
assert.equal((await appendEvent(client,baseEvent)).value.duplicate,true);
assert.equal((await appendEvent(client,{...baseEvent,observedAt:null})).code,'conflict');
assert.equal(validateEvent({...baseEvent,payload:{kind:'observation',fact:'sleep_detected',sampleId:null}}).ok,false);
assert.equal(validateEvent({...baseEvent,kind:'report',payload:{kind:'observation',fact:'location',sampleId:null}}).ok,false);
assert.deepEqual(provisionalRawAfterMigration,provisionalRawBeforeMigration);
```

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-18.test.mjs`; expect absent validator/storage failures.
- [ ] **Step 3: Implement** typed runtime validation, source/scope checks and immutable append; index event identity and session/sequence without assuming receipt order equals observation order. Nullable source time yields uncertain latency; sequence reset requires new session ID. Treat source-receipt time differences as measured only when `meta.clockEvidence==='verified'` under the frozen clock-evidence contract and observedAt <= receivedAt; otherwise preserve raw times and uncertainty. Contradictory accounts coexist and never silently upgrade verification. Keep private evidence references access-controlled.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-18.test.mjs`; duplicates count once, out-of-order observations stay reproducible, forbidden fact upgrades fail.
- [ ] **Step 5: Commit** explicit Task 1 paths with `git commit -m "feat: version auditable trip events and uncertainty"`.

### Task 2: Draft/location contracts and reproducible timeline queries

**Files:** Create `src/location/types.ts`, `db/queries/issue-18-reconcile.sql`, `docs/evidence/issue-18.md`; modify `docs/contracts/events-v1.md`, `tests/issue-18.test.mjs`, `tests/fixtures/issue-18-events.json`.

**Interfaces:** `src/location/types.ts` owns shared `LocationSample={sampleId:Id;sessionId:Id;sequence:number;observedAt:Instant;latitude:number;longitude:number;accuracyM:number|null;context:EvidenceContext}` and `StoredLocation=LocationSample & {tripId:Id;receivedAt:Instant}`. Coordinates are allowed only in restricted location storage, not duplicated into general audit logs; event `sampleId` references them. Draft confirmation references #16's exact `TripFields` and revision; grant scope is the common `live_map|incident_response` pair. #21 imports these types without redefining them.

- [ ] **Step 1: Write failing tests** `zone_change`, `privacy_provenance`, reordered sample identity and denominator reconstruction using independently written expected rows. SQL fixtures include one active trip spanning a coverage gap and two contradictory reports, rather than deriving expectations from query output.

```js
assert.equal(afterZoneChange.deadlineAt,'2026-10-17T18:00:00Z');
assert.equal(unknown.meta.context.zone,null);
assert.equal(proposed.payload.stage,'proposed');
assert.equal(confirmed.payload.stage,'confirmed');
assert.equal(JSON.stringify(publicTimeline).includes('rawAudio'),false);
assert.equal(JSON.stringify(publicTimeline).includes('bearer'),false);
assert.deepEqual(reconciled,{registeredTripHours:2,locationCoveredHours:1,reports:2,corroborated:0});
```

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-18.test.mjs`; expect missing dictionary/query assertions to fail.
- [ ] **Step 3: Implement** versioned sample/draft/grant dictionary and parameterized reconciliation SQL: timeline orders source/receipt/sequence explicitly, reports uncertain intervals, separates operational active trip-hours including gaps from qualified location exposure, and joins independent outcomes only by evidence linkage. Read projections enforce actor/recipient scope. Offset/time-zone changes affect local-hour presentation only; never recalculate an agreed deadline. Document permission/revocation history without serializing tokens or raw transcripts.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-18.test.mjs`; rebuild timelines from raw fixture rows in a fresh schema and verify fixed expected denominators and redaction.
- [ ] **Step 5: Commit** explicit Task 2 paths with `git commit -m "docs: define event provenance and reproducible reconciliation"`.

## Acceptance and self-review

Another engineer must reproduce the raw-event timeline and denominators, including duplicates, reordering, clock skew, offset changes, unknown country/zone, conflicts and sharing changes, on the recorded revision. Record their disposition and missing inputs in `docs/evidence/issue-18.md`; a fixture pass or AI review cannot substitute. Hand typed location/session contracts to #19/#21 and source-labelled facts to #25/#29/#40. No report or location update is a driver wellbeing response.

Self-review: five risks have assertions; common envelope stays compatible and draft activation remains #16's responsibility; #18 owns location types only, #21 owns authorization/storage policy. No hidden source-time correction or claim of confirmed crime/sleep is introduced.
