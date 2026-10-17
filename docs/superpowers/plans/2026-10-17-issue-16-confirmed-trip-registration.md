# Issue #16: Register the trip and limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn bounded voice/text input into a correctable driver-owned draft, then explicitly confirm one durable trip, sharing grants and deadline.

**Architecture:** Draft extraction is an untrusted provider boundary and cannot perform mutations beyond saving a draft. Confirmation validates current permissions and supported mode inside one transaction; transport loss leaves the client registration state unknown until an authenticated read/retry resolves it.

**Tech Stack:** Version candidates, gated on #12; architecture follows ADR-002: Node.js 24 LTS, TypeScript strict/ESM, Fastify 5, `pg`, PostgreSQL 18, `node:test` and `node:assert/strict`; AWS topology is selected in ADR-002; exact versions and implementation/evidence readiness remain gated.

**Spec:** [Product requirements](../../PLAN.md), [shared contracts and constraints](../specs/2026-10-17-robert-backend-contracts.md), [ownership](../../OWNERSHIP.md), and [original blockers](../../plan.json).

**Status:** Proposed/gated; planning only. Owner `Robertzu43`; original issue remains open. Original blockers: #15. Additional handoffs: #12 accepted contracts/runtime and input limits; #10 supported channel matrix; #13 stationary confirmation UX; #14 identity/trucks; #9 supported sensor modes; #27 later deadline worker. Source/test paths below are future files, not an assertion that runtime code exists.

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

1. Instruction-bearing/malformed model output never starts sharing — Task 1 `hostile_extraction`.
2. “Tomorrow at six” and different device/destination zones require clarification — Task 1 `ambiguous_time`.
3. Contacts revoked after review or stale draft revisions cannot activate — Task 3 `stale_permission`.
4. Lost responses/repeated confirmation produce one trip/deadline — Task 3 `lost_response_retry`.
5. Offline, denied sensors or unknown cross-border capability never display active coverage — Task 3 `unsupported_registration`.

---

## Execution gate

#12 freezes content byte/duration limits, allowed media types, retention/deletion, confirmation fields and evidence-backed sharing modes in `docs/contracts/backend.md`. #16 records a selected transcription/extraction service's official SDK operations, supported `es`/`pt-BR`, limits, timeout/error behavior and retention in `docs/evidence/issue-16-provider.md`; amend Task 1 with exact verified calls before enabling it. Until then adapter fixture tests are implementable only after #12; actual voice/text provider integration is gated, not “done”. No arbitrary remote audio URLs or implicit paid API use.

### Task 1: Bounded intake, clarification and draft revisions

**Files:** Create `src/trips/drafts.ts`, `db/migrations/issue-16-registration.sql`, `tests/issue-16.test.mjs`; modify `src/api/app.ts` through integrator.

**Interfaces:** Consume #14 `authenticate`, `inTransaction`, `createTestContext` and baseline types. Define in `drafts.ts`:

```ts
 type TripFields = { truckId:Id|null; origin:string|null; destination:string|null; departureCountry:string|null; destinationCountry:string|null; departureAt:Instant|null; departureTimeZone:string|null; arrivalAt:Instant|null; arrivalTimeZone:string|null; contactIds:Id[]; route:string|null; plannedStops:string[]; restPlan:string|null; mode:'location_and_checkin'|'checkin_only'|null };
 type DraftInput = {modality:'text';text:string;locale:Locale}|{modality:'audio';bytes:Uint8Array;mediaType:string;durationMs:number;locale:Locale};
 type Draft = {id:Id;driverId:Id;revision:number;modality:'text'|'audio';fields:TripFields;clarify:(keyof TripFields)[];status:'draft'|'confirmed'};
 type ExtractedTrip = Omit<TripFields,'truckId'|'contactIds'> & {truckHint:string|null;contactHints:string[];uncertainFields:(keyof TripFields)[];relativeTime:boolean};
 type ExtractionProvider = {extract(input:DraftInput):Promise<Result<unknown>>};
 resolveExtractedFields(ctx:AppContext,actor:Actor,input:ExtractedTrip):Promise<{fields:TripFields;clarify:(keyof TripFields)[]}>;
 type IntakeLimits = {maxTextBytes:number;maxAudioBytes:number;maxAudioDurationMs:number;mediaTypes:string[]};
 createDraft(ctx:AppContext,actor:Actor,provider:ExtractionProvider,input:DraftInput,limits:IntakeLimits,key:string):Promise<Result<Draft>>;
 updateDraft(ctx:AppContext,actor:Actor,id:Id,fields:TripFields,expectedRevision:number,key:string):Promise<Result<Draft>>;
 readDraft(ctx:AppContext,actor:Actor,id:Id):Promise<Result<Draft>>;
```

`POST /v1/trip-drafts` accepts JSON text or bounded audio body with locale/media metadata; `PATCH /v1/trip-drafts/:id` accepts `{fields,expectedRevision}`; `GET /v1/trip-drafts/:id` returns `Draft`. Mutations require authentication and `Idempotency-Key`. Validate structural output strictly, reject unexpected action/permission keys, and parse the strict `ExtractedTrip` hint schema, then resolve exact normalized truck nicknames/contact labels only against current actor-authorized database choices; zero or multiple matches require clarification and never choose the first result. Model-supplied IDs or action keys are invalid. Unknown or ambiguous required fields stay null and appear in `clarify`; optional route/stops remain optional. Departure and arrival both require explicit instants and IANA zones for review. Relative “now”, “tomorrow” or missing dates set `relativeTime=true`, leave affected instant fields null and require a corrected absolute date/time/zone before confirmation; neither device clock nor server receipt silently becomes departure. Store source modality and corrected fields, not raw media/transcript in audit logs.

- [ ] **Step 1: Write failing tests** `hostile_extraction`, `ambiguous_time`, voice/text equivalence for both locales, byte/duration/media rejection (including short claimed duration with overlong decoded audio, MIME/signature mismatch), relative departure “now”, duplicate truck/contact labels and provider failure. Define `draftFixture(ctx)` locally returning synthetic actor/truck/contact IDs, complete `fields`, bounded `limits`, and fixture extraction providers; define SQL count assertions directly in this test file.

```js
assert.equal((await createDraft(ctx,A,hostile,input,limits,'bad')).code,'invalid_input');
assert.equal((await createDraft(ctx,A,failed,input,limits,'failed')).code,'unavailable');
assert.ok(ambiguous.value.clarify.includes('arrivalTimeZone'));
assert.equal(ambiguous.value.fields.arrivalAt,null);
assert.deepEqual(voice.value.fields,text.value.fields);
assert.equal(Number((await ctx.db.query('select count(*) from trips')).rows[0].count),0);
```

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-16.test.mjs`; expect missing draft behavior failures.
- [ ] **Step 3: Implement** declared draft functions, actor-scoped persistence and revision/idempotency checks; bound request decoding before model calls. Treat `durationMs` and declared MIME as untrusted: inspect actual media signature/type and decoded duration using the #12-approved media inspector (or the selected provider’s verified inspection operation before extraction), rejecting mismatches/overlimits. If actual duration cannot be verified, audio intake remains unsupported; never accept a client duration claim as proof. No draft creates grants, deadlines or notifications. Discard temporary audio/transcript under the approved retention contract on success/failure; denied/unavailable microphone stays a client text alternative, not fabricated transcript.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-16.test.mjs`; all intake tests pass against isolated PostgreSQL.
- [ ] **Step 5: Commit** explicit Task 1 paths with `git commit -m "feat: validate driver-owned voice and text trip drafts"`.

### Task 2: Contact invitation, independent acceptance and revocation

**Files:** Create `src/contacts/consent.ts`; modify `db/migrations/issue-16-registration.sql`, `src/api/app.ts`, `tests/issue-16.test.mjs`. Robert owns this backend seam; #15 owns invitation/consent UX and willingness evidence. #12 selects the proof mechanism; #10 must verify actual invitation channel/SDK operations before activation. No contact-account system is added.

**Interfaces:** Define in `consent.ts`:
```ts
 type Contact = {id:Id;driverId:Id;label:string;locale:Locale;status:'pending'|'accepted'|'revoked';revision:number};
 type ContactInvite = {label:string;destination:string;country:string;locale:Locale};
 type ContactConsentProvider = {invite(input:ContactInvite & {invitationId:Id}):Promise<Result<{providerRef:string}>>;verify(proof:string):Promise<Result<{invitationId:Id;destination:string;accepted:boolean;expiresAt:Instant}>>};
 inviteContact(ctx:AppContext,actor:Actor,input:ContactInvite,provider:ContactConsentProvider,key:string):Promise<Result<Contact>>;
 acceptContact(ctx:AppContext,input:{proof:string;expectedRevision:number},provider:ContactConsentProvider,key:string):Promise<Result<Contact>>;
 revokeContact(ctx:AppContext,actor:Actor,contactId:Id,expectedRevision:number,key:string):Promise<Result<Contact>>;
```
`accepted_contacts(id,driver_id,label,destination_ciphertext,destination_hash,country,locale,status,revision,accepted_at,revoked_at)` stores driver-scoped relationships; `contact_invitations(id,contact_id,provider_ref,expires_at,consumed_at,delivery_state)` binds one-use proof to the intended recipient and invitation. `contactIds` in drafts refer to these relationship IDs. No global phone lookup exposes other drivers. Encrypt destination storage under #14/#12 rules; pending delivery/unknown acceptance never counts as accepted.
- [ ] **Step 1: Write failing tests** for driver-forged acceptance, expired/reused/mismatched proof, foreign-driver revocation, actual recipient acceptance and revoke-before-confirm. Fake proof fixtures exercise logic only; create no accepted real contact.
```js
assert.equal((await acceptContact(ctx,{proof:'driver-assertion',expectedRevision:1},fake,'forged')).ok,false);
assert.equal((await acceptContact(ctx,{proof:expiredProof,expectedRevision:1},fake,'expired')).ok,false);
assert.equal((await acceptContact(ctx,{proof:recipientProof,expectedRevision:1},fake,'accept')).value.status,'accepted');
assert.equal((await revokeContact(ctx,B,contactA,2,'foreign')).code,'not_found');
```
- [ ] **Step 2: Run** `npm run build && node --test tests/issue-16.test.mjs`; expect absent contact-permission behavior failures.
- [ ] **Step 3: Implement** POST `/v1/contacts/invitations` (driver-authenticated `ContactInvite`), POST `/v1/contacts/acceptances` (`{proof,expectedRevision}`, recipient authenticated only by verified single-use proof), and POST `/v1/contacts/:id/revoke` (owner plus expected revision). Require idempotency keys. Only matched unexpired provider proof of the recipient's explicit consent can accept; a driver body never can. Persist invite before delivery, retain ambiguous delivery without blind resend, and consume proof/acceptance atomically. Initially serialize revocation/confirmation using locked contact and affected trip rows in consistent ID order; revoke all dependent map/incident grants and invalidate existing recipient outbox intents in the same transaction. #17 then integrates its shared trip lock, and #30 cancels pending recipient jobs when those tables exist; current contact/grant eligibility checks remain authoritative at every dispatch. Do not query future worker tables or make #17 a prerequisite of #16. #15 coordinates independent comprehension/willingness evidence.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-16.test.mjs`; permission/proof tests pass; actual invitation delivery/consent evidence stays gated and missing is recorded.
- [ ] **Step 5: Commit** explicit Task 2 files with `git commit -m "feat: require recipient proof for trusted-contact consent"`.

### Task 3: Explicit confirmation and atomic durable registration

**Files:** Create `src/trips/registration.ts`; modify `src/api/app.ts`, `db/migrations/issue-16-registration.sql`, `tests/issue-16.test.mjs`; create `docs/evidence/issue-16.md`.

**Interfaces:** Define in `registration.ts`; use draft types without duplicating them:

```ts
 type OutboxIntent = {id:Id;tripId:Id;tripRevision:number;kind:string;payload:Record<string,unknown>;state:'pending'|'cancelled'|'processed'};
 type Trip = {id:Id;driverId:Id;truckId:Id;state:TripState;revision:number;policyVersion:string;deadlineAt:Instant};
 type RegistrationPolicy = {version:string;mode:'location_and_checkin'|'checkin_only';supported:boolean;sensors:'available'|'denied'|'unavailable';contactDelivery:'available'|'unavailable';firstDeadlineAt:Instant;grantExpiresAt:Instant;limitsAcknowledgement:string};
 type ConfirmInput = {draftId:Id;expectedRevision:number;confirmed:true;limitsAcknowledgement:string};
 type RegisteredTrip = {trip:Trip;registration:'registered';mode:'location_and_checkin'|'checkin_only';location:'awaiting_sample'|'unavailable';contactDelivery:'available'|'unavailable'};
 confirmDraft(ctx:AppContext,actor:Actor,input:ConfirmInput,policy:RegistrationPolicy,key:string):Promise<Result<RegisteredTrip>>;
 readTrip(ctx:AppContext,actor:Actor,tripId:Id):Promise<Result<Trip>>;
```

`RegistrationPolicy` is loaded from current server support/capability evidence, never trusted from request JSON. POST `/v1/trip-drafts/:id/confirm` accepts `{expectedRevision,confirmed:true,limitsAcknowledgement}` and returns `RegisteredTrip`; GET `/v1/trips/:id` returns `Trip`. A durable receipt means registration only, not location availability or wellbeing. A transport timeout has no success body: #13 displays `unknown_registration`, then retries the same key or reads the draft; offline setup cannot claim registration.

- [ ] **Step 1: Write failing tests** `stale_permission`, `lost_response_retry`, `unsupported_registration`, transaction rollback, current truck ownership, distinct zones and changed cross-border support. Extend local fixture with accepted/revoked contacts, approved synthetic policy and two authenticated actors. Define `confirmation` from fixed fields independently of implementation output.

```js
assert.equal((await confirmDraft(ctx,A,stale,policy,'stale')).code,'conflict');
assert.equal((await confirmDraft(ctx,A,revoked,policy,'revoked')).code,'invalid_input');
assert.equal((await confirmDraft(ctx,A,confirmation,{...policy,supported:false},'unsupported')).code,'unsupported');
const first=await confirmDraft(ctx,A,confirmation,policy,'retry'); // discard HTTP response
assert.deepEqual(await confirmDraft(ctx,A,confirmation,policy,'retry'),first);
assert.equal(Number((await ctx.db.query('select count(*) from trips')).rows[0].count),1);
assert.equal(Number((await ctx.db.query("select count(*) from deadlines where state='pending'")).rows[0].count),1);
assert.equal(first.value.location,'awaiting_sample');
assert.equal((await readTrip(ctx,B,first.value.trip.id)).code,'not_found');
```

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-16.test.mjs`; expect confirmation/atomicity failures.
- [ ] **Step 3: Implement** row-lock draft, check ownership/revision/explicit confirmation/current contact acceptance/truck assignment, resolve unambiguous departure/arrival zones and instants, and enforce evidence-selected mode. One PostgreSQL client transaction writes trip, revision, grants, initial deadline, baseline audit event (`kind:'trip'`, payload `{kind:'trip',action:'registered',state:'active',deadlineAt}`), outbox intent and saved idempotency response. Fault injection before commit must leave all absent. Denied sensors may use only explicitly acknowledged supported check-in-only mode; unavailable contact delivery stays visible and is rejected unless that exact limited mode is approved. No implicit home-country coverage, cargo value or customer manifest requirements.

Reserved SQL contract: `trips(id,driver_id,truck_id,state,revision,policy_version,deadline_at)`; `trip_drafts(id,driver_id,revision,modality,fields,status,trip_id)`; `sharing_grants(id,trip_id,recipient_id,scope,token_hash,expires_at,revoked_at)` where scope is `live_map` or `incident_response` and `token_hash` is nullable until the separately authorized credential issuance/rotation step; `deadlines(id,trip_id,trip_revision,due_at,state)`; `outbox(id,trip_id,trip_revision,kind,payload,state)`; `trip_events(event_id,trip_id,revision,envelope)`; `idempotency(actor_id,key,request_hash,result)`. Use UUID keys, UTC timestamptz, foreign keys and unique registration/deadline identities; #27/#30 add worker fields without replacing these records. Task 2 owns accepted-contact rows under the #12/#15 design agreement; #21 owns live-map credential issuance and #29 incident credentials. Real consent proof and limits must be accepted before execution. Persist canonical request hashes and scope keys by operation/actor.

- [ ] **Step 4: Run** `npm run build && node --test tests/issue-16.test.mjs`; repeat concurrent confirmation with a database barrier, verify one trip/deadline and rollback atomicity, then reconnect/read after dropped response.
- [ ] **Step 5: Commit** explicit Task 3 files with `git commit -m "feat: register confirmed trips grants and deadlines atomically"`.

## Acceptance and self-review

Handoff authoritative receipt/unknown/degraded fixtures to #13 and durable deadlines to #27. Independent observer must reconcile displayed state to exactly one trip and valid deadline through dropped response, refresh, duplicate, offline, denied sensors and unavailable channels. Validate separate Spanish/Portuguese voice and text descriptions, transcription failure, ambiguous arrival, correction, revoked contacts and stale confirmation with actual selected provider evidence. Current source tests do not close provider, stationary comprehension, permission or physical-device gates; record missing evidence in `docs/evidence/issue-16.md`.

Self-review: five risks have task assertions; contact acceptance has an explicit backend owner and cannot be driver-asserted; provider remains gated; #18 extends the provisional #12 envelope later without blocking registration; explicit confirmation is the only activation path. Database fixtures test durability but do not claim monitoring coverage or safety efficacy.
