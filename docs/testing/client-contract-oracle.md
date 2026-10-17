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
