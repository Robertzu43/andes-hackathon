# Issue #14: Verify driver and trucks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish verified driver identity and explicit truck assignment without granting cross-driver history or tracking access.

**Architecture:** A provider boundary verifies identity proof; our database owns stable driver IDs, revocable sessions and truck relationships. Fold the minimal build/API/database scaffold into this first working slice; no fleet account or SIM inference.

**Tech Stack:** Version candidates, gated on #12; architecture follows ADR-002: Node.js 24 LTS, TypeScript strict/ESM, Fastify 5, `pg`, PostgreSQL 18, `node:test` and `node:assert/strict`; AWS topology is selected in ADR-002; exact versions and implementation/evidence readiness remain gated.

**Spec:** [Product requirements](../../PLAN.md), [shared contracts and constraints](../specs/2026-10-17-robert-backend-contracts.md), [ownership](../../OWNERSHIP.md), and [original blockers](../../plan.json).

**Status:** Proposed/gated; planning only. Owner `Robertzu43`; original issue remains open. Original blockers: #13. Additional handoffs: #10 approved verification/recovery channel and actual test-account access; #12 accepted runtime/contracts; #15-facing accepted-contact/scoped-credential design agreement frozen through #12; completion of #15 is not a prerequisite for #14. Source/test paths below are future files, not an assertion that runtime code exists.

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

1. Expired/replayed verification proof never creates another session — Task 1 `expired_and_reused`.
2. A recycled number cannot recover another driver's history — Task 1 `recycled_number`.
3. Brazil and another Latin American number format remain distinct from residence/trip country — Task 1 `international_identity`.
4. Shared truck assignment never shares trips or changes the acting driver — Task 2 `shared_truck`.
5. Number change revokes old access and retries do not duplicate mutation — Task 2 `number_change_retry`.

---

## Execution gate and files

#12 must accept dependency versions, identity recovery proof, session lifetime, rate limits, phone parsing library and keyed phone lookup/storage rules in `docs/contracts/backend.md`. International parsing must use that verified library; a regular expression alone is not proof of a valid destination. #10 records actual provider SDK/API calls, challenge expiry/reuse rules, recovery evidence and number-recycling protections in `docs/evidence/issue-14-provider.md`; amend Task 1 with those exact operations before real integration. SMS possession alone cannot recover existing history; unresolved recovery stays unavailable. No provider endpoint is invented here.

Integrator creates `package.json`, lockfile, `tsconfig.json`, `src/contracts.ts`, `src/api/app.ts`, `src/db/transaction.ts`, `tests/helpers/context.mjs` and migration manifest. Create `.github/workflows/ci.yml` to install the lockfile, build and run tests against disposable PostgreSQL; create `src/api/main.ts` for validated environment startup/shutdown. If #12 accepts containers, include `Dockerfile`, `.dockerignore` and `compose.yaml` for local API/database execution in this slice; otherwise record the accepted local command in `docs/contracts/backend.md`. No deployment is performed. Compile `src/` to `dist/`; define scripts `build=tsc`, `check=tsc --noEmit`, `test=node --test tests/*.test.mjs`. Copy common types verbatim from baseline; add #12’s `ContactCredential={token:string}` common type after acceptance. Explicitly register routes in `buildApp(ctx: AppContext, identity: IdentityProvider): FastifyInstance`; do not start a listener in tests.

### Task 1: Verified identity, scaffold and isolated test context

**Files:** Create scaffold above; `src/identity/identity.ts`, `db/migrations/issue-14-identity.sql`, `tests/issue-14.test.mjs`.

**Interfaces:**

```ts
// src/identity/identity.ts; common Id/Instant/Actor/Locale/Result/AppContext from src/contracts.ts
 type PhoneInput = { entered: string; country: string };
 type Challenge = { id: Id; expiresAt: Instant };
 type VerifiedProof = { subject: string; canonicalPhone: string; challengeId: Id; recoveryApproved: boolean };
 type IdentityProvider = {
   challenge(input: PhoneInput, purpose: 'signup'|'recover'|'number_change'): Promise<Result<Challenge>>;
   verify(challengeId: Id, code: string): Promise<Result<VerifiedProof>>;
 };
 type Session = { token: string; expiresAt: Instant; actor: Actor };
 beginIdentity(ctx: AppContext, provider: IdentityProvider, actor: Actor|null, input: PhoneInput, purpose: 'signup'|'recover'|'number_change', key: string): Promise<Result<Challenge>>;
 completeIdentity(ctx: AppContext, provider: IdentityProvider, challengeId: Id, code: string, key: string): Promise<Result<Session>>;
 authenticate(ctx: AppContext, token: string): Promise<Result<Actor>>;
 // src/db/transaction.ts; rollback on failure, always release at caller
 inTransaction<T>(client: import('pg').PoolClient, work: (client: import('pg').PoolClient) => Promise<T>): Promise<T>;
```

`tests/helpers/context.mjs` owns `createTestContext(): Promise<{ctx: AppContext; close(): Promise<void>}>`; require `TEST_DATABASE_URL`, isolate a new schema per invocation, apply manifest migrations, use fixed UTC clock, then drop only that schema on close; reject public/default schemas and never drop a database. Missing database configuration fails clearly. `tests/issue-14.test.mjs` locally defines `identityFixture(ctx)` with fake provider, `challenge`, `proof`, `expiredProof`, `recycledProof` and `phoneCases` (synthetic BR + PE inputs), never participant identities.

- [ ] **Step 1: Write failing tests** for `expired_and_reused`, `recycled_number`, `international_identity` and unauthenticated/forged `driverId` HTTP input.

```js
assert.equal((await completeIdentity(ctx, fake, expiredId, '000000', 'expired')).ok, false);
assert.equal((await completeIdentity(ctx, fake, consumedId, '000000', 'new-key')).ok, false);
assert.equal((await completeIdentity(ctx, recycledFake, oldAccountChallenge, '000000', 'recover')).ok, false);
assert.equal((await authenticate(ctx, 'forged')).code, 'unauthorised');
assert.notEqual(br.canonicalPhone, pe.canonicalPhone);
assert.equal((await app.inject({method:'GET',url:'/v1/trucks'})).statusCode, 401);
```

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-14.test.mjs`; expect failure for absent scaffold/functions, then a behavioral failure before implementation.
- [ ] **Step 3: Implement** the declared functions, database uniqueness for consumed challenges and provider subject, hashed session secrets and restricted phone storage. Require a verified actor for number-change challenges; bind challenges to purpose/initiating actor/session, impose evidence-approved rate limits, and persist idempotency results without logging codes/tokens; sensitive session replay results are encrypted using the #12-approved server secret outside the repository. Provider `recoveryApproved` is valid only under the reviewed stronger recovery contract; no phone-only account merge. HTTP `POST /v1/identity/challenges` accepts `{phone,purpose}` and returns `Challenge`; `POST /v1/identity/sessions` accepts `{challengeId,code}` and returns `Session`. Both require `Idempotency-Key`; number-change challenge creation also requires the existing authenticated session; session secrets go only to authenticated response transport.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-14.test.mjs`; all Task 1 assertions pass against isolated PostgreSQL; record actual-provider tests separately as gated.
- [ ] **Step 5: Commit** only Task 1 source, scaffold, migration and test changes with `git commit -m "feat: verify driver identity with scoped sessions"` after explicit `git add` of the files above.

### Task 2: Driver-controlled truck relationships and number changes

**Files:** Create `src/identity/trucks.ts`; modify `src/identity/identity.ts`, `src/api/app.ts`, `db/migrations/issue-14-identity.sql`, `tests/issue-14.test.mjs`; create `docs/evidence/issue-14.md`.

**Interfaces:**

```ts
 type Truck = { id: Id; nickname: string; identification: string; revision: number };
 type TruckRelationship = { truckId: Id; driverId: Id; role: 'owner'|'operator'; status:'pending'|'accepted'; revision: number };
 saveTruck(ctx: AppContext, actor: Actor, input: {id?: Id; nickname: string; identification: string; role:'owner'|'operator'; expectedRevision?:number}, key: string): Promise<Result<Truck>>;
 listTrucks(ctx: AppContext, actor: Actor): Promise<Result<Truck[]>>;
 assignTruck(ctx: AppContext, actor: Actor, input: {truckId:Id; driverId:Id; expectedRevision:number}, key:string): Promise<Result<TruckRelationship>>;
 changeNumber(ctx: AppContext, actor: Actor, provider: IdentityProvider, input:{challengeId:Id;code:string;expectedRevision:number}, key:string): Promise<Result<{revision:number}>>;
```

Relationships model an individual owner/operator. `assignTruck` called by an accepted owner creates a pending assignment for `input.driverId`; the same operation called by that target driver accepts the existing pending assignment at its current revision. Any other actor is rejected. Test both steps, and show no truck until acceptance; a plate match never creates a relationship. No hard maximum of two trucks or national plate pattern: one/two trucks is the segment, not an access rule.

- [ ] **Step 1: Write failing tests** `shared_truck`, `number_change_retry`, cross-owner updates, flexible identifiers and repeated create. Define independent synthetic actors A/B and truck T in this test file.

```js
assert.equal((await saveTruck(ctx, B, {...truckA,id:T,expectedRevision:1}, 'foreign')).code, 'not_found');
assert.deepEqual((await listTrucks(ctx, B)).value.map(t=>t.id), [T]); // accepted shared assignment only
assert.equal((await authenticate(ctx, oldSession.token)).code, 'unauthorised');
assert.deepEqual(await changeNumber(ctx,A,fake,change,'same'), await changeNumber(ctx,A,fake,change,'same'));
assert.equal((await changeNumber(ctx,A,fake,{...change,code:'different'},'same')).code,'conflict');
```

- [ ] **Step 2: Run** `npm run build && node --test tests/issue-14.test.mjs`; expect missing truck/change-number behavior failures.
- [ ] **Step 3: Implement** SQL ownership filters, relationship revisions and idempotency. `GET /v1/trucks` returns `Truck[]`; `POST /v1/trucks` accepts `saveTruck` input; `POST /v1/trucks/:id/assignments` accepts `{driverId,expectedRevision}`; `POST /v1/identity/number` accepts `changeNumber` input. Mutations require authenticated actor and `Idempotency-Key`; number changes invalidate existing sessions and do not reassign history. Truck assignment never creates a sharing grant. Keep residence country independent from phone country.
- [ ] **Step 4: Run** `npm run build && node --test tests/issue-14.test.mjs`; require all assertions and same/different-driver HTTP cases pass.
- [ ] **Step 5: Commit** `git add src/identity src/api/app.ts db/migrations/issue-14-identity.sql tests/issue-14.test.mjs docs/evidence/issue-14.md` then `git commit -m "feat: scope truck relationships and number changes"`.

## Acceptance and self-review

Return UI fixtures to #13/#15; #16 alone selects the acting driver, truck and contacts for a trip. Record revision, commands, failure cases and missing evidence. Closure additionally requires designated real-account verification/recovery logs, expired/reused-code evidence and a second tester demonstrating that number recycling/shared trucks cannot expose another driver's history. Test fixtures do not prove phone delivery or recovery security. Unresolved identity/permission ambiguity blocks sharing.

Self-review: all five Review Focus cases map to tasks; provider operations remain explicitly gated; baseline types have one owner; test context and transaction helper are defined here. No live provider, deployment, contacts or participant data are authorised by this plan.
