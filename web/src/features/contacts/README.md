# Trusted-contact and privacy journeys

The headless controller and owned React route components use Robert's backend at
`ebc8fb1d36f441ef012ca585201cefabf61383d6`, specifically
`docs/contracts/runtime.md`, `src/contacts/routes.ts`, `src/location/routes.ts`
and `src/incidents/routes.ts`. Rendering consumes lane49's frozen shared foundation;
lane45 owns authenticated HTTP/session transport. This branch authors only contact/
privacy modules and their tests. No shared package/router, transport, token storage,
notification sender or optional research/data-pool implementation is copied here.
The small `ContactApi` interface remains the headless injection seam.

## UI host handoff

Use foundation PR56 `3283fe675ebeee04bb2be8a62f42ab5c475b4b0e` and API PR59
`db7034fc9e1dba035b87368117376e9730d6b830`. Import `createContactRoutes` from
`web/src/features/contacts/routes.tsx` and pass `{api, session, gateway}` from one
shared API/session host. Supply the returned `contacts`, `invitation`, `contactTrip`
and `privacy` components to `FoundationRoot.routes`; merge them with other owners'
components there. The feature adds no router, shell, language provider or package.
Its ES/PT-BR dictionary and CSS consume49's actual hooks, controls and tokens.

The gateway must verify `/v1/me`, then every mounted feature separately activates
45's identity binding before reading or writing. Session changes synchronously
retire caches/receipts and pending catalog responses. Route teardown disposes the
binding; actor/trip replacement also destroys the response draft. A contact trip
reference selects `{id,driverId:null}` through `selectContactTrip`, which is valid
only in the contact view. It fabricates neither an owner identity nor permission;
the existing protected snapshot GET still decides access, and driver resolution
checks are unchanged.

Optional `incidentReference(tripId)` and `grantReference(tripId)` callbacks return
only already-known UUID hints from the host. They are not discovery APIs or evidence
of consent. An incident reference is re-read and checked against the selected trip
before any response control becomes usable. A grant reference can request only a
server-authorized trip revoke. There is no default UUID, source fact or fabricated
lookup. The trip page finds the incident through `GET /v1/trips/:id/status` (see
below); an incident reference is only a fallback when status shows none. Without a
grant reference, trip revocation shows its actual limit.
Incoming invitation metadata still has no published read contract, so its page
cannot accept or display invented requested scopes; the known route grant ID can
request participant-authorized withdrawal. Existing headless acceptance/narrowing
remains tested for use once an actual retrieval contract is available.

Management uses PR65's actual owner `listContacts` contract, keeping historical
accepted scopes, revoked state and truncation visible. It supports explicit invitation
inputs and inline standing revocation. Privacy reuses that catalog and distinguishes
driver management from unavailable recipient consent management. Contact response
keeps source/capture/receipt/read times, the server's open check/deadline and alert-wave facts,
acknowledgement, reported action and driver-only resolution separate. Revocation
conceals before sending. Lost replies and refused same-key retries remain unknown;
only the explicit unchanged-key retry is offered. Route disposal clears local
operation/receipt state and its retry closure; it does not reconcile or cancel the
server outcome. The UI says leaving does not cancel the request and claims no
cross-route or persisted operation history. No optional visual is required.

### Reproduce the UI

The typed client (#59, #81) and the foundation are on main, so no composition step
is needed.

```sh
cd web
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node node_modules/typescript/bin/tsc -p tests/contacts/ui-tsconfig.json
node --test tests/contacts/view.integration.mjs
npm run dev
```

Open the printed loopback URL at `/tests/contacts/fixture.html?screen=trip`;
`screen=contacts|privacy|invitation` and `locale=pt-BR` select other fixtures.
These development-only pages instantiate the actual shared foundation/API/controller
with explicitly synthetic memory-only HTTP/token fixtures. They do not mount new
backend routes or prove browser OIDC, persisted UI data or production entry wiring.
The normal production entry still requires integrator44 to supply this registry
and trusted host; its hard reload is not claimed as a completed feature integration.

`node tests/contacts/browser-check.mjs <loopback-origin> <evidence-dir>` uses an
installed Chrome and the existing dependency-free Codus browser helper (override
`CODUS_BROWSER_HELPER` if needed). It closes only its own temporary profile.
Forty route/locale/viewport cases cover 390/1440/1920/360/430px, plus 13 focused
keyboard, validation, duplicate-submit, receipt, session, permission/error/empty,
truncation, unknown-revoke, missing-reference, reduced-motion and narrow-response
checks. Viewport and full-page captures need human inspection and independent52
acceptance. Source composition receipts distinguish working-tree builder evidence
from a frozen revision. `ANDES_CONTACT_CONTROLS_ONLY=1` reruns just the focused cases.

Run the standalone tests using the backend's supported Node24–26 runtime:

```sh
node --test web/tests/contacts/*.test.mjs web/tests/privacy/*.test.mjs
```

Node24's native TypeScript support runs these modules without installing packages.
Type-check with TypeScript5.9.3 when available:

```sh
tsc --noEmit --strict --skipLibCheck --target ES2023 --lib ES2023,DOM \
  --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions \
  web/src/features/contacts/journey.ts web/src/features/privacy/consent.ts \
  web/tests/contacts/location-age.types.ts
```

## Actual API mapping for lane45

Every write receives `{signal,idempotencyKey}`; the adapter must send the key as
`Idempotency-Key`. Revoke, acknowledgement and resolution have an empty JSON body.
Every read receives `{signal}`. Adapter failures expose numeric `status` (or
`statusCode`); raw HTTP response/error strings are never copied into journey state.
No operation silently obtains another user's credentials from a role selection.

| Interface method | Backend route and body |
| --- | --- |
| `inviteContact(body, options)` | `POST /v1/contacts`, `{contactId,phone,map,incident}` |
| `acceptContact(id, body, options)` | `POST /v1/contacts/:id/accept`, `{map,incident}` |
| `revokeContact(id, options)` | `POST /v1/contacts/:id/revoke`, `{}` |
| `revokeTripContact(tripId, grantId, options)` | `POST /v1/trips/:id/contacts/:grantId/revoke`, `{}` |
| `getTripSnapshot(tripId, options)` | `GET /v1/trips/:id/snapshot` |
| `getIncident(id, options)` | `GET /v1/incidents/:id` |
| `acknowledgeIncident(id, options)` | `POST /v1/incidents/:id/acknowledgements`, `{}` |
| `reportIncidentAction(id, body, options)` | `POST /v1/incidents/:id/actions`, `{action}` |
| `resolveIncident(id, options)` | `POST /v1/incidents/:id/resolve`, `{}` |

### Published adapter handoff

Lane45's PR59 at `7da6dbbd629eb996a0493f750d20e1845fa8f907` exports
`createContactApi` and `bindJourneySession` from `web/src/lib/api/index.ts`.
The facade maps `getTripSnapshot` to `getSnapshot`, and
`reportIncidentAction(id,{action},options)` to `reportAction(id,action,options)`;
the other methods forward their arguments. It introduces no retries or authority.

The host creates the journey with that facade and binds it to the shared
`MemorySession`. The binding's callback must synchronously call `setSession(null)`
when cleared, or set the verified `/v1/me` actor UUID with the host's fixed local
view. `activate()` verifies the actor before setting it. Dispose the binding on
unmount or view replacement; every controller using the session needs its own
binding. A real client401 clears the shared session and can supersede an outstanding
journey result. Superseded never means the server mutation was cancelled.

Lane45 publicly confirmed the retry repair at the earlier feature logic/test freeze
`b95bdbaa3f106f33d30b3aa8b0127ca3b691ee0e` in
[its scoped PR62 confirmation](https://github.com/Bimbi-Dev/andes-hackathon/pull/62#issuecomment-6243021647).
It reports 14 controller/client checks, including retry400/403/404/409/422 unknown
retention, a first-attempt409 rejection control, shared-session401 invalidation and
strict structural types. HTTP/token fixtures are synthetic; those checks do not
establish real browser login or signed-JWT/PostgreSQL integration of the adapter.
That earlier confirmation is not extended to the new UI/observation bridge or
gateway. Those changes require fresh43/52 review and actual host integration.

`setSession({actorId,view})` consumes the registered identity from `/v1/me` and a
local journey view. It is not authentication or authorization. The adapter must
bind every operation to that same authenticated session and call `setSession`
on logout, reauthentication, identity or role-view changes. The backend remains
the authority for verified phone, invitation recipient, trip ownership and current
standing/trip consent on every protected request. Never expose a production role
switch that changes only these local fields while retaining another user's token.

## State and privacy behaviour

Invitation creation records pending consent only after a matching server receipt;
it sends no invitation notification. Acceptance allows a nonempty subset of the
requested map/incident scopes, then waits for a matching server receipt. A supplied
invitation hint is caller metadata, not authoritative grant discovery. The backend
must reject a forged/stale hint or mismatched verified phone. Acceptance is a
historical command receipt; `privacy.currentAuthorization` always requires another
server check rather than granting a protected view from local consent flags.

Role/session/trip changes abort outstanding signals and discard protected data and
receipt history. Abort does not promise that a server mutation was cancelled.
Late results from the previous context are ignored, including transports that
ignore AbortSignal. Reordered reads cannot overwrite newer results. Each read
clears that view before loading; 401/403/404 invalidates both protected views and
all outstanding operations. A401 also clears the local session. Error categories
preserve invalid/authentication/forbidden/missing/conflict/unsupported/server/network.

Standing and per-trip revocation clear protected data before the request, and
again after confirmation. Protected reads are blocked during pending/uncertain
revocation. An ambiguous write remains uncertain, does not create a receipt, and
is never automatically replayed. `retryUncertainCommand()` is an explicit user
action reusing the exact original key/body. It is unavailable after identity/trip
changes. A refusal of that retry (including 409) does not disprove the original
possible commit: the outcome remains uncertain and revocation keeps protected
reads blocked. Authentication failure clears the session and prevents replay in
another identity. Same-session protected-read denial also preserves a prior unknown
write outcome. A first-attempt definitive4xx remains rejected, distinct from this
prior-unknown case. There is no promise that revocation cancels already authorized provider
work; no restore/re-enrolment operation is invented.

Location state preserves capturedAt, receivedAt, server readAt, server freshness
at that read and source age separately. `locationAge(snapshot)` returns that exact
server age with `asOf: 'server-read'`. It accepts no client clock and makes no current
age estimate. A browser wall clock, including an aligned/offset/backward clock,
cannot alter the raw fact. A slightly future capture already accepted and clamped
to age 0 by the server remains 0; unavailable age remains null. Re-read the authorized
snapshot for a newer fact. The UI already renders the raw age/freshness with ES/PT-BR
as-of-read labels and does not call this helper. Neither path labels the cache live,
refreshes authorization or promotes old uploads to a new observation.

Q59's [original preserved source-age probe](https://github.com/Bimbi-Dev/andes-hackathon/blob/16d51a1873c54fdc302c5cdd002b9fa2bb851e89/docs/reviews/pr53/bridge-reproduce.mjs)
reproduces the earlier clock-mixing defect at the archived UI head. Its published
output has a hardcoded older candidate tag; `location-age-baseline.json` records
the actual archive and observations. Eight new controls in `location-age.test.mjs`
fail against that old source and cover as-of semantics, the aligned control,
offsets/rollback, accepted +300ms capture and unavailable age. The compile-only
`location-age.types.ts` rejects a caller-supplied wall clock. This is a narrow helper
correction awaiting59/43 confirmation; prior privacy acceptance stays scoped and
the UI still awaits52 review. The backend's 120-second bound
is synthetic engineering policy, not qualified phone coverage or a safety promise.

An SOS acknowledgement is an attributed receipt, distinct from an action report.
Free-text inability-to-assist and later contradictory reports remain separate own
action receipts without claiming help or resolving the incident. They are not
independently corroborated outcomes. Only the driver's authenticated operation can
resolve; the local view/owner check is an additional UX guard. Because the resolve
response has no resolvedAt, the journey requires another incident read before
presenting a resolved incident fact. Arrival/map closure is not incident resolution.
Operational sharing never implies research permission; research reuse, account
deletion and restoring revoked consent are explicitly unsupported here.

## Missing backend support sent to41/44 through Brain

At the frozen backend SHA there is no contact/grant list or invitation metadata
read, so another signed-in contact cannot discover pending invitations or requested
scopes from this module. Invitation creation requires an already registered target
UUID and its destination phone. Caller hints and local receipts cannot restore that
history after reload. No fabricated grant-read route or production share link exists.

The incident read returns only id/tripId/status/createdAt/resolvedAt/groupCapability.
It has no acknowledgement/action history, participant availability, structured
cannot-assist state or conflict-resolution interface. This journey retains only its
own successful action receipts in memory. Rendering other people's reports or
reconciling disputes requires an actual backend read contract. Lane45's published
adapter covers the semantic/session seam above. The composed fixture renders the
owned UI, while production host wiring and real authentication remain unintegrated
here. Auth/privacy review belongs43 and functional UI review52.

The standalone unit tests use synthetic transport receipts and failure/race probes.
They do not prove backend authentication. The persisted scenarios below add real
signed-JWT and PostgreSQL integration with invented identities. Browser OIDC login,
lane45's actual transport, data retention/deletion policy and human/device gates
remain open. Neither suite proves provider delivery, consent comprehension,
physical-device capability, qualification or safety. No participants, notifications,
recruitment, spending, deployment or collection is used.

## Persisted driver/contact role-switch scenarios

With Node24–26 and local PostgreSQL15+ binaries, from the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node web/tests/contacts/run-persisted.mjs
```

The bounded runner builds the unchanged backend and creates a disposable cluster
under a fresh private `/private/tmp/andes-l51-*` directory. PostgreSQL listens only
on that private Unix socket, not TCP; it does not connect to an existing database.
The runner supplies its own synthetic TEST_DATABASE_URL, forces live-send permission
off, stops its child database and deletes the temporary cluster afterward. The
default binaries are `/opt/homebrew/bin/postgres` and `/opt/homebrew/bin/initdb`;
override `ANDES_TEST_POSTGRES` / `ANDES_TEST_INITDB` with local executable paths.
Each scenario additionally uses the backend helper's unique disposable SQL schema.
Without an explicit test DB, the normal test glob visibly skips these three cases.

The three persisted cases use the actual Fastify routes, PostgreSQL transactions
and signed synthetic JWT verification. They verify narrowed consent denies maps;
unverified-phone acceptance fails; acknowledgement and contradictory reported
actions persist separately while SOS remains active after arrival; trip-only
revocation permits a different trip while standing revocation denies future trips;
and fresh browser controllers cannot recover revoked protected data. Forging only
the local view/identity never replaces the JWT: contact credentials cannot resolve,
stranger credentials cannot read, and only the driver's credential resolves before
fresh contact reads observe resolution. Calls use Fastify injection, not an external
network server, OIDC login, AWS, a provider adapter or a production account.


## Contact-route readiness inventory

Source review: backend `c752de8a3b424bcbc086764dc11052348b27e320` runtime and
contacts/location/incidents/API route files; those route files are unchanged from
the tested `ebc8fb1` feature base. Published, unmerged PR65 at
`748d30c6e6c595fd1a2c2c648a045750de3dd9c8` supplies `docs/contracts/client-read.md`,
`src/client-read/routes.ts` and its tests. Its additions are inventoried here,
not imported or claimed integrated. Brain's contacts/invitation/contact-trip/privacy
blueprints determine the UI tasks; the owned components now use49's committed foundation.

Lane45 owns authenticated transport/session binding. A route UUID never grants
access. Each write below uses the existing authenticated Idempotency-Key contract.

| App route/control | Actual inputs and supported action | Missing support or boundary |
| --- | --- | --- |
| `/contacts`: reload | PR65 contacts/bootstrap GET returns driver-owned grant ID/contactId/phone, requested/accepted scopes, status and consent timestamps/attribution | Bound100 and hasMore; no cursor. Recipient requests return their own driver lists, not incoming invitations. |
| `/contacts`: invite | Registered target UUID, E.164 destination and nonempty map/incident scopes; existing contacts POST records pending state | No directory/phone-to-user lookup, enrollment or invitation notification. Pending is not accepted. |
| `/contacts`: revoke | Known grant ID from driver catalog or own receipt; existing standing revoke POST with empty body | Server checks participant; permanent, including future trip selection. No restore operation. |
| `/contact/invitations/:grantId`: load | Route grant ID and current recipient need requested scopes, driver binding and current grant state | Incoming invitation list/detail is missing. A local hint or URL cannot restore authoritative metadata. |
| `/contact/invitations/:grantId`: accept | Explicit nonempty subset of requested scopes; existing accept POST | Verified destination/recipient checks stay server-owned; handle revoked/already-accepted/phone conflicts. No invitation-expiry field exists. |
| `/contact/invitations/:grantId`: withdraw | Known grant ID; existing standing revoke | No invented reject/restore/acceptance-notification action. |
| `/contact/trips/:tripId`: discover | Trip ID needs driver/grant/effective permissions and active incident binding | PR65 trip list is driver-only; contact shared-trip discovery is missing. Selected grant IDs do not prove current authorization. |
| `/contact/trips/:tripId`: location | Existing snapshot GET rechecks current map consent/map-active | Preserve capture/receipt/read times and age. Map403 does not deny a separately permitted incident. |
| `/contact/trips/:tripId`: incident | Status GET returns the latest incident UUID to incident-scope contacts; the incident GET then rechecks it | Map-only contacts get no incident from status, and the page never reads that as "no incident". Read returns only ID/trip/status/createdAt/resolvedAt/group capability; open SOS survives arrival under incident consent. |
| `/contact/trips/:tripId`: acknowledge | Read active incident; existing acknowledgement POST with empty body | Receipt is not action, delivery, help or resolution. |
| `/contact/trips/:tripId`: action/cannot assist | Active incident plus explicit 1–300-character report; existing actions POST | Free-text attributed reports only; other participants' history and structured inability/conflict reconciliation are absent. |
| `/contact/trips/:tripId`: revoke trip | Known trip/grant IDs; existing trip revoke POST | Other trips may retain standing consent; ambiguous revoke keeps reads blocked; authorized prior work may complete. |
| `/contact/trips/:tripId`: resolve | Existing resolve POST is driver-only | Contact UI must not offer it; arrival/ack/action never resolves. |
| `/privacy`: inspect/revoke | Driver catalog supplies current standing state; existing standing/trip revokes accept known IDs | Recipient standing management and effective per-trip-revocation reload are missing reads. Local receipts remain historical. |
| `/privacy`: optional reuse/restore/deletion | No supporting API/prerequisite evidence | Explain unsupported capability; no research toggle, restore, deletion or emergency-number action is enabled. |

PR65 profile GET exposes only the current actor's id/phone/verification, not a
user directory. Driver trip summaries retain selected grant IDs,50active/20recent
bounds and truncation flags; they expose no effective per-trip-grant revocation,
incident discovery, coordinates or provider facts. Check/deadline and alert-wave
facts come from the status read below; PR53 stays unwired.

### Retrieval request and backend ownership

Q41 confirmed that its PR65 is limited to actor-owned profile/truck/contact/trip
catalogs and bootstrap. It will not duplicate Robert's planned
`GET /v1/trips/:id/status` and `/sharing`; those paths have no published recipient
discovery DTO in the reviewed source. The two needs below were sent to41/44 for
backend-owner coordination, not as authorization for41 to invent parallel routes.
Robert/44 must settle any remaining invitation/shared-trip discovery ownership and
publish the actual paths/DTOs;45 then types them before51 consumes them.
The immediate need is two bounded participant-authorized retrievals with stable
IDs/order and explicit truncation:

1. Incoming invitation list/detail for the authenticated recipient: grant ID,
   driver binding, requested/accepted operational scopes, pending/accepted/revoked
   state and applicable existing consent timestamps. This supports invitation
   reload and recipient consent management. A minimal revoked tombstone must not
   retain protected trip access. Exclude others' phones/claims, route/cargo/location
   details and provider internals.
2. Shared-trip list/detail for an authenticated accepted contact: trip/driver/grant
   binding, current effective map/incident permissions or denial, per-trip revoke
   state and permitted active-incident UUID. Keep an open incident discoverable
   after arrival/map closure under incident consent. Reuse snapshot for coordinates
   and age; discovery need not duplicate notification or event-history APIs.

Both reads distinguish unauthorized/missing from legitimate empty results and
recheck standing/trip revocation under existing backend rules. No query/body owner
selects another actor. Useful controls: stranger, wrong recipient, narrowed scope,
revoke then reload, arrived trip with active SOS. Shared phone values cannot prove
identity/consent. Driver per-trip-grant-state reload, structured inability, report
history, directory enrollment, deletion and channel/deadline status remain explicit
separate gaps outside this minimal request. No scaffold or success fixture is added.

## Trip status (#74 on main) and contact role

The contact trip page reads `GET /v1/trips/:id/status` (driver, or a contact with an
accepted, unrevoked grant). For incident-scope contacts it returns the open check
(reason and `askUntil`), the latest incident (trigger, check reason, `label`,
creation time) and the current alert wave's deliveries, and the page loads that
incident by the UUID status gives. Map-only contacts get `check:null`,
`incident:null` and no deliveries; the page then says nothing is visible to this
account and that this does not mean the driver is fine. A status denial does not
hide the separately authorized incident or map, and a map 403 does not hide an
incident that status found. Status has no "last driver response" field, so that row
was removed. Invitations can set `role` (`family` by default, or `colleague`).

`status.browser.mjs` checks this against the Vite dev fixture
(`node web/tests/contacts/status.browser.mjs http://127.0.0.1:PORT`, using
`web/tests/foundation/cdp.mjs`). The client's status decoder on main drops `label`
today, so the label reaches the page only once that decoder keeps it. The journey
keeps it when it is present.

Refs #15, #35, #14. No issue completion is implied.
