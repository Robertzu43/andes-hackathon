# Independent client contract oracle

Reviewer lane 47 owns `tests/client-contract-review/`. The source contract is
Robert's `codex/aws-durable-backend` at
`ebc8fb1d36f441ef012ca585201cefabf61383d6`, specifically
[`docs/contracts/runtime.md`](../contracts/runtime.md). Phone boundary PR52 is
`b34ca56a79515104d7412d46f0e20d7045a5ba8e`; monitoring boundary PR53 is
`e9df5cbfd5c2cfbb19698d46bb957b8561920e66`. Record replacement SHAs before adapting
these tests. Fixtures are fabricated and contain no production identities or evidence.

Run with a backend-supported Node 24–26 (exercised with Node 26.3.0):

```sh
node --test tests/client-contract-review/*.test.mjs
```

No package install, server, database, provider or browser is required for this
fixture/transport self-check. The injected fetch accepts only the reserved
`https://andes.synthetic.invalid` origin and never forwards a request. It can
return exact contract bodies, HTTP errors, malformed JSON, a lost response, or a
held response that deliberately ignores cancellation. The latter tests session
generation checks rather than assuming abort prevents a late server response.
Unscripted retries, unexpected routes/methods and wrong bodies fail the transport.
The clone-isolated memory store persists across a test driver's recreation;
it is not a substitute for real IndexedDB reload, quota or browser proof.

## Acceptance boundaries

| Axis | Required client observation | Source/owner |
| --- | --- | --- |
| Ambiguous writes | A network loss after POST does not prove refusal or success. No blind retry or new-key replay. An explicit safe replay preserves the original key and exact content. | Runtime idempotency, lane45 |
| HTTP errors | 401, 403, 404, 409, 422 and transport/protocol failures retain distinct meaning. An error body does not leak headers/tokens, raw provider data or other users' cached facts. | Runtime errors/auth, lane45 |
| Session isolation | Signing out retires pending work and cached sensitive data. A late response from user A cannot become user B's result/cache; authentication is supplied explicitly. | Runtime identity and build brief, lane45 |
| Source time | Upload and read time never replace `capturedAt`; stale samples stay stale. A recent upload response is only the accepted count, not delivery or monitoring. | Runtime locations, PR52/53 |
| Buffer/restart | Finite capacity has explicit loss counts; persisted upload intent retains the same batch/key through ambiguous response and restart. Queues remain scoped to user/trip. | Build brief, lane42 |
| Revocation/stop | A stopped or revoked scope cannot start new uploads or silently reuse another identity. Prior network authorization may already have happened; abort is not proof of server cancellation. | Runtime consent, lane42/45 |
| Claims | Unknown, phone observations, attributed reports, server receipts, acknowledgement and action stay separate. No fabricated route, source time, delivery or safety state. | Runtime, PR52/53 |

The catalog intentionally includes only routes in the pinned runtime contract.
It does not guess future list/discovery routes from lane41. Region, language and
time zone remain explicit; synthetic examples include Brazilian Portuguese.

## Candidate review procedure

Capture an immutable author SHA, archive it into reviewer scratch, read its API
and source, and bind the reviewer probes to its documented injection interface.
Until that interface and frozen candidate exist, passing fixture self-checks
is **not** an author pass. Preserve failing probes unchanged across a fix; publish
actual path/line/reproduction findings only after executing the frozen source.

Lane46 owns real PostgreSQL/signed-identity API and process-restart proof. Align
the above semantics with that suite; a scripted response does not prove SQL
transactions, idempotency persistence, consent enforcement or provider delivery.
Subsequent candidate probes and local reload/offline browser proof belong in this
same reviewer lane once the authors' interfaces and frontend foundation exist.
Physical-device, human, provider and product evidence gates remain open.

## API driver probes

`api-probes.mjs` contains 29 executable cases: the 16 cataloged operations, seven
HTTP errors, ambiguous explicit replay, malformed write response, cancellation
after a write starts, revoked snapshot access, signout cleanup and a late response
crossing an account switch. Its self-tests accept a small synthetic control and
reject seven planted defects, including blind retry and stale-session disclosure.
Those self-tests are sensitivity evidence for the oracle, not an author verdict.

A reviewer-owned adapter exports `createApiDriver({baseUrl, fetchImpl, store})` and
returns `setSession({userId, token})`, `clearSession()`, `call(request)` and optional
`dispose()`. `call` receives `{method,path,body?,idempotencyKey?,signal?}` for a
cataloged operation and projects the candidate's result into the raw contract
body. This is a test-driver seam, not a proposed application interface or API.
Bind it to the frozen author's documented exports after reading the source.

The driver projects existing candidate errors to `{kind,status?,code?,ambiguous?}`:
`http` retains the actual status/code; `network`, `protocol` and `aborted` identify
transport/response failures; `session` is a local retired/signed-out session error.
It must not implement missing retry, privacy or ambiguity handling to make the
candidate pass. Unsupported behavior is a finding or an explicit integration gap,
not logic to hide inside the adapter. Only fabricated session tokens are allowed.

```sh
node tests/client-contract-review/run.mjs \
  --driver /absolute/reviewer/candidate-driver.mjs \
  --candidate AUTHOR_40_CHARACTER_FROZEN_SHA
```

The runner exits 0 only when all selected API assertions hold, 1 on an assertion
or bounded probe failure, and 2 for a missing/invalid driver or SHA. Missing
candidate code never produces a skipped or passing review. The SHA is an explicit
claim: the runner does not attest module identity or archive provenance. Verify
that separately and publish the exact binding, commands and limitations with a
review. Reports omit candidate exception text to avoid reflecting sensitive data.

### Reviewed API candidate

`drivers/api-a20060b.mjs` binds the actual public `createApiClient`/`MemorySession`
exports at `a20060b5b3a61e1d210febe77ccc62069afed364` to these probes. It only
dispatches the reviewed method and projects the candidate's existing error kind,
status, code and `outcome`; it adds no privacy, retry or session behavior. It does
not inject a storage implementation because this candidate has no storage/cache.
The store assertion therefore covers only the supplied seam; source inspection
and the late-response/signout cases establish this module's memory-only boundary,
not cleanup of a future UI or arbitrary browser storage.

```sh
git archive a20060b5b3a61e1d210febe77ccc62069afed364 | tar -x -C /ABS/EMPTY/ARCHIVE
ANDES_REVIEW_API_ROOT=/ABS/EMPTY/ARCHIVE node tests/client-contract-review/run.mjs \
  --driver tests/client-contract-review/drivers/api-a20060b.mjs \
  --candidate a20060b5b3a61e1d210febe77ccc62069afed364
```

Independent disposition: **ACCEPT for the reviewed client module** at that SHA.
Node 26.3.0: author suite 47 passed, reviewer probes 29 passed, oracle self-checks
35 passed; TypeScript 5.9.3 strict/negative checks passed with an existing read-only
compiler. No backend files were changed or dependencies installed. Actual backend
identity/SQL, browser auth/CORS, UI cache cleanup and device/provider behavior remain
unproved. New lane41 read routes or a later candidate need a separate delta review.

Latest API delta review: **ACCEPT** at
`78efad0a207e98cc44336a03ba6af9fc0c1d2901`. The four-file delta canonicalizes UUID
path parameters and projects only the four required credential fields. The same
29 probes pass through `drivers/api-78efad0.mjs`; 48 author tests and both
NodeNext/ESNext-Bundler strict TypeScript configurations pass. Additionally:

```sh
ANDES_REVIEW_API_ROOT=/ABS/78EFAD0/ARCHIVE \
  node tests/client-contract-review/api-delta.probes.mjs
```

The two focused controls check both nested path UUIDs share a lowercase replay
scope and that credential injection never reads an unrelated getter. Earlier
accepted evidence remains pinned to its original SHA rather than silently moved.

## Durable observation queue oracle

`queue-probes.mjs` defines ten scenarios before a lane42 candidate is supplied:
source-time preservation, finite capacity/loss counts, restart, ambiguous upload
across restart, wrong-trip acknowledgement, scope switch, stop/revocation, signout
including late completion, source-age retention, and unavailable persistent storage.
`queue-probes.test.mjs` checks each assertion with separate positive/fault traces,
plus missing-data and hung-collector controls. These traces are fabricated, not an
implementation of a queue or proof that lane42 passes.

`queueInputs()` supplies two explicit user/trip/session scopes, old source samples,
capacity 3 and an explicit 24h engineering retention configuration. Its neutral
`sourceAtMs`/event fields are reviewer notation; a collector must map them to the
candidate's documented event/storage seam without inventing source timestamps or
freezing a shared event contract. `wireSample()` defines only the already accepted
backend upload fields. A source's upload/read time cannot change its captured time.

A reviewer-bound `collectQueueTrace({scenario, inputs})` executes the named actions
against archived candidate code and returns observations in the checked shape.
See the assertions for exact fields: upload requests include actual user/trip,
path, idempotency key and body; `pending` records project original event IDs/source
facts; `intent` projects persisted key/body/scope; `persistedEntries` comes from the
actual injected store after signout. The collector must observe real public state
and transport/store calls, never synthesize expected outcomes or implement missing
queue behavior. Review its source alongside the frozen candidate.

Ambiguous reconciliation accepts either an explicit same-key/same-body replay or
a visible unresolved hold retaining the original batch. It never requires an
automatic resend. A storage failure may expose a memory-only fallback, but cannot
claim durability. Stop/revocation prevents new uploads; it does not claim to undo
an already sent request. A signout probe releases old completion before checking
that prior-user data has not returned.

```sh
node tests/client-contract-review/run-queue.mjs \
  --collector /ABS/REVIEWER/frozen-queue-collector.mjs \
  --candidate AUTHOR_40_CHARACTER_FROZEN_SHA
```

Missing collector/candidate exits 2, assertion/collection failure exits 1, all
assertions holding exits 0. Each collection is bounded. Candidate/trace provenance
must still be verified independently. There is **no lane42 acceptance yet**.
Real IndexedDB reload/offline tests wait for its frozen exports and the local
browser foundation; lane46's real backend/auth/process tests remain separate.

## Actual client-to-backend bridge

`api-backend.probes.mjs` connects the frozen client **78efad0** to actual backend
HTTP/SQL using lane46's frozen **df05aeb** runtime helper and its owned PostgreSQL
cluster. It does not implement a duplicate backend. Backend source remains
**ebc8fb1**; the helper archive must already have dependencies and built output.
Archive/verify both exact candidates before running: the script records those
source claims but does not authenticate arbitrary supplied directories.

```sh
env -u APP_INTEGRATION_ADMIN_URL \
  APP_INTEGRATION_PG_BIN=/ABS/POSTGRES/BIN APP_INTEGRATION_PG_PORT=56447 \
  ANDES_REVIEW_API_ROOT=/ABS/78EFAD0/ARCHIVE \
  ANDES_REVIEW_RUNTIME_ROOT=/ABS/DF05AEB/BUILT/ARCHIVE \
  ANDES_REVIEW_RECEIPT_PATH=/tmp/q47-client-backend.receipt.json \
  node tests/client-contract-review/api-backend.probes.mjs
```

The helper creates/drops its own database and cluster; it rejects an inherited
admin-service URL. The API listens on an OS-assigned loopback port. Auth uses real
RS256 verification against an explicitly injected synthetic public key, not remote
OIDC or a login bypass. JWTs/headers/passwords are never written to the receipt.
Channel support defaults empty; no worker, provider, AWS service or send is enabled.
Cleanup closes API/context pools and removes only this run's owned resources.

Executed with Node 26.3.0 and PostgreSQL 16.14: **37 actual HTTP exchanges and all
12 scenarios passed**. These cover explicit confirm/idempotent replay, stale and
unavailable snapshots, an older upload not replacing the latest source fix,
cross-user rejection, reports, SOS, acknowledgement/action, owner resolution and
arrival preserving SOS. Revocation uses a separate still-active trip to isolate
permission loss from map closure. Local signout makes no subsequent HTTP request.

The resulting sanitized synthetic-run receipt is committed at
[`client-contract-reviews/bridge-78efad0.receipt.json`](client-contract-reviews/bridge-78efad0.receipt.json).
Lane52 PR60 **5f43ebb** checker returned `backend-receipt-checks-pass` for all 12
cases and `wholeAppAccepted: false`. All identities and coordinates are synthetic.
This records actual local code execution, not participant/device/provider evidence.

Separately, the complete lane46 **df05aeb** runner passed typecheck/build and **61
tests** on this lane's owned cluster/port. Its explicit `check-ci-seam.mjs` mode was
not run. Neither run establishes browser CORS, frontend state/cache cleanup,
production remote JWT/JWKS, SQS, PostgreSQL failover or physical-device behavior.

## Driver controller review

PR63 frozen `c256e75a1b58168925a8e9f760c3759ee33bfa0a` is a separate nonvisual
controller. `driver.probes.mjs` uses its public export and independent synthetic
responses; it does not import author test expectations or implement the controller.

```sh
ANDES_REVIEW_DRIVER_ROOT=/ABS/C256E75/ARCHIVE \
  node tests/client-contract-review/driver.probes.mjs
```

Current result: **FIX**, six independent probes pass and one fails. After opening
trip A and reading its location/active incident, the same instance accepts a new
draft/confirmation for trip B without clearing A's cached facts. `requestHelp()`
returns A's incident and makes no SOS request for B. The one-journey restriction
in `openTrip` is bypassed by draft/confirmation. Reject that second journey or
explicitly retire all previous facts/work before any supported switch. The probe
accepts a blocked transition; it never requires inventing a new controller flow.

Author unit tests 26/26 and strict TypeScript consumer checks pass on Node26.3.0 /
TypeScript5.9.3. That does not override the independently reproduced scope failure.
Preserve this probe unchanged for the corrected frozen head. The companion
`run-driver-persisted.mjs` reuses lane46's owned cluster and built runtime for the
four declared persisted tests, with no shared database or implementation edit.
Those four persisted tests were independently executed against the frozen source:
**4 passed, 0 failed**, PostgreSQL16.14 on this lane's owned cluster/port56447.
The passing existing journeys do not exercise the newly reproduced overlap case.
