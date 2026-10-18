# Phone Demo · Plan B (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and mount the actual Tándem driver and contact screens, with memory-only demo authentication, consent before trip confirmation, honest location/alert states, an accessible spotlight, and a real-backend browser journey running in CI.

**Architecture:** Compose the existing Foundation router, locale provider, typed API client, driver controller, contact routes and durable observation queue. Keep the phone adapter in `src/phone-observations/`, imported through a Vite alias; do not move it or create another session DTO. Each browser document has its own MemorySession; a contact link acquires the family credential without minting another world.

**Tech Stack:** Node `>=24 <27` (local `24.17.0`), React `19.3.1`, React Router `7.18.4`, TypeScript `5.9.3`, Vite `8.3.4`, Node test runner, existing Vite SSR/CDP browser helpers and disposable PostgreSQL `15+`.

**Spec:** `docs/superpowers/specs/2026-10-18-functional-phone-demo-design.md`, §§2,3,7,9 and the exact §4 shared contract. Also `CONTRIBUTING.md`, `DESIGN.md`, `docs/design/README.md`, and Robert's [PR96 finding](https://github.com/Robertzu43/andes-hackathon/pull/96#issuecomment-6247072009), tracked in #97.

## Global Constraints

- Single origin; API paths `/v1/*`; no CORS, new runtime dependency, external login fallback or production OIDC changes. `__ANDES_TEST_HOOKS__` exists only in explicitly enabled test builds; the final browser journey uses the actual production mount.
- Default locale `es`; also `pt-BR`. Use `Intl.DateTimeFormat().resolvedOptions().timeZone`. Trip countries come exclusively from session `tripCountries`; `DEMO_ALLOWED_COUNTRIES` limits OTP destinations and defaults to `PE`. An empty trip-country list disables trip creation; do not invent a fallback.
- Driver and contact status polling: `5000 ms`. Demo token lifetime: `2 h` / `7200 s`. OTP: `6` digits, `10 minutes`, `5` attempts; server defaults `DEMO_OTP_PER_NUMBER_HOURLY=3`, `DEMO_OTP_PER_IP_HOURLY=5`. These are server policy, not client retry budgets.
- Demo policy values: `SILENCE_MS=120000`, `ASK_GRACE_MS=60000`, `ARRIVAL_GRACE_MS=120000`, `CHECK_SWEEP_MS=5000`. They are demo values, not qualified safety thresholds; the UI never opens/escalates a check itself.
- Preserve supplied Tándem assets and Manrope/SIL OFL. Exact semantic values come from `docs/design/tokens.css`: canvas `#F7F5F0`, surface/onAction `#FFFFFF`, ink `#132C3A`, action `#086F79`, danger `#B42332`, warning `#825400`, positive `#16634B`. Green proves no driver safety. Targets `48px` minimum, primary `64px`, in-route actions `80px`, action gap `16px`; controls may grow with translated/enlarged text.
- Keep OK, pause and SOS placement stable. SOS is red, dominant and one touch through `requestHelp()`, independent of ordinary interaction gating. Arrival never resolves an incident. Only the owner explicitly resolves through «Ya estoy a salvo».
- Location capture, server receipt, provider acceptance, delivery and human response stay distinct. No phone in responses, rendered statuses or logs. Phone entry is transient input; clear visible fields on dispatch and retain only the in-flight/OTP closure needed for that request sequence. No phone, token, code or display name in persistent storage.
- Link format `/contact/invitations/:grantId#t=<family token>`; consume and erase the fragment before asynchronous work, never persist it. Only authenticated backend identity/consent authorizes access.
- Spotlight: own component, no library, no writes, never covers or intercepts SOS; keyboard, visible focus, reduced motion, skip/back/next, replay and guarded localStorage.
- No `.env*` or secret reads/writes/copies; no AWS, tunnel, deploy, live provider activation, real SMS/call or spending. Fixed OTP and fake providers exist only in-process in test `createApp` options. Plan C owns physical-device/live evidence.

## Review Focus

1. **RF1 — expiry/account change during pending work:** abort/retire requests, clear protected state and ignore late results; never recreate a world behind an active screen. Tests: Tasks 1–3,7.
2. **RF2 — accepted grant revoked before confirmation:** `409 contact_not_accepted` leaves no activation and returns to consent recovery. Tests: Tasks 4,9.
3. **RF3 — page hidden, denied GPS/wake lock or unavailable IndexedDB:** stop capture, report sharing loss honestly, preserve unknown receipt semantics and retire uploads on logout. Tests: Tasks 2,5.
4. **RF4 — malformed/expired/reused fragment or foreign-world invitation:** erase the credential, fail closed after backend verification, show recovery, never mint another demo session on the contact page. Tests: Tasks 7,9.
5. **RF5 — missing spotlight target, denied storage or enlarged Portuguese text:** navigation remains usable and SOS remains reachable with zero writes. Tests: Task 6.

---

## Contract and ownership

Keep the shared contract exactly:

- `POST /v1/demo/session` → `200 {expiresAt, tripCountries: string[], driver: {id, token}, family: {id, token}, colleague: {id, token, grantId}}`, retaining additive `synthetic: true`, `expiresInSeconds: 7200`. No `driver.truckId` or `family.grantId`.
- `POST /v1/demo/phone/start {phone}` → `202 {expiresAt}`; errors `400 invalid_phone`, `403 country_not_allowed`, `429 rate_limited`, `429 demo_budget_exhausted`, `503 demo_sms_disabled`.
- `POST /v1/demo/phone/verify {phone, code}` → `200 {verified: true}`; errors `400 invalid_code`, `410 code_expired`, `429 too_many_attempts`.
- Error bodies are `{code}`; nonobject/nonstring request fields produce `400 invalid_request`. OTP requests are authenticated and keyless; they are not the anonymous session exception.
- A owns `web/src/lib/api/types.ts`, `responses.ts`, `web/tests/api/runtime.test.mjs`, `runtime.integration.mjs`. B owns the other web files. B imports A's `DemoWorld`; no compatibility union, cast hiding old fields or parallel session decoder.
- A also owns the coordinated correction `CommandResult.automaticEscalation: boolean` and a boolean command decoder; the actual backend already returns `true`. B Task 5 depends on that correction, not merely A Task 6.
- Recipient discovery is already implemented in `src/client-read/recipient.ts` and mounted in `src/api/app.ts`; its contract document's “not implemented” banner is stale. B adds web bindings only.
- A owns root CI until a narrow coordinated handoff for B Task 9. After A confirms no concurrent workflow edit, Task 9 ships `npm --prefix web run test:phone` and its CI hook together on the same tested integration head; A reviews that hunk. No B task edits backend or Plan C.

## Execution order and PR groups

| Group | Tasks / dependency | Reviewable outcome |
| --- | --- | --- |
| Production driver | **1 → 2 → 3 → 4 → 5**; Tasks 1–2 have no A Task 6 dependency; Task 3 begins session consumers and requires A Task 6 | Production mount, preparation and active driver screens |
| Spotlight | **6**, independent of A Task 6; may execute after Task 2 while A is pending; production integration follows Tasks 3–5 | Keyboard-safe, read-only driver/contact tour |
| Contactflow | **7 → 8 → 9**; Task 7 needs A Tasks 6,8,9 for backend integration; Task 9 needs A serving/OTP/dispatch and CI handoff | Credential intake, OTP/acceptance, presence and real-backend browser CI |

Start **Task 1**. Preferred execution order is **1 → 2 → 6 → 3 → 4 → 5 → 7 → 8 → 9**: Task 6 produces the standalone component before Task 3 mounts it, so A Task 6 cannot stall the initial three gates. PR grouping remains as listed. One task and an independent task review before the next; fresh contexts at execution, no nested implementers. User already authorized execution; no new plan-confirmation gate.

Each coherent group gets its own PR to `main`, using `Refs #13, #16, #24, #97` as applicable. Task commits below are future execution steps, not authorization to merge. Keep DRAFT/HOLD until PR96 is frozen/merged, actual A dependencies are integrated, current-head CI and independent review pass, and Robert dispositions clear all findings. Robert alone merges. Refresh PR96 head/files, complete discussions/reviews/inline threads and inbox before each task/group and publication. If Robert supplies B, adopt/reconcile it without overwriting his plan or pushing PR96.

## File structure

| Files | Responsibility |
| --- | --- |
| `web/src/features/driver/controller.{mjs,d.mts}`, `validation.mjs`, `README.md`; `web/src/lib/api/driver.ts` | Six bounded write slots including resolution; status/resolve SDK binding |
| `web/src/features/driver/observations.ts`, `web/src/lib/observations/phone-adapter.d.ts`; existing queue/upload modules | Actual #52→#66 composition and lifecycle, no cloned adapter |
| `web/src/app/runtime.ts`, `production.tsx`, `web/src/main.tsx` | Memory-only runtime and real Foundation options/mount |
| `web/src/features/driver/view-store.ts`, `prepare.tsx`, `active.tsx`, `routes.tsx`, `messages.ts`, `ui.css` | Catalog evidence, driver forms, active/check/alerts/summary screens |
| `web/src/features/contacts/demo-management.tsx`, `invitation.tsx`, `presence.ts`; existing routes/view-store/messages | Driver invitation/wait, recipient OTP/accept and polling |
| `web/src/features/tour/{controller.ts,spotlight.tsx,steps.ts,messages.ts,ui.css}` | Read-only spotlight and ordered localized steps |
| `web/src/lib/api/{demo-phone.ts,recipient.ts}`; existing client/demo/index | OTP/discovery contracts and contact credential acquisition; no duplicate DemoWorld |
| `web/tests/phone/` | Focused unit/render/browser tests and final actual-backend runner |

All paths below are exact; match named functions/anchors rather than pre-edit line numbers.

## Commands and evidence

From the worktree root, define the following shell function; it activates Node 24 for **every** Node/npm invocation:

```sh
n24() { (source /Users/sebasbimbi/.nvm/nvm.sh && nvm use 24 >/dev/null && "$@"); }
```

`n24 npm --prefix web test` builds/typechecks first and runs `tests/*/*.test.mjs`. TSX render tests use `createServer({configFile:false, server:{middlewareMode:true,hmr:false}}).ssrLoadModule`, as in `web/tests/contacts/catalog.test.mjs`; alias-dependent tests load the real Vite config. Browser tests reuse `web/tests/foundation/cdp.mjs`. Test fixtures are synthetic and contain no acquired credentials.

Controller baseline at `c8517e42e3419874a7f87319badc8d31d54e4c49`: web **349/349**, backend isolated harness **206/206**, zero skipped/failed, Node24.17/PostgreSQL16.14, `LC_ALL=C`; evidence `/tmp/andes-b-preflight.md`. These are baseline results, not proof of future tasks. Task evidence records RED/GREEN command, actual SHA, independent disposition and limits.

---

### Task 1: Enable SDK status reads and a separate owner-resolution intent

**Files:**
- Modify: `web/src/features/driver/controller.mjs`, `controller.d.mts`, `validation.mjs`, `README.md`; `web/src/lib/api/driver.ts`
- Test: `web/tests/driver/journey.test.mjs`, `contracts.types.ts`
- Create/Test: `web/tests/phone/driver-transport.test.mjs`

**Interfaces:**
- Consumes: existing `ApiClient.getTripStatus(id, options)`, `resolveIncident(id, WriteOptions)`, `decode.tripStatus`, `decode.resolution`.
- Produces: `DriverJourney.resolveIncident(): Promise<Outcome>`; `WriteSlot` adds `'resolve'`, `Operation` adds `'resolveIncident'`; `retryUnknown('resolve',{confirmed:true})`. `createDriverTransport` maps `readStatus` and `resolveIncident`; `decodeDriverResponse` uses existing shared decoders.

- [ ] **Step 1: Write failing tests.** Extend the existing journey fixture and add SDK tests. Pin these named cases:

```js
// 'readStatus reaches the SDK and is decoded'
assert.deepEqual(await transport(readStatus, options), {kind:'ok', data:status});
assert.deepEqual(decodeDriverResponse(readStatus, status), status);
// 'resolve has its own slot and replays the original uncertain intent'
assert.equal(journey.snapshot().operations.resolve.request.operation, 'resolveIncident');
assert.deepEqual(retryRequest, originalResolveRequest); // same incident, empty body, key
assert.deepEqual(journey.snapshot().operations.sos, originalSosSlot);
// 'resolution needs an active same-trip incident; late responses lose authority' (RF1)
assert.equal(blockedResolveCalls, 0); // no session, missing/resolved/foreign incident
assert.equal(afterAccountChange.incident.data, null);
assert.equal(arrivalWithOpenIncident.incident.data.status, 'active');
```

Also assert wrong response ID stays unknown, no invented `resolvedAt`, simultaneous resolution coalesces, later incidents get new keys, and SOS still dispatches in moving/unknown interaction mode while resolution uses the ordinary explicit-interaction gate.

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/driver/journey.test.mjs web/tests/phone/driver-transport.test.mjs`. Expected new cases fail: unsupported status transport / absent resolution method.
- [ ] **Step 3: Implement the interfaces.** Add a dedicated sixth write slot, resolution correlation and invalidation; retain **four read slots**, SOS reconciliation and unknown-intent rules. A resolution acknowledgement invalidates incident/status; a fresh read establishes current resolution/time. Update the documented five-write bound deliberately.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; then `n24 node web/node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM web/tests/driver/contracts.types.ts`. Expected all pass, including existing SOS regressions.
- [ ] **Step 5: Commit.** Stage only this task's listed files. Run `git commit -m "feat(driver): Bind status and owner incident resolution"`; record the independent review before starting another task.

### Task 2: Compose observation capture, queue and lifecycle without a session-world dependency

**Files:**
- Create: `web/src/features/driver/observations.ts`, `web/src/lib/observations/phone-adapter.d.ts`
- Modify: `web/vite.config.ts`, `web/src/lib/observations/upload.mjs`
- Create/Test: `web/tests/phone/observations.test.mjs`
- Test: `web/tests/observations/upload.test.mjs`, `pipeline.test.mjs`

**Interfaces:**
- Consumes: existing `createQueuedTripPhoneObservations({pipeline,trip:{tripId,revision},reviewedContext,locationConsent,...options})`; `openObservationStores`, `openObservationQueue`, `createLocationUploader`, `createObservationPipeline`; `ApiClient.setSharing`.
- Produces: `createTripObservationHost({tripId,revision,session,api,baseUrl,reviewedContext})` → `{startSharing(event):Promise<void>, stopSharing():Promise<void>, getSnapshot(), subscribe(listener), dispose():Promise<void>}`. Snapshot is token/phone-free: acquisition state, storage/wake-lock availability and server-sharing receipt/unknown. The existing reviewedContext shape is preserved, not replaced with an enable flag.

- [ ] **Step 1: Write failing tests.** Use only detached adapter `synthetic-test` platform/clock for positive acquisition:

```js
// 'capture requires actual context and trip-bound consent'
assert.equal(withoutPacket.reason, 'unqualified'); assert.equal(nativeGpsCalls, 0);
assert.equal(withoutConsent.reason, 'trip-location-consent-required');
assert.equal(queued.scope.userId, driverSession.snapshot().subject); // JWT sub, not /me UUID
assert.deepEqual(uploaded.observations[0], capturedSample); // source timestamp/accuracy intact
// 'hidden/denied/storage failure remains unavailable and logout retires upload' (RF3)
assert.deepEqual(sharingBody, {state:'stopped',reason:'page_hidden'});
assert.equal(storageUnavailable.gpsCalls, 0);
assert.equal(postLogoutDispatches, 0); assert.equal(lateCallbackApplied, false);
```

Cover permission denial → `permission_denied`, explicit stop → `user`, acquisition failure → `error`, wake-lock refusal as a nonfatal limitation, unknown sharing write without automatic replay, same-owner queue wipe on logout, and remote HTTP/credential-bearing upload URLs rejected.

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/phone/observations.test.mjs web/tests/observations/upload.test.mjs`. Expected missing host/alias and loopback upload-origin tests fail.
- [ ] **Step 3: Implement.** Alias `@phone-observations` to `../src/phone-observations`; import the real adapter. Bind uploader token acquisition to a current MemorySession lease and pipeline `ownerSubject` to its subject. Permit credential-free loopback HTTP for local tests, HTTPS elsewhere; never use a fake HTTPS origin or weaken owner matching. On hidden/stop/denial, stop capture immediately and send the existing sharing operation under one captured key; distinguish no-send/unknown/receipt. Dispose capture/uploader before awaits; account retirement clears its queue.

The source gate is binding: `adapter.mjs` `allowed()/gate()` requires `schema=andes.phone-observations.qualification/1`, `kind=physical-device-review`, `disposition=qualified`, actual `evidenceRef`, matching `key/contextKey`, matching `budgetRevision` (default `engineering-only/5`) and `streams.geolocation=true`. No actual packet currently exists; the host shows unavailable and passes null through. Controller/Plan C must supply actual reviewed evidence for physical acquisition. Do not fabricate a packet, bypass the guard or treat this as completed device qualification.

- [ ] **Step 4: Run GREEN.** `n24 node --test web/tests/phone/observations.test.mjs web/tests/observations/*.test.mjs`; `n24 npm --prefix web run build`. Expected all pass; positive capture evidence remains synthetic.
- [ ] **Step 5: Commit.** Stage only this task's listed files; `git commit -m "feat(driver): Wire trip observation lifecycle to the durable queue"`.

### Task 3: Mount a real production runtime and the approved Tándem foundation

**Depends on:** A Task 6's actual session type/decoder/fixture commit, and B Task 6's standalone component. Tasks 1–2 and Task 6 can run before A's handoff.

**Files:**
- Create: `web/src/app/runtime.ts`, `web/src/app/production.tsx`
- Modify: `web/src/main.tsx`, `web/src/foundation/app.tsx`, `web/src/styles/tokens.css`, `web/src/styles/foundation.css`
- Copy: `docs/design/assets/tandem-logo-ink.svg` → `web/public/brand/tandem-logo-ink.svg`; `docs/design/assets/fonts/{Manrope.woff2,OFL.txt}` → `web/public/brand/fonts/{Manrope.woff2,OFL.txt}`
- Create/Test: `web/tests/phone/runtime.test.mjs`, `foundation.test.mjs`

**Interfaces:**
- Consumes: A's `DemoWorld`; existing `createDemoWorld(api)`, `createDemoSessionGateway({api,session,persona:'driver',world})`, `bindJourneySession`, `createContactRoutes(host)`.
- Produces: `createPhoneDemoRuntime({origin})` → `PhoneDemoRuntime {api:ApiClient, session:MemorySession, gateway:SessionGateway, getWorld():Promise<DemoWorld>, restart():Promise<void>, dispose():Promise<void>}`; `createProductionOptions(runtime):FoundationOptions`. Task 7 extends credential acquisition for contact documents, retaining this interface.

- [ ] **Step 1: Write failing tests.**

```js
// 'production mount supplies real options and begins only on Empezar'
assert.equal(sessionRequestsBeforeStart, 0);
assert.equal(doubleStartSessionRequests, 1); assert.equal(meVerifiedBeforeProtectedView, true);
assert.deepEqual(world.tripCountries, ['PE']); assert.equal('truckId' in world.driver, false);
assert.equal('grantId' in world.family, false);
// 'explicit reset retires old work and expired worlds never repopulate' (RF1)
assert.equal(oldActorVisibleAfterReset, false); assert.equal(lateOldCatalogApplied, false);
assert.equal(storageCredentialWrites, 0); assert.equal(contactPathSessionMintCalls, 0);
// 'approved system replaces legacy ANDES placeholders'
assert.equal(computed.surface, '#FFFFFF'); assert.equal(computed.onAction, '#FFFFFF');
assert.equal(visibleBrand, 'Tándem'); assert.equal(minimumPrimaryHeight >= 64, true);
```

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/phone/runtime.test.mjs web/tests/phone/foundation.test.mjs`. Expected absent runtime/options and legacy brand/token assertions fail.
- [ ] **Step 3: Implement.** Mount `<FoundationRoot {...createProductionOptions(runtime)} />` in `main.tsx`; preserve the compile-time test-hook guard. One world source per driver document; no auto-mint on mount, route navigation or contact URL. `restart()` disposes protected controllers/observers, ends/drops the old world and explicitly begins another. Default Spanish; pt-BR through the existing provider. Mount existing contact/privacy routes now, extend driver registry in Tasks 4–5 and invitation acquisition in Task 7. Mount Task 6's `TourEntry` within Foundation's `criticalActions` region; Tasks 4,5,8 supply its DOM targets. Reuse foundation components; map legacy CSS variables to the canonical tokens, add bundled font/wordmark and correct target sizes/safe-area padding without another shell/router.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; `n24 npm --prefix web test`. Inspect production build: no callable `__ANDES_TEST_MOUNT__`; expected tests and build pass.
- [ ] **Step 5: Commit.** Stage only this task's listed files; `git commit -m "feat(web): Mount the production demo runtime with Tandem foundation"`.

### Task 4: Build welcome, truck, invitation-wait and reviewed-trip preparation screens

**Files:**
- Create: `web/src/features/driver/view-store.ts`, `prepare.tsx`, `routes.tsx`, `messages.ts`, `ui.css`; `web/src/features/contacts/demo-management.tsx`
- Modify: `web/src/app/production.tsx`
- Create/Test: `web/tests/phone/prepare.test.mjs`

**Interfaces:**
- Consumes: `PhoneDemoRuntime`; Task 1's `DriverJourney`; existing `getBootstrap/listTrucks/listContacts/listTrips`, `createTruck`, `inviteContact`, `createDraft`, `confirmTrip`.
- Produces: `createDriverView(runtime)` → stable `getSnapshot()`, `subscribe(listener)`, `start()`, `stop()`, `reloadCatalogs():Promise<void>`, `journey:DriverJourney`; `createDriverRoutes(runtime,view):FeatureRoutes`; `DemoManagement({runtime,onAccepted})`.

- [ ] **Step 1: Write failing tests.**

```js
// 'prepare follows backend evidence, never the old seeded session'
assert.deepEqual(nextPaths, ['/trucks','/contacts','/trips/new']);
assert.deepEqual(inviteBody, {contactId:world.family.id,phone:inputPhone,map:true,incident:true,role:'family'});
assert.equal(phoneInputAfterDispatch, ''); assert.equal(displayNameInRequest, false);
assert.equal(waitText, 'Esperando que tu contacto acepte…');
assert.equal(confirmCallsWhilePending, 0); assert.equal(contactPollInterval, 5000);
assert.deepEqual(confirmBody.contactGrantIds.sort(), [acceptedFamilyGrant,world.colleague.grantId].sort());
// 'revoked between review and confirm stays inactive' (RF2)
assert.equal(confirmFailure.code, 'contact_not_accepted'); assert.equal(activation, null);
assert.equal(contactsRecoveryVisible, true);
```

Assert description, truckId, origin, destination, future explicit-offset arrival, selected `tripCountries` country, canonical locale and device timeZone reach draft and confirm unchanged; empty countries/missing fields/past arrival block sending. Empty/denied/truncated catalogs remain distinct. `409 contact_already_invited` offers «Empezar de nuevo», not another invitation to the same family identity.

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/phone/prepare.test.mjs`. Expected absent driver route screens/store.
- [ ] **Step 3: Implement.** Build real home `/`, `/trucks`, demo `/contacts` and `/trips/new`. Resume from authenticated owner catalogs: active trip first, otherwise missing truck, then unaccepted family, then preparation. Require explicit stationary/assisted interaction before ordinary forms; do not infer it from GPS. Normalize only authenticated catalog facts into `provideSelectionEvidence`; never mark pending accepted. Poll contacts with one in-flight read, stop on unmount/session change. Keep names in memory; capture phone only for one invitation request, clear on completion, recover unknown via catalog read. Share the exact family link from trusted runtime without rendering tokens as status text. Review the returned draft before explicit confirmation; backend rejection remains authoritative.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; `n24 npm --prefix web test`. Expected all preparation/order/privacy assertions and existing catalog tests pass in es and pt-BR.
- [ ] **Step 5: Commit.** Stage only this task's listed files; `git commit -m "feat(driver): Build consent-first trip preparation screens"`.

### Task 5: Build active trip, check-in, alerts and summary screens

**Depends on:** Tasks 1–4 and A's boolean `automaticEscalation` decoder correction.

**Files:**
- Create: `web/src/features/driver/active.tsx`
- Modify: `web/src/features/driver/view-store.ts`, `routes.tsx`, `messages.ts`, `ui.css`; `web/src/app/production.tsx`
- Create/Test: `web/tests/phone/active.test.mjs`

**Interfaces:**
- Consumes: Task 4's view; Task 2's observation host; Task 1's `refreshStatus/resolveIncident/requestHelp`.
- Produces: `ActiveTrip`, `CheckIn`, `Alerts`, `Summary` route components; `createDriverRoutes` now covers all driver RouteIds. Protected SOS is supplied through Foundation's existing `criticalActions` boundary, including check/alerts/recovery routes.

- [ ] **Step 1: Write failing tests.**

```js
// 'active status drives checks and facts'
assert.equal(statusTimerMs, 5000); assert.equal(concurrentStatusReads, 1);
assert.equal(checkRoute, '/trips/'+tripId+'/check-in'); assert.equal(deadline, status.check.askUntil);
assert.equal(sentOkCommand, 'checkin_ok'); assert.deepEqual(pauseCommands, ['pause','resume']);
// 'SOS bypasses ordinary gating; arrival does not resolve'
assert.equal(sosCallsFromMovingState, 1); assert.equal(sosConfirmationDialogs, 0);
assert.equal(safeButtonVisible, status.incident?.status === 'active');
assert.equal(resolveOperation, 'resolveIncident'); assert.equal(arrivalResolveCalls, 0);
assert.equal(incidentAfterArrival.status, 'active'); assert.equal(gpsAfterArrival, 'stopped');
// 'server and local acquisition facts never imply fresh delivery' (RF3)
assert.equal(visibleCapturedAt, status.location.capturedAt);
assert.equal(acceptedLabelMeansDelivered, false); assert.equal(localPendingMeansSent, false);
```

Also test error/unknown/rejected writes, denied/missing/stale status, optional wake lock, missing reviewed packet, countdown expiry issuing no write, no phone values, and 80px critical targets at 320px width / 200% text in both locales.

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/phone/active.test.mjs`. Expected missing active/check/alerts/summary screens.
- [ ] **Step 3: Implement.** Poll status while authenticated; stop timers/abort and ignore late reads on retirement. Use backend freshness/capture time, separately show local capture/permission limits. «Compartir ubicación» is an explicit consent/permission gesture; no matching packet displays unavailable. Pause suspends checks but leaves SOS available. «Ya estoy a salvo» resolves the current incident then refreshes incident/status; do not invent resolution time. «Llegué» sends `arrived`, stops capture/queue for that trip and navigates summary; retain an open incident and accessible owner resolution. Alerts show role/channel and actual pending/accepted/delivered/unknown/unavailable facts, including colleague `destination_not_allowed`; contact acknowledgement is separate.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; `n24 npm --prefix web test`. Expected boolean `automaticEscalation:true` commands decode, all safety regressions pass and production registry has no placeholder for a driver RouteId.
- [ ] **Step 5: Commit.** Stage only this task's listed files; `git commit -m "feat(driver): Build active trip controls and truthful alert views"`.

### Task 6: Add the accessible read-only spotlight

**Files:**
- Create: `web/src/features/tour/controller.ts`, `spotlight.tsx`, `steps.ts`, `messages.ts`, `ui.css`
- Create: `web/tests/fixtures/phone-tour.html`, `web/tests/fixtures/phone-tour.tsx`
- Create/Test: `web/tests/phone/tour.test.mjs`, `tour.browser.mjs`

**Interfaces:**
- Produces: `createTourController({storage,kind:'driver'|'contact'})` → `getSnapshot/subscribe/start/next/back/skip/dispose`; `Spotlight({controller,steps})`; `TourEntry({kind:'driver'|'contact'})` owns controller lifecycle, translations and replay; `TourStep {id:string,target:string,title:string,body:string}`. No API, command or navigation-write callback.
- Consumes: DOM `data-tour` targets; Foundation i18n and critical SOS region. Integration uses the existing router; standalone fixture tests do not need A's world.

- [ ] **Step 1: Write failing tests.**

```js
// 'tour is ordered and has no write authority'
assert.deepEqual(driverStepIds, ['welcome','truck','contact','trip','location','ok','pause','sos','check','alerts','arrival']);
assert.equal(apiWriteCalls, 0); assert.equal(storageKey, 'tandem.phone-tour.v1.driver');
// 'storage refusal, absent target and enlarged text leave SOS reachable' (RF5)
assert.equal(startWithThrowingStorage.open, true); assert.equal(missingTargetNavigationWorks, true);
assert.equal(elementAtSosCenter.closest('[data-action="sos"]') !== null, true);
assert.equal(reducedMotionAnimationCount, 0); assert.equal(focusReturnedAfterSkip, true);
```

Browser assertions cover Tab/Shift-Tab/Enter/Escape, visible focus, next/back/skip/replay and 320px/200% pt-BR layout. Contact steps explain visible facts, uncertainty and calling the driver/emergency number without promising rescue.

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/phone/tour.test.mjs`. Expected missing tour modules.
- [ ] **Step 3: Implement.** Use the target rectangle and box-shadow dimming; every dimmer layer is pointer-transparent over SOS and the tooltip avoids its rectangle. Do not use a modal/inert region that removes SOS from keyboard access. Recompute on resize/scroll; absent target gets a nonblocking explanatory card. Guard storage reads/writes; remember only completion, never credentials. Tour follows the route's available targets and never activates actions or changes routes automatically. Add «¿Cómo funciona?» replay; contact and driver have separate completion keys.
- [ ] **Step 4: Run GREEN.** Repeat Step 2. `n24 node web/tests/phone/tour.browser.mjs` starts/stops its own loopback Vite fixture at `/tests/fixtures/phone-tour.html` and existing CDP helper; expected keyboard, geometry, zero-write and reduced-motion assertions pass. Then `n24 npm --prefix web test`. Task 3 owns production mounting; Tasks 4,5,8 own target attributes, so this standalone deliverable does not import missing driver screens.
- [ ] **Step 5: Commit.** Stage only this task's listed files; `git commit -m "feat(web): Add a read-only accessible phone-demo spotlight"`.

### Task 7: Consume the contact fragment and implement authenticated OTP/acceptance

**Files:**
- Create: `web/src/lib/api/demo-phone.ts`, `web/src/features/contacts/invitation.tsx`
- Modify: `web/src/lib/api/client.ts`, `demo.ts`, `index.ts`; `web/src/app/runtime.ts`, `production.tsx`; `web/src/features/contacts/messages.ts`; `web/index.html`
- Create/Test: `web/tests/phone/otp.test.mjs`, `invitation.test.mjs`

**Interfaces:**
- Produces: ApiClient `startDemoPhone({phone}, RequestOptions?):Promise<{expiresAt:string}>`, `verifyDemoPhone({phone,code}, RequestOptions?):Promise<{verified:true}>`; decoders/types live in `demo-phone.ts`, not A's files.
- Produces: `createInvitationSession({api,session,location,history}):SessionGateway` in `demo.ts`, reusing `createSessionGateway`; `Invitation({runtime,grantId})` replaces the disabled demo invitation route.
- Consumes: exact §4 HTTP contract and existing `acceptContact(grantId,{map:true,incident:true},{idempotencyKey})`. No alternate world DTO.

- [ ] **Step 1: Write failing tests.**

```js
// 'OTP has bearer auth, keyless writes and exact success statuses'
assert.equal(start.status, 202); assert.deepEqual(start.decoded, {expiresAt});
assert.deepEqual(verify.decoded, {verified:true});
assert.equal(otpAuthorization, familyAuthorization); assert.equal(otpIdempotencyHeader, undefined);
assert.equal(otherWritesStillRequireKey, true); assert.equal(anonymousOtpDispatches, 0);
// 'fragment is erased before verification; malformed/foreign/expired input fails closed' (RF4)
assert.equal(hashAtFirstAsyncCall, ''); assert.equal(replaceStateCalls, 1);
assert.equal(credentialStorageCalls, 0); assert.equal(driverWorldMintCalls, 0);
assert.equal(authenticatedBeforeMe, false); assert.equal(wrongWorldAcceptAllowed, false);
// 'expiry during verify cannot accept or repopulate protected state' (RF1)
assert.equal(lateVerifyAcceptCalls, 0); assert.equal(phoneFieldAfterStart, '');
```

Table-test every status/code in Contract and `400 invalid_request`, malformed 202/200 JSON, network ambiguity, SMS-disabled and resend after expiry. Codes map to fixed localized copy, never raw response text or phone echoes. Acceptance stays disabled until actual successful verification; unknown acceptance retains its key and reconciles rather than silently succeeding.

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/phone/otp.test.mjs web/tests/phone/invitation.test.mjs`. Expected missing authenticated OTP operations and fragment gateway.
- [ ] **Step 3: Implement.** Extend the existing request helper with operation-specific success status and authenticated keyless mutation support; only `createDemoSession` stays actorless. Preserve session leases, timeout/error redaction and all ordinary idempotency requirements. Parse and erase `#t` synchronously, validate bounded demo family JWT metadata/expiry as acquisition data only, then let backend `/me` establish identity. Cap local lifetime at token expiry and 7200s, never persist. Contact reload without credential offers reopening the original link, not a new world. Add `no-referrer` document policy. Keep phone only in the pending OTP closure between start/verify, clear inputs on dispatch and clear the closure on completion, expiry or teardown. Explicitly verify, then explicitly accept; backend still checks recipient/number/world.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; `n24 npm --prefix web test`; `n24 node web/node_modules/typescript/bin/tsc -p web/tests/api/tsconfig.json`. Expected exact statuses, failures, privacy and existing session/client tests pass.
- [ ] **Step 5: Commit.** Stage only this task's listed files; `git commit -m "feat(contacts): Verify and accept demo invitations from memory-only links"`.

### Task 8: Discover contact trips and maintain authenticated status presence

**Files:**
- Create: `web/src/lib/api/recipient.ts`, `web/src/features/contacts/presence.ts`
- Modify: `web/src/lib/api/client.ts`, `index.ts`; `web/src/features/contacts/invitation.tsx`, `routes.tsx`, `view-store.ts`, `messages.ts`; `web/src/app/production.tsx`
- Create/Test: `web/tests/phone/recipient.test.mjs`, `presence.test.mjs`

**Interfaces:**
- Produces: `ApiClient.listContactInvitations(RequestOptions?)` → `{invitations,readAt,limit:100,hasMore}`; `listContactTrips(RequestOptions?)` → `{trips,readAt,limit:100,hasMore}`, decoded/types in `recipient.ts`.
- Invitation rows exactly: `{id,driverId,requested:{map,incident},accepted:{map,incident},status,acceptedAt,revokedAt}`. Trip rows exactly: `{tripId,grantId,driverId,status,scopes:{map,incident},activeIncidentId}`. IDs UUID, dates ISO/null, source enums unchanged; discard extras/phones, reject >100 rows/duplicate references.
- Produces: `startContactPresence({api,tripId,onStatus,onUnavailable,document,navigator}):()=>void`; existing `createContactView` consumes fresh status to discover/read incident and refresh permitted location, retaining separate denial scopes.

- [ ] **Step 1: Write failing tests.**

```js
// 'accepted contact waits for attached trip, then polls authenticated status'
assert.equal(tripListUrl, '/v1/contact/trips'); assert.equal(emptyMeansError, false);
assert.equal(statusUrl, '/v1/trips/'+tripId+'/status'); assert.equal(intervalMs, 5000);
assert.equal(maxInFlight, 1); assert.equal(statusAuthorization, familyAuthorization);
assert.equal(wakeLockRequested, 'screen'); assert.equal(remainingTimersAfterStop, 0);
assert.equal(lateStatusAfterLogoutVisible, false); assert.equal(writesFromPolling, 0);
// 'revocation and map denial never widen authority or hide a separate incident'
assert.equal(revokedProtectedFactsVisible, false); assert.equal(map403HidesIncident, false);
assert.equal(arrivedWithActiveIncidentStillReachable, true);
```

- [ ] **Step 2: Run RED.** `n24 node --test web/tests/phone/recipient.test.mjs web/tests/phone/presence.test.mjs`. Expected missing discovery bindings/presence pump.
- [ ] **Step 3: Implement.** After acceptance, poll the existing contact-trip catalog every 5000ms until a real attached trip appears; open its contact route using returned references. Read invitation metadata only from its authenticated inbox; absent/truncated/revoked differs from permission. On contact trip, poll status every 5000ms immediately and while visible/authenticated, request optional screen wake lock, reacquire on visible and release on exit. Refresh incident and permitted location through existing ContactView/journey; use grant reference for revoke only. Denied/revoked/account-changed reads conceal protected facts and cancel timers; no polling write or cached authorization. Show that missing status is uncertainty and that a locked/suspended page cannot maintain presence.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; `n24 npm --prefix web test`. Expected both contact discovery and existing scope/revoke/contact-view regressions pass.
- [ ] **Step 5: Commit.** Stage only this task's listed files; `git commit -m "feat(contacts): Discover shared trips and maintain demo presence"`.

### Task 9: Run driver → alert → contact against the real backend in CI

**Depends on:** Tasks 1–8; A serving, Task 6, OTP Tasks 8–9, dispatch Task 10 and command decoder; A's root-CI handoff. This is required by #97, not an optional follow-up.

**Files:**
- Create: `web/tests/phone/backend.integration.mjs`, `backend-fixture.mjs`
- Modify: `web/package.json`, `web/README.md`
- Conditional modify after A confirms no concurrent workflow edit: `.github/workflows/ci.yml` app-integration job, only the `test:phone` dependency/setup/command hook; A reviews the hunk

**Interfaces:**
- Produces: `npm --prefix web run test:phone` builds current root/backend and production web then runs `node --test tests/phone/backend.integration.mjs`; command exits nonzero on any failure or missing dependency, never silently skips.
- `backend-fixture.mjs` exports `withPhoneBackend(testContext, run):Promise<void>`, using existing `disposableDatabase/testEnvironment` from `scripts/app-integration/runtime.mjs`, `createContext/migrate`, and A's `createApp({ctx,auth:demo.auth,demo,demoPhone,webRoot,automaticChecks:true,channelSupport})`. Serve actual `web/dist` on `127.0.0.1:0`; two separate CDP browser instances use the real production mount, not `__ANDES_TEST_MOUNT__`.

- [ ] **Step 1: Write failing integration tests.**

```js
// 'production driver → OTP contact → trip → alert → contact response'
assert.deepEqual(visitedDriverRoutes, ['/', '/trucks', '/contacts', '/trips/new', '/trips/'+tripId]);
assert.equal(backendTripCountBeforeAcceptance, 0);
assert.equal(backendGrantStatusAfterContactAccept, 'accepted');
assert.deepEqual(persistedTripGrantIds.sort(), [familyGrantId,colleagueGrantId].sort());
assert.equal(contactDiscoveredTripId, tripId); assert.equal(contactStatusPollObserved, true);
assert.equal(contactIncidentAfterSos.id, driverIncident.id);
assert.equal(familyAcceptedChannels.sort().join(','), 'sms,voice,whatsapp');
assert.equal(colleagueUnavailableReason, 'destination_not_allowed');
assert.equal(contactAcknowledgementResolvesIncident, false);
assert.equal(ownerResolvedIncident.status, 'resolved'); assert.equal(arrivedTrip.map_active, false);
// negative controls (RF2/RF4), real signed backend
assert.equal(revokedGrantConfirmation.status, 409);
assert.equal(foreignFamilyInvitationAcceptance.status, 403);
assert.equal(browserRuntimeErrors.length, 0); assert.equal(externalProviderFetches, 0);
```

Also cover an open check/missed-check incident upgraded by SOS (same incident ID), owner arrival leaving an active incident until explicit resolution, and OTP disabled/rejected path with no acceptance. Use a mutable test clock and actual `checkOnce` with authenticated contact requests to maintain demo presence, not real-time waits or UI-fabricated checks.

- [ ] **Step 2: Run RED.** `n24 npm --prefix web run test:phone`. Initially FAIL: missing script/screens/runner; after runner creation, the added regression must fail on the prior implementation. Preserve the named assertion and baseline SHA.
- [ ] **Step 3: Implement the bounded test seam and CI handoff.** Generate the demo issuer and pass a fictional-number OTP sender plus fixed code **only through in-process `demoPhone:{...limits,send,code}`**. Use A's actual `claimJob/authorizeJob(...,demoPolicy)/finishAttempt` with a fake provider to process persisted jobs, no SQS/AWS or live worker. Test limits are synthetic explicit options, not proposed live caps. Use two independent browser profiles; enter the shared link through the actual contact UI and never log it. Assert driver and contact delivery/status views separately; report provider acceptance as fake, not device delivery. Cleanup browser, app/context and owned DB in finally.

After A confirms no concurrent workflow edit, add this exact CI sequence in the existing Node24 app-integration job after root `npm ci` and PostgreSQL-bin discovery: `npm --prefix web ci`, then `npm --prefix web run test:phone`. Ship the runner and CI hook together on this same integration PR head and have A review the narrow workflow hunk. Ensure headless Chrome is present via `ANDES_CHROME_BINARY` (existing CDP helper), choose an isolated PostgreSQL port and `LC_ALL=C` on macOS. Archive redacted TAP/results for the exact tested SHA. Demonstrate a failing assertion makes that CI job fail; a script existing without a running CI step or a different-head CI run does not satisfy #97.

- [ ] **Step 4: Run GREEN.** `n24 npm --prefix web run test:phone`, `n24 npm --prefix web test`, and the existing isolated backend harness. Expected zero failures/skips, no external fetches, successful owned-resource cleanup. Verify the actual named CI job ran `test:phone` on the proposed head; keep HOLD if the CI handoff is missing. No physical GPS/channel delivery qualification is claimed.
- [ ] **Step 5: Commit.** Stage the four B-owned files plus the narrow authorized CI hunk after A's no-concurrent-edit confirmation; `git commit -m "test(web): Exercise the production phone journey against the real backend"`. Record A's confirmation/review and the matching same-head CI run.

---

## Self-review and spec coverage

- [x] **Spec coverage:** §2 production startup/real routes → Tasks 3–5; driver order and all draft fields → Task 4; active controls/check/status/resolve/arrival → Tasks 1,5; #52→#66 GPS/owner subject/lifecycle → Task 2; guided driver/contact steps → Task 6. §3 demo invitation/wait/reset → Task 4; fragment/OTP/acceptance → Task 7; discovery/status presence/wake lock → Task 8. §4 exact session consumer → Task 3, OTP contract → Task 7, real fail-closed outcomes → Task 9; A owns server policy/session decoder. §7 web assertions → Tasks 1–8, CI actual-backend journey → Task 9. §9 groups/dependencies are explicit above.
- [x] **Step scan:** each task has exact files, an Interfaces block, named RED assertions, commands, implementation decisions, GREEN and a scoped future commit. No implementation bodies or speculative backend scope.
- [x] **Type consistency:** use A's DemoWorld only; actor UUID binds controllers through verified `/me`, JWT subject scopes observation queue; dedicated `resolve` slot never borrows `sos`; `readStatus` binds existing shared decoder; contact list envelopes match actual `recipient.ts`.
- [x] **Review Focus:** RF1 → Tasks 1–3,7; RF2 → Tasks 4,9; RF3 → Tasks 2,5; RF4 → Tasks 7,9; RF5 → Task 6. Each has explicit negative assertions.
- [x] **Proportion/scope:** nine independently reviewed gates, no duplicated session architecture, shared-package migration, provider activation, operations or optional #69/#70/#72 visuals. Reuse existing Tándem components; correct existing legacy tokens/brand rather than introducing a new design.

**External evidence/dependencies remain explicit:** actual A commits, A's command-decoder/CI handoffs, PR96 freeze/merge and Robert dispositions; a genuine matching physical-device packet for real adapter acquisition; Plan C's authorized two-phone/live-channel evidence. Software tests can pass without claiming these external gates passed. No other spec requirement in B's scope is left without an owning task.
