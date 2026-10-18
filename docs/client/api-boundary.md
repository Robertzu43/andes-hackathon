# Typed client API and session boundary

Lane45 owns `web/src/lib/api/**`, `web/tests/api/**` and this document. The library
has no runtime dependencies, framework imports, provider SDK, storage or root
package changes. Import its public API and wire types from `web/src/lib/api/index.ts`.

## Source contracts and dependencies

The original route base is `ebc8fb1d36f441ef012ca585201cefabf61383d6`. Current review
also checks PR74 at `27e4f94b5962e88735fdb8fc3fea8cc3e842baa4` and PR65 at
`de9e455b6f7631aa80addfa19b1f38def68bb523`, including their actual route handlers and
strict schemas. These unmerged routes are explicit dependencies, not capabilities
assumed to exist on the old base. Backend reconciliation PR83 must land before the
base PR59 can be retargeted to main; the gatekeeper owns merging. PR81 remains a child.

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
| `commandTrip` | POST `/v1/trips/:id/commands`; arrived/cancel/pause/resume/checkin_ok/rest_report |
| `uploadLocations` | POST `/v1/trips/:id/locations`; caller supplies captured observations |
| `getSnapshot` | GET `/v1/trips/:id/snapshot`; preserve capture/receive/read time, age and freshness |
| `revokeTripContact` | POST `/v1/trips/:tripId/contacts/:grantId/revoke`; independent from standing consent |
| `reportSos` | POST `/v1/trips/:id/sos`; attributed request and active episode ID, group unavailable |
| `getIncident` | GET `/v1/incidents/:id`; current-consent read independent of trip/map closure |
| `acknowledgeIncident`, `reportAction` | POST incident `/acknowledgements` or `/actions`; attributed response, not provider delivery |
| `resolveIncident` | POST incident `/resolve`; explicit owner resolution, independent of arrival |

Status, sharing and anonymous demo acquisition are already implemented in the
separate PR81 child. Its pending shared-world/persona repairs must be completed on
the corrected base before adoption. No duplicate or invented route is added here.
`readStatus` is accepted by the driver descriptor type, but this base returns
`not_sent/unsupported_operation` until PR81 supplies its actual HTTP binding.

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
UTC before a server can commit and echo them. An unzoned local datetime is rejected
as invalid_input/not_sent; the feature must obtain the intended zone. The caller's
object is not mutated. No arrival, locale, country, truck, role or time-zone default
is invented by the client.

## Source facts and bounded reads

Decoders project fixed known fields. Malformed JSON/content types, missing required
facts and contradictory location states fail closed. A snapshot's age must equal
readAt minus capturedAt; capture and receive times cannot be after readAt. Freshness
must match the backend's120000ms engineering boundary. Validation uses source times,
never the current browser clock, and does not qualify that bound for field safety.

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

PR65 phone privacy is a separate pending repair. The currently inspected source
still returns profile/contact phone fields; this pin is not permission to expose
live phone numbers in the demo. Consume the corrected backend contract before final
composition. Trip summaries exclude raw draft text and coordinates.

## Journey and foundation integration

`createContactApi(api)` maps the published feature's getTripSnapshot/reportIncidentAction
aliases and preserves original keys, signals and ApiError objects. Other wrappers
remain to satisfy the actual typed feature port. No local permission or retry is added.

`bindJourneySession(session,api,setActor)` clears synchronously, activates only from
typed /v1/me and retires old activations. The callback must clear protected state
when given null. Disposal clears once and suppresses queued session notifications,
including disposal by an earlier listener during the same dispatch. The independently
reviewed75bdffa fix is preserved in this base. Same-account refresh does not call the
reset callback; account replacement, clear, current401 and expiry do.

`createDriverTransport(api)` preserves ok/not_sent/rejected/unknown and original
intent ownership. Its current feature compatibility pin is
`127c82ad109702a329e5bec008708b0fbc67487b`. An explicit SOS is not swallowed by a cached
incident; cross-trip edits and old incident reuse remain prohibited by the feature.
The SOS regression also retains the original driver80e9d45 source to isolate the
shared binding's original refresh failure.

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
```

The declared immutable Git objects must be fetched. Tests use Node built-ins,
synthetic HTTP and actual extracted feature sources; missing dependencies fail
rather than silently skip. Temporary sources are removed afterward. Current local
results are115 native/view checks and19 controller/foundation checks, plus both
strict TypeScript modes. They do not establish browser, backend isolation, physical
iOS, provider delivery or complete-app acceptance.

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

PR81 review5560922593's arrival-echo failure is repaired in the shared base. Its
remaining world reuse, role switching, status freshness and demo-off401 controls
belong to the child after this base. Backend reconciliation83 and current independent
reviews/CI remain merge gates. No acceptance is inherited from old7e241c3 or81/75bdffa.

Expected command revision and incident read time cannot be invented against
PR74/27e4f94: its strict command body accepts only type, and incident GET has
createdAt/resolvedAt but no readAt. Both contract gaps were sent to the backend
coordinator. New requirements need an actual published backend schema before binding.
