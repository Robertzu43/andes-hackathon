# Canonical Phone Demo Web Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task, with fresh implementer and independent spec/quality review. Steps use checkbox syntax. Execution is already authorized.

**Goal:** Port the independently reviewed owner-resolution and observation lifecycle work onto PR103's canonical initial mount, preserving its browser runner and removing the known test portability/race defects.

**Architecture:** Start from PR103 `c4f728dc2e41e4c55431c59d2afeba2a7a71fe07` on a separate owned follow-up branch. Retain its Foundation mount, runtime, screens, SDK status/boolean corrections, `test:phone` journey and CI hook. Add only the missing controller operation, capture host and required validation repairs; later approved UI/OTP/session work remains separate.

**Tech Stack:** Existing Node24–26, TypeScript5.9, React19, Vite8, Node tests, CDP Chrome and owned disposable PostgreSQL. No new dependency.

**Spec:** Approved `docs/superpowers/specs/2026-10-18-functional-phone-demo-design.md` at PR96 commit `c8517e42e3419874a7f87319badc8d31d54e4c49`. PR96 is unmerged and that file is absent on the canonical base; read its immutable reference supplied by the controller, never substitute the smaller PR103 body for the full spec. Initial full B plan and reviewed checkpoints remain on `sebasbimbi/feat/phone-demo-b` at `ffb2a7c8e0eb59990e33867b25d657db039387f7`.

## Global Constraints

- Work only on the controller-created owned follow-up branch, never Robert's active branch or main; normal pushes only, no merge authority. Follow-up PR targets main and stays DRAFT/HOLD with explicit PR103/100/96 dependencies and unresolved review/evidence limits.
- Preserve the canonical mount/routes/runtime, `readStatus` binding, `automaticEscalation: boolean`, existing `test:phone` journey and its root CI hook. No second runtime, state layer, phone harness or initial B PR.
- No `.env*`/secret reads, writes or copies; no AWS, deployment, tunnel, live providers, real SMS/calls or spending. Use only allowlisted process-scoped synthetic environment and disposable local PostgreSQL.
- No fabricated physical-device packet. Real capture requires the existing adapter's matching reviewedContext and trusted native dispatch. Positive unit acquisition uses its detached synthetic platform AND clock only; production defaults to device mode with no URL/storage/environment synthetic toggle.
- Bind capture consent to the exact trip and explicit native share action, before asynchronous work. Preserve source capture time, subject ownership, account retirement, upload abort/wipe and distinct sharing receipt/unknown/refusal/no-send states.
- Keep SOS independent of ordinary interaction gating. Add a separate sixth resolve slot; arrival never resolves an incident and acknowledgement never invents resolution time.
- A owns API `types.ts`, `responses.ts`, and runtime session fixtures; do not edit them in this task. The approved new world has `expiresAt`, `tripCountries`, driver/family `{id,token}`, colleague `{id,token,grantId}`, with additive synthetic/expiry metadata. No alternate DTO. This adoption keeps the current seeded journey until the coordinated A6 consumer migration; do not merge a contract change alone against old consumers.
- Preserve Tándem assets/components and ES/pt-BR. Capture/server receipt/provider acceptance/delivery/human response remain distinct; no phone/token/code in rendered statuses, logs or persistent storage.

## Review Focus

1. Unknown resolution replays its exact incident/body/key without consuming SOS; stale reads/account changes lose authority.
2. Capture preparation and disposal races cannot acquire or dispatch after retirement; no missing/unqualified packet becomes a real stream.
3. SDK status/boolean behavior remains intact and ordinary/prototype-named unknown decoder operations fail locally.
4. Existing browser journey writes captures only under its private temporary destination, works on macOS and CI, and preserves real API/SQL assertions.
5. Owner-isolation reconnect awaits the real pump, keeps records and performs no foreign-owner HTTP dispatch; no retry-until-green loop.

### Task 1: Adopt the missing reviewed core and validate the preserved journey

**Files:**
- Modify: `web/src/features/driver/controller.mjs`, `controller.d.mts`, `validation.mjs`, `README.md`; `web/src/lib/api/driver.ts`; `web/src/lib/observations/upload.mjs`; `web/vite.config.ts`.
- Create: `web/src/features/driver/observations.ts`, `web/src/lib/observations/phone-adapter.d.ts`.
- Modify/Test: `web/tests/driver/journey.test.mjs`, `contracts.types.ts`; `web/tests/api/shared-sdk.integration.mjs`; `web/tests/observations/upload.test.mjs`; `web/tests/phone/status-binding.test.mjs`; `web/tests/phone/journey.mjs`; `web/tests/foundation/preview-proxy.test.mjs`.
- Create/Test: `web/tests/phone/driver-transport.test.mjs`, `web/tests/phone/observations.test.mjs`.

**Interfaces:**
- Port `DriverJourney.resolveIncident():Promise<Outcome>`, WriteSlot `resolve`, operation `resolveIncident`, `retryUnknown('resolve',{confirmed:true})`, SDK resolution decoder/dispatch and ID correlation. Six write/four read slots; preserve PR103's status/boolean behavior and generic unsupported-operation classification.
- Port `createTripObservationHost({tripId,revision,session,api,baseUrl,reviewedContext,captureOptions?})` with start/stop/snapshot/subscribe/async dispose. Only existing adapter mode/platform/clock dependency inputs are forwarded; default device, exact-trip action consent, asynchronous preparation before readiness and synchronous trusted dispatch before first await.
- Source commits: reviewed resolution `6e469fa611afa68bc0c58d4d7ed0c5174c033e48`; host `ae7c879d017c4a89e1f803e8b74c9f543e761989`; strong SDK integration `10c28e82c99e394c2e129e73f5906da318591855`; A owner-settlement hunk `5280ad6aab9f3ef21b37502e2538d56dc600fc52` (already isolated as `c36c77bed0f75395c653420efbacef3d0df84b0e`). Read exact source objects; do not replay whole branches.

- [ ] **Step 1: Port behavioral tests first and observe RED.** Preserve the reviewed resolution/host cases and original-intent, stale-read, preparation/retirement, qualification, source-age and URL controls. Run the focused suites before implementation and retain expected missing-method/module/unsupported-resolution failures. Add decoder cases for `constructor`, `toString` and an ordinary unknown name; each must throw the SDK's unsupported error, never return undecoded data. Current remote B tests cover the existing status/boolean contract and must remain passing. Parent's exact PR103 baseline is 351/352 web (known owner pending-count race), root/web builds pass, existing SDK integration1/1 passes; those are supplied evidence, not new GREEN results.
- [ ] **Step 2: Port only missing production pieces.** Adapt the reviewed operation and host to the canonical code. Keep PR103 status/boolean and use an own-entry decoder guard. Alias the actual adapter, keep qualification/consent/lease protections and uploader URL/redirect/cookie policy. Do not wire new UI, change seeded-world assumptions, fix unrelated screens or duplicate the runtime in this adoption.
- [ ] **Step 3: Reconcile reviewed test repairs and runner portability.** Apply only A's upload-test settlement hunk, preserving no-POST/no-delete/owner assertions. Extend the current SDK integration assertions with deterministic incident ordering, full real decoded status facts and true unsupported-operation/no-HTTP coverage. Remove the unconditional `/opt/cursor/artifacts/screenshots` destination from the existing journey; keep its temporary captures and actual assertions/cleanup, no second harness. Use supported `envDir:false` in new/ported fixtures and replace the two existing deprecated preview options; preserve disabled dotenv loading, with no `.env` fixture files created.
- [ ] **Step 4: Verify GREEN.** Activate Node24 for every Node/npm command. Run focused driver/transport/observation/status/owner tests and strict driver consumer types, current root build, full web suite with an owned disposable DB, exact real shared-SDK integration and `npm --prefix web run test:phone` using the existing journey. All actual failures/warnings/skips and cleanup must be recorded. Do not execute the known unsafe artifact-copy code before portability repair. No probabilistic rerun-to-green; investigate failures. Controller verifies same-head remote CI after independent review/push.
- [ ] **Step 5: Commit and report.** Stage only the listed task files, conventional commit with Refs #9/#13/#19/#52/#66/#97/#103 as applicable and Codex attribution. No worker push/PR/nested agents. Full report is bounded, with actual RED/GREEN excerpts, commands, log paths, source provenance, exact commit and limits. Fresh independent review follows before the next task.

## Acceptance limits and next work

This adoption does not clear PR103's known screen/gate findings Q1–Q5, dependencies, physical qualification or full approved Plan B. The controller's exact-head reconciliation report assigns those defects and maps missing registration/consent, A6 world consumers, OTP/fragment, contact presence, active controls/GPS, countries/locales/ETA and spotlight to follow-ups. Reuse the canonical source and browser runner for those tasks. A6 backend/SDK changes and compatible UI consumers must pass the extended journey on the same integrated head before any contract-breaking merge.

## Self-review

- [x] One bounded adoption task, exact files/interfaces/source commits and RED/GREEN commands; no competing initial mount or harness.
- [x] Missing spec features remain explicit follow-up work; no unsupported whole-app claim.
- [x] A-owned types/decoder/session fixtures excluded and the same-head A6 integration gate retained.
- [x] Review Focus cases map to existing/new behavioral tests; low-impact fixture/path cleanup uses existing checks.
- [x] Execution already authorized; no additional plan confirmation.
