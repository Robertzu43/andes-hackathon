# Issue #21: Make coverage gaps explicit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authorize location ingestion and polling snapshots, preserve observation age through outages and deny new disclosure authorizations after grant revocation or closure; previously authorized responses may arrive afterward.

**Architecture:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects ECS/Fargate + RDS PostgreSQL + SQS. Store the newest qualified location plus evidence-bounded operational history and a bounded client buffer. HTTP polling authorizes and copies a snapshot in a short SQL transaction shared with lifecycle/grant changes, then releases SQL before HTTP delivery; it never replays stale buffered coordinates as live movement. Slow notification providers do not hold this transaction or its connection.

**Tech Stack:** TypeScript/Fastify, `pg`, PostgreSQL and Node test runner on the chosen AWS target; versions, account access and final #12 acceptance remain evidence gates. No implementation or deployment is claimed.

**Spec:** [Product requirements](../../PLAN.md), [shared contracts and constraints](../specs/2026-10-17-robert-backend-contracts.md), [ownership](../../OWNERSHIP.md), and [original blockers](../../plan.json).

**Status:** Proposed/gated; planning only. Owner `Robertzu43`; original issue remains open. Original blockers: #20. Additional handoffs: #12/#9 measured capture/poll cadence, freshness/buffer/retention limits; #14 identity; #15 consent and credentials; #16 grants; #17 closure coordination; #18 location types; #19 device buffer; #22 contact map. Source/test paths below are future files, not an assertion that runtime code exists.

## Global Constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- No forced visual/manual response while moving; audio is not presumed safe.
- Recheck trip and sharing grants for every location read/update authorization on the SQL authority, including each poll/reconnect. Responses authorized before revocation can arrive later; disclosed copies cannot be recalled.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Review Focus

1. Two drivers/two trips cannot cross-write or cross-read by guessed IDs — Task 1 `cross_scope` and Task 2 `cross_recipient`.
2. Duplicate/reordered/delayed batches never replace a newer sample — Task 1 `late_batch`.
3. Expired/revoked credentials and already-open maps cannot authorize new snapshots — Task 2 `revoked_poll`.
4. Airplane mode, shutdown and browser loss produce stale/unknown without invented causes — Task 2 `coverage_gap`.
5. Invalid coordinates/timestamps/sequence and oversized buffering are rejected or bounded explicitly — Task 1 `bounds`.

---

## Execution gate and HTTP contract

#12/#9 freeze measured `staleAfterMs`, `maxAccuracyM`, `maxFutureSkewMs`, `maxBufferSamples`, `maxBufferAgeMs`, `maxBatchSamples`, polling/capture cadence `maxHistorySamples` and history retention in `docs/contracts/location.md`; these are currently unset, not numbers to invent. #15 freezes expiring contact credential issue/rotation/revocation, per-trip consent and approved rest/extension visibility. #18 owns `LocationSample`/`StoredLocation`; #16 owns grants. Until these handoffs exist, synthetic logic may be described but real sharing stays gated. A 30-second fixture is not a live-service promise.

### Task 1: Authorized, ordered ingestion and bounded replay

**Files:** Create `src/location/locations.ts`, `src/location/buffer.ts`, `db/migrations/issue-21-location.sql`, `tests/issue-21.test.mjs`, `docs/contracts/location.md`; modify `src/api/app.ts` through integrator.

**Interfaces:** Consume #18 `LocationSample`/`StoredLocation`, #17 `withTripTransaction` and common types. Define:

```ts
 // src/location/locations.ts
 type LocationPolicy = {staleAfterMs:number;maxAccuracyM:number;maxFutureSkewMs:number;maxBufferSamples:number;maxBufferAgeMs:number;maxBatchSamples:number;historyRetentionMs:number;maxHistorySamples:number};
 type LocationBatch = {expectedRevision:number;samples:LocationSample[]};
 type IngestedLocations = {accepted:Id[];duplicates:Id[];ignoredOlder:Id[];latestSampleId:Id|null};
 ingestLocations(ctx:AppContext,actor:Actor,tripId:Id,batch:LocationBatch,policy:LocationPolicy,key:string):Promise<Result<IngestedLocations>>;
 // src/location/buffer.ts; shared with #19, no device timer dependence
 boundLocationBuffer(samples:LocationSample[],now:Instant,limits:{maxSamples:number;maxAgeMs:number}):{samples:LocationSample[];dropped:number};
```

POST `/v1/trips/:id/locations` accepts `LocationBatch`, authenticated driver and `Idempotency-Key`, returns `IngestedLocations`. Bind each session to driver/trip in restricted storage. Validate finite latitude [-90,90], longitude [-180,180], nonnegative finite accuracy or null, UUID IDs, integer sequence >=0, UTC timestamps and evidence-approved skew/age. Session sequence resets require a new session ID; reused sample ID/different content conflicts. Invalid batch fails atomically; duplicates return saved identity without new publication. Existing aggregate changes use expected trip revision.

- [ ] **Step 1: Write failing tests** `cross_scope`, `late_batch`, `bounds`, closed trip and no-current-sharing-grant ingestion. Locally define `locationFixture(ctx)` returning A/B actors, trips, accepted recipient credentials, current sample and approved synthetic policy by seeding #16 tables; no raw participant samples.

```js
assert.equal((await ingestLocations(ctx,B,tripA,batch,policy,'foreign')).code,'not_found');
assert.equal((await ingestLocations(ctx,A,tripA,invalidLatitude,policy,'invalid')).code,'invalid_input');
assert.equal((await ingestLocations(ctx,A,tripA,older,policy,'older')).value.latestSampleId,newest.sampleId);
assert.deepEqual((await ingestLocations(ctx,A,tripA,duplicate,policy,'again')).value.duplicates,[newest.sampleId]);
assert.equal((await ingestLocations(ctx,A,closedTrip,batch,policy,'closed')).code,'conflict');
assert.equal(boundLocationBuffer(threeSamples,now,{maxSamples:2,maxAgeMs:60000}).samples.length,2);
```

Additional assertions cover NaN/Infinity, future times, wrong session, null accuracy, overlarge batch, same-key/different-body and buffer overflow/expiry. Fixed `60000` is a test-only bound. Define expected newest sample by independent timestamp/session fixtures, not reducer output.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-21.test.mjs`; expect missing ingest/buffer behavior failures.
- [ ] **Step 3: Implement** ownership/current-state/sharing recheck inside `withTripTransaction`, then strict validation, dedupe and conditional latest-row update. Compare qualified observation time first, session sequence within a session; equal/contradictory identities remain uncertain and cannot masquerade as newer. Unknown accuracy or accuracy above `maxAccuracyM` may be retained as history but cannot replace the latest qualified position or become a current precise location; a long outage preserves the older sample as stale. Keep `receivedAt` server-owned. Location samples carry the current lifecycle revision but do not increment `trips.revision` or invalidate deadline generations; update sample identity/sequence separately. Store the selected qualified sample in `latest_locations(trip_id,sample jsonb,received_at)` and retained samples in restricted `location_history`; #18 owns their JSON sample type. Record dropped/ignored counts; oldest/expired buffer items are discarded under the explicit retention contract. Bound history by `historyRetentionMs` and `maxHistorySamples`; no unlimited route archive or change to server check-in deadlines.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-21.test.mjs`; concurrent and reordered uploads preserve newest sample and unchanged deadline rows.
- [ ] **Step 5: Commit** explicit Task 1 paths with `git commit -m "feat: authorize and bound location reconciliation"`.

### Task 2: Scoped current snapshots, freshness and revocation

**Files:** Create `src/location/grants.ts`; modify `src/location/locations.ts`, `src/api/app.ts`, `tests/issue-21.test.mjs`, `docs/contracts/location.md`; create `docs/evidence/issue-21.md`.

**Interfaces:** Common `ContactCredential={token:string}` is frozen in #12/introduced by #14; contact credentials never become a driver `Actor`.

```ts
 type LocationSnapshot = {tripId:Id;state:'current'|'stale'|'unavailable';sample:StoredLocation|null;observationAgeMs:number|null;serverAt:Instant;staleAt:Instant|null;cause:'unknown'};
 readGrantedLocation(client:import('pg').PoolClient,tripId:Id,recipientId:Id,now:Instant,policy:LocationPolicy):Promise<Result<LocationSnapshot>>;
 // src/location/grants.ts
 type GrantIssue = {grantId:Id;revision:number;credential:ContactCredential|null;secretState:'returned_once'|'unavailable_on_replay'};
 issueMapCredential(ctx:AppContext,actor:Actor,input:{tripId:Id;recipientId:Id;expectedRevision:number;expiresAt:Instant},key:string):Promise<Result<GrantIssue>>;
 revokeMapGrant(ctx:AppContext,actor:Actor,input:{tripId:Id;grantId:Id;expectedRevision:number},key:string):Promise<Result<{revision:number}>>;
 // src/location/locations.ts
 readCurrentLocation(ctx:AppContext,credential:ContactCredential,tripId:Id,policy:LocationPolicy):Promise<Result<LocationSnapshot>>;
```

GET `/v1/contact/trips/:id/location` takes scoped credential in the `Authorization` header, returns `LocationSnapshot` with `Cache-Control: no-store`; never place tokens in URLs/logs or use shared/CDN caching. Hash credential lookup, require accepted recipient + current trip + `scope='live_map'` + unexpired/unrevoked grant. Uniform `not_found` prevents existence leaks; absent/malformed credential is unauthorised. Driver reads use the separately authenticated owner route, not contact impersonation. Internal `readGrantedLocation` requires the client of an active `withTripTransaction` callback and rechecks accepted recipient/current trip/unexpired-unrevoked `live_map` grant; it returns `not_found` when denied. Public reads validate credential shape, then check the hashed credential and call this helper in the same short transaction; do not authorize on a stale replica or outside the shared boundary. Return the minimal copied snapshot after commit/client release. #29's `readIncidentNotificationSnapshot` calls it for precise location and maps denial to withheld/null coordinates; `incident_response` alone never permits precise location.

POST `/v1/trips/:id/map-credentials` issues/rotates a live-map credential for the acting driver's accepted recipient and confirmed sharing agreement; POST `/v1/trips/:id/map-grants/:grantId/revoke` revokes it. Both require driver authentication, expected lifecycle revision and `Idempotency-Key`. Within short transaction-scoped trip coordination, recheck consent/state and cap expiry to the confirmed grant; issue `crypto.randomBytes(32)` secret, persist only its cryptographic hash, and revoke previous credentials on rotation. Return the raw credential once, never log it. Narrow idempotency exception requiring #12 acceptance: replay returns saved grant metadata with `credential:null,secretState:'unavailable_on_replay'`; a new key rotates after response loss, rather than falsely claiming a recoverable link. Revocation is idempotent and denies subsequent new read authorizations; it does not wait for an HTTP response already authorized; it increments lifecycle revision because permissions changed, unlike location ingestion.

- [ ] **Step 1: Write failing tests** `cross_recipient`, `revoked_poll`, `coverage_gap`, expiry during an open map, close/read race and replay after restart. Local fixtures define two recipients/two trips and fake clock instants; each poll invokes the API again.

```js
assert.equal((await readCurrentLocation(ctx,recipientB,tripA,policy)).code,'not_found');
assert.equal((await readCurrentLocation(ctx,recipientA,tripA,policy)).value.state,'current');
assert.equal(afterOutage.value.state,'stale');
assert.equal(afterOutage.value.sample.observedAt,newest.observedAt);
assert.equal(afterOutage.value.cause,'unknown');
assert.equal(afterRevocation.code,'not_found');
assert.equal(afterClosure.code,'not_found');
assert.equal(reconnected.value.sample.sampleId,newest.sampleId);
assert.equal(replayedIssue.value.credential,null);
assert.equal(replayedIssue.value.secretState,'unavailable_on_replay');
assert.equal(oldCredentialAfterRotation.code,'not_found');
```

Add the full journey using #16 APIs: invite → verified recipient acceptance → explicit trip confirmation → issue map credential → authorized read → driver revocation → denied next read; also reject unaccepted recipients, foreign drivers and overlong grant expiry. Assert repeated old uploads never decrease observation age or reset `staleAt`, `incident_response` credentials cannot fetch maps, and revoked `live_map` does not delete independently scoped incident evidence. Force close/read and revoke/read ordering with two clients and barriers, not sleeps: stop-first denies; read-first copies a snapshot and releases SQL, then revocation commits before the delayed response is delivered. Assert that later read authorizations fail and that a blocked WhatsApp call does not stall reads/revocation. Preserve active SOS on arrival and require any newly authorized incident payload to withhold coordinates after live-map revocation, even if independent incident consent remains valid. Record deadline rows before/after outage and verify unchanged pending deadlines.

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-21.test.mjs`; expect missing snapshot/revocation behavior failures.
- [ ] **Step 3: Implement** the declared credential issuance/rotation/revocation routes and fresh grant/state authorization inside `withTripTransaction` before snapshot construction; serialize closure against read authorization, then commit/release before response transmission. Return last qualified sample with original observation time and explicit stale/unknown, or unavailable/null if none. Each poll/reconnect is a new authorization check; no server subscription or SSE path. #22 clears denied snapshots and locally ages current to stale at `staleAt` between polls; an already authorized response may arrive after revocation, and delivered coordinates cannot be recalled. #19 consumes `boundLocationBuffer`, reconnects with an authorized current snapshot, and never animates buffered samples as current movement.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-21.test.mjs`; re-run #17 closure assertions on the same revision and deliver API fixtures to #19/#22.
- [ ] **Step 5: Commit** explicit Task 2 files with `git commit -m "feat: poll scoped location snapshots with truthful freshness"`.

## Acceptance and self-review

Sebastian must confirm the Android device/framework selected by ADR-002, then integrate and physically observe airplane mode, lock/background, process kill, shutdown, delayed batch, reordering and prolonged outage; timestamp availability independently and measure end-to-end latency against #9/#12 limits. Open contact views/reconnects must deny new disclosure authorization after expiry/revocation/closure, explicitly preserving the limit for already authorized responses, and display no fresh location/wellbeing within unobserved intervals. Record observed last position/time, uncertainty, buffer drops and independent server deadline behavior in `docs/evidence/issue-21.md`. Synthetic races cannot establish installed-device background capture capability or phone-to-contact cadence; these remain issue closure gates.

Self-review: all five risks map to tests; common location types/grant scopes have single owners; HTTP polling replaces persistent subscriptions in this selected design while preserving per-read revocation authorization. iPhone/PWA background capture is not validated by this choice. No inferred outage cause, wellbeing, endless escalation or unsupported live-tracking claim.
