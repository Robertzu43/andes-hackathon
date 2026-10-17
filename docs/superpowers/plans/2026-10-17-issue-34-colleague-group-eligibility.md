# Issue #34: Gate colleague-group delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep unsupported group sends disabled while preserving opted-in individual colleagues and safe manual sharing with a clear response owner.

**Architecture:** Use an evidence-based group eligibility decision and existing individual notification/credential paths. Implement no group provider transport in this slice; supported group delivery requires a later exact-provider plan amendment and target-group walkthrough evidence.

**Tech Stack:** AWS ECS/Fargate, RDS PostgreSQL, SQS Standard (`emergency`/`ordinary` with separate DLQs); TypeScript/Fastify API and workers. Node.js 24 LTS, Fastify 5 and PostgreSQL 18 remain proposed versions to qualify/pin under #12; `pg`, `node:test`, `node:assert/strict`. No infrastructure or runtime is implemented by this plan revision.

**Spec:** Product: `docs/PLAN.md`, “Gate colleague-group delivery · #34”; contract baseline: `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Status and gates:** Proposed plan only; owner `Robertzu43`, original issue state `open`, original blockers `#33` unchanged. Planning/synthetic engineering readiness does not authorize provider activation, deployment, spending, participant contact or issue closure. User-selected execution: subagent-driven, one reviewed issue slice at a time after plan review.

**Additional handoffs:** #10/#31 supply current official account and target-group eligibility, #11 action window, #15 accepted contact consent, #24 stationary interaction contract, #29 scoped incident response, #30–33 individual delivery/retries. #12 supplies support configuration. Independent walkthrough evidence is required; documentation or account eligibility alone does not establish target-group operation.

**Group integration blocked:** Robert requires a WhatsApp alert to the selected driver group, with no individual SMS/calls inferred from membership. The eligibility/manual-sharing tasks below are preparatory and do not complete that requirement. Once actual Zavu account/target-group capability is verified, add a reviewed group adapter/job contract, recipient/location authorization model and real delivery tests. Its job is independent of individual channels and uses the same short authorization/outbox/recovery rules; unsupported group capability is explicitly missing. Manual sharing is not equivalent completion and cannot close #34.

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

## Review Focus

1. API documentation without account/target-group proof leaves groups conditional — Task 1 `documentation_is_not_group_support`.
2. Unavailable group transport still permits separately opted-in individual colleagues — Task 1 `individual_fallback_remains_available`.
3. Expired/revoked/forwarded credentials cannot expand into continuous location history — Task 2 `manual_link_scope_and_expiry`.
4. Manual share while moving is refused or deferred without requiring interaction — Task 2 `manual_share_requires_stationary_confirmation`.
5. Multiple readers with no confirmed responder keep action pending — Task 2 `group_read_is_not_response_ownership`.
---

### Task 1: Evaluate eligibility without adding a group integration

**Files:**
- Create `src/notifications/group-eligibility.ts`: pure evidence gate and available fallback modes.
- Create `docs/contracts/group-support.md`: dated account/group evidence and separately supported fallback cells.
- Create `tests/issue-34.test.mjs`: local eligibility fixtures; no real members/numbers/group IDs.

**Interfaces:** Consume #31 `SupportCell`/individual channel eligibility. Eligibility never creates consent, a contact or a provider request.

```ts
type GroupEvidence = {officialContractRef:string|null;checkedAt:Instant|null;
  validUntil:Instant|null;accountEligible:boolean|null;targetGroupSupported:boolean|null;
  receiptEvidenceRef:string|null;walkthroughEvidenceRef:string|null};
type GroupDecision = {group:'conditional'|'unavailable'|'evidence_complete';
  transportEnabled:false;individualFallback:boolean;manualSharing:boolean;reason:string};
evaluateGroupDelivery(input:{now:Instant;evidence:GroupEvidence;individualDeliverySupported:boolean;
  acceptedIndividualCount:number;manualSharingAllowed:boolean}):GroupDecision;
```

- [ ] **Step 1: Write failing tests** `documentation_is_not_group_support`, `individual_fallback_remains_available`, `unsupported_group_does_not_block_individual_channels`, and `complete_evidence_does_not_create_transport`.

```js
assert.equal(documentationOnly.group, 'conditional');
assert.equal(documentationOnly.transportEnabled, false);
assert.equal(unavailableGroup.individualFallback, true);
assert.equal(noIndividualConsent.individualFallback, false);
assert.equal(completeEvidence.group, 'evidence_complete');
assert.equal(completeEvidence.transportEnabled, false);
assert.equal(providerGroupCalls.length, 0);
```

Test false/null account eligibility, target group unsupported, no receipt/walkthrough, stale evidence requiring recheck under the approved support policy, and a supported individual country/language/channel with an unsupported group. Evidence fixtures contain references only, not participants or secret invitation URLs.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-34.test.mjs`; expect missing export or gate failures.
- [ ] **Step 3: Implement** `evaluateGroupDelivery`. Missing evidence or an absent/expired `validUntil` stays conditional; confirmed official ineligibility is unavailable. Individual fallback requires accepted, separately opted-in recipients and supported delivery cells. Manual sharing availability follows consent/safe-interaction rules. Even complete evidence returns `transportEnabled:false` in this slice because no official group adapter has been implemented/tested. Enabling that future path requires a reviewed plan amendment with exact SDK/API, actual target group, scope/recipient revocation semantics and authorized evidence; never unofficial personal-account automation.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-34.test.mjs`; require all gate cases to pass without any provider group call.
- [ ] **Step 5: Commit** exact Task 1 files with message `feat: gate colleague groups on eligibility evidence`.

### Task 2: Provide scoped stationary sharing and response ownership

**Files:**
- Create `src/incidents/sharing.ts`: authenticated manual share preparation and response-owner assignment.
- Modify `src/incidents/routes.ts`: `POST /v1/contact/incidents/:id/share-previews` and `POST /v1/contact/incidents/:id/response-owner`, plus authenticated `GET /v1/contact/incidents/:id/share-previews/:shareId`.
- Modify `src/incidents/state.ts` only for response-owner facts; create `db/migrations/issue-34-sharing.sql` for idempotent previews containing recipient scope/expiry/text; reuse #29 facts for ownership.
- Modify `tests/issue-34.test.mjs`; create `docs/evidence/issue-34.md`. Integrator handles route registration; no group messaging route is registered.

**Interfaces:** Consume #29 `ContactCredential`, response authorization and incident action facts; manual sharing targets an existing accepted recipient who already holds valid `incident_response` scope. The returned URL identifies a preview; it is not a bearer credential and requires that recipient’s existing authorization. The current contact-only endpoint permits stationary manual sharing by an authorized contact; a driver UI reuses the driver-authenticated command path only after #24 supplies its contract.

```ts
type ManualShareInput = {incidentId:Id;recipientId:Id;expectedRevision:number;
  idempotencyKey:string;stationaryConfirmed:boolean};
type SharePreview = {id:Id;text:string;responseUrl:string;expiresAt:Instant;recipientId:Id};
prepareManualShare(ctx:AppContext, credential:ContactCredential,
  input:ManualShareInput):Promise<Result<SharePreview>>;
readManualShare(ctx:AppContext, credential:ContactCredential,
  input:{incidentId:Id;shareId:Id}):Promise<Result<SharePreview>>;
confirmResponseOwner(ctx:AppContext, credential:ContactCredential,
  input:{incidentId:Id;expectedRevision:number;idempotencyKey:string}):Promise<Result<Incident>>;
```

- [ ] **Step 1: Add failing tests** `manual_link_scope_and_expiry`, `manual_share_requires_stationary_confirmation`, `group_read_is_not_response_ownership`, `response_owner_is_unique`, `manual_share_idempotency`, and `minimal_manual_payload`; add `sharing_revocation_ordering` and `response_owner_does_not_cancel_channels`, asserting revocation-first denies a new preview/read, earlier authorized responses may finish, and owner confirmation leaves required individual jobs eligible.

```js
assert.equal(movingShare.code, 'conflict');
assert.equal(expiredLink.statusCode, 404);
assert.equal(revokedRecipientLink.statusCode, 404);
assert.equal(liveMapUsingIncidentLink.statusCode, 404);
assert.equal(afterReaders.value.action, 'pending');
assert.equal(afterOwnerConfirmed.value.action, 'pending');
assert.equal(concurrentSecondOwner.code, 'conflict');
assert.equal('route' in sharePreview, false);
assert.deepEqual(repeatedPreview.value, sharePreview);
assert.equal(samePreviewKeyDifferentRecipient.code, 'conflict');
```

Use real PostgreSQL and two accepted synthetic contacts. Test a recipient outside the accepted circle, cross-incident link, forwarded link at another scope, invalid/revoked caller, simultaneous owner confirmations and owner subsequently unable to help. Test server responses contain only minimum attributed incident text/truck reference/expiring response URL; no continuous history, cargo or attachments.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-34.test.mjs`; expect new scope/action assertions to fail. A missing disposable `TEST_DATABASE_URL` is a failure.
- [ ] **Step 3: Implement** the three signatures using #29 scope/idempotency/revision checks and atomic facts. Require an explicit stationary confirmation from the safe interaction flow; it is self-report, not proof of phone/driver state, and never trigger a prompt while moving. Reuse #31’s approved recipient-language template fields for the minimal attributed text. Return a preview for the authorized human to share manually; this endpoint sends nothing. Store a stable preview result and its recipient/incident scope/expiry under the idempotency key; the same key/payload returns that saved result, different payload conflicts. Generate/read previews and assign ownership in short #17 `withTripTransaction` transactions, serialized with recipient revocation and incident resolution, without provider I/O. Trip arrival alone does not resolve SOS; a separately permitted incident-response credential may remain valid but cannot reveal newly revoked map data. A response already authorized before revocation may arrive afterward. Response ownership, ACK and group read never cancel other required channel jobs. The URL grants no access by itself: `readManualShare` requires the addressed recipient’s valid incident-response credential and denies other contacts, expiry or revocation. If no existing recipient credential is available, return unavailable and use the separately qualified individual delivery path; never expose a new bearer token through a reusable preview. One authenticated recipient may explicitly accept response ownership; views/delivery/group membership never assign it or imply assistance. If owner cannot help, record that fact, release ownership and keep action pending/unavailable until another recipient accepts; no silent reassignment. A copied link conveys no continuous-history access or response ownership. Reuse #29 credential hashes; do not persist raw tokens.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-34.test.mjs`; record scope/expiry/concurrency results and missing independent walkthrough in `docs/evidence/issue-34.md`.
- [ ] **Step 5: Commit** exact Task 2 files and approved registration with message `feat: support scoped manual incident sharing`.

**Original acceptance gate:** Official eligibility and actual existing-group support remain conditional unless evidenced. Independently walk through minimal payload, expiring scope, revocation and one clear response owner; no confirmed responder means action pending. Unsupported group delivery must not block useful one-to-one delivery. An explicit unavailable/conditional outcome preserves useful individual delivery, but leaves the required group integration unmet and #34 open. Documentation alone never proves working group delivery.

**Self-review:** Five review cases map to tests; individual/manual fallback remains useful, group transport remains disabled and no continuous-history permission is inferred. Driver-facing manual-share integration remains gated on #24’s exact safe-interaction contract; independent responsibility walkthrough is still required.
