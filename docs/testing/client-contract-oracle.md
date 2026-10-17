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

### Owner reads and journey session bindings

`7da6dbbd629eb996a0493f750d20e1845fa8f907` was separately exercised against the
source contract and routes in PR65 `748d30c6e6c595fd1a2c2c648a045750de3dd9c8`.
Five actual owner reads are added without owner selectors or invented timestamps.
The candidate also adds contact/driver facades and session invalidation bindings.

```sh
ANDES_REVIEW_API_ROOT=/ABS/7DA6DBB/ARCHIVE \
  node tests/client-contract-review/run.mjs \
  --driver tests/client-contract-review/drivers/api-7da6dbb.mjs \
  --candidate 7da6dbbd629eb996a0493f750d20e1845fa8f907
ANDES_REVIEW_API_ROOT=/ABS/7DA6DBB/ARCHIVE \
  node tests/client-contract-review/api-read-lifecycle.probes.mjs
```

Node26.3.0 results: author tests **67 passed**; declared integration using actual
contact `b95bdba` and driver `c256e75` source with synthetic HTTP **14 passed**;
strict TypeScript5.9.3 NodeNext and ESNext/Bundler checks passed. Independent baseline
**29**, prior focused controls **2**, and new read/lifecycle/adapter probes **23**
all passed. New cases cover exact wire routes/limits/truncation, retained revoked
history, private-field projection, invalid read schemas, concurrent activation,
account rotation, shared401 clearing, idle expiry and driver error/key semantics.

The integration test's read-only `git show` uses this lane's existing object store
to load its exact pinned feature files into a temporary directory. No feature files
are edited. Results are pinned to this revision; later gateway additions need their
own delta review. The new read routes were **not** executed against actual SQL here.
There is no claim that typed bindings repair the independently held driver finding,
establish contact feature acceptance, or prove the pending frontend/browser seam.

### Current gateway/read candidate

Scoped independent disposition: **ACCEPT for the typed-client module** at
`db7034fc9e1dba035b87368117376e9730d6b830`. Its five-file delta from `7da6dbb`
adds the headless session gateway, exports, tests and documentation. Gateway
snapshots carry only explicit state/mode; trusted acquisition alone cannot publish
authenticated until the actual typed `/v1/me` call succeeds. No implicit provider,
storage, login endpoint, refresh or demo identity is supplied.

```sh
ANDES_REVIEW_API_ROOT=/ABS/DB7034F/ARCHIVE \
  node tests/client-contract-review/api-gateway.probes.mjs
```

Fresh checks on this exact head: **77 author tests, 14 declared actual-controller
fixture integration checks, 29 unchanged baseline probes, 2 prior delta controls,
23 read/lifecycle probes and 8 independent gateway probes all passed**. Both strict
TypeScript5.9.3 NodeNext/ESNext-Bundler configurations passed on Node26.3.0. The eight
new cases exercise inert unconfigured state, held identity verification, old provider
success/failure after replacement, stale401 after new authentication, stale logout
failure, private provider errors without retry, and teardown clearing a bound view
without invoking external logout.

The sanitized combined result is `client-contract-reviews/api-db7034f.probes.json`.
The supplied source directory was manually archived/verified; the runner does not
attest source identity. Actual frozen foundation type compatibility, browser login
and protected view rendering, new read-route SQL/auth isolation and production
provider behavior remain unproved. Source read-time metadata needed by driver
selection evidence is still absent from PR65's contract and is not fabricated.
The independent PR63/PR66 findings are separate from this module acceptance;
their dispositions are recorded below. This does not approve the complete app.

### Foundation type compatibility delta

Scoped independent disposition: **ACCEPT** at
`292d3c4e6ebe6831c3aec5d9db3824e17ee64be7` for the two-file test/documentation
delta from `db7034f`. The API runtime tree is byte-for-byte identical, Git tree
`0ad380efe9f1dd535107e0e896e244a222cc78e3`; the existing runtime acceptance remains
pinned to its reviewed source.

The added compile-only test reads foundation PR56
`3283fe675ebeee04bb2be8a62f42ab5c475b4b0e` from Git, imports the actual public
`FoundationRoot`, `FoundationOptions`, `SessionGateway` and `SessionSnapshot`, and
checks both configured/unconfigured gateways in NodeNext and ESNext/Bundler.
Its generated binding is never executed. Source inspection confirmed the actual
foundation entry and session/useSyncExternalStore boundary rather than relying
on an invented interface. Existing dependencies are resolved through a temporary
symlink, no code is emitted, and the owned temporary directory is removed.

```sh
ANDES_TYPESCRIPT_TSC=/ABS/EXISTING/typescript/bin/tsc \
ANDES_FOUNDATION_NODE_MODULES=/ABS/EXISTING/foundation/web/node_modules \
  node --test web/tests/api/foundation.integration.mjs
```

Independently executed from the frozen archive with Node26.3.0/TypeScript5.9.3:
**3 passed** (parent plus both compiler configurations). The unchanged 77-test
runtime suite was not repeated for this test/documentation-only delta. This closes
the structural compatibility gap for those exact sources, while actual React
mounting, browser subscription/login/rendering, current feature integration and
provider/server authorization remain separate. The test still pins old driver
`c256e75` in its other feature suite; that dependency needs an owned lane45 update
before its evidence can claim corrected driver `80e9d45`. That update was reviewed
separately at the following head.

Follow-up disposition: **ACCEPT** at
`7e241c39a31d4eaba5f8028fd977e06f6ca72d4d` for the current test/documentation
delta. The API runtime tree remains exactly `0ad380efe9f1dd535107e0e896e244a222cc78e3`.
The feature integration now pins corrected driver
`80e9d45f9a234de54b1017e856e8349c097b8760` and adds two meaningful regressions
through the real typed transport/session binding. They check that bound-trip
form/draft/confirm/open operations send nothing, cached help stays on that trip,
a fresh controller cannot reuse its predecessor's incident/location, and pending,
unknown or reconciled drafts cannot be crossed while original retry keys/bodies
remain intact. The complete changed tests/documentation were reviewed.

Fresh independent execution at this exact head on Node26.3.0: **16 feature fixture
integration checks passed**, including the strict structural consumer check, and
**3 foundation compile-only checks passed** in NodeNext/ESNext-Bundler. The 77-test
runtime evidence stays pinned to unchanged `db7034f`; it was not rerun for this
test/documentation delta. HTTP/provider values are synthetic and no React runtime
is executed. These tests now establish the corrected driver/client fixture seam;
the four real signed API/PostgreSQL driver journeys are separately pinned to
`80e9d45` below. Browser/device/provider and whole-app acceptance remain open.

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
must still be verified independently.

### PR66 frozen queue review

`drivers/queue-0b1e7e6.mjs` binds the public queue/uploader/pipeline exports at
`0b1e7e69f9ea5f0b28266554a5361ba7d299bfda` to the unchanged ten scenarios. It
injects clone-isolated stores and synthetic fetch, and projects actual records,
request bodies/keys and counters. Fixture sequence labels are decoded from their
event IDs; source timestamps/coordinates come from actual retained records.
The binding does not create a persisted intent, clear stores on signout, or add
candidate safeguards. No real request leaves the process.

```sh
ANDES_REVIEW_QUEUE_ROOT=/ABS/0B1E7E6/ARCHIVE \
  node tests/client-contract-review/run-queue.mjs \
  --collector tests/client-contract-review/drivers/queue-0b1e7e6.mjs \
  --candidate 0b1e7e69f9ea5f0b28266554a5361ba7d299bfda
ANDES_REVIEW_QUEUE_ROOT=/ABS/0B1E7E6/ARCHIVE \
  node tests/client-contract-review/queue-races.probes.mjs
```

Disposition: **FIX**. Node26.3.0 author suite **40 passed**. The unchanged queue
oracle is **7 passed, 3 failed**: missing persisted ambiguous intent, wrong-trip
receipt acceptance, and an unsupported signout boundary. That final item is an
integration acceptance gap, not an executed signout implementation failure.
The additional seven independently written scheduling/protocol probes produce
**1 passed, 6 failed**, with these four distinct reproduced defects:

1. Hold `getAccessToken()` inside a flush; await `pipeline.stop()` or
   `revokeTrip()`; then release the token. A **new POST starts afterward**, with
   zero requests before retirement and one afterward. This is a new transmission,
   not a claim that an already sent request can be undone.
2. A 200 response naming another trip, or containing malformed JSON, deletes the
   sole retained sample and increments `uploaded`. The reported receipt uses the
   requested trip ID even when the response named another trip.
3. Lose the response to a one-sample upload, enqueue a second capture, and flush.
   The unresolved one-sample key/body becomes a different key/two-sample body.
   Records survive restart, but no batch intent is persisted for reconciliation.
4. Nine network failures with default `maxAttempts: 8` make nine requests and
   leave the record pending, never failed; the network catch skips exhaustion.

Raw sanitized results are in `client-contract-reviews/queue-0b1e7e6.probes.json`
and `queue-0b1e7e6-races.probes.json`. Expected failure exits are 1; these are
candidate defect evidence, not failing fixture self-checks. The author owns fixes;
preserve the assertions for the next frozen head. Browser IndexedDB reload/quota,
signout host integration, physical capture and device/provider behavior remain
unproved. No browser foundation was needed for these core reproductions.

### Queue follow-up at 8dabaff

Disposition remains **FIX** at
`8dabafffa94a0609d86b23a7d832303d6e1da244`. The six-file delta adds per-trip
occupancy/lifecycle observations and their tests, adjusts documentation and removes
the competing `web/package.json`. The uploader Git blob is identical to original
`0b1e7e6`; none of the four upload findings was repaired by that delta.

Fresh Node26.3.0 execution: **42 author tests pass**; the original unchanged
ten-case oracle remains **7 passed / 3 failed**, including the explicitly unsupported
signout gap; original scheduling/protocol probes remain **1 passed / 6 failed**.
Both retirement races, both receipt failures, changed ambiguous batch key/body
and network retry exhaustion reproduce with the same observed results.

The assertions were preserved unchanged: `queue-races.probes.mjs` SHA-256
`41f2db6da493aad33b97f6ca623405e0dab6d0b1fdc45c4e11e0a1210e36d57a`,
`queue-probes.mjs` SHA-256
`8576e85070fd387361ac9b8e5738d7ce2a49aefc7f4a5ea9c8ebd7fa4ca65fe3`.
Raw outputs are `client-contract-reviews/queue-8dabaff.probes.json` and
`queue-8dabaff-races.probes.json`. A newer corrected frozen head needs a separate
re-review; status observability and bridge checks do not clear these findings.

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

Historical result at `c256e75`: **FIX**, six independent probes pass and one fails. After opening
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

### Corrected driver candidate

Scoped independent disposition: **ACCEPT** at
`80e9d45f9a234de54b1017e856e8349c097b8760`. The original cross-trip finding is
resolved for this nonvisual controller. Source review confirms bound-trip guards
across form/contact edits, save and new confirmation; pending/unknown/saved draft
intents block `openTrip` from crossing into another journey. Same-confirmation
receipts remain usable, confirmation initializes all read facts, and cached help
requires the current trip ID. Original unresolved intents are retained.

The exact original `driver.probes.mjs` was not changed. SHA-256 remains
`2f780e0073396fc59d43a325194845aa53b953eed34a452b51e36a9ba0dad3c4`.
Against the corrected archive it reports **7 passed, 0 failed**, compared with
the preserved 6/1 failure on `c256e75`. The sanitized result is
`client-contract-reviews/driver-80e9d45.probes.json`.

Fresh independent execution on Node26.3.0: author unit checks **28 passed**, strict
TypeScript5.9.3 consumer checks passed, and all **4 declared signed API/PostgreSQL
journeys passed** using the unchanged reviewer-owned cluster wrapper with lane46
`df05aeb`/backend `ebc8fb1` on owned port56447. The strengthened persisted journey
opens a fresh controller over a real saved trip, reads its location/incident,
blocks overlapping draft/confirmation and checks one persisted draft/incident
and same-trip help. Cleanup completed; no listener remained on this lane's port.

This resolves the original reviewer request, not browser/device/provider or
whole-app acceptance. The separate typed-client controller test was subsequently
advanced to this driver and reviewed at `7e241c3` above; older fixture evidence is
not silently reattributed. Queue PR66's four reproduced defects remain open
pending a repaired frozen candidate.
