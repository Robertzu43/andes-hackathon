# Typed client API and session boundary

The library in `web/src/lib/api/` has no runtime dependencies, framework imports, provider SDK or storage. Import its public API and wire types from `web/src/lib/api/index.ts`. Decoders follow [the backend contract](../contracts/runtime.md) and [client reads](../contracts/client-read.md): no response DTO carries a phone value; invitation inputs still require the explicit destination phone.

| Operation | Actual HTTP contract |
| --- | --- |
| `getIdentity` | GET `/v1/me`; verified backend UUID, not an OIDC subject |
| `getProfile`, `getBootstrap` | GET `/v1/profile`, `/v1/bootstrap`; owner-scoped reads |
| `listTrucks`, `listContacts`, `listTrips` | GET the corresponding `/v1` collection; bounded first-page reads |
| `createTruck` | POST `/v1/trucks` with label |
| `inviteContact` | POST `/v1/contacts` with existing contactId, international phone, map/incident scopes and optional family/colleague role |
| `acceptContact`, `revokeContact` | POST `/v1/contacts/:id/accept` or `/revoke`; acceptance cannot broaden requested scope |
| `createDraft` | POST `/v1/trip-drafts`; text and optional corrected fields, including explicit expectedArrivalAt |
| `confirmTrip` | POST `/v1/trip-drafts/:id/confirm`; literal confirmed:true, selected grant IDs and optional corrections |
| `getTrip` | GET `/v1/trips/:id`; preserve SQL wire names and optional arrival/sharing timestamps |
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

Status, sharing and anonymous demo acquisition are described in the status section
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

All five catalog read envelopes require their actual server readAt. Bootstrap has one
root time, not invented timestamps on its profile/list entries. The repaired server
pins a repeatable-read read-only snapshot on telemetry capacity before sampling
its clock. Preserve that value without substituting browser time. API integration
tests cover the actual signed backend and shared SDK; PostgreSQL regressions cover
snapshot consistency and independent read/SOS capacity.

Lists preserve bounds and truncation:100 trucks,100 standing contacts,50 active and
20 recent trips. Revoked grants retain historical accepted scopes without granting
current access. Errors stay errors. Collection404 is unsupported/endpoint_unavailable,
not an empty list or missing individual resource. Recipients list their own invitations and
shared trips through `GET /v1/contact/invitations` and `GET /v1/contact/trips`.

Catalog decoders discard phone properties even from legacy responses. The demo
privacy regression uses a fictional configured live destination and performs no
provider send; it does not qualify live participant or provider behavior.
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
listener during the same dispatch. Same-account refresh does not call the reset callback; account
replacement, clear, current401 and expiry do.

`createDriverTransport(api)` preserves ok/not_sent/rejected/unknown and original
intent ownership. An explicit SOS is not swallowed by a cached incident; cross-trip
edits and old incident reuse remain prohibited by the driver controller. The SOS
regressions run the current controller and cover accepted and committed-but-pending
SOS results without replay across a same-account credential refresh.

Features can inject `decodeDriverResponse(request,data)` and `decodeLocationSnapshot`
through the public entry. These reuse the same wire
decoders as the HTTP client; actor/trip correlation and receipt semantics stay with
the feature. The standalone feature need not import the SDK at runtime.

`createSessionGateway({session,api,mode,acquire?})` implements the real public
foundation seam with immutable stable token-free state/mode snapshots. Initial
injected credentials enter connecting and require actual /v1/me. Without credentials
or acquisition it is unconfigured. Explicit acquisition also awaits verification;
provider success alone cannot authenticate. A verifier401 publishes error; a later
request401 signs out. Reads and late subscriptions check expiry when browser timers
were suspended. End/dispose retire old work. The gateway has no built-in provider or demo identity.

## Status, sharing and demo sessions

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

`web/tests/api/runtime.test.mjs` covers this with synthetic HTTP.

## Tests

```sh
npm --prefix web test   # includes web/tests/api/*.test.mjs
node web/node_modules/typescript/bin/tsc -p web/tests/api/tsconfig.json
node web/node_modules/typescript/bin/tsc -p web/tests/api/tsconfig.json --module ESNext --moduleResolution Bundler
# Against the real backend and a disposable PostgreSQL (after `npm run build` at the root):
TEST_DATABASE_URL=postgresql://USER@localhost:PORT/OWNED_TEST_DB ZAVU_LIVE_SEND=false node --test web/tests/api/shared-sdk.integration.mjs
```

`contracts.types.ts` holds compile-only negative assertions; do not execute it. CI runs the first three in the web job and the SQL-backed shared-SDK test in the backend job.
