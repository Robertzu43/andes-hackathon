# Canonical Phone Demo Remaining Plan B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task with a fresh implementer and independent reviewer, dispatched by the controller. Steps use checkbox syntax. Execution is already
authorized; no new plan confirmation.

**Goal:** Complete the approved driver/contact phone journey on canonical PR103 without replacing its mount, runtime, controllers, SDK or browser runner.

**Architecture:** Extend `createPhoneDemoRuntime(origin: string)` , `createPhoneRoutes(runtime)` and the mounted `screens.tsx` /contact views. Adopt the separate reviewed resolve/observation port first; repair the five screen defects next.
Prepare independent protocol primitives, then cut over A6, onboarding, OTP consent and the existing browser journey together when the real OTP backend is ready.

**Tech Stack:** Node `>=24 <27` , React19, TypeScript5.9, Vite8, existing Node/SSR/CDP helpers, disposable local PostgreSQL15+. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-18-functional-phone-demo-design.md` at approved PR96 commit `c8517e42e3419874a7f87319badc8d31d54e4c49` . Read alongside this plan; if not yet merged, use
`git show c8517e42e3419874a7f87319badc8d31d54e4c49:docs/superpowers/specs/2026-10-18-functional-phone-demo-design.md` . Canonical application/design source: PR103 commit `d3a1b256f90a303ab4a050a8601a835e690af289` , including
`CONTRIBUTING.md` , `DESIGN.md` and `docs/design/{README,specification}.md` . Use these Git/PR pins when the working branch differs; no local scratch or ignored planning artifact is required.

## Global Constraints

- PR103 at canonical head `d3a1b256f90a303ab4a050a8601a835e690af289` is the canonical INITIAL slice, not full B acceptance. Preserve `main.tsx` , runtime/routes/screens, `readStatus` , boolean `automaticEscalation` , `test:phone` and its
  existing root CI hook. No second runtime/state layer/browser harness/initial B PR.
- **Binding Brain ordering 08:57 supersedes the old Task6-first preference:** adoption → Q1–Q5 rendered/request fixes → A6 consumers/onboarding/contact OTP/presence/active flow → tour after screens settle → same-head acceptance. Independent
  protocol preparation may precede the atomic cutover; the controller records dependency reordering.
- Single origin; `/v1/*` ; no CORS or production OIDC changes. Default `es` , also canonical `pt-BR` ; device zone `Intl.DateTimeFormat().resolvedOptions().timeZone` . Trip choices come ONLY from `tripCountries` ; OTP
  `DEMO_ALLOWED_COUNTRIES` is a different policy. Empty countries means unavailable, never invented PE.
- Poll driver/contact status and pending-contact/trip discovery every `5000 ms` , at most one in-flight cycle. Tokens expire in `2 h` / `7200 s` . OTP has `6` digits, `10 minutes` , `5` attempts; hourly defaults are `3` per number and `5`
  per IP. The backend owns these limits.
- Demo timing: `SILENCE_MS=120000` , `ASK_GRACE_MS=60000` , `ARRIVAL_GRACE_MS=120000` , `CHECK_SWEEP_MS=5000` ; these are demo values. The browser never opens/escalates a check.
- Reuse approved Tándem wordmarks/Manrope/OFL and semantic tokens: canvas `#F7F5F0` , surface/on-action `#FFFFFF` , ink `#132C3A` , action `#086F79` , danger `#B42332` , warning `#825400` , positive `#16634B` . Targets minimum `48px` ,
  primary `64px` , in-route `80px` , action gaps `16px` ; text can enlarge. Green establishes no safety.
- Stable OK/pause/SOS positions; dominant red one-touch SOS through `requestHelp()` , independent of ordinary interaction gating. Owner resolution uses the dedicated sixth slot; arrival never resolves an incident. Keep resolution available
  for an arrived trip with an open incident.
- No phone in responses/statuses/logs; necessary phone entry is transient, cleared visibly on dispatch. Retain only the memory closure needed for the pending invitation/OTP sequence, then erase on completion/expiry/retirement. Never persist
  phones, names, tokens or OTP codes. Capture, server receipt, provider acceptance, delivery and human response remain separate facts.
- Invitation `/contact/invitations/:grantId#t=<family token>` : erase fragment synchronously before async work; credentials stay in memory and backend verification establishes authority. Contact pages never mint their own world or acquire
  family from the driver's local world as an authentication shortcut.
- No `.env*` /secret reads/writes/copies, AWS/deploy/tunnel/live provider/spending/real SMS/calls. Fake OTP sender/code only through in-process `createApp` options, never environment, URL, storage or a public bypass. Missing genuine
  reviewed device qualification means capture unavailable; never fabricate a packet.
- A owns `web/src/lib/api/{types,responses}.ts` , `web/tests/api/{runtime.test,runtime.integration}.mjs` , backend and root CI. Reviewed/pushed A6 is `dedffcd70567cd8051f59d2d9230552c70f77069` ; boolean hunks already match PR103. B owns
  consumer patches. Do not edit A files; integrate through the controller, preserving both histories.
- A6 contract: `{synthetic:true,expiresInSeconds:7200,expiresAt,tripCountries:string[],driver:{id,token},family:{id,token},colleague:{id,token,grantId}}` . No seeded truck/family grant, alternate DTO, compatibility union or casts hiding
  obsolete fields. **A6 backend merge HOLD until this exact contract and compatible browser consumers pass on one integrated head.**
- OTP progress: A8 is independently reviewed at `fb6b0da` ; A9 is active. Consume the actual reviewed OTP backend and in-process test seam when its handoff is complete. Keep adoption/repair/primitives runnable with the canonical legacy
  world until the coherent cutover; no partially cut-over production mount or broken legacy CI journey.
- Controller owns task gates, ledger, integration/publication and owner-thread replies. Follow-up PRs target `main` , retain explicit #103/#100/#96 dependencies and DRAFT/HOLD as needed; Robert alone merges. No writes to Robert's branch.
  Every future commit uses the commit skill, task-scoped staging, `Refs #N` and agent attribution.

## Review Focus

1. **Q1:** A-bound journey with B in the route must expose no mislabeled SOS/OK target; valid A controls still request A. Owner: Task1 render AND request regressions.
2. **Q2:** loading, first-read failure, denied/invalidated status and retained stale data must not claim no check/empty deliveries; valid current null check may. Owner: Task1.
3. **Q3:** absent/pending/revoked/foreign family contact must send zero confirm requests, including after consent changes at review. Owner: Task1, retained through Task3/new-world CI.
4. **Q4:** rejected/not-sent/lost confirmation must preserve the saved draft and offer explicit recovery; uncertainty replays its original body/key. Owner: Task1.
5. **Q5:** resolved `begin()` with gateway `error` /`expired` must render recovery without navigating; connecting/retry/success must render actual transitions. Owner: Task1, retained through contact cutover.

---

## Reconciliation, handoffs and file map

| Original task | Already canonical/adoption-owned | Remaining owner below |
| --- | --- | --- |
| 3 runtime/foundation | Real production mount, one runtime/router/locale/session SDK, driver/contact/privacy registry | Tasks1/3 gateway/lifecycle/new-world consumers; Task3 Tándem brand/token/target correction |
| 4 preparation | Home, seeded truck display and direct draft+confirm | Task1 Q3/Q4; Task3 actual truck/invite/wait/review, countries/locale/ETA/reset |
| 5 active screens | Active/check/alerts/summary routes, SOS/OK and driver status interval | Task1 Q1/Q2; Task4 qualified-host UI, pause/resume/resolve/arrival and truthful facts |
| 6 spotlight | Not implemented; prior fixture deprecation cleanup moved into adoption | Task6 standalone plus composition AFTER stable screens; no new visual concept/image gate |
| 7 invitation/OTP | Family gate impersonates the seeded local family; accept disabled | Task2 independent transport/fragment; Task3 actual recipient authentication/OTP/consent |
| 8 discovery/presence | Existing contact journey/view, manual status/location refresh | Task2 bindings/pump; Task5 discovery/presence/wake-lock composition |
| 9 real browser CI | Existing `web/tests/phone/journey.mjs`, package script and root CI invocation | Task3 minimum atomic acceptance; Task7 full ordered acceptance, same runner/hook |

Adoption owns resolve controller/SDK/correlation, `createTripObservationHost` , uploader policy, alias, Q6 artifact portability, Q7 decoder guard and owner-settlement flake. Consume those published interfaces; do not port them again or
reassign their tests here.

| Exact paths | Responsibility |
| --- | --- |
| Existing `web/src/app/{runtime.ts,phone-routes.tsx}`, `web/src/main.tsx` | Extend actual runtime and composition, retirement/reset and contact-document acquisition |
| Existing `web/src/features/driver/{screens.tsx,messages.ts,ui.css}` | Preserve exported Home/Trucks/Prepare/TripHome/CheckIn/Alerts/Summary; real forms, phases, active controls/facts |
| New `web/src/features/contacts/{demo-management.tsx,invitation.tsx,presence.ts}` | Demo invite/wait, OTP/accept/wait-for-trip, single-flight presence lifecycle |
| Existing `web/src/features/contacts/{routes.tsx,view-store.ts,messages.ts,ui.css}` | Reuse ContactView/journey, incident/location/scopes/revocation; integrate presence |
| Existing `web/src/lib/api/{client.ts,demo.ts,index.ts}`; new `demo-phone.ts`, `recipient.ts` there | Authenticated keyless OTP, fragment gateway, exact recipient catalogs; A's DemoWorld remains sole world type |
| Existing `web/src/foundation/{app.tsx,messages.ts}`, `web/src/styles/{tokens.css,foundation.css}`, `web/index.html`, `web/README.md` | Supplied brand/tokens, licensed font, accessible sizing, no-referrer and honest runnable-scope docs |
| New `web/src/features/tour/{controller.ts,spotlight.tsx,steps.ts,messages.ts,ui.css}` | Read-only ordered spotlight and replay, no command authority |
| Existing `web/tests/phone/{journey.mjs,mount.test.mjs,home-render.tsx}`; task-specific tests listed below | Extend original actual-backend runner and SSR helper; isolated tour fixtures are component tests, not another phone harness |

## Commands and evidence rules

Prerequisite: from repository root run `node --version` and proceed only with Node `>=24 <27` (24, 25 or 26). Select a supported runtime using your local tooling before running commands; all npm/node subprocesses must inherit it. Commands
below use normal `npm` and `node` ; no machine-specific activation wrapper is required.

Each task runs its listed RED command before production edits; missing test files are setup failures, not sufficient behavioral RED. Record failing named assertion against the prior implementation, GREEN, exact SHA and valid-input control.
Use `envDir:false` for Vite fixtures; use actual config for the adapter alias. No source-string/route-function-only substitute for rendered/request assertions.

`npm --prefix web test` runs the strict build and native suites; full persisted verification uses the controller's owned disposable PostgreSQL invocation with process-only synthetic configuration, not inherited application environment.
Existing resource helpers are `disposableDatabase/testEnvironment` in `scripts/app-integration/runtime.mjs` ; always clean owned processes/DBs in finally. Missing prerequisites/skips are not acceptance. `test:phone` already owns its real
API/DB/browser setup. Synthetic browser/OTP tests do not qualify physical capture or live delivery.

## Task 1: Verify/adopt upstream updates, then repair unresolved Q1–Q5 FIRST

**Depends on:** completed/reviewed canonical adoption. No A6/OTP dependency; preserve the currently working seeded-world journey.
**Files:** Modify `web/src/features/driver/{screens.tsx,messages.ts}` , `web/src/app/phone-routes.tsx` , `web/tests/phone/{home-render.tsx,mount.test.mjs,journey.mjs}` . After upstream adoption, extend existing
`web/tests/phone/{family-gate.test.mjs,family-render.tsx}` for real gateway transitions rather than duplicating their covered cases. Create/Test `web/tests/phone/{screen-recovery.test.mjs,prepare.test.mjs,gates.test.mjs}` . No controller
rewrite or A-owned file.

**Interfaces:** Keep `createPhoneRoutes(runtime):FeatureRoutes` and actual exported screens. Consume `JourneySnapshot` fact fields `state/data/invalidated/error/clientReceivedAtMs` , `gateway.getSnapshot().state` ,
`confirmTrip({confirmed:true})` , `retryUnknown('confirm',{confirmed:true})` , `openTrip(draft.id)` . Use `listContacts/getBootstrap` `ContactSummary.contactId` to match `world.family.id` ; do not infer family from any accepted row or
require removed `family.grantId` .

- [ ] **Step1 — Refresh/verify/adopt:** canonical PR103 pin is `d3a1b256f90a303ab4a050a8601a835e690af289` . Refresh exact head, full discussion/reviews/threads before dispatch. Compare upstream changes using Git/PR history from initial
  `c4f728dc2e41e4c55431c59d2afeba2a7a71fe07` through `bf87ca743b10217b2c81b69ade0531b9b73c7290` to the canonical pin; preserve upstream capture/test updates, A-owned root fixes and separately reviewed adoption. Latest d3a adds only the root
  interrupt change (+6/-2), independently reviewed by A61; screens/routes/runtime/gateway app code remains unchanged from bf87. Baseline
  `node --test web/tests/phone/captures.test.mjs web/tests/phone/family-gate.test.mjs web/tests/phone/status-binding.test.mjs` on the reconciled candidate, then repair the still-unresolved Q1–Q5 with actual rendered/request RED/GREEN. No
  duplicate upstream repair, Robert-branch write or gate clearance from claims.
- [ ] **Step2 — Write behavioral RED tests:** `route_mismatch_blocks_cross_trip_writes` : render A, navigate B, mismatch/recovery visible, zero SOS/OK requests while mismatched; returning to A yields SOS and OK requests targeting A.
  `unknown_status_is_not_no_check` : delayed/failed/403/404/invalidated/retained-old status render unknown/stale with read time, no affirmative no-check/empty-delivery copy; current successful null check does show no-check, and
  matching-trip SOS still sends.
- [ ] `family_acceptance_required` : missing/pending/revoked/foreign-id catalogs each render waiting/recovery and send zero confirms; valid same-world accepted family plus colleague sends exactly those grant IDs. Re-read before
  confirmation; `409 contact_not_accepted` stays inactive and shows consent recovery. Keep this policy in demo screen orchestration, not a global backend/selection-validator change.
- [ ] `saved_draft_confirmation_recovers` : rejected/not-sent confirm keeps one draft and permits explicit confirm of that draft after recovery; unknown confirm exposes reconcile and same-intent retry, preserving id/body/key. Successful
  authoritative `openTrip(draft.id)` recovers an already-created trip. Never re-run edit-text/save-draft or create a replacement while outcome is unknown.
- [ ] `gateway_snapshot_drives_both_gates` : actually render Home and FamilyGate connecting/error/expired → retry → authenticated. `begin()` resolves on error; assert zero protected navigation, no catalog requests and visible error. Valid
  authentication navigates; concurrent clicks mint once. Extend existing CDP journey with request interception for failure/lost-response cases and actual UI clicks, retaining its real-backend happy path.
- [ ] **Step3 — Run RED:** `node --test web/tests/phone/screen-recovery.test.mjs web/tests/phone/prepare.test.mjs web/tests/phone/gates.test.mjs` ; `npm --prefix web run test:phone` . Expected failures are wrong target, false absence,
  missing contact guard, stranded draft and hidden gateway failure; retain separate evidence for each Q1–Q5 and accepted valid inputs.
- [ ] **Step4 — Implement:** reject route mismatch with an explicit link to the bound trip before showing its controls. Derive draft/review/confirm/recovery phase from the existing journey snapshot; retry rejected/not-sent confirmation on
  the saved draft, uncertainty only through explicit same-key retry/reconciliation. Render snapshot gateway errors and navigate only after authenticated success. No second screen store/runtime or silently minted world.
- [ ] **Step5 — GREEN:** repeat Step3, then `npm --prefix web test` . All five regressions and existing seeded browser journey pass; actual route/request agreement is evidence. Controller's fresh reviewer verifies mutations and
  original-thread dispositions.
- [ ] **Step6 — Commit:** only listed files; message `fix(web): Repair canonical trip and gateway recovery` with `Refs #97, #103` . Controller offers the reviewed commit/evidence in original Q threads; planner/worker does not self-clear
  findings.

## Task 2: Prepare OTP, fragment, recipient and presence primitives independently

**Depends on:** Task1. No new-world production mount or unavailable backend required. This is the smallest preparation split of original Tasks7/8; it does not activate OTP UI yet.
**Files:** Create `web/src/lib/api/{demo-phone.ts,recipient.ts}` , `web/src/features/contacts/presence.ts` ; modify `web/src/lib/api/{client.ts,demo.ts,index.ts}` . Create/Test
`web/tests/phone/{otp.test.mjs,invitation.test.mjs,recipient.test.mjs,presence.test.mjs}` ; modify `web/tests/api/contracts.types.ts` for published consumers.

**Interfaces:** ApiClient `startDemoPhone({phone}: {phone:string}, options?:RequestOptions):Promise<{expiresAt:string}>` , `verifyDemoPhone({phone,code}: {phone:string,code:string}, options?:RequestOptions):Promise<{verified:true}>` . Their
types/decoders live in `demo-phone.ts` , not A's files. Actor bearer REQUIRED; NO idempotency header; no automatic retry. Keep all ordinary write keys and actorless-session policy intact.

`createInvitationSession({api,session,location,history}):SessionGateway` in `demo.ts` consumes only `getIdentity` , MemorySession, Location pathname/hash and History.replaceState. Parse/erase fragment at construction, before `begin()` ;
retain metadata/credential only in memory. Verify family persona/world-form sub/iss/aud/exp metadata as acquisition constraints, then `/v1/me` authenticates; token decode itself is not verification. No `createDemoSession` capability.

ApiClient `listContactInvitations(options?:RequestOptions):Promise<ContactInvitations>` and `listContactTrips(options?:RequestOptions):Promise<ContactTrips>` use `recipient.ts` . Both envelopes `{readAt,limit:100,hasMore,...}` ; invitation
rows `{id,driverId,requested:{map,incident},accepted:{map,incident},status,acceptedAt,revokedAt}` ; trip rows `{tripId,grantId,driverId,status,scopes:{map,incident},activeIncidentId}` . Preserve source enums/UUID/ISO/null values; project
fixed phone-free fields, reject >100 rows/duplicates. A missing grant in truncated results is not permission.

`startContactPresence({refreshStatus,suspend,document,navigator}):()=>void` consumes callbacks `refreshStatus():Promise<void>` , `suspend():void` , visibility and optional screen wake lock. Immediate refresh then `5000 ms` , no overlapping
async cycle. The view owns authenticated GET/state updates; this primitive only schedules existing view work. Hidden/stop invokes suspend to abort/conceal reads, releases lock/removes listeners and ignores late completion; visible resumes
one cycle.

- [ ] **Step1 — Write RED:** `otp_is_authenticated_keyless_202_200` checks exact start `202 {expiresAt}` and verify `200 {verified:true}` , Authorization, no key, no anonymous dispatch, no retry, malformed success rejection. Table start
  errors `400 invalid_phone` , `403 country_not_allowed` , `429 rate_limited/demo_budget_exhausted` , `503 demo_sms_disabled` ; verify `400 invalid_code` , `410 code_expired` , `429 too_many_attempts` ; both preserve `400 invalid_request` .
  No raw phone/body in errors.
- [ ] `fragment_erased_before_first_async` checks exact URL cleanup with query/path preserved, no token storage/log/referrer, malformed/duplicate/oversized/expired/nonfamily/foreign invitation refusal and zero session mint.
  `recipient_catalogs_are_authoritative` covers empty versus denied/unsupported/truncated, scopes and arrived trips with active incidents. `presence_polls_and_retires` uses finite timers for repeated authenticated reads, one in flight,
  logout/expiry/revocation/hidden cleanup and nonfatal wake-lock refusal, zero polling writes.
- [ ] **Step2 — RED:** `node --test web/tests/phone/otp.test.mjs web/tests/phone/invitation.test.mjs web/tests/phone/recipient.test.mjs web/tests/phone/presence.test.mjs` . Expected missing operations/gateway/pump after tests are
  established.
- [ ] **Step3 — Implement:** extend the existing request helper with separate auth/key/success-status policy; only session mint is actorless. Add recognized fixed OTP codes, retain leases/error redaction/credentials
  omit/no-store/no-referrer. Do not import or change DemoWorld assumptions, mount these primitives or call a real OTP provider. Presence rechecks session authority through the SDK each cycle; hidden/suspended pages cannot promise
  attendance.
- [ ] **Step4 — GREEN:** repeat Step2; `node web/node_modules/typescript/bin/tsc -p web/tests/api/tsconfig.json` ; same with `--module ESNext --moduleResolution Bundler` ; `npm --prefix web test` ; existing `npm --prefix web run test:phone`
  remains GREEN with legacy production behavior.
- [ ] **Step5 — Commit:** listed files only; `feat(web): Prepare verified contact protocol primitives` , `Refs #97, #103` . Report these as protocol tests, not backend OTP acceptance.

## Task 3: Atomic A6 consumer, onboarding and contact OTP/consent cutover

**Depends on:** Tasks1/2 and reviewed actual A6 plus OTP start/verify backend and documented in-process `createApp` test seam. A6 is available; A8 is reviewed at `fb6b0da` and A9 is active. The remaining dependency is the complete reviewed
OTP backend/test-seam handoff and its integration. Controller integrates all participants in an owned candidate; do not land A6/backend or SDK world decoder alone against old screens/runner.
**Files:** Modify `web/src/app/{runtime.ts,phone-routes.tsx}` , `web/src/main.tsx` , `web/src/lib/api/demo.ts` , `web/src/features/driver/{screens.tsx,messages.ts,ui.css}` , `web/src/features/contacts/{view-store.ts,messages.ts,ui.css}` ,
`web/src/foundation/{app.tsx,messages.ts}` , `web/src/styles/{tokens.css,foundation.css}` , `web/index.html` , `web/README.md` , `web/tests/phone/{home-render.tsx,mount.test.mjs,prepare.test.mjs,invitation.test.mjs,journey.mjs}` . Create
`web/src/features/contacts/{demo-management.tsx,invitation.tsx}` and `web/tests/phone/{runtime.test.mjs,foundation.test.mjs}` .
**Assets:** Copy approved `docs/design/assets/tandem-logo-ink.svg` to `web/public/brand/tandem-logo-ink.svg` , and `fonts/{Manrope.woff2,OFL.txt}` to `web/public/brand/fonts/` ; no new artwork. A integrates its own types/decoder/runtime
fixture changes; B does not edit them.

**Interfaces:** Preserve `createPhoneDemoRuntime(origin:string)` and existing returned api/session/gateway/familyApi/familySession/familyGateway/journey/binding/world. Add `restart():Promise<void>` and `dispose():Promise<void>` ; extend
existing world source with `reset():void` , retiring pending generations. World `.get()` remains one explicit-start acquisition, not mount/route/expiry auto-mint. Cap credentials at JWT exp, `world.expiresAt` and `7200 s` .

`DemoManagement({runtime,onAccepted}:{runtime:PhoneDemoRuntime,onAccepted:()=>void})` owns the demo invite/wait form. `Invitation({runtime,grantId}:{runtime:PhoneDemoRuntime,grantId:string})` owns recipient OTP/accept/wait. Consume Task2
methods plus existing `inviteContact(body,WriteOptions)` and `acceptContact(grantId,{map:true,incident:true},WriteOptions)` .

Extend ContactView with `acceptInvitation(hint:Pick<Invitation,'id'|'driverId'|'contactId'|'requested'>,choice:ConsentScopes):Promise<void>` using its existing ContactJourney.acceptInvitation/perform/retry. Here Invitation is the existing
journey hint type, not the UI component. Build hint from the authenticated recipient inbox row and `/me` actor; a hint is never authorization. Preserve `createContactRoutes` privacy/non-demo behavior; no second consent state machine.

- [ ] **Step1 — Write RED:** `new_world_starts_empty_and_resumes_from_catalogs` : zero mint on render, single mint on double start, `/me` before protected views; real POST truck then `/contacts` then `/trips/new` ; new world has no
  truck/family grant fields. Resume from authenticated active-trip/truck/contact facts, not seeded metadata. Reset retires old sessions/controller/observations/catalog reads, mints a DIFFERENT world only on explicit action; delayed old
  mint/read cannot repopulate.
- [ ] `invite_waits_for_same_world_family` : invite `{contactId:world.family.id,phone,map:true,incident:true,role}` with default family; name stays client-only, phone field clears on dispatch. Poll contacts `5000 ms` ; pending/revoked/no
  family blocks confirmation. Share the exact fragment link. Duplicate/wrong number offers «Empezar de nuevo» to mint a new world. Selecting colleague role does not satisfy the required family gate.
- [ ] `trip_review_uses_qualified_country_locale_eta` : all description/truck/origin/destination/country/locale/timeZone/future explicit-offset arrival fields reach draft and explicit confirm; offer ONLY world.tripCountries, canonical
  ES/pt-BR and device zone. Empty list/missing fields/past ETA/denied or truncated catalogs disable submission; check again at confirm. Preserve Task1 Q3/Q4; confirm attaches accepted family AND `world.colleague.grantId` .
- [ ] `independent_contact_verifies_then_accepts` : second isolated browser opens fragment link; erase before async, authenticate using its credential, no driver-world mint. Visible phone/code clear on dispatch; closure clears on
  success/expiry/restart/unmount. Only real successful verify enables explicit accept; wrong code/expired/rate limit/disabled SMS/wrong-world never accept. Unknown accept retains its original key and reconciles via invitation GET/retry,
  never a new grant.
- [ ] `atomic_browser_cutover` : extend EXISTING journey with two `browser()` instances/profiles and actual production UI: start → empty truck POST → pending invite → OTP through actual backend fake in-process sender → accept → reviewed
  confirm → active trip/status/contact discovery. SQL asserts zero trips before acceptance, no seed truck/family grant, exact trip grants and family OTP verification. No `__ANDES_TEST_MOUNT__` , fabricated acceptance or DTO fallback.
- [ ] **Step2 — RED:** `node --test web/tests/phone/runtime.test.mjs web/tests/phone/foundation.test.mjs web/tests/phone/prepare.test.mjs web/tests/phone/invitation.test.mjs` ; `npm --prefix web run test:phone` on the unadapted integrated
  A6/OTP candidate. Expected obsolete seeded consumer/order/consent failures. Record the exact A backend commits; unavailable OTP is dependency failure, not behavioral RED.
- [ ] **Step3 — Implement runtime/composition:** retain current runtime, retire both memory sessions/binding/controller/host work on reset/dispose. Contact-document familyGateway uses `createInvitationSession` , never local
  `createDemoSessionGateway(persona:'family')` . Pass the document's actual driver/contact gateway to Foundation; sharing opens an independent document. Reload without fragment requests reopening the original link. Add document no-referrer
  policy and remove misleading no-OTP/seeded/Peru-only copy.
- [ ] **Step4 — Implement existing forms and consent:** `Trucks` calls `journey.registerTruck(label)` after authenticated evidence; demo contacts replace UUID/scope entry with phone/name/role and fixed requested scopes. Refresh
  authoritative selection evidence after writes. `Prepare` keeps Task1 phases, separately saves/reviews/confirms and re-reads family consent. Contact screen verifies then accepts through its existing journey; waits/polls recipient trip
  catalog and opens returned trip IDs. Add data-tour anchors without mounting the tour yet.
- [ ] **Step5 — Apply existing design:** use supplied wordmark/font, map foundation CSS variables to exact tokens, Tándem document/header/footer copy, 48/64/80px targets, safe areas, both locales and 200% text. Keep router and semantic
  components; do not redesign or add optional visuals. Test surface/on-action white, bundled font, minimum targets and no production mount hook.
- [ ] **Step6 — GREEN:** repeat Step2, API NodeNext/Bundler type commands from Task2, `npm --prefix web test` and `node --test web/tests/api/shared-sdk.integration.mjs` under owned DB. Existing root CI must run `test:phone` on the SAME
  integrated candidate. Keep contract-merge HOLD if any participant/test/handoff is missing; separate-head green does not count.
- [ ] **Step7 — Commit:** B-listed files only; `feat(web): Cut over onboarding to verified demo worlds` , `Refs #97, #103` . Controller assembles/reviews A+B together and records A6 HOLD disposition; no B worker edits A files or
  unilaterally publishes half the cutover.

## Task 4: Finish active/check/alerts/summary through the adopted host

**Depends on:** Task3 integrated consumers and adopted sixth resolve/observation interfaces. Preserve Task1 wrong-target/unknown-state repairs and canonical status/boolean binding.
**Files:** Modify `web/src/features/driver/{screens.tsx,messages.ts,ui.css}` , `web/src/app/{runtime.ts,phone-routes.tsx}` , `web/src/main.tsx` , `web/tests/phone/{screen-recovery.test.mjs,journey.mjs}` . Create/Test
`web/tests/phone/active.test.mjs` .

**Interfaces:** Consume `journey.sendCommand('checkin_ok'|'pause'|'resume'|'arrived')` , `requestHelp()` , adopted `resolveIncident():Promise<Outcome>` / `retryUnknown('resolve',{confirmed:true})` , `refreshStatus/refreshIncident` . Consume
adopted `createTripObservationHost({tripId,revision,session,api,baseUrl,reviewedContext,captureOptions?})` → `startSharing(nativeEvent):Promise<void>` , `stopSharing():Promise<void>` , `getSnapshot/subscribe` , `dispose():Promise<void>` .
Qualification input uses that host's actual parameter type; no replacement packet schema or external toggle.

- [ ] **Step1 — Write RED:** `active_controls_use_authoritative_status` : status interval `5000` , max one in flight, open check routes to check-in with actual `askUntil` ; countdown expiry performs no write. Pause/resume and OK preserve
  backend boolean results; SOS works from moving/unknown interaction without confirmation, duplicate pending submission or route-target confusion.
- [ ] `owner_resolution_is_separate_from_arrival` : active-incident safe button calls dedicated resolve, refreshes facts, never invents resolvedAt; uncertain retry keeps incident/body/key and SOS available. Arrival sends arrived, stops
  acquisition/queue, opens summary, leaves incident active and owner resolution reachable; arrived-first and resolve-first both covered.
- [ ] `gps_requires_fresh_gesture_and_qualification` : explicit native button event reaches READY host synchronously before first await; no event replay after async preparation. Null/unreviewed packet, denied GPS/IndexedDB,
  hidden/freeze/pagehide, expiry/logout and wake-lock refusal render truthful sharing/capture/receipt states; stop/denial reports through host sharing lifecycle. Subject ownership is session JWT `sub` , not `/me` UUID. Positive detached
  platform+clock tests remain synthetic; real acquisition stays unavailable without genuine packet.
- [ ] `delivery_and_location_facts_are_distinct` : display server freshness/capturedAt/accuracy and separate local acquisition/read age, stale/unavailable/denied states; pending/accepted/delivered/unknown/unavailable by role/channel/reason,
  including colleague destination_not_allowed. Never turn acceptance into human response, unavailable status into empty facts, or stale coordinates into movement.
- [ ] **Step2 — RED:** `node --test web/tests/phone/active.test.mjs web/tests/phone/screen-recovery.test.mjs` ; `npm --prefix web run test:phone` with new actual control assertions. Expected missing pause/resolve/arrival/host UI; retain
  Q1/Q2 valid-input cases.
- [ ] **Step3 — Implement:** one current-trip host tied to credential revision; start/stop/dispose it through runtime lifecycle, consume snapshots rather than clone host/pipeline. Poll only current authenticated trip, retire/abort on
  exit/account change, route backend open check to banner. Use Foundation `criticalActions` for one correctly targeted SOS across driver check/alerts/recovery routes; avoid duplicate controls. Task1's route-identity guard also covers this
  critical region: a mismatched B route cannot dispatch A controls. Keep stable OK/pause/SOS order and honest delivery/location copy, plus data-tour anchors.
- [ ] **Step4 — GREEN:** repeat Step2; `node --test web/tests/phone/observations.test.mjs web/tests/observations/*.test.mjs` ; `npm --prefix web test` . Browser checks at 320px/390px, both locales/200% text, critical actions ≥80px and no
  overflow/covered SOS. No physical GPS proof claimed.
- [ ] **Step5 — Commit:** listed files only; `feat(driver): Complete active trip controls and sharing` , `Refs #52, #66, #97, #103` .

## Task 5: Compose contact discovery, status presence and scoped facts

**Depends on:** Tasks2/3, stable active-route/status interfaces from Task4. Reuse the existing ContactView/ContactJourney; do not replace their scope/revoke/receipt handling.
**Files:** Modify `web/src/features/contacts/{invitation.tsx,presence.ts,routes.tsx,view-store.ts,messages.ts,ui.css}` , `web/src/app/phone-routes.tsx` , `web/tests/phone/{presence.test.mjs,recipient.test.mjs,journey.mjs}` . Existing
contact regression suites remain authoritative.

**Interfaces:** Keep `createContactView(host:ContactHost, view:'driver'|'contact', tripId?:string)` return snapshot/subscription/start/stop/loadLocation/loadIncident/revoke/ack/report/retry and Task3 acceptance. Extend it with
`refreshStatus():Promise<void>` using the existing journey's loadStatus, then current correlated incident/permitted location reads. Add `suspendPresence():void` calling existing journey.concealProtectedFacts plus view publish; it cancels
protected reads without forgetting a pending/uncertain write/key.

Call Task2 `startContactPresence({refreshStatus,suspend:suspendPresence,document,navigator})` inside the existing view's lifecycle. No separate pump GET or parallel status store. `ContactHost.grantReference(tripId)` is the discovered grant
reference for revoke only, never read authority.

- [ ] **Step1 — Write RED:** `accepted_contact_discovers_only_attached_trip` : real accept precedes confirm, empty list waits, trip appears only after attach; authenticated catalog populates grant/incident references,
  truncated/denied/revoked remain distinct. Arrived trip with active incident remains reachable, map scope stays false.
- [ ] `contact_poll_preserves_presence_with_driver_offline` : repeated actual authenticated `/status` at `5000 ms` , one cycle, update incident/location from current facts; driver reads/capture stop while contact remains visible. Finite
  clock + actual sweeper shows check opens/escalates only with fresh world presence, not UI timers. Hidden/suspended/unmounted/expired contacts stop and release wake lock; visible resumes one pump, late results ignored.
- [ ] `scope_denial_does_not_erase_other_authorized_scope` : map403 preserves separately permitted incident; revocation/account change conceals protected facts/receipts and retires reads. Acknowledgement/action remain human reports, never
  resolution. Status failure shows uncertainty/read age rather than no check/no deliveries.
- [ ] **Step2 — RED:** `node --test web/tests/phone/presence.test.mjs web/tests/phone/recipient.test.mjs` ; `npm --prefix web run test:phone` . New composition assertions fail against one-shot/manual contact reads.
- [ ] **Step3 — Implement:** connect the pump inside existing view start/stop and scope checks; avoid duplicate loadStatus by letting one view-owned refresh perform status and subsequent correlated reads. Manual refresh uses the same
  in-flight cycle. Complete invitation wait/discovery navigation; request optional screen wake lock, release/reacquire by visibility. Add contact tour anchors and truthful suspended-page attendance explanation.
- [ ] **Step4 — GREEN:** repeat Step2; `node --test web/tests/contacts/*.test.mjs` ; `npm --prefix web test` . Include existing revoke/incident/location-age browser regressions through their existing commands, and real-backend scope tests
  under owned DB; no new harness.
- [ ] **Step5 — Commit:** listed files only; `feat(contacts): Maintain authenticated trip presence` , `Refs #62, #97, #103` .

## Task 6: Add and compose the read-only spotlight AFTER screens settle

**Depends on:** Tasks3–5 stable driver/contact targets; 08:57 ruling deliberately replaces standalone-tour-first ordering. Approved existing Tándem shape; no image generation, visual concept approval or new confirmation.
**Files:** Create `web/src/features/tour/{controller.ts,spotlight.tsx,steps.ts,messages.ts,ui.css}` , `web/tests/fixtures/{phone-tour.html,phone-tour.tsx}` , `web/tests/phone/{tour.test.mjs,tour.browser.mjs}` . Modify
`web/src/app/phone-routes.tsx` , `web/src/features/driver/screens.tsx` , `web/src/features/contacts/{invitation.tsx,routes.tsx}` , `web/src/main.tsx` for entry/targets/styles; extend existing `journey.mjs` with mounted zero-write/SOS
assertion.

**Interfaces:** `createTourController({storage,kind:'driver'|'contact'})` → `getSnapshot/subscribe/start/next/back/skip/dispose` ; `TourStep {id:string,target:string,title:string,body:string}` ; `Spotlight({controller,steps})` ;
`TourEntry({kind:'driver'|'contact'})` . Only DOM target/i18n/completion-storage authority, never API/write callbacks or automatic navigation.

- [ ] **Step1 — Write RED:** `tour_orders_all_driver_steps` exactly `welcome,truck,contact,trip,location,ok,pause,sos,check,alerts,arrival` ; contact steps explain visible facts, uncertain status, calling driver then emergency number
  without promising rescue. `tour_never_writes_or_blocks_sos` asserts zero API writes and element-at-SOS-center plus keyboard reachability on actual active route.
- [ ] `tour_survives_storage_missing_target_and_enlargement` asserts next/back/skip/replay «¿Cómo funciona?», Tab/Shift-Tab/Enter/Escape, visible focus/return focus, missing target nonblocking, resize/scroll geometry, zero reduced-motion
  animation, 320px/200% pt-BR layout. Denied localStorage shows tour safely; keys `tandem.phone-tour.v1.driver` / `.contact` retain only completion.
- [ ] **Step2 — RED:** `node --test web/tests/phone/tour.test.mjs` ; `node web/tests/phone/tour.browser.mjs` . Expected absent component/behavior; fixture owns/stops loopback Vite/CDP resources.
- [ ] **Step3 — Implement:** rectangle box-shadow spotlight, SOS-safe pointer-transparent dimmer and tooltip geometry, no modal/inert trap removing SOS. Guard storage, absent targets and reduced motion. Mount using the existing
  router/locale and critical-action protection; tours never activate controls or change routes automatically.
- [ ] **Step4 — GREEN:** repeat Step2; `npm --prefix web test` ; `npm --prefix web run test:phone` verifies mounted tour and real SOS coexist without tour writes. Adoption already owns envDir fixture cleanup; do not duplicate it.
- [ ] **Step5 — Commit:** listed files only; `feat(web): Guide the settled phone journey with a spotlight` , `Refs #97, #103` .

## Task 7: Complete the existing same-head browser journey and CI acceptance

**Depends on:** Tasks1–6, actual integrated A OTP/dispatch policy, reviewed A6 contract, current-head independent review. This is full software acceptance, not a new initial B runner/PR or PlanC physical/live evidence.
**Files:** Modify ONLY existing `web/tests/phone/journey.mjs` , `web/README.md` ; change `web/package.json` only if its existing test:phone invocation needs additional named cases. Root `.github/workflows/ci.yml` stays unchanged by default:
it ALREADY installs web dependencies and invokes `npm --prefix web run test:phone` in app-integration.

**Interfaces:** Preserve `npm --prefix web run test:phone` → current production web/root builds + `node --test tests/phone/journey.mjs` , nonzero on failure/missing prerequisite, zero silent skips. Reuse `browser(output)` twice for isolated
profiles, `disposableDatabase/testEnvironment` , actual `createApp` , `demoIssuer` , `checkOnce` and A's current `claimJob/authorizeJob/finishAttempt` contracts. Fake sender/code/provider only in-process test options; no SQS/AWS/live worker
or production OTP bypass.

- [ ] **Step1 — Extend behavioral RED:** actual driver UI → new truck → pending contact → second-browser fragment/OTP/accept → reviewed trip/accepted family+colleague → contact discovery/status. Exercise GPS unavailable without genuine
  packet plus existing positive detached host tests; OK/pause/resume; stop driver traffic while contact polling preserves attendance; actual checkOnce opens check then missed-check incident; SOS upgrades SAME incident ID; family
  fake-provider SMS/WhatsApp/voice outcomes, colleague destination_not_allowed.
- [ ] Assert driver/contact alert views reflect actual persisted jobs, acknowledgements do not resolve, explicit owner safe resolves with authoritative time, arrival ends map/acquisition; separate arrived-first case keeps active incident
  resolvable. Negative OTP disabled/wrong code/expiry/wrong-world/mismatched number and revoked-before-confirm paths cannot accept/activate. Keep Q1–Q5 actual render/request controls and all original SQL/honesty/overflow assertions.
- [ ] **Step2 — RED:** `npm --prefix web run test:phone` on the prior head with new acceptance assertions. Missing backend options are an unresolved handoff, never permission to mock away OTP/consent. The A handoff supplies actual createApp
  option signatures; compile/run against those exact exported interfaces rather than invent a backend DTO or seam.
- [ ] **Step3 — Finish test orchestration:** mutable synthetic clock + real sweeper/dispatch functions, explicit synthetic qualification/policy settings through in-process options, and fake provider acceptance labeled as such. Set synthetic
  demoLimits perIncident/perSession and alerts-per-number daily to at least `6` for the check+SOS waves; test tripCountries from actual synthetic channel entries and a truly empty configuration, never a fallback country. Do not supply a
  fabricated physical reviewedContext or manipulate consent/OTP tables to make the positive flow pass. Preserve original temporary artifact handling from adoption; redact fragment/phone/code from assertion errors/network
  diagnostics/captures and retain no screenshots while sensitive inputs are visible.
- [ ] **Step4 — GREEN:** `npm --prefix web run test:phone` ; `npm --prefix web test` ; API type commands from Task2; `node scripts/app-integration/run.mjs` ; `node --test web/tests/api/shared-sdk.integration.mjs` under owned DB. Record zero
  failures/skips, cleanup, exact integrated SHA and actual synthetic limits. Existing CI app-integration must visibly execute and pass test:phone on that same proposed SHA.
- [ ] **Step5 — CI ownership/publication gate:** reuse the existing hook. Only if a concrete setup/hook repair proves necessary, controller obtains A's no-concurrent-edit confirmation and narrow ownership release before any workflow edit; A
  independently reviews that hunk. Controller refreshes PR96/100/103/dependent heads, discussions/reviews/threads/inbox before publication and keeps HOLD for unresolved owner dispositions/evidence. CI green alone grants no merge authority.
- [ ] **Step6 — Commit:** task-scoped files only; `test(web): Complete canonical verified phone acceptance` , `Refs #97, #103` . Controller publishes evidence/limits and offers fixes through original owner threads; no author merge or
  self-approval.

## Self-review and coverage map

| Spec requirement / finding | Owning task and acceptance |
| --- | --- |
| §2 production mount, real screens, default ES/PT-BR, Tándem/accessibility | Canonical retained; Tasks1/3; Task4 active geometry; Task6 tour |
| §2 ordered registration, every draft field, reviewed explicit confirmation | Tasks1/3; Task7 actual backend/browser order and grant SQL |
| §2 SOS/OK/pause/check banner/status/location/owner resolve/arrival | Adopted host/resolve retained; Tasks1/4/7, source capture vs receipt and arrived-open-incident cases |
| §2 all 11 driver steps, short contact tour, keyboard/storage/motion/SOS | Task6 after settled screens; mounted Task7 assertion |
| §3 transient invite, accepted-family wait, reset wrong number | Tasks1/3; no seeded grant dependency or empty-family confirm |
| §3 fragment/independent recipient/OTP/consent/discovery/presence/wake lock | Task2 primitives, Task3 atomic UI, Task5 composition, Task7 actual backend |
| §4 exact empty-world consumer, countries/expiry and OTP status/auth policy | A6 dedffcd integrated in Task3; Task2 exact transport, Task7 real backend; A owns server abuse/dispatch/purge |
| §§5–6 truthful unavailable channels, phone privacy, same-world fail-closed | Tasks2–5/7; real policy acceptance uses A backend, no provider activation |
| §7 web + actual-backend CI same head | Task1 RED for Q1–Q5; Task3 minimum atomic journey; Task7 complete existing runner/hook |
| §§1/8/9 serving/deploy/physical evidence and dependency order | A/PlanC/controller external gates; no two-phone delivery/GPS qualification claim from synthetic tests |
| Q1/Q2/Q3/Q4/Q5 | Task1 individually named render/request RED/GREEN; retained Tasks3–5/7 |
| Q6/Q7/owner flake | Adoption-owned only; regression preservation, no duplicate port |

- [x] Actual canonical interfaces retained; no proposed `production.tsx` , parallel driver view-store, second world DTO or browser harness. Exact files/public methods/test assertions/commands/commits supplied per task; no implementation
  bodies.
- [x] A6 availability and OTP dependency distinguished; independent preparation leaves legacy production working; no partial cutover or backend-only contract merge. Controller alone rules on execution reorder and integration.
- [x] All original Tasks3–9 requirements mapped despite new atomic boundaries. 08:57 ordering replaces obsolete tour-first preference; nothing silently cut from OTP, privacy, GPS or consent acceptance.
- [x] Self-review checked type/name consistency, all five Review Focus ownerships, step granularity and software versus physical/provider evidence. Missing genuine packet remains honest unavailable and an external qualification gate.

## Current integration pins and handoff

Canonical PR103: `d3a1b256f90a303ab4a050a8601a835e690af289` . The preceding `bf87ca743b10217b2c81b69ade0531b9b73c7290` changes capture helpers/tests, FamilyGate DOM-shim tests, journey artifacts and ordinary unknown-operation coverage; no
screens/routes/runtime/gateway application code changed. New family tests cover a rejected mocked begin promise and static connecting state, not actual resolved-error/expired/retry behavior; Q1–Q5 remain actual repair work. The d3a root
interrupt-only delta (+6/-2) is A61-owned independent review, not a B screen fix or gate waiver.

Approved specification: PR96 `c8517e42e3419874a7f87319badc8d31d54e4c49` . A6: reviewed `dedffcd70567cd8051f59d2d9230552c70f77069` ; A8: reviewed `fb6b0da` ; A9: active. A6 backend merge HOLD remains until the real contract, complete OTP
backend and compatible consumers pass the existing browser journey on one integrated head. Reviewed adoption stays separate; refresh its exact integration/CI state and PR96/100/103 discussions before implementation/publication. Controller
owns task-package generation, preflight, review, dependency disposition and publication; no ignored artifact is a prerequisite. Local provenance and historical observations are maintained only in the private planner report.
