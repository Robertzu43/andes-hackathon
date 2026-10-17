# Issue #29: Define action and uncertainty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist attributed incident reasons and distinct delivery, acknowledgement, action and driver-status facts.

**Architecture:** Persist explicit SOS incident, qualified per-recipient/channel jobs and publication outbox in the authenticated command transaction. Keep one active SOS episode per trip with attributed report facts; contact actions use separately scoped credentials. Consume ordinary escalation intents only when their evidence-gated policy is enabled.

**Tech Stack:** AWS ECS/Fargate, RDS PostgreSQL, SQS Standard (`emergency`/`ordinary` with separate DLQs); TypeScript/Fastify API and workers. Node.js 24 LTS, Fastify 5 and PostgreSQL 18 remain proposed versions to qualify/pin under #12; `pg`, `node:test`, `node:assert/strict`. No infrastructure or runtime is implemented by this plan revision.

**Spec:** Product: `docs/PLAN.md`, “Define action and uncertainty · #29”; contract baseline: `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Status and gates:** Proposed plan only; owner `Robertzu43`, original issue state `open`, original blockers `#4` unchanged. Planning/synthetic engineering readiness does not authorize provider activation, deployment, spending, participant contact or issue closure. User-selected execution: subagent-driven, one reviewed issue slice at a time after plan review.

**Additional handoffs:** #12 freezes contracts/coordination, #14 supplies authenticated API/test context, #16 supplies grants and generic outbox, #17 supplies short trip transactions, #25/#27 supply phase/deadline intents. #11 supplies T_action and independent incident labels. #30/#31 consume notification intents; #32 adds provider receipts. Shared registration/migration numbering belongs to the integrator.

**Authoritative decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) replaces earlier provider-call session locks, global dispatch fences and promises of no physical send after closure. This plan is a design, not executed tests or runtime readiness.

## Global Constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- A relevant committed closure/revocation/resolution stops new affected attempt authorizations. A previously authorized attempt may start or finish later; preserve it as in flight/unknown until reconciled. No provider I/O holds a SQL connection or transaction.
- Arrival/cancellation stops map publication and ordinary work; it does not resolve an open SOS. Incident resolution is a separate authenticated driver action. ACK/read/answered-call does not cancel other required channels.
- Explicit SOS makes WhatsApp, SMS and voice independently eligible immediately for each deduplicated opted-in individual recipient. Unsupported cells are explicit missing capabilities; group membership grants no individual SMS/voice consent.
- PostgreSQL is authoritative; transactional outbox publishes only IDs/versions to SQS Standard emergency/ordinary queues. Redelivery, DLQ redrive and expired leases never authorize a blind replay of an ambiguous attempt.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.
- Trip mutation, revision, audit event and required outbox intent commit on the same PostgreSQL client/transaction.
- Do not promise exactly-once provider delivery.

**Deadline provenance rule:** Invoke #27 `isDeadlineIntentCurrent` only for deadline-derived work with both deadlineId and generation present. Partial/malformed provenance is rejected. Explicit-help/fatigue intents and their notification jobs have neither field; validate their authenticated source, current trip/incident and recipient consent directly, without waiting for or requiring an expired check-in. Add an unsolicited-help-before-any-expiry test that reaches the eligible notification path.

## Review Focus

1. A missed reply is unknown, never a robbery/fatigue diagnosis — Task 1 `missed_checkin_is_unknown`.
2. Acknowledgement followed by inability to help remains action pending — Task 2 `ack_then_unavailable`.
3. Two contact reports disagree without erasing provenance — Task 2 `contradictory_reports_are_retained`.
4. A revoked, expired or wrong-purpose response credential discloses no incident — Task 2 `response_scope_is_enforced`.
5. Duplicate SOS reports reuse one active episode; closed ordinary work cannot reopen — Task 1 `duplicate_and_closed_intents`.
---

### Task 1: Persist the incident model and escalation intent

**Files:**
- Create `src/incidents/state.ts`: incident types and transactional materialization.
- Create `db/migrations/issue-29-incidents.sql`: incidents, incident facts, input deduplication; extend scoped grants with incident scope only if #16 has not already supplied it.
- Create `tests/issue-29.test.mjs`; use `tests/helpers/context.mjs` from #14 and define local synthetic trip/intent fixtures.
- Modify the #27 consumer registration only through the integrator; do not change its deadline computation.

**Interfaces:** Consume common `Id`, `Instant`, `Locale`, `Result`, `EventEnvelope`, `AppContext` from `src/contracts.ts`, `ContactCredential={token:string}` and #16 `OutboxIntent` from `src/trips/registration.ts`; use #17 `withTripTransaction<T>(ctx:AppContext,tripId:Id,work:(client:PoolClient)=>Promise<T>):Promise<T>` from `src/trips/coordination.ts` and #27 `isDeadlineIntentCurrent(client:PoolClient,intent:OutboxIntent):Promise<boolean>` from `src/checkins/deadlines.ts`.

```ts
type IncidentReason = 'security_help' | 'fatigue_rest' | 'unconfirmed_status';
type IncidentPhase = 'active' | 'checkin_due' | 'grace' | 'escalating' | 'action_pending' | 'resolved';
type DeliveryState = 'not_requested' | 'pending' | 'queued' | 'accepted' | 'delivered' | 'failed' | 'answered' | 'unknown' | 'unable_to_deliver' | 'no_contact_available';
type ActionState = 'unknown' | 'pending' | 'attempted' | 'assistance_arranged' | 'unavailable';
type Incident = { id: Id; tripId: Id; revision: number; reason: IncidentReason;
  phase: IncidentPhase; delivery: DeliveryState; urgency: 'agreed' | 'explicit_help'; action: ActionState;
  driverStatus: 'unknown' | 'reported_ok' | 'reported_needs_help'; sourceEventId: Id };
projectEscalationPhase(input:{tripState:TripState;incidentResolved:boolean;openSecurityIncident:boolean;
  checkinPhase:'idle'|'due'|'grace'|'expired';action:ActionState}):IncidentPhase|null;
type PlanIncidentJobs = (client:PoolClient,incident:Incident,sourceIntent:OutboxIntent)=>Promise<void>;
materializeIncident(client:PoolClient,intent:OutboxIntent,planJobs:PlanIncidentJobs):Promise<Result<Incident>>;
processEscalationIntents(ctx:AppContext,limit:number,planJobs:PlanIncidentJobs)
  :Promise<{applied:number;obsolete:number}>;
```

- [ ] **Step 1: Write failing tests** `missed_checkin_is_unknown`, `duplicate_and_closed_intents`, `attributed_help_and_fatigue`, and `rollback_has_no_notification`.

```js
assert.equal(projectEscalationPhase({tripState:'active',incidentResolved:false,openSecurityIncident:false,checkinPhase:'due',action:'unknown'}), 'checkin_due');
assert.equal(projectEscalationPhase({tripState:'active',incidentResolved:false,openSecurityIncident:false,checkinPhase:'grace',action:'unknown'}), 'grace');
assert.equal(missed.value.reason, 'unconfirmed_status');
assert.equal(missed.value.driverStatus, 'unknown');
assert.equal(missed.value.action, 'unknown');
assert.equal(missed.value.delivery, 'pending');
assert.equal(sos.value.urgency, 'explicit_help');
assert.equal(fatigue.value.reason, 'fatigue_rest');
assert.equal(duplicate.value.id, first.value.id);
assert.equal(await countNotificationIntents(closedOrdinaryTripId), 0);
assert.equal(await countNotificationIntents(rolledBackTripId), 0);
```

The test file must implement `countNotificationIntents(tripId)` to count #30 job-publication outbox rows using parameterized SQL and fixed independent fixture IDs; none of these names exists yet. Add `sos_atomic_jobs_outbox`, `different_keys_share_active_sos`, `arrival_does_not_resolve_sos`, and `resolved_episode_allows_new_sos`: assert one incident and one job per required supported channel/person, all corresponding publication rows, and no rows after rollback. Arrival keeps the SOS open but withholds new map coordinates; ACK leaves all three channel jobs eligible. Seed due/grace/escalated lifecycle inputs to assert each phase projection; an explicit-help intent does not wait for missed-check-in grace.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-29.test.mjs`; expect a missing-module/export or explicit failed assertion before implementation. Missing `TEST_DATABASE_URL` is a setup failure, never a passing skip.
- [ ] **Step 3: Implement** the signatures above. `projectEscalationPhase` resolves only an explicitly resolved incident; a closed trip without a security incident returns null (no active ordinary phase), while an open SOS stays action pending regardless of arrival or contact ACK. Due/grace remain distinct; synthetic expiry may project escalating, but automatic no-response escalation is disabled until #11/#24 define and validate its audience/limits. An explicit SOS never depends on a timer.

  Materialize `incident.security_help_required` in the same transaction as the authenticated #26 report: persist source event/time/actor, active incident, call `planJobs`, persist audit facts and mark the source intent consumed before commit. `PlanIncidentJobs` is injected from #31 and calls #30 enqueue; it may record unavailable channel capability but cannot silently omit required channel outcomes. Tests use an explicitly synthetic planner. No SOS acceptance response precedes this commit. A failed materializer `Result` or planner failure must abort the outer transaction: the command converts it to a domain abort before `withTripTransaction` can commit, then maps it back at the API boundary. Test failure after incident insert leaves zero incident/job/outbox rows. Ordinary `checkin.lost_contact_required` and `incident.fatigue_rest_required` consumers preserve policy/deadline provenance and use the same SQL-only materializer. Do not send externally or publish SQS inside this transaction.

  Deduplicate request keys with content hashes; reject key reuse with changed content. Deduplicate source intents and enforce one unresolved security incident per trip, so simultaneous distinct report keys share the same episode/jobs while preserving all report facts. A subsequent SOS after resolution starts a new episode. Use the short #17 transaction and stable trip-before-intent row order. Reject obsolete ordinary deadline work, but never treat trip arrival as resolving an existing security incident or suppressing its continuing permitted jobs. All complete deadline provenance uses #27's validity seam; unrelated trip revisions do not obsolete current work.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-29.test.mjs`; require all Task 1 assertions to pass against real PostgreSQL, including injected rollback, same-key/content conflict, simultaneous different-key SOS taps and separate episodes after resolution.
- [ ] **Step 5: Commit** `git add src/incidents/state.ts db/migrations/issue-29-incidents.sql tests/issue-29.test.mjs && git commit -m "feat: preserve incident reason and uncertainty"`.

### Task 2: Authorize and record contact action separately

**Files:**
- Create `src/incidents/access.ts`: opaque incident-response credentials, scope checks and minimal notification snapshot.
- Create `src/incidents/routes.ts`: `POST /v1/contact/incidents/:id/actions` and driver-authenticated `POST /v1/incidents/:id/resolve`. Reuse #14 `Actor` authentication; never accept actor identity from the body.
- Modify `src/incidents/state.ts`, `tests/issue-29.test.mjs`; create `docs/evidence/issue-29.md`.
- Route registration in `src/api/app.ts` is an integrator edit; reuse the #14 error/result mapping.

**Interfaces:** `ContactActionInput={incidentId:Id, expectedRevision:number, idempotencyKey:string, kind:'acknowledged'|'attempted_contact'|'assistance_arranged'|'unable_to_help', observedAt:Instant, note:string|null}`; authenticated scope comes from the credential, never a body contact ID.

```ts
type IncidentNotificationSnapshot = {driverReference:string;truckReference:string;reason:IncidentReason;
  attribution:{source:EventEnvelope['source'];observedAt:Instant|null;corroboration:'unverified'|'independently_corroborated'};
  location:{state:'current'|'stale'|'unavailable'|'withheld';latitude:number|null;longitude:number|null;
    observedAt:Instant|null;ageMs:number|null;accuracyM:number|null}};
readIncidentNotificationSnapshot(client:import('pg').PoolClient, incidentId:Id,
  recipientId:Id, now:Instant, policy:LocationPolicy):Promise<Result<IncidentNotificationSnapshot>>;
issueIncidentResponseCredential(client: import('pg').PoolClient,
  input: {tripId: Id; incidentId: Id; recipientId: Id; expiresAt: Instant}): Promise<ContactCredential>;
recordContactAction(ctx: AppContext, credential: ContactCredential,
  input: ContactActionInput): Promise<Result<Incident>>;
resolveIncident(ctx:AppContext,actor:Actor,
  input:{incidentId:Id;expectedRevision:number;idempotencyKey:string}):Promise<Result<Incident>>;
```

- [ ] **Step 1: Add failing tests** `ack_then_unavailable`, `contradictory_reports_are_retained`, `response_scope_is_enforced`, `contact_idempotency_conflict`, and `contact_cannot_confirm_driver`, and `notification_snapshot_is_minimal_and_scoped`; add `driver_resolution_is_separate` and `resolution_preserves_authorized_attempt`. Assert wrong-driver/contact resolution fails, expected revision/idempotency are enforced, future authorization is denied after commit and a previously authorized attempt may finish afterward.

```js
assert.equal(afterAck.value.action, 'pending');
assert.equal(afterUnable.value.action, 'unavailable');
assert.equal(afterUnable.value.driverStatus, 'unknown');
assert.deepEqual(facts.map(f => f.kind), ['acknowledged', 'unable_to_help']);
assert.equal(otherContactResult.code, 'not_found');
assert.equal(changedPayloadSameKey.code, 'conflict');
assert.equal(providerReceiptCreatedActionFacts, 0);
assert.equal(noMapGrantSnapshot.value.location.state, 'withheld');
assert.equal(noMapGrantSnapshot.value.location.latitude, null);
```

Test expired/revoked credentials, `live_map` tokens, another incident/trip, immutable conflicting reports from two allowed contacts, stale revision, late action after resolution, and the body field `driverId`. Implement local fixture/query helpers in this test file, not new shared test infrastructure.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-29.test.mjs`; expect the new scope/action assertions to fail.
- [ ] **Step 3: Implement** the four signatures and routes. Generate opaque credentials with cryptographic randomness; persist only their hashes, recipient/trip/incident scope, expiry, purpose `incident_response` and revocation. Require accepted recipient permission, notes of at most 1,000 UTF-8 bytes and valid timestamps (an engineering payload limit, not a safety threshold); enforce idempotency and revision in the same transaction. The snapshot helper verifies accepted/unrevoked recipient and incident-notification permission, then delegates to #21’s shared `readGrantedLocation(client:PoolClient,tripId:Id,recipientId:Id,now:Instant,policy:LocationPolicy):Promise<Result<LocationSnapshot>>` from `src/location/locations.ts` inside the short shared trip transaction, with #21’s `LocationPolicy` from that module. That internal helper requires a current recipient `live_map` grant and reuses the public map’s latest-sample qualifier. If map consent is missing/revoked, return `withheld` and null coordinates; never infer location-sharing permission from incident scope. Otherwise preserve current/stale/unavailable, age and attribution. It never uses an incident credential as live-map access or returns history/cargo. Add revoked recipient and stale/missing location assertions. Store acknowledgement and action timestamps separately with source attribution; acknowledgement/answered call never sets assistance or driver confirmation. Contradictory reports remain facts; do not auto-resolve from contact/provider action. Closed trips revoke live-map scope; separately permitted incident-response records obey their own expiry/retention. ACK/read/answered-call never cancels required channel jobs. Add a separate authenticated driver incident-resolution command; it serializes with authorization and cancels only jobs not yet authorized, retaining in-flight/unknown attempts. Arrival or a generic “estoy bien” report cannot invoke it implicitly.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-29.test.mjs`. Record revision/results and missing external evidence in `docs/evidence/issue-29.md`.
- [ ] **Step 5: Commit** the exact Task 2 files and integrator-approved route registration with message `feat: record scoped contact action facts`.

**Original acceptance gate:** Independent scenario labels must map every transition to appropriate action/uncertainty. Define useful action from real incident timelines; if nobody can act within evidence-defined T_action, narrow the promise. Synthetic transitions cannot establish earlier useful action or close #29.

**Self-review:** Product reasons, urgent route, unknown/no-contact/unavailable states, source attribution and orthogonal action are covered. Five review cases map to named tests. No provider integration, safety threshold or external acceptance is invented; independent labels remain missing until supplied.
