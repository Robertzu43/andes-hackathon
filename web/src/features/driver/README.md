# Driver journey controllers — #13 software slice

`controller.mjs` is a nonvisual, framework-independent, memory-only driver journey.
`controller.d.mts` exposes its TypeScript surface. No UI, router, web package,
transport, login, NLP, transcription, monitoring algorithm or notification is
implemented here. The shared foundation and Design Contract remain component49 /
Brain work. Root backend files and other lanes' owned paths are unchanged.

Exact branch base: Robert's `origin/codex/aws-durable-backend` at
`ebc8fb1d36f441ef012ca585201cefabf61383d6`, refreshed before creating
`sebasbimbi/feat/andes-driver-trip-flow`. Read `docs/contracts/runtime.md`,
`docs/evidence/backend-progress.md`, `package.json` and actual trips, contacts,
incidents, location, validation and idempotency source. No endpoint is invented.

## State and explicit actions

Construction starts nothing. The host binds a verified session's backend actor
UUID with `setSession`. It never passes a bearer token into these controllers.
Session identity is context, not authorization; Robert's server remains the
authority for ownership, consent, trip state and idempotency. Changing or clearing
the session cancels local waits, purges draft/catalog/server facts and ignores
late old-session responses. `dispose` is idempotent and also clears subscriptions.

The host must explicitly set `stationary` or `allowed-assistance` before form or
write actions. These are host policy assertions, not movement detection or a
validated driving-safety claim. `moving` and `unknown` block those actions. Reads
require no moving interaction. There is no alarm, timer-driven check-in, required
response or penalty for not interacting while moving.

`editForm` preserves explicit text and corrected truck/origin/destination/country/
locale/timeZone fields. Nothing extracts fields or infers country, language or
zone. Spanish locale variants and Brazilian Portuguese (`pt-BR`) are supported
input choices; no translated UI or human language validation is claimed. Country
and time zone remain independent of the language and phone number.

`saveDraft` persists only through a valid transport response. Missing fields stay
missing and do not activate a trip. Once saved, raw text is immutable in this
bounded journey because the backend has no update-draft route; explicit field
corrections are included on confirmation. `confirmTrip({confirmed:true})` requires
a complete valid form, an owned truck and explicitly selected accepted grants.
An empty contact selection is permitted by the real backend and remains empty.
Repeated pending confirmations share one request/key. An acknowledgement is
recorded as `activation.source = 'confirm-response'`; current persisted trip
state remains `not-loaded` until `openTrip` reads it. No successful local-only
activation is supplied by default.

This controller owns one journey at a time. A different trip cannot overwrite an
already bound trip. Opening a trip locks draft form/contact edits, draft creation
and new confirmation. Pending, unknown and accepted drafts also block opening
another trip; their captured intents are not discarded. A separate instance with the same verified session can open
another persisted trip; logout/disposal must destroy the old instance. There is
no local storage or hydration claim. Page kill loses memory, including unresolved
intents; do not start a new write to compensate for an uncertain prior write.
Recover/reconcile through server reads and the transport's qualified intent
journal before enabling a reload/restart flow.

## Owned trucks and accepted contacts

The current base lacks catalog/list read APIs. The controller therefore accepts
host-normalized `provideSelectionEvidence` only at an explicit trusted seam:

```js
{
  actorId: 'backend-actor-uuid',
  source: 'authenticated-server-read',
  readAt: 'explicit-offset-ISO-instant',
  trucks: [{id: 'owned-truck-uuid', label: 'Camión 1'}],
  contacts: [{id: 'standing-grant-uuid', status: 'accepted', map: true, incident: true}]
}
```

This is **not a frozen HTTP response** or permission for UI code to invent
ownership/acceptance. Component41 owns the read routes; component45 must normalize
their actual responses. Missing evidence blocks truck selection/registration and
confirmation. Evidence must match the current actor. At most two trucks are
supported in this client slice; this cached guard is not a cross-device backend
truck-count constraint. `registerTruck` records only an actual successful create
response. Pending, revoked, unknown and scope-empty contacts are not selectable.
Selections are normalized to lowercase UUIDs, case-alias duplicates are rejected
and the backend must recheck live consent at confirmation. A later catalog update
that revokes selection blocks confirmation without silently selecting another
contact.

## Transport binding for component45

`transport(request, {signal})` is an injected local port returning one of:

```js
{kind: 'ok', data: actualServerResponse}
{kind: 'rejected', status: 409, code: 'contact_not_accepted'}
{kind: 'unknown', code: 'network'}
```

`DriverRequest` contains `operation`, `params`, optional `body`, and for writes a
required `idempotencyKey`. This descriptor is a provisional host binding, not a
claim that component45's unpublished module already exposes these names. Bind it
to that module after its exact interface arrives. No raw `fetch` or URL builder
is present in this slice. The operations map only to existing backend source:

| Operation | Existing backend method/path | Owned request/meaning |
| --- | --- | --- |
| `createTruck` | POST `/v1/trucks` | `{label}`; verified session owner |
| `createDraft` | POST `/v1/trip-drafts` | `{text,fields}`; no audio |
| `confirmDraft` | POST `/v1/trip-drafts/:id/confirm` | `{confirmed:true,contactGrantIds,fields}` |
| `command` | POST `/v1/trips/:id/commands` | Actual enum `{type}` only |
| `sos` | POST `/v1/trips/:id/sos` | `{}`; one active attributed episode |
| `readTrip` | GET `/v1/trips/:id` | Persisted SQL-named fields, current owner |
| `readSnapshot` | GET `/v1/trips/:id/snapshot` | Owner's source-aged location snapshot |
| `readIncident` | GET `/v1/incidents/:id` | Current authorized incident read |

Every response is checked for the expected operation/trip/session before it
changes state. Malformed or wrong-object success cannot manufacture activation.
HTTP 400/401/403/404/409/422 stay distinct. A 401 expires local auth and cancels
other pending waits; denied reads clear protected cached data. Raw exception,
provider and diagnostic details are not stored. A 5xx, lost response, rejection
of the transport promise, timeout or local abort leaves write outcome unknown;
it does not prove a rollback. Browser abort cannot undo a committed server write.

Unknown writes lock that operation's intent. A retry's 4xx rejection does not
disprove an earlier ambiguous commit; the original submission stays unknown,
with that retry response recorded separately. `retryUnknown(slot,{confirmed:true})`
is an explicit operator action using exactly the same captured body/params/key,
not an automatic new attempt. Offline/online changes never trigger sends.
Different commands cannot coalesce into a pending command's acknowledgement;
identical pending commands do. Repeated acknowledged commands reuse the receipt
until the host explicitly supplies `{newIntent:true}` for a new user intent.
Ordinary commands and SOS occupy separate slots, so an unknown pause cannot
block an explicit allowed help request. Repeated help retains the same known
active episode. A read can discover resolution; the controller never resolves
an incident on arrival, cancel, pause, OK or rest report.

Command acknowledgement invalidates earlier trip/location reads but never
locally guesses the new persisted state. `checkin_ok` and `rest_report` retain
their actual command acknowledgements and local receipt time, with unknown
source event time; they do not become measured wellbeing, fatigue or delivery.

## Source times, projection and bounded work

Location captures, server receipt/read time and server-as-read age/freshness are
preserved separately from `clientReceivedAtMs`. An old response cannot replace a
newer requested read. A `fresh` value in the raw response is an **as-of-read
server fact**, not an advancing live claim. No cadence/freshness/risk calculation
is copied here. Bind `monitoringProjection(facts, clientNowMs)` to the reviewed
monitoring projection through an agreed adapter when integrated; the default is
explicitly unavailable. Consumers must use that source-aged projection rather
than rendering raw as-of-read freshness as current. Sensitive location/text
remain in memory only; nothing is uploaded, persisted or logged automatically.

At most five write slots and three read slots exist; each has at most one local
pending wait. Same-slot new reads retire prior ones; old callbacks are inert.
Listeners are capped at 16. The default 15000 ms request timeout (configurable
1–60000 ms) is an engineering resource bound, not a safety deadline. Timer delays
do not make late replies timely: elapsed local time is rechecked before response
application. Backward clock movement fails that response closed; a missing clock
keeps receipt time unknown. The browser controls scheduling and cannot guarantee
cleanup while killed/suspended. Unknown intents are never silently discarded to
create new sends. There is no unbounded event/history buffer, worker or polling.

## Verification and next dependency

Node **24.17.0**, matching the backend's Node 24–26 engine range:

```sh
node --test web/tests/driver/journey.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM web/tests/driver/contracts.types.ts
```

Author result: **26 passed, 0 failed** using an explicitly synthetic contract
fixture. Coverage includes explicit regional fields, one/two-truck evidence,
contact revocation, incomplete draft, duplicate confirm, immutable retry intent,
network/HTTP/permission states, delayed timers, logout/late replies, read races,
independent command/SOS slots, source-time retention and no invented delivery.
No package install, DB, physical device, provider or server was needed for these
controller tests. They do not establish a persisted HTTP end-to-end journey,
independent acceptance, human comprehension, language qualification or safety.
Strict compile-only consumer checks also passed with the existing TypeScript
5.9.3 compiler in component46's `andes-evidence-gates/node_modules`; no compiler
or package was installed in this lane. They reject invented commands, unsupported
permission/interaction states, audio form input and unknown write slots.

The next slice also passed **four actual PostgreSQL/API journey checks**, including
a new API instance reading committed state after shutdown of the original API.
See [persisted-evidence.md](persisted-evidence.md) for the exact runtime, commands,
test-only catalog/transport seams and limits. This does not replace component45's
browser client binding or component41's missing catalog read contract. UI rendering
follows the verified component49 foundation plus Brain Design Contract. Those are
remaining dependency gaps. Physical/human evidence gates for #13 stay open. No
merge or issue closure is performed by this author lane.

## Independent PR63 cross-trip repair

Reviewer47 found a P2 overlap bug at c256e75a1b58168925a8e9f760c3759ee33bfa0a:
opening A, reading its location/active incident, then drafting/confirming B could
leave A facts cached and return A incident from help without sending SOS for B.
The [original review](https://github.com/Bimbi-Dev/andes-hackathon/pull/63#pullrequestreview-5560547636)
is accepted. The guard now enforces the documented one-journey contract across
open, form edits, save and confirm; confirm initializes all three read facts, and
cached help additionally checks trip identity. Repeated same-journey confirmation
retains its original receipt. No unknown intent is silently retired.

Current evidence: **28/28 author controller checks**, strict TypeScript 5.9.3
consumer checks and **4/4 actual signed API/PostgreSQL journeys pass** on Node24.17.0.
The persisted journey now explicitly restores a fresh controller from a real trip
with location and active incident, rejects the overlapping draft/confirm and
asserts one persisted draft/incident and same-trip help. The unchanged reviewer
probe reports **7/7 pass**, versus **6/7** on frozen c256e75. Its SHA-256 remains
2f780e0073396fc59d43a325194845aa53b953eed34a452b51e36a9ba0dad3c4.

The reviewer probe was read/run in its owner directory without editing it:

```sh
ANDES_REVIEW_DRIVER_ROOT="$PWD" node /Users/sebasbimbi/.codus/workspaces/andes-channel-review/tests/client-contract-review/driver.probes.mjs
```

Raw before/after results are /private/tmp/andes-driver-review-before.json and
/private/tmp/andes-driver-review-after.json; author output is
/private/tmp/andes-driver-review-after.tap. Reviewer47 confirmation of the new
immutable head remains required. No merge or product qualification is claimed.

The typed client has since published createDriverTransport and bindJourneySession
in PR59 at db7034fc9e1dba035b87368117376e9730d6b830. That binding's prior checks
pin c256e75 and must be rerun with this corrected head. Q41 owner catalogs are
published separately in PR65; their missing server readAt normalization remains
a contract gap. PR53 monitoring is parked; UI must not depend on its projector.
See [command source inventory](command-source-inventory.md) for current voluntary
OK/rest/pause semantics and pending status/policy contracts.
