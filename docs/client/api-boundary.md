# Typed client API and session boundary

Lane45 owns `web/src/lib/api/**`, `web/tests/api/**` and this document. The base is
Robert's refreshed `origin/codex/aws-durable-backend` at
`ebc8fb1d36f441ef012ca585201cefabf61383d6`. Sources are
[runtime.md](../contracts/runtime.md), `src/api/{app,schemas,mutations}.ts`, `src/auth.ts`,
`src/{trips,contacts,location,incidents}/routes.ts` and `db/migrations/001-core.sql`.
The library has no runtime dependencies, framework imports, server SDKs or root
package/config changes. Node24 native TypeScript stripping runs the tests.

## Consumer boundary

Import `createApiClient`, `MemorySession`, `createIdempotencyKey`, `ApiError` and wire
types from `web/src/lib/api/index.ts`. The client accepts an explicit trusted API or
proxy base URL, a memory session, an optional fetch implementation and an optional
positive integer timeout. HTTPS is required except on literal loopback development
hosts. Userinfo, query parameters and fragments in the base URL are rejected. A
configured path prefix such as `/api/` is preserved. Never derive this URL from a
recipient link, user-entered trip text or provider payload.

```ts
import { createApiClient, MemorySession, createIdempotencyKey } from './api/index.ts';

const session = new MemorySession();
const api = createApiClient({ baseUrl: trustedRuntimeConfig.apiBaseUrl, session });
// A separately configured trusted OIDC integration obtains these credentials.
session.setCredentials(await trustedIdentityIntegration.getSessionCredentials());
const identity = await api.getIdentity(); // backend UUID, distinct from OIDC subject
const intent = { idempotencyKey: createIdempotencyKey() }; // once per explicit intent
const draft = await api.createDraft({ text: driverEnteredText }, intent);
// Show/edit the returned draft, then obtain a separate explicit user confirmation.
// Only confirmTrip(..., { confirmed: true, contactGrantIds, fields }, newIntent)
// activates it. No country, language, truck or time-zone defaults are invented.
```

The names beginning `trusted...` describe caller-owned integrations; they are not
implemented login/config services or sample credentials. No login, refresh, logout,
cookie session or token-exchange endpoint exists at this backend revision. The
backend independently verifies signed OIDC tokens, issuer/audience and claims. This
library does not validate a JWT, infer phone verification, or grant ownership from a
body field. `setCredentials` is an injection boundary for an identity integration,
not a production sign-in flow. Real browser authentication remains a dependency.

Credentials live only in memory. `snapshot()` exposes identity/status/expiry but no
token. Clear on local sign-out/unmount; invoke the configured identity provider's
own logout separately if needed. Do not persist `capture()` leases or credentials
in browser storage, URLs, telemetry or error reports. Token replacement, account
change and clear abort older requests. The client rejects stale responses even if
an injected transport ignores abort. A late401 from an old session cannot clear a
new session. Expiration blocks new requests and bounds in-flight requests; there is
no silent refresh or cross-account replay. Session state is checked again before a
response can reach a caller. Consumers must also clear their own per-account views.

Fetch uses `credentials: omit`, `cache: no-store`, `redirect: error` and
`referrerPolicy: no-referrer`. Backend responses declare no-store. There is no client
response cache, cookie/CSRF transport or refresh-token persistence. The backend has
no CORS policy at this revision; the browser app needs a trusted same-origin proxy
or separately implemented/reviewed server CORS. A native fetch test does not prove
browser CORS or a real provider login. No security token belongs in frontend build
configuration. A browser base URL is public configuration, not a credential.

## Operations from the actual routes

| Client operation | HTTP contract |
|---|---|
| `getIdentity` | GET `/v1/me` → server identity UUID |
| `getProfile`, `getBootstrap` | GET `/v1/profile`, `/v1/bootstrap`; additive owner read contract PR65/748d30c |
| `listTrucks`, `listContacts`, `listTrips` | GET `/v1/trucks`, `/v1/contacts`, `/v1/trips`; bounded first-page reads, not discovery for another identity |
| `createTruck` | POST `/v1/trucks` with `{label}` |
| `inviteContact` | POST `/v1/contacts` with existing `contactId`, international `phone`, explicit map/incident scopes |
| `acceptContact`, `revokeContact` | POST `/v1/contacts/:id/accept` or `/revoke`; acceptance cannot broaden requested scope |
| `createDraft` | POST `/v1/trip-drafts` with text and optional corrected fields; returned draft/missing fields stay explicit |
| `confirmTrip` | POST `/v1/trip-drafts/:id/confirm`; literal `confirmed:true`, selected grant IDs and optional corrections |
| `getTrip` | GET `/v1/trips/:id`; SQL wire names, including `time_zone`, are preserved |
| `commandTrip` | POST `/v1/trips/:id/commands`; arrived/cancel/pause/resume/checkin_ok/rest_report only |
| `uploadLocations` | POST `/v1/trips/:id/locations`; caller supplies capturedAt and qualified observations, no fabricated samples |
| `getSnapshot` | GET `/v1/trips/:id/snapshot`; captured/received/read times, age and unavailable/stale/fresh remain distinct |
| `revokeTripContact` | POST `/v1/trips/:id/contacts/:grantId/revoke`; independent from standing revoke |
| `reportSos` | POST `/v1/trips/:id/sos`; an attributed request with active episode ID, group unavailable |
| `getIncident` | GET `/v1/incidents/:id`; minimal current-consent incident read, independent of trip/map closure |
| `acknowledgeIncident`, `reportAction` | POST `/v1/incidents/:id/acknowledgements` or `/actions`; attributed acknowledgement/action stay distinct |
| `resolveIncident` | POST `/v1/incidents/:id/resolve`; driver/owner resolution is explicit and independent of trip closure |

Responses are checked at runtime and projected to documented fields. Missing/invalid
required fields, unexpected content types, malformed JSON and impossible null-location
freshness combinations fail as `invalid_response`. No response means unknown, not
successful delivery, wellbeing or resolved SOS. Fresh/stale engineering bounds are
server facts, not validated safety cadence. Snapshot age/freshness is preserved rather
than recomputed from the browser clock. Raw text is untrusted content for the future
UI to escape; it is never rendered by this library.

The original backend base lacked lists; Q41's published additive reads are now
implemented below. Recipient invitation/draft discovery and incident action history
are still absent from that contract. The client cannot invent a contact UUID from a phone number. Audio
transcription is unsupported and has no client operation. Q49 owns the app foundation;
framework-independent exports are available for its adapter without changing its files.

## Writes, cancellation and errors

Every write requires explicit `WriteOptions.idempotencyKey` (1–128 visible ASCII
characters) and accepts `signal`. Generate one key for one explicit intent and keep
its exact payload/key until the result is reconciled. The payload is serialized before
asynchronous work. The server scopes keys by actor, method, route and parameters;
changed payload with a reused key conflicts. UUID path parameters are canonicalised
to lowercase so case aliases preserve the same backend idempotency scope.
The library makes exactly one HTTP
attempt and never retries, refreshes, queues offline work or generates a replacement
key. Explicit same-key reconciliation remains a caller decision against current
server state; automatic retry on a timeout/network error is prohibited. Losing a
response does not authorise a new SOS episode or new mutation key.

`ApiError` has a fixed public message, `kind`, numeric `status` when available, an
allowlisted backend `code`, operation name and `outcome`. It carries no raw response,
token, URL, freeform backend error or transport cause. The UI can localise the fixed
kind/code into Spanish and Brazilian Portuguese. Backend401/403/404/409/422 remain
distinct; 400 is invalid input and 5xx is a server failure.401 invalidates only the
session that issued that request. New credentials require the trusted integration.

For writes, `outcome: not_sent` means local validation/cancellation prevented fetch;
`rejected` describes this request's4xx response, not an earlier idempotent attempt;
`unknown` means fetch started and the result cannot be confirmed (network, timeout,
in-flight cancellation, session change,5xx or bad success response). Reads use
`not_applicable` for transport outcomes. No blind replay follows any of them.
Cancellation is local and cannot undo a committed transaction. The default10s timeout
is an engineering resource bound, not an incident deadline or server cancellation.

## Verification and open dependencies

```sh
node --test web/tests/api/*.test.mjs
node node_modules/typescript/bin/tsc -p web/tests/api/tsconfig.json
```

The test suite uses only Node built-ins and synthetic inputs. It checks each sourced
route/command and wire body, bearer/cookie/cache policy, explicit draft confirmation,
idempotency/no replay, malformed responses, redacted error distinctions, session expiry
and account races, cancellation, timeout and an actual native-fetch loopback server
including redirect refusal. The loopback server is a synthetic contract fixture; it
does not prove real backend/OIDC/PostgreSQL/provider or browser integration. Compile-only
tests also reject missing idempotency keys, false confirmation, audio and invented
commands. `contracts.types.ts` is never executed.

Development used Node24.17.0 and the already installed TypeScript5.9.3 compiler in the
same repository's Q46 worktree; no dependency was installed or added to this lane.
The compiler's absolute path is environment-specific; the normal command above uses
the backend's existing pinned dev dependency when available. The root backend suite
requires its own disposable PostgreSQL/credentials and is not a client-only test.

Q47 independently reviews the frozen client candidate. Further Q41 status/time APIs, Q49 UI wiring,
a real configured identity flow, trusted browser proxy/CORS, backend integration and
physical/human/provider evidence remain separate dependencies. Existing product gates
remain open; synthetic passing tests do not establish field safety or channel support.

## Published controller integration

`createContactApi(api)` supplies the structural `ContactApi` from PR62 at
`b95bdbaa3f106f33d30b3aa8b0127ca3b691ee0e`. It maps `getTripSnapshot` to `getSnapshot`
and `reportIncidentAction(id,{action},options)` to `reportAction(id,action,options)`.
Other contact operations forward their exact arguments. The facade introduces no
routes, keys, retries, error rewriting, role authority or local data cache.

`bindJourneySession(session, api, setActor)` connects a caller-owned controller to
the shared session and `/v1/me`. It first clears its controller, then `activate()`
reads the backend identity and sets that UUID only if the session and activation
are still current. `setActor(null)` must synchronously clear protected state. The
binding does not interpret OIDC subjects or change tokens to match a local role.

For the published contact controller, the host supplies a fixed-view callback:

```ts
const journey = createContactJourney(createContactApi(api));
const binding = bindJourneySession(session, api, actorId => {
  journey.setSession(actorId ? { actorId, view: 'contact' } : null);
});
await binding.activate();
// On unmount: binding.dispose(). Local sign-out: session.clear().
```

`createContactJourney` belongs to the feature lane and is not re-exported or copied
into this library. Driver controllers can bind with `id => driver.setSession(id)`;
`createDriverTransport(api)` now supplies the driver descriptor/result adapter
delegated by Q50. It maps all eight published operations, preserves original keys
and bodies, and returns `ok`/`rejected`/`unknown` without replay. Errors lacking a
confirmed terminal HTTP rejection remain unknown. All controllers
using the same session must register their own binding. Local view changes require
disposing/rebinding the old context; they never grant server permission.

`MemorySession.subscribe(listener)` emits a token-free invalidation signal on
credential replacement, clear,401 and expiry. While observed, a bounded timer checks
expiry even without another HTTP request; unsubscribing retires it when no listeners
remain. A throwing view listener cannot prevent other views from clearing. Timer
execution still depends on browser scheduling; suspended/killed contexts have no
guaranteed cleanup deadline. New requests and responses independently recheck expiry.

The separate integration command requires the two published source objects to have
been fetched. It reads only their explicitly pinned feature files into a temporary
directory and removes that directory afterwards; it never edits those lanes or adds
their source to this branch. No missing dependency is silently skipped.

```sh
git fetch origin sebasbimbi/feat/andes-trusted-contact-flow sebasbimbi/feat/andes-driver-trip-flow
ANDES_TYPESCRIPT_TSC=/absolute/path/to/existing/typescript/bin/tsc \
  node --test web/tests/api/contacts.integration.mjs
```

This probes the actual PR62 contact implementation plus PR63 driver controller at
`80e9d45f9a234de54b1017e856e8349c097b8760`, the real typed-client exports and a strict
structural `ContactApi` compile check. HTTP replies and tokens are synthetic fixtures;
these tests do not replace Q44/Q46's signed-JWT/PostgreSQL/native-HTTP integration or
actual browser rendering. The standard client suite remains runnable without Git
feature objects or a compiler.

**Resolved external finding originally at PR62/a8466d5:** network loss left a revoke uncertain, but
a same-key retry's409 changes the controller operation to rejected, dropping the
original ambiguity. A direct frozen-source reproduction was sent to Q51 and Brain.
The facade preserves both original ApiErrors and does not hide the HTTP status to
work around feature state. Q51 repaired the controller at `b95bdbaa3f106f33d30b3aa8b0127ca3b691ee0e`.
Integration tests now confirm that retry400/403/404/409/422 retain the uncertain
revoke and block protected reads, first-attempt409 remains rejected, and retry401
clears the shared session and invalidates the old context without replay. With a
shared-session binding, that cleared context returns `superseded`, which does not
mean its server write was cancelled. Q43's wider privacy review remains separate.

The actual published driver controller is also exercised through the typed adapter:
create truck, draft, explicit confirmation, trip/snapshot/incident reads, command,
lost SOS response and rejected same-key retry. Synthetic selection evidence is
clearly test-only; catalog evidence normalisation and real backend/browser proof remain open.

**Driver finding and candidate repair:** PR63/c256e75 allowed new draft work while
bound to active trip A, with stale incident/location state crossing into another
trip. The owner published a narrow repair at
`80e9d45f9a234de54b1017e856e8349c097b8760`; this integration now pins that candidate.
Two new actual-controller/typed-transport regressions fail against the old c256e75
source and pass against the repair. They check that a bound context blocks form,
draft, confirmation and other-trip intents without HTTP, cached help stays on A,
and a fresh session-bound controller clears old incident/location before sending
help for B. Pending, unknown and reconciled drafts also block other-trip opening;
explicit unknown reconciliation keeps its exact key/body. HTTP remains synthetic.
These are scoped adapter regressions, not independent acceptance of the driver
repair or UI. Q47's exact-revision driver re-review remains a separate requirement.

## Published owner reads

Read API source: PR65 at `748d30c6e6c595fd1a2c2c648a045750de3dd9c8`, including
[the frozen wire contract](https://github.com/Bimbi-Dev/andes-hackathon/blob/748d30c6e6c595fd1a2c2c648a045750de3dd9c8/docs/contracts/client-read.md)
and `src/client-read/routes.ts`. The client adds those five actual GET operations
without importing or changing the backend implementation. Use types `Profile`,
`TruckList`, `ContactList`, `TripList`, `Bootstrap` and their entry types.

Every read uses the current bearer; there is no owner/body/query selector. Profile
retains nullable phone and its verified-claim flag. Contact rows preserve requested
versus historical accepted scopes, pending/accepted/revoked status, acceptance and
revocation timestamps and nullable revoker attribution. A revoked row may still
contain historically accepted scopes; it grants no current read/dispatch authority.
Trip summaries preserve regional fields, state, map/check-in flags, source timestamps
and selected grant IDs, while excluding raw draft text and coordinates. The runtime
decoder rejects malformed or contradictory required facts and projects only known fields.

Lists are bounded first pages: 100 trucks, 100 standing contacts, 50 active trips and
20 recent trips. Exact limits and every `hasMore` flag remain visible. There is no
cursor, silent auto-pagination or claim of complete catalog coverage when truncated.
Read failures remain errors, never fabricated empty lists. `/v1/contacts` is the
driver's management list; it does not discover a contact's incoming invitations or
authorised trips. Recipient discovery, `/status`, response/action history and other
unpublished routes remain unavailable.

These responses contain **no server readAt**. The client adds no browser timestamp
and cannot yet manufacture the driver's `SelectionEvidence.readAt` from this wire
contract. The missing source-time/normalisation seam was reported to Q41 and Brain.
The backend must publish that meaning before a catalog adapter can claim server
read-time provenance. The client also makes no stronger transaction-snapshot guarantee
than the reviewed backend contract/implementation. Q44/Q46 must test these additions
against their actual signed-JWT/PostgreSQL integration revision; mock read fixtures
do not establish backend isolation or browser reload behaviour.

## Foundation session gateway

`createSessionGateway({session,api,mode,acquire?,release?})` implements Q49's published
headless UI seam at `3283fe675ebeee04bb2be8a62f42ab5c475b4b0e` (PR56):
`getSnapshot`, `subscribe`, optional `begin` and `end`. Its stable,
immutable snapshots contain only `state` and explicit `mode: external|demo`. The
states are unconfigured/signed-out/connecting/authenticated/expired/error. No
credential, backend UUID, provider exception or raw error is exposed in a snapshot.
The adapter imports no React, foundation, provider SDK or browser storage.

Without an explicit trusted acquisition callback the gateway is unconfigured and
has no begin/end actions. It supplies no demo identity or production-login fallback.
`acquire({signal})` must come from the separately configured trusted identity
integration or an explicitly labelled synthetic test harness. Mode is a label and
does not mint or validate tokens. Acquired credentials are stored only in the shared
MemorySession; the gateway must also await the typed `/v1/me` response before it
publishes authenticated. A provider success alone cannot do so.

Concurrent begin calls share one pending verification, including calls made from
subscribers. Clear/end, account changes and disposal retire old acquisition and
verification replies. A cancelled flow cannot later install credentials. Provider
exceptions become only a fixed error state, with explicit retry possible; no silent
refresh/retry occurs. Expiry changes the observed gateway to expired without another
acquisition. `end()` immediately clears locally and optionally invokes the caller's
trusted logout callback. Local clearing alone does not claim provider-token revocation.
`dispose()` is for application teardown and never invokes external logout.

The gateway verifies session state, not feature loading. Once authenticated, the host
still awaits each `bindJourneySession(...).activate()` before invoking its controller.
Catalogs, protected views, permissions and feature state remain caller-owned. The
separate compile-only integration reads the exact frozen foundation sources from
Git and imports its real public `FoundationRoot`, `FoundationOptions`, `SessionGateway`
and `SessionSnapshot` exports. It checks configured and unconfigured API gateways
in both NodeNext and the foundation's ESNext/Bundler mode, without executing the
generated binding, changing foundation files or installing dependencies:

```sh
git fetch origin sebasbimbi/feat/andes-web-foundation
ANDES_TYPESCRIPT_TSC=/absolute/path/to/existing/typescript/bin/tsc \
ANDES_FOUNDATION_NODE_MODULES=/absolute/path/to/existing/foundation/web/node_modules \
  node --test web/tests/api/foundation.integration.mjs
```

The explicit existing dependency directory is used only for type resolution via
a temporary symlink; the compiler emits nothing and temporary files are removed.
This establishes structural compatibility with the actual foundation entry. It
does not mount React or prove its subscription, login or rendered browser behavior.
PR56's development-only `window.__ANDES_TEST_MOUNT__({session:gateway})` hook is the
published runtime seam for the browser integration owner; production entries have
no test hook. Actual browser rendering and server authorization remain to be tested.
Current tests exercise the real gateway/client code with synthetic provider/HTTP
fixtures; no production sign-in or configured external provider has been validated.
