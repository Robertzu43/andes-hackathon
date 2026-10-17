# Issue #31: Qualify contact notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route only evidenced, opted-in notification attempts and prepare minimal attributed messages in the recipient’s supported language.

**Architecture:** Plan independent recipient/channel jobs in the incident transaction, then prepare minimum payloads inside #30’s short attempt-authorization transaction. Implement a real provider adapter only after its account, operations, templates, limits and receipt evidence are frozen; synthetic fixtures prove internal routing only.

**Tech Stack:** AWS ECS/Fargate, RDS PostgreSQL, SQS Standard (`emergency`/`ordinary` with separate DLQs); TypeScript/Fastify API and workers. Node.js 24 LTS, Fastify 5 and PostgreSQL 18 remain proposed versions to qualify/pin under #12; `pg`, `node:test`, `node:assert/strict`. No infrastructure or runtime is implemented by this plan revision.

**Spec:** Product: `docs/PLAN.md`, “Qualify contact notifications · #31”; contract baseline: `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Status and gates:** Proposed plan only; owner `Robertzu43`, original issue state `open`, original blockers `#30` unchanged. Planning/synthetic engineering readiness does not authorize provider activation, deployment, spending, participant contact or issue closure. User-selected execution: subagent-driven, one reviewed issue slice at a time after plan review.

**Additional handoffs:** #10 supplies eligible channels/countries/account and actual recipients, #11 supplies priority/deadline limits, #12 supplies secrets/runtime, #16 accepted contact/grants, #21 location freshness, #29 incidents/response credentials, and #30 ProviderPort/PrepareDispatch. #32 requires the chosen provider’s callback contract. Group delivery belongs to #34 and remains disabled here.

**Confirmed routing:** Explicit SOS requires WhatsApp, SMS and voice for the primary family/partner contact and selected additional person, deduplicated by accepted person identity across roles. All three are immediately eligible, with independent capacity and outcomes; ACK never suppresses the remaining channels. Eligibility remains a consent/account/language/country gate, not a delay behind WhatsApp. The selected driver group gets a separate WhatsApp-only job if #34 qualifies its real transport; membership alone adds no individual SMS/calls.

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

1. Unsupported country/language/channel never silently falls through to an untested provider — Task 1 `unsupported_matrix_cell`.
2. A revoked/wrong recipient is checked again inside attempt authorization — Task 1 `revocation_before_prepare`.
3. Missing/stale location and uncorroborated reports retain uncertainty — Task 1 `minimal_attributed_payload`.
4. Spanish and Brazilian Portuguese use independently approved content — Task 1 `recipient_locale_templates`.
5. Ambiguous provider acceptance cannot be normalized into failure/success — Task 2 `provider_outcomes_and_receipts`.
---

### Task 1: Gate routing and prepare minimal messages

**Files:**
- Create `src/notifications/dispatch.ts`: SQL-scoped job planning and #30 `PrepareDispatch` implementation.
- Create `src/notifications/eligibility.ts`: frozen support-matrix lookup reused by #34.
- Create `src/notifications/templates.ts`: approved locale/template field contracts, no full-route/cargo fields.
- Create `tests/issue-31.test.mjs`; define local synthetic policy, recipient, incident and provider fixtures.

**Interfaces:** Consume `NotificationJob`, `PreparedDispatch`, `PrepareDispatch`, `ProviderPort`, `enqueueNotificationJobs` from #30; #29 `PlanIncidentJobs`; #29 `issueIncidentResponseCredential` and `readIncidentNotificationSnapshot(client,incidentId,recipientId,now,locationPolicy):Promise<Result<IncidentNotificationSnapshot>>`; #17 `withTripTransaction`; #16 outbox. Consume #21 `LocationPolicy` from `src/location/locations.ts`. The #29 snapshot helper enforces incident-recipient consent plus a separate current `live_map` grant before coordinates and returns withheld/null without that grant; do not call #21’s live-map getter with an incident credential or duplicate its storage query. Check deadline provenance with #27 `isDeadlineIntentCurrent(client,intent)` inside the short trip transaction. The planner runs before the SOS command commits; it does no external I/O.

```ts
type SupportCell = {driverCountry:string;recipientCountry:string;locale:Locale;
  channel:Channel;status:'supported'|'conditional'|'unavailable'|'untested';evidenceRef:string|null};
type DispatchPolicy = {version:string;support:SupportCell[];responseLinkTtlMs:number};
type ChannelEligibility = {channel:Channel;eligible:boolean;reason:string};
evaluateRequiredChannels(policy:DispatchPolicy,input:{driverCountry:string;
  recipientCountry:string;locale:Locale;optedInChannels:Channel[]}):ChannelEligibility[];
createIncidentJobPlanner(policy:DispatchPolicy):PlanIncidentJobs;
createDispatchPreparer(ctx:AppContext, policy:DispatchPolicy, locationPolicy:LocationPolicy):PrepareDispatch;
```

- [ ] **Step 1: Write failing tests** `unsupported_matrix_cell`, `revocation_before_prepare`, `minimal_attributed_payload`, `recipient_locale_templates`, `expired_response_link`, and `routing_is_atomic`; add `all_sos_channels_immediately_eligible`, `ack_does_not_cancel_other_channels`, `trip_arrival_withholds_location_but_keeps_sos` and `group_membership_is_not_individual_consent`. Assert equal initial due times for all three jobs, distinct outcomes, no new coordinates after map revocation, and no individual job created solely by group membership.

```js
assert.equal(evaluateRequiredChannels(policy, untestedDestination).filter(c => c.eligible).length, 0);
assert.deepEqual(evaluateRequiredChannels(policy, allSupported).map(c => c.channel), ['whatsapp','sms','voice']);
assert.equal(await countJobs(twoRolesSamePersonIncidentId), 3);
assert.equal(afterRevoke.code, 'not_found');
assert.equal(prepared.fields.locationState, 'stale');
assert.equal(prepared.fields.reason, 'unconfirmed_status');
assert.equal(prepared.locale, 'pt-BR');
assert.equal('route' in prepared.fields, false);
assert.equal('cargo' in prepared.fields, false);
assert.equal(await countJobs(rolledBackIntentId), 0);
assert.equal(expiredLinkResponse.statusCode, 404);
```

Implement local helpers and seed independent expected payload fields. Test different driver/recipient countries, international numbers, Spanish versus Brazilian Portuguese, unsupported locale, missing location, source attribution for reported security/fatigue, and an accepted contact removed after routing. Neither number prefix nor account country substitutes for declared destination support.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-31.test.mjs`; expect missing modules/failed assertions; require disposable PostgreSQL rather than skipped tests.
- [ ] **Step 3: Implement** the planner/preparation interfaces. `evaluateRequiredChannels` returns exactly three cells in WhatsApp/SMS/voice order, each with an explicit eligibility/reason; this order is display order, not execution priority. Qualify each accepted recipient's channels independently using current documented support cells and consent. `createIncidentJobPlanner` returns #29's SQL-only callback: use the caller's transaction, deduplicate accepted person identity across roles, create every supported SOS channel job with the same immediate due time and `queueClass:'emergency'`, and use #30 enqueue to persist publication intents. No separate asynchronous routing step may be required to make a committed SOS durable. Persist missing-channel capability facts; partial support is not full requirement completion. No recipients means `no_contact_available`; all channels definitively unavailable means `unable_to_deliver`, never inferred action. Ordinary routes remain policy-gated and use `ordinary`; production authorization expiry/budgets must come from #11/#10, not an invented SOS delay.

  Preparation rechecks source, incident state, current accepted recipient/channel permission and policy in #30's short transaction, including deadlines only when provenance exists. An open SOS may survive trip closure with current incident consent; #29's snapshot returns withheld/null without live-map consent. Create a fresh expiring incident-response credential in this transaction and return its raw URL only in memory. Load qualified location with age/accuracy/state, driver/truck reference and attributed reason; bound fields by verified template limits, with no cargo, full routes or attachments. Snapshot hash is for audit, not a recoverable payload. A previously authorized snapshot may still be sent after revocation, and its disclosed coordinates cannot be recalled. No provider/template lookup or any other network I/O occurs in preparation.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-31.test.mjs`; require both locale paths, revocation and rollback tests to pass.
- [ ] **Step 5: Commit** exact Task 1 files with message `feat: gate minimal contact notification payloads`.

### Task 2: Bind and qualify the selected provider

**Files:**
- Create `docs/contracts/messaging-provider.md`: actual account/channel/SDK/API/template/callback/limit contract and evidence links.
- Create `src/notifications/provider.ts`: verified external implementation of #30 `ProviderPort`.
- Modify `tests/issue-31.test.mjs`; create redacted `tests/fixtures/issue-31/` provider-contract fixtures and `docs/evidence/issue-31.md`.
- Integrator wires the selected provider and preparer into `src/worker.ts`; installs an official SDK only if selected and justified, then updates lockfile.

**Provider decision:** Robert selected Zavu and authorized applicable Andes credits. No redemption or channel activation has occurred. Do not reopen provider selection unless a concrete qualification failure requires an alternative.

**Task 2 blocked — mandatory pre-implementation gate:** #10/#12 must qualify the Zavu account; freeze dated official SDK version or HTTP operation/path, authentication/secrets, per-channel account/destination eligibility, accepted template IDs/languages, request/response schemas, limits, timeout/abort semantics, provider IDs, upstream idempotency support, status-query operation and callback signature contract. Append those exact operations and sanitized response fixtures to this plan before Task 2 code. The current plan intentionally supplies no invented endpoint/signature and is not a deployable adapter specification.

**Interfaces:** `createProviderAdapter(config:ProviderConfig):ProviderPort`, with `ProviderConfig={contractPath:string,secretRef:string}`; the selected verified implementation loads deployment secrets without exposing them in errors or logs. #30 owns the send/reconcile input/output types. `contractPath` identifies reviewed configuration, never arbitrary runtime user input.

- [ ] **Step 1: Write failing tests** `provider_outcomes_and_receipts`, `permanent_provider_error`, `account_rate_limit`, and `provider_payload_redaction` and `adapter_invokes_send_once` against the selected provider’s real documented request/response fixtures. Stub only the network transport; assert exact official operation/body fields frozen above.

```js
assert.deepEqual(accepted, {state:'accepted', providerId:fixtureMessageId});
assert.equal(acceptedThenTimeout.state, 'unknown');
assert.equal(permanentFailure.permanent, true);
assert.equal(rateLimited.retryAfterMs, fixtureRetryAfterMs);
assert.equal(logs.some(entry => entry.includes(rawResponseToken)), false);
assert.equal(unverifiedReconciliation.state, 'unknown');
```

Test WhatsApp one-to-one, SMS and voice only for separately supported cells; unsupported channels remain disabled. Never infer delivered/answered from API acceptance or synthesize a recipient receipt. If no official status lookup/idempotency feature exists, the adapter reports that limit honestly for #33.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-31.test.mjs`; require failures in the new mapping tests before implementation.
- [ ] **Step 3: Implement** `createProviderAdapter` using only the frozen official operations. Preserve provider IDs and accepted/rejected/unknown distinctions; unexpected/missing responses and post-initiation transport failures remain unknown. Apply validated channel/destination/template limits and disable automatic SDK/HTTP retries. `reconcile` performs read-only official status lookup and never resends an ambiguous operation; absent lookup returns unknown. A timeout or abort cannot prove nonacceptance. No personal-account automation or real sends from tests.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-31.test.mjs`. After separately authorized provider testing, attach message/call IDs, timestamped arrival observations/screenshots, response-link checks, and Spanish/Brazilian Portuguese comprehension records by country/channel/language to `docs/evidence/issue-31.md`.
- [ ] **Step 5: Commit** exact Task 2 files and approved integration changes with message `feat: bind qualified messaging provider` only after its code tests pass; keep missing recipient evidence explicit.

**Original acceptance gate:** Opted-in recipients receive and understand attributed messages and requested action within #11’s T_action. Verified provider receipts plus independent recipient observation and language comprehension are required. Unproven routes stay conditional/disabled; a single-country success is not Latin American availability. Engineering completion cannot close #31 without those records.

**Self-review:** All five review cases have task tests; minimal freight context, opt-in, revoked/expired links and locale/country separation are covered. Exact provider API is deliberately gated and must be added before adapter execution; no outbound message or provider activation is authorized here.
