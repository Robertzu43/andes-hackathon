# Issue #32: Separate receipt from action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate provider callback bytes and preserve receipt history without conflating delivery with human action.

**Architecture:** Verify the exact raw HTTP body using the selected provider’s frozen contract before parsing/normalizing events. Store authenticated immutable receipt facts keyed by provider event identity, and derive delivery state without changing contact-action or driver-confirmation facts.

**Tech Stack:** AWS ECS/Fargate, RDS PostgreSQL, SQS Standard (`emergency`/`ordinary` with separate DLQs); TypeScript/Fastify API and workers. Node.js 24 LTS, Fastify 5 and PostgreSQL 18 remain proposed versions to qualify/pin under #12; `pg`, `node:test`, `node:assert/strict`. No infrastructure or runtime is implemented by this plan revision.

**Spec:** Product: `docs/PLAN.md`, “Separate receipt from action · #32”; contract baseline: `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`; original ownership/blockers: `docs/plan.json`.

**Status and gates:** Proposed plan only; owner `Robertzu43`, original issue state `open`, original blockers `#31` unchanged. Planning/synthetic engineering readiness does not authorize provider activation, deployment, spending, participant contact or issue closure. User-selected execution: subagent-driven, one reviewed issue slice at a time after plan review.

**Additional handoffs:** #31 must freeze provider identity, signature/replay scheme, schemas, IDs and callback retry/response contract; #12 supplies secrets/request limits. #29 owns action/incident state and #30 owns attempts. Integrator registers raw-body route handling before generic parsing; the selected Fastify body strategy must preserve bytes exactly.

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

1. Re-serialized JSON or altered whitespace is not a substitute for signed raw bytes — Task 1 `signature_uses_raw_bytes`.
2. Invalid, expired or replayed callback authentication cannot create receipt facts — Task 1 `callback_authentication_failures`.
3. Unknown provider IDs and cross-account callbacks cannot mutate another attempt — Task 2 `receipt_scope_is_enforced`.
4. Duplicated/out-of-order contradictory receipts remain auditable without regressing closure — Task 2 `duplicate_and_late_receipts`.
5. Answered call, voicemail, unread delivery and acknowledgement without help stay distinct — Task 2 `receipts_never_create_useful_action`.
---

### Task 1: Authenticate callback bytes at the HTTP boundary

**Files:**
- Create `src/notifications/callbacks.ts`: callback request/verifier/normalized-event contracts and service.
- Create `src/notifications/callback-routes.ts`: `POST /v1/provider/callbacks/:provider` using bounded raw bytes.
- Create `tests/issue-32.test.mjs` and `tests/fixtures/issue-32/` with synthetic and approved redacted provider fixtures.
- Integrator modifies `src/api/app.ts` to register the route/parser with the verified provider contract; do not change body parsing globally without tests.

**Real verifier integration blocked — execution gate:** Extend `docs/contracts/messaging-provider.md` and this task with exact provider callback header names, canonical signing input, algorithm/SDK verification operation, replay/timestamp rule, secret rotation, expected success/error status and maximum payload size. None is selected today; synthetic verifier tests exercise plumbing only and cannot qualify authentication. No guessed HMAC format or endpoint challenge response is allowed.

**Interfaces:** Consume #30 attempt identity and common `Instant`/`Result`. Provider identity comes from configured route/account registration, never trusted body values.

```ts
type RawCallback = {provider:string;method:'POST';url:string;
  headers:Record<string,string|string[]|undefined>;body:Uint8Array;receivedAt:Instant};
type Receipt = {providerEventId:string;providerId:string;accountRef:string;
  status:'queued'|'accepted'|'delivered'|'failed'|'answered'|'unknown';
  occurredAt:Instant|null;detailCode:string|null};
type VerifiedCallback = {replayKey:string;receipts:Receipt[]};
type CallbackVerifier = {verify(request:RawCallback):Promise<Result<VerifiedCallback>>};
handleProviderCallback(ctx:AppContext, verifier:CallbackVerifier,
  request:RawCallback):Promise<Result<{duplicate:boolean;recorded:number}>>;
```

- [ ] **Step 1: Write failing tests** `signature_uses_raw_bytes`, `callback_authentication_failures`, `oversized_or_malformed_body`, and `callback_secret_rotation` using Fastify injection with byte-identical fixtures.

```js
assert.deepEqual(seenByVerifier, originalBodyBytes);
assert.equal(tamperedResponse.statusCode, fixtureUnauthenticatedStatus);
assert.equal(await receiptCount(), 0);
assert.equal(oversizedResponse.statusCode, 413);
assert.equal(validCurrentKeyResponse.statusCode, fixtureSuccessStatus);
assert.equal(expiredKeyResponse.statusCode, fixtureUnauthenticatedStatus);
```

`fixtureSuccessStatus` and auth failure status must come from the frozen callback contract, not convenient guesses. Test reordered JSON/whitespace, changed byte, absent authentication, wrong account secret, expired proof where supported, malformed JSON and replay. Define local receipt-count fixtures; record no raw signature or credential in logs.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-32.test.mjs`; expect new route/verifier failures. No real-database tests may pass by skipping missing `TEST_DATABASE_URL`.
- [ ] **Step 3: Implement** the route/service interface. Enforce the frozen byte bound before parsing, verify with the official operation and configured trusted URL/account, then parse validated schemas. Rotation accepts only the configured active transition keys. Authenticated duplicate retries receive the documented acknowledgement with no duplicate mutation; replay authentication failure follows the provider’s explicit replay rules. Invalid/unverifiable input cannot enter the trusted receipt ledger. Redact destination, raw body, signature and response tokens in diagnostics.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-32.test.mjs`; require raw-byte and authentication fixtures to pass for the actual selected signature scheme before claiming secure callbacks.
- [ ] **Step 5: Commit** exact Task 1 files and approved app registration with message `feat: verify provider callback bytes`.

### Task 2: Record receipts independently of action

**Files:**
- Create `db/migrations/issue-32-provider-receipts.sql`: provider/account/event uniqueness and immutable receipt records.
- Create `src/notifications/receipts.ts`: correlated receipt append and delivery projection.
- Modify `src/notifications/callbacks.ts`, `tests/issue-32.test.mjs`; create `docs/evidence/issue-32.md`.

**Interfaces:** `recordReceipts(client:PoolClient, input:{provider:string,replayKey:string,receipts:Receipt[],receivedAt:Instant}):Promise<{duplicate:boolean,recorded:number}>`. Correlate by configured provider/account plus provider ID, not a body trip/recipient ID. Delivery projection is `{status:Receipt['status'],contradictory:boolean,lastReceivedAt:Instant}`; preserve every distinct authenticated fact and provider occurrence versus server receipt times.

- [ ] **Step 1: Add failing tests** `receipt_scope_is_enforced`, `duplicate_and_late_receipts`, `receipts_never_create_useful_action`, and `callback_commit_retry`; add `callback_before_http_result`, `receipt_cannot_cancel_other_channels`, and `closed_trip_sos_receipt`. Assert verified delivery arriving before HTTP completion remains delivered after a later unknown/accepted result, late receipts preserve resolved incident phase, arrival preserves an unresolved SOS, and receipt/read/ACK cancels zero other required channel jobs.

```js
assert.equal(duplicate.recorded, 0);
assert.equal(unknownProviderIdMatchedAttempts, 0);
assert.equal(afterLateCallback.incident.phase, 'resolved');
assert.equal(afterAnswered.incident.action, 'unknown');
assert.equal(afterDelivered.incident.driverStatus, 'unknown');
assert.equal(deliveryProjection.contradictory, true);
assert.deepEqual(actionFacts.map(f => f.kind), ['acknowledged', 'unable_to_help']);
```

Replay delivered then late queued, answered voicemail, delivered-but-unread, late failed/delivered contradiction, wrong account, duplicate event identity with different bytes, and commit failure followed by provider retry. Contact acknowledgement/action timestamps are supplied by #29 fixtures and must not be changed by any receipt.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-32.test.mjs`; expect the new ledger/projection assertions to fail.
- [ ] **Step 3: Implement** `recordReceipts` and service transaction. Deduplicate on provider/account/event identity, detect contradictory payload reuse, and atomically commit ledger/projected attempt state before acknowledging receipt. Quarantine unknown correlations as bounded redacted records for reconciliation; never attach them to guessed incidents. A valid callback can arrive before the send response has supplied a provider ID: correlate only with a qualified pre-recorded attempt/upstream key if the official contract supports it, otherwise retain the authenticated receipt and retry correlation after the send result records its ID. Do not drop early receipts or guess a match from phone/trip fields. Apply the frozen provider’s partial order, not a fabricated universal status ranking. Preserve contradictory/late receipts and unknown times without regressing resolved incident or mutating useful-action facts. Do not revive a cancelled job or authorize any new attempt from a receipt. Make the receipt/result projector shared with #30 `recordSendOutcome`, so late HTTP failure/unknown cannot degrade an already verified receipt; contradictory facts remain auditable. All state writes use short SQL transactions with no provider I/O. Report acknowledgement and action latency separately from provider latency, with missing facts remaining null.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-32.test.mjs`; record callback IDs/times, deduplication/ordering results and remaining observer evidence in `docs/evidence/issue-32.md`.
- [ ] **Step 5: Commit** exact Task 2 files with message `feat: separate receipt facts from contact action`.

**Original acceptance gate:** Reconcile real callback traces with an independent recipient/observer timeline, including voicemail, delivered unread, duplication/out-of-order and inability to help. Require zero conflation of receipt/answer with useful action and no late regression of resolved incidents. Synthetic signed fixtures alone cannot close #32.

**Self-review:** Raw bytes, trusted account scope, duplicate identities, late contradictory events and action separation map to named tests. Actual provider verification and callback response semantics remain blocked until documented; no invented universal status or signature scheme is assumed.
