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

At this base there are no list-trucks, list-contacts, invitation/draft discovery or
trip-list routes. Q41 owns the new read contract; only its actual published routes
will be added. The client cannot invent a contact UUID from a phone number. Audio
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

Q47 independently reviews the frozen client candidate. Q41 read APIs, Q49 UI wiring,
a real configured identity flow, trusted browser proxy/CORS, backend integration and
physical/human/provider evidence remain separate dependencies. Existing product gates
remain open; synthetic passing tests do not establish field safety or channel support.
