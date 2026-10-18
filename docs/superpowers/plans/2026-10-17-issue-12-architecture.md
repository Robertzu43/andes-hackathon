# Issue 12 Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the delegated architecture decision into evidence-supported contracts for voice/text intake, live sharing and durable escalation. Design selection is recorded; final #12 acceptance remains pending.

**Architecture:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects a modular API/control worker and separate emergency/ordinary delivery consumers on ECS/Fargate, RDS PostgreSQL authority, transactional outbox and SQS Standard. Short SQL transactions coordinate lifecycle, grants and attempt authorization; all external I/O runs after SQL release. Separate interpretation from confirmed state, and operational observations from wellbeing/contact action.

**Tech Stack:** TypeScript/Fastify and PostgreSQL on the selected AWS target. Node.js 24 LTS, Fastify 5 and PostgreSQL 18 remain compatibility/version candidates to verify against actual account/runtime access. No deployment, spending or runtime implementation is authorized by this documentation update.

**Spec:** `docs/PLAN.md` issue #12; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md` (proposed contract baseline).

## Global Constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Apply the roadmap's product/scoring checkpoint: technical effort 40%, traction 30%, pitch 30%; the delegated design choice is not evidence of capacity, delivery or issue acceptance.

## Review Focus

1. Missing #11 limits: final acceptance remains blocked; delegated design selection does not invent safety numbers (Task 1 evidence manifest check).
2. Phone background failure: live-map transport cannot be mistaken for capture support (Task 1 capability disposition).
3. Provider acceptance timeout: an unknown send must remain reconcilable (Task 2 failure table).
4. Stop versus attempt authorization: serialize SQL decisions and explicitly allow a previously authorized call to start/finish later (Task 2 two-client timeline).
5. Conflicting time zone/contact extraction: draft confirmation must validate current grants and an unambiguous instant (Task 2 API examples).

---

**Owner/status and existing blocker:** Robertzu43; original issue open, blocked by #11. Robert delegated the design choice recorded in ADR-002; do not reopen AWS selection as a required approval. #9 physical-device traces, #10 provider access and #11 evidence/stop contract remain prerequisites to final acceptance. Documentation consistency is not implementation or closure.

### Task 1: Record delegated design and validate capability/infrastructure boundaries

**Files:** Maintain `docs/architecture/ADR-002-aws-durable-dispatch.md` as the decision authority; retain ADR-001 as superseded history. Create/complete `docs/architecture/support-matrix.json` and `docs/evidence/issue-12.md` from actual evidence. Update dependent plans/contracts to match ADR-002. No runtime files in this task.

**Interfaces:** Consumes #9 device records, #10 country/channel/language records and #11 threshold/hazard contract. Produces a support matrix whose rows contain `country`, `locale`, `deviceMode`, `channel`, `status` (`supported|conditional|unavailable|untested`), and `evidenceRefs: string[]`; evidence references must identify actual artifacts and tested revision/setup.

- [ ] Establish shared product understanding with Robert: primary driver/contact, current workaround and evidenced failure, security scenario, intended useful contact action, complete voice/text-to-arrival journey, non-goals and demo. Reflect confirmed requirements separately from assumptions; resolve one important question at a time before proposing architecture. Record the agreed brief in the ADR.
- [ ] Recheck the official judging guide and map the proposed scope to technical effort (40%), traction (30%) and pitch (30%). State what evidence each contribution needs, and reserve work/time for validation and presentation; do not equate a complex stack with a higher score.
- [ ] Read the source artifacts and record missing evidence explicitly in `docs/evidence/issue-12.md`; do not reconstruct research from this plan.
- [ ] Carry ADR-002's comparison of ECS/Fargate + RDS + SQS, PostgreSQL-only transport, Lambda and managed workflows into the acceptance record. Record the delegated selection as made, while infrastructure availability, cost, restoration and capacity remain unverified.
- [ ] Validate the chosen Android-installed driver capture scope with Sebastian's available device/framework; contact web and fresh-browser demo remain separate. Do not claim PWA background capture or iPhone support from this design choice.
- [ ] Record actual runtime/host/database versions, worker restart policy, connection budget, secret storage, backup/restore, health/log access, migration/rollback procedure and deployment permissions. If access or behavior cannot be checked, keep deployment readiness blocked.
- [ ] Record actual identity, transcription/extraction and messaging providers or `unavailable` with the missing prerequisite; add the exact provider operations and callback validation to #14/#16/#31/#32/#33 before enabling those integrations. Synthetic ports alone do not complete them.
- [ ] Run this local evidence-shape check; expect PASS only for internally consistent rows, not proof of validity:

```python
import json
rows = json.load(open('docs/architecture/support-matrix.json'))
assert rows, 'support matrix cannot be empty'
assert all(r['status'] in {'supported','conditional','unavailable','untested'} for r in rows)
assert all(r['status'] != 'supported' or r['evidenceRefs'] for r in rows)
print('PASS: matrix shape; source evidence still requires review')
```

- [ ] Commit only the scoped architecture/evidence artifacts with message `docs(#12): record capability and infrastructure decisions`.

### Task 2: Freeze shared contracts and failure ownership

**Files:** Create `docs/contracts/backend.md`, `docs/contracts/examples.json`, `docs/architecture/failure-tests.md`; update ADR and baseline. Runtime targets reserved for later owners: `src/contracts.ts` and `src/db/transaction.ts` (#14), `src/trips/registration.ts` (#16), `src/trips/coordination.ts` (#17), `src/events/events.ts` (#18).

**Interfaces:** Freeze baseline `Actor`, `AppContext`, `Clock`, `Result<T>`, `TripState`, `EventEnvelope`; freeze the exact exports in each downstream plan. API examples contain `name`, `actorScope`, `request`, `expectedStatus`, `expectedState`, `reason`, all synthetic. Define polling snapshot freshness/expiry semantics, location bounds, audio size/duration/formats and retention from selected provider/device evidence. Record separate synthetic values for fixture use.

- [ ] Write expected examples before implementation: unconfirmed audio draft cannot activate; duplicate confirmation returns the same trip; changed payload/key conflicts; foreign truck/contact is rejected; an expired map grant reveals no location; ambiguous arrival requires clarification; closure rejects location publication.
- [ ] Run `python3 -m json.tool docs/contracts/examples.json > /dev/null`; expect exit 0. Inspect that each listed case has an expected result independent of implementation output.
- [ ] Draw the trip and incident state machines and map each loss/failure to an owner, exact test file and evidence gate. Separate trip lifecycle, location-sharing scope, check-in deadline and incident/action status rather than forcing everything into one enum.
- [ ] Specify `withTripTransaction<T>(ctx:AppContext,tripId:Id,work:(client:PoolClient)=>Promise<T>):Promise<T>` in `src/trips/coordination.ts` (#17): begin, acquire transaction-scoped trip coordination, execute SQL-only callback, commit/rollback and release before returning. Lifecycle, grant changes, map-read authorization and attempt authorization share this boundary; bounded SQL lock wait comes from infrastructure configuration. No session lock across provider/SQS I/O and no global trip dispatch fence. Caller/API boundaries map failures to `Result` without claiming an uncommitted action succeeded.
- [ ] Write stop-first and authorization-first timelines, pause immediately after authorization, release SQL, then commit closure/revocation/resolution before resuming the external call. Require zero new affected authorizations after stop; permit the previously authorized call to start/finish later. Slow WhatsApp must not block SMS/voice, another trip, map reads or revocation. Crashes after authorization remain unknown until reconciliation; redelivery never blindly resends.
- [ ] Keep arrival/cancellation, explicit security-incident resolution and contact revocation separate. Arrival stops live location/check-ins/ordinary work but does not resolve SOS. Independent incident consent may permit SOS after trip end, without newly authorized precise location. Map responses/payloads authorized before revocation may arrive later; state that limit in UI examples. A contact receipt never resolves the incident.
- [ ] Agree field and route contracts with Sebastian for #13/#15/#19/#22/#24/#35. Record the accepted contract revision and separate driver, contact and provider authentication paths. Allocation is unchanged; frontend acceptance is his handoff.
- [ ] Freeze #16's contact-acceptance backend, #21's map credential issuance/revocation and #26's check-in/report endpoints. Record the one-time map-secret replay exception: stable metadata, null credential and explicit unavailable-on-replay state; a new issuance key rotates the old token. Include contact acceptance → confirmed trip → scoped map read → revocation as an integration test.
- [ ] Reconcile every downstream plan's signatures/schema ownership to the accepted decision. Commit with `docs(#12): freeze backend contracts and failure tests`.

**Acceptance:** Independent reviewer can trace every critical constraint to a component, test and real evidence source. Unknown device/channel behavior stays unsupported. #12 remains open until this evidence exists; documentation consistency alone is not acceptance.

**Subagent boundary:** One architecture author; one fresh engineering reviewer after the complete contract is assembled. No parallel edits to schema/contract documents. The delegated design decision is already recorded; Sebastian's interface agreement and independent evidence remain final acceptance gates.
