# Typed client API and session boundary

Lane45 owns `web/src/lib/api/**`, `web/tests/api/**` and this document. The library
has no runtime dependencies, framework imports, provider SDK, storage or root
package changes. Import its public API and wire types from `web/src/lib/api/index.ts`.

## Source contracts and dependencies

The original route base is `ebc8fb1d36f441ef012ca585201cefabf61383d6`. Contract checks
also used PR74 at `27e4f94b5962e88735fdb8fc3fea8cc3e842baa4` and PR65 at
`de9e455b6f7631aa80addfa19b1f38def68bb523`, including their actual handlers and strict
schemas. PR59 now targets main and includes a normal merge of
`f75de59fa1d4190cfe8a204f2ea5d42833d6f46b`, after Robert merged the backend
reconciliation, web foundation and future-arrival contract. Normal merges also
preserve his PR59 fixes `935d1ed` (verify first) and `578600c` (calendar/hour24),
including his source validation and regression. Existing PR59 history is preserved.
PR81 remains a separate child; Robert owns approval and merge.

| Operation | Actual HTTP contract |
| --- | --- |
| `getIdentity` | GET `/v1/me`; verified backend UUID, not an OIDC subject |
| `getProfile`, `getBootstrap` | GET `/v1/profile`, `/v1/bootstrap`; PR65 owner-scoped reads |
| `listTrucks`, `listContacts`, `listTrips` | GET the corresponding `/v1` collection; bounded first-page PR65 reads |
| `createTruck` | POST `/v1/trucks` with label |
| `inviteContact` | POST `/v1/contacts` with existing contactId, international phone, map/incident scopes and optional PR74 family/colleague role |
| `acceptContact`, `revokeContact` | POST `/v1/contacts/:id/accept` or `/revoke`; acceptance cannot broaden requested scope |
| `createDraft` | POST `/v1/trip-drafts`; text and optional corrected fields, including explicit expectedArrivalAt |
| `confirmTrip` | POST `/v1/trip-drafts/:id/confirm`; literal confirmed:true, selected grant IDs and optional corrections |
| `getTrip` | GET `/v1/trips/:id`; preserve SQL wire names and optional PR74 arrival/sharing timestamps |
| `getTripStatus` | GET `/v1/trips/:id/status`; server check/incident/delivery facts and optional scope-filtered location summary |
| `setSharing` | POST `/v1/trips/:id/sharing`; explicit state/reason and caller idempotency key |
| `createDemoSession` | POST `/v1/demo/session` with `{}`; explicit `{demo:true}`, no bearer or idempotency key; sensitive synthetic world |
| `commandTrip` | POST `/v1/trips/:id/commands`; arrived/cancel/pause/resume/checkin_ok/rest_report |
| `uploadLocations` | POST `/v1/trips/:id/locations`; caller supplies captured observations |
| `getSnapshot` | GET `/v1/trips/:id/snapshot`; preserve capture/receive/read time, age and freshness |
| `revokeTripContact` | POST `/v1/trips/:tripId/contacts/:grantId/revoke`; independent from standing consent |
| `reportSos` | POST `/v1/trips/:id/sos`; attributed request and active episode ID, group unavailable |
| `getIncident` | GET `/v1/incidents/:id`; current-consent read independent of trip/map closure |
| `acknowledgeIncident`, `reportAction` | POST incident `/acknowledgements` or `/actions`; attributed response, not provider delivery |
| `resolveIncident` | POST incident `/resolve`; explicit owner resolution, independent of arrival |

Status, sharing and anonymous demo acquisition are described in the PR81 section
below. `readStatus` is accepted by the driver descriptor type, but the driver
transport still returns `not_sent/unsupported_operation`; bind it to `getTripStatus`
when the driver feature consumes status.

## Trusted session and transport

`createApiClient({baseUrl,session,fetch?,timeoutMs?})` requires a trusted explicit
HTTPS API/proxy URL, except literal HTTP loopback. Userinfo, query and fragment are
rejected; a configured path prefix is preserved. The browser still needs a trusted
same-origin proxy or independently implemented CORS. A native fetch test does not
prove browser CORS or provider login.

`MemorySession.setCredentials` accepts credentials only from a trusted identity
integration. It neither verifies JWTs nor grants ownership from body IDs. Credentials
and transport leases are memory-only: never persist or log them, put them in URLs,
or render them. `snapshot()` is token-free. No synthetic login, silent refresh or
provider fallback exists in this base.

A trusted refresh with the same issuer and subject updates only credentials. It
preserves the bound actor, pending requests and accepted SOS receipts. Account
changes, sign-out and expiry invalidate old-account work and protected contexts.
A credential revision separately prevents an older token's401 from invalidating a
refreshed token for the same account. Old successes require the same live account.
A refresh can extend credential life, never a request's fixed timeout.

Requests use credentials:omit, cache:no-store, redirect:error and
referrerPolicy:no-referrer. Tokens appear only in Authorization. An owned
AbortController fan-in supports platforms without AbortSignal.any; completion
retires its timer and every attached listener. The default10s timeout bounds local
resources, not a server transaction or incident deadline.

## Intent and receipt semantics

All authenticated writes require a caller-owned visible-ASCII idempotency key,
1–128 characters. Create one key per explicit intent and preserve its body/key while
reconciling ambiguity. UUID paths canonicalize to lowercase. The serialized body is
captured before asynchronous work. There is exactly one HTTP attempt: no automatic
retry, offline replay, replacement key or token refresh.

| Result | Meaning |
| --- | --- |
| not_sent | Local validation, missing session or cancellation prevented dispatch |
| rejected | This request received a definite HTTP4xx, including429; this alone does not disprove an earlier ambiguous attempt |
| unknown | Dispatch began but a successful result cannot be confirmed: transport loss, post-dispatch abort/expiry,5xx or malformed success |
| not_applicable | Read outcome, including local read validation/session failures |

A definite4xx remains a rejection when cancellation races its error body. A current
credential401 is invalidated before parsing that body; an old token cannot erase a
new account or refresh. Resource validation rejects asynchronously through the
returned promise. Error messages/codes are fixed or allowlisted; raw provider,
transport and server payloads never become public errors or causes.

Explicit zoned arrival instants normalize before draft and confirmation dispatch.
The supported offset spellings +0000 and +05, and lowercase t/z, become canonical
UTC before a server can commit and echo them. Calendar and time fields must
round-trip at the supplied offset: impossible dates and hour24 are rejected before
dispatch. Valid leap days and offset-induced UTC day changes remain valid. An
unzoned local datetime is rejected as invalid_input/not_sent; the feature must
obtain the intended zone. The caller's object is not mutated. No arrival, locale,
country, truck, role or time-zone default is invented by the client.

Current main separately requires expectedArrivalAt to be strictly in the future
at draft creation and again at confirmation, using the server clock. This SDK does
not replace that authority with the browser clock. The location capture tolerance
below applies to observations, not expected arrivals.

## Source facts and bounded reads

Decoders project fixed known fields. Malformed JSON/content types, missing required
facts and contradictory location states fail closed. A snapshot's age must equal
max(0, readAt minus capturedAt). The actual upload route permits a capture clock up
to30000ms ahead of receivedAt; such accepted future captures retain age zero.
ReceivedAt cannot be after readAt, and capture beyond that receipt tolerance is
invalid. Freshness must match the backend's120000ms engineering boundary. Validation
uses source times, never the current browser clock, and does not qualify either
bound for field safety.

All five PR65 read envelopes require their actual server readAt. Bootstrap has one
root time, not invented timestamps on its profile/list entries. At de9e455 the server
samples its handler clock before a repeatable-read read-only transaction. Preserve
that value without assigning a different instant to the database snapshot. The
older3ea6e1b implementation used read committed; its earlier evidence is not proof
of de9e455 isolation. This client has not independently established SQL isolation.

Lists preserve bounds and truncation:100 trucks,100 standing contacts,50 active and
20 recent trips. Revoked grants retain historical accepted scopes without granting
current access. Errors stay errors. Collection404 is unsupported/endpoint_unavailable,
not an empty list or missing individual resource. Recipient invitation/trip discovery
remains a separate PR86 dependency.

Phone access and projection remain backend authority; these client checks do not
qualify live phone-number privacy or permit exposing live numbers in the demo.
Trip summaries exclude raw draft text and coordinates.

## Journey and foundation integration

`createContactApi(api)` maps the published feature's getTripSnapshot/reportIncidentAction
aliases and preserves original keys, signals and ApiError objects. Other wrappers
remain to satisfy the actual typed feature port. No local permission or retry is added.

`bindJourneySession(session,api,setActor)` clears synchronously on construction,
then verifies typed /v1/me before publishing an actor. Explicit reactivation keeps
the current actor and protected facts while verification is pending. An unchanged
verified actor does not invoke the callback again; an actual actor change clears
before publishing its replacement. Concurrent activations with the same credential
revision and caller signal share one verification; different activations retire old
ones. The callback must clear protected state when given null. Disposal clears once
and suppresses queued session notifications, including disposal by an earlier
listener during the same dispatch. The independently reviewed75bdffa fix is
preserved. Same-account refresh does not call the reset callback; account
replacement, clear, current401 and expiry do.

`createDriverTransport(api)` preserves ok/not_sent/rejected/unknown and original
intent ownership. Its current feature compatibility pin is
`127c82ad109702a329e5bec008708b0fbc67487b`. An explicit SOS is not swallowed by a cached
incident; cross-trip edits and old incident reuse remain prohibited by the feature.
The SOS regression retains the original driver80e9d45 source to isolate the shared
binding's original refresh failure. Explicit-reactivation tests use actual current
controller `20c08faad67fddbe27eebac7585c63b3366f31a8`, which preserves same-actor state,
and cover accepted and committed-but-pending SOS results without replay.

Features can inject `decodeDriverResponse(request,data)`, `decodeLocationSnapshot`
and `decodeIncidentSummary` through the public entry. These reuse the same wire
decoders as the HTTP client; actor/trip correlation and receipt semantics stay with
the feature. The standalone feature need not import the SDK at runtime.

`createSessionGateway({session,api,mode,acquire?,release?})` implements the real public
foundation seam with immutable stable token-free state/mode snapshots. Initial
injected credentials enter connecting and require actual /v1/me. Without credentials
or acquisition it is unconfigured. Explicit acquisition also awaits verification;
provider success alone cannot authenticate. A verifier401 publishes error; a later
request401 signs out. Reads and late subscriptions check expiry when browser timers
were suspended. End/dispose retire old work; only explicit end invokes the optional
trusted release callback. The gateway has no built-in provider or demo identity.

## PR81 status, sharing and demo sessions

`getTripStatus` preserves the server's trip state/expected arrival, nullable asking
check and `askUntil`, latest active or resolved incident, and individual job delivery
states. The incident keeps its #77 `label` (robo/intento_robo/falsa_alarma/sin_senal/otro
or null); an unknown label fails as invalid_response, and a backend without labels leaves
the field absent. Arrival can coexist with an active incident. A job's accepted/unknown/delivered
status is not contact acknowledgement or proof of help. The projection excludes
phones, recipient IDs and coordinates; optional location is omitted when the route
omits it. The response has no trip ID or readAt: bind it to the requested trip and
current session in the consuming view. No polling policy or countdown is added.

`setSharing(id,{state,reason},{idempotencyKey,signal?})` records stopped/resumed
sharing (reasons user/page_hidden/permission_denied/error). It does not prove a
sensor is capturing or that anything was delivered. Closed-trip409 and ambiguous
results stay distinct; reconciliation reuses the original body/key, never retried.

`api.createDemoSession({demo:true,signal?})` makes one unauthenticated POST with `{}`:
no bearer, cookies or idempotency key (the server has no actor yet). With demo mode
off the backend's auth hook answers401; a missing route is404; rate limiting is
429 `demo_rate_limited`. All stay errors and never fall back to another login.
The returned `DemoWorld` holds sensitive tokens for driver/family/colleague: keep it
in memory only, never render, log or persist it.

`createDemoSessionGateway({session,api,persona,world?})` fixes mode to `demo` and
needs an explicit persona. Unverified JWT claims supply issuer/subject/expiry metadata
only; the gateway still requires server verification and a matching `/v1/me` UUID
before it publishes authenticated.

One world serves every persona and every begin. `createDemoWorld(api)` mints a world
on first use and reuses it in memory until its declared 7200s lifetime ends, so a
second begin(), or end() then begin(), returns to the same trip and SOS instead of
stranding them. Pass the same `world` to the driver, family and colleague gateways
so contacts reach the driver's trip:

```ts
const world = createDemoWorld(api);
const driver = createDemoSessionGateway({session, api, persona: 'driver', world});
const family = createDemoSessionGateway({session, api, persona: 'family', world});
```

A world is dropped (and the next begin mints a new one) only when it expires, its
tokens fail local validation, or the server rejects them with401 (for example after
a restart, which kills the in-memory signing key). A page reload loses the world
because tokens are never persisted; the backend's abandoned-world rule then stops
automatic checks on the old trip, while an explicit SOS keeps escalating.

`web/tests/api/runtime.test.mjs` covers this with synthetic HTTP. The real-backend
`runtime.integration.mjs` extracts PR74 at 4c138ca, PR65's read module at 3ea6e1b and
Q46's resource helper at c2501a4 (test-only archive) and needs an owned PostgreSQL:

```sh
git fetch origin pull/74/head pull/73/head pull/65/head
APP_INTEGRATION_PG_BIN=/absolute/path/to/postgresql/bin \
APP_INTEGRATION_PG_PORT=<owned-free-port> \
ANDES_BACKEND_NODE_MODULES=/absolute/path/to/existing/backend/node_modules \
ANDES_TYPESCRIPT_TSC=/absolute/path/to/existing/typescript/bin/tsc \
  node --test web/tests/api/runtime.integration.mjs
```

Those pins predate PR65's repeatable-read change (de9e455); results there are not
evidence for the current backend's isolation.

## Reproduction and current evidence

Use Node24.17.0 or another runtime allowed by the root manifest. Do not execute
contracts.types.ts: its negative assertions are compile-only. No implicit install.

```sh
node --test web/tests/api/*.test.mjs web/tests/api/contact-view.integration.mjs
node /absolute/path/to/existing/typescript/bin/tsc -p web/tests/api/tsconfig.json
node /absolute/path/to/existing/typescript/bin/tsc -p web/tests/api/tsconfig.json --module ESNext --moduleResolution Bundler
ANDES_TYPESCRIPT_TSC=/absolute/path/to/existing/typescript/bin/tsc \
ANDES_FOUNDATION_NODE_MODULES=/absolute/path/to/existing/foundation/web/node_modules \
  node --test web/tests/api/contacts.integration.mjs web/tests/api/foundation.integration.mjs
# Built root backend and an explicitly owned, disposable test database are required:
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:PORT/OWNED_TEST_DB \
ZAVU_LIVE_SEND=false node --test web/tests/api/shared-sdk.integration.mjs
```

The declared immutable Git objects must be fetched. Tests use Node built-ins,
synthetic HTTP and actual extracted feature sources; missing dependencies fail
rather than silently skip. Temporary sources are removed afterward. Current local
results on #59 are142 native/view checks and19 controller/foundation checks (161 total),
plus both strict TypeScript modes. The existing web build and13 foundation checks
also pass. CI runs the API suite and both type modes in the web job; its existing
disposable PostgreSQL service runs the additional SQL-backed shared-SDK regression
in the backend job. Full Git history supplies the pinned feature objects; missing
objects fail the checks.

The unchanged original Q50 SQL reproduction fails with SDK b5bc921 and actual
controller20c08fa at the cleared-trip assertion after explicit reactivation.
Robert's578600c head already passes the ported SQL regression against backend1a7bf70;
the remaining concurrent-activation probe fails only its extra-verification count,
while future-capture valid controls are still rejected. His date repair passes the
unchanged calendar/offset controls. The product SQL regression also passes with the
final reconciled SDK and merged main backend:
two real check-in events, SOS held after SQL commit, fresh same-identity JWT and
reactivation, retained pending state, accepted result, explicit resolution and a new
incident, arrival independent of active SOS, zero outbox rows and logout cleanup.
Local SQL evidence used an owned ephemeral PostgreSQL16.14 cluster, stopped and
removed afterward; CI uses PostgreSQL18. No browser, physical iOS, provider delivery,
complete-app acceptance or general backend-isolation qualification follows.

On #81 the API suite adds runtime.test.mjs (status, sharing and demo world), and
`runtime.integration.mjs` passes7 real HTTP/PostgreSQL checks at its stated pins.

The frozen contact view store at e2c1e677cf3ec3fa9c7f91529b082ab5b8ff91e6 confirms both
contact and driver views remain closed after401, protected data clears, and explicit
begin recovers. The original queued-callback failure is preserved as RED before
this guard. Current feature integration uses contact b95bdba and driver127c82a;
foundation compile compatibility remains pinned3283fe6. No old receipt moves to a
new source revision without rerunning its relevant checks.

## Gatekeeper coverage and remaining dependencies

PR59 review5560836622: the six required items have reproducing regressions for SOS
refresh retention, zero-dispatch results, AbortSignal.any absence, missing catalog
capability, anchored snapshot freshness and PR74 arrival/contact-role types. The
should-fix lifecycle issues have RED/GREEN cases for verifier401, installed sessions,
late expiry, asynchronous read validation, definite refusals and dropped readAt.
UUID validation is shared and demo_rate_limited is allowlisted.

PR81 review5560922593: the arrival echo, refresh/SOS retention, not_sent outcomes and
AbortSignal.any fallback (including demo sign-in) come from the merged base. /status
freshness must now agree with its age. One demo world is shared across personas and
reused across begins (runtime.test.mjs). The demo-off401 case is covered by the
demo status test. Current independent reviews/CI remain merge gates.

The separate backend audit83 COMMENT5561269408 still holds demo restart after poll
and migration007 legacy-delivery visibility. Those are Robert/main scope; neither
is repaired or qualified by this PR59 change.

Expected command revision and incident read time cannot be invented against
PR74/27e4f94: its strict command body accepts only type, and incident GET has
createdAt/resolvedAt but no readAt. Both contract gaps were sent to the backend
coordinator. New requirements need an actual published backend schema before binding.
