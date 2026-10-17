# Local backend integration runtime

Lane 46 owns `tests/app-integration/**`, `scripts/app-integration/**` and this file.
The current source base is the reviewed integrated backend at
`5591c9b55fe7f4505e36ccee96d27aa913e0debf` (PR61). The original PR58/749f46f
branch and receipts remain bound to Robert's
`ebc8fb1d36f441ef012ca585201cefabf61383d6`. Routes and dependency seams come from
[the executable runtime contract](../contracts/runtime.md); this harness does not
add app routes or change backend policy.

## Reproduce

Use Node **24–26**, PostgreSQL **15+** server binaries, and the checked-in npm lock.
The local verification uses Node 24.17.0, npm 11.13.0 and PostgreSQL 16.14.
From this worktree:

```sh
source ~/.nvm/nvm.sh
nvm use 24.17.0
npm ci --ignore-scripts --no-audit --no-fund
node scripts/app-integration/run.mjs
```

Activate an equivalent installed Node version if nvm is unavailable. No new npm
packages or test framework are added. PostgreSQL is discovered through
`pg_config --bindir`. To select another installed server or a free lane port:

```sh
APP_INTEGRATION_PG_BIN=/opt/homebrew/opt/postgresql@16/bin \
APP_INTEGRATION_PG_PORT=56446 node scripts/app-integration/run.mjs
```

The command typechecks, builds the backend, runs all existing `tests/*.test.mjs`
checks and the new `tests/app-integration/*.test.mjs` checks, then cleans up.
It exits nonzero on setup/check/cleanup failure. A missing dependency or occupied
port is a failure, never a skipped or simulated database run. The harness never
reads `.env`, reuses `DATABASE_URL`, or starts Compose's shared default ports.

## Isolation and cleanup ownership

Default mode creates a private `andes-q46-*` directory under the system temp
directory, initializes its own real PostgreSQL cluster and creates a randomly
named `andes_q46_<16 hex digits>` database. PostgreSQL listens only on
`127.0.0.1:56446`, with a random SCRAM password and a private Unix socket. A mode
0600 password file inside the private run directory is removed immediately after
`initdb`; the remaining connection credential stays in memory. No credentials are
printed or committed. Readiness verifies the owned data
directory; the harness probes the port before starting and never kills its holder.
`APP_INTEGRATION_PG_PORT` selects a different unprivileged free port explicitly.

The HTTP test listener binds to `127.0.0.1` with port **0** (OS-assigned free port),
and reports each actual port/PID as test diagnostics. Each restart can select a
new free port. API and dispatch children inherit an allowlist of test settings;
provider/AWS/OIDC credentials, the application's database settings and `.env`
files are not inherited. No AWS SDK transport or production provider HTTP is
constructed by the harness's fixtures. A local provider stub supplies synthetic
acceptance only and writes a minimal call ledger without phone/location payloads.

The runner owns only its child processes, generated database and temp directory.
Normal success and caught failure both drop that exact database, close pools,
stop the owned PostgreSQL child and remove the directory. Each API stop closes
its context/pools and disconnects test IPC; the parent has bounded kill fallback
for a stuck child. Existing backend tests create/drop their own unique schemas
and temporary bootstrap roles/databases within the dedicated test server.

SIGKILL or machine loss cannot run JavaScript cleanup. In that case identify the
specific `postgres -D .../andes-q46-*/data` process by its recorded run directory
and confirm its cwd/command before stopping it or removing its directory. Never
stop another lane's PostgreSQL, reuse a shared database for reset, or clean up by
a broad process-name match. No long-lived app, port, database or preview is left
by a normally completed run.

## Explicit CI seam for integrator44

The existing backend CI exposes a local PostgreSQL service with administrative
test privileges. The harness can use an **explicit** loopback administrative URL
to create and drop a separate randomly named database on that service:

```sh
APP_INTEGRATION_ADMIN_URL="$TEST_DATABASE_URL" node scripts/app-integration/run.mjs
```

Only `postgres:` / `postgresql:` URLs with exact loopback hosts and no query
options are accepted; remote hosts are rejected before connection. Never pass a
production or shared-data URL. The administrative role must be allowed to create
databases and run the existing bootstrap privilege tests. Its input database is
not reset or migrated by the harness; only the generated database is used. This
mode does not stop the integrator's PostgreSQL service. CI secrets stay in its
environment, outside command logs and PR descriptions.

This is a callable seam for component44's reviewed CI change. Lane 46 does not edit
root package scripts or workflows without component44 coordination. The current
default `npm test` includes only root tests, so it does **not** discover this new
subdirectory. The explicit harness command is required. The locally owned-cluster
mode is the default. To verify CI-service mode locally against a second generated
database on an owned server, including an unchanged input-database sentinel and
an exact database inventory/cleanup check:

```sh
node scripts/app-integration/check-ci-seam.mjs
```

This control runs the same suite through the explicit admin URL, asserts that its
input table/data survive and that the nested run leaves no extra database, then
cleans up its own server. It establishes local seam behaviour; component44 still
owns the actual CI workflow wiring and review.

## Scenario coverage and limits

| Scenario | Positive control | Rejection / persistence control |
|---|---|---|
| Identity | Real RS256 signature and `/v1/me` registration | Missing/incorrect signature rejected; server identity survives actual API restart |
| Owned truck | Create under authenticated driver | Same mutation key/body returns same UUID; changed body or missing key rejected |
| Contact consent | Intended verified recipient accepts requested scopes | Wrong user and unverified phone cannot accept |
| Trip preparation | Explicit complete fields + accepted contact confirm | Incomplete draft activates nothing; another user cannot borrow truck or confirm |
| Location | Captured, received and read timestamps remain distinct | Unavailable/fresh/stale states, future sample rejection, stranger read/upload denial |
| Trip lifecycle | Pause preserves map, resume re-enables checkins | OK/rest remain attributed, `automaticEscalation:false`, no inferred incident |
| API restart | Actual child exits; new process reads same PostgreSQL state | Same signed user, truck/trip/location and idempotent response persist |
| SOS/contact | Duplicate taps share episode; contact can acknowledge/report action | Stranger cannot read; contact cannot resolve; acknowledgement/action leave SOS active |
| Dispatch restart | Abandoned unattempted claim becomes executable after lease | Ambiguous authorized attempt stays unknown, exactly one stub send across two recovery processes, zero delivered jobs |
| Arrival/resolution | Arrival closes map while SOS remains readable/actionable | Further location upload denied; only driver resolves; pending work cancels |
| Revocation | Contact revokes trip grant; owner revokes standing grant | Contact loses incident read; later confirmation denied; closure and revocation survive another API restart |
| Runtime guard | Generated local test database | Remote/schema-bearing admin URLs and borrowed database names rejected |

The fixture uses the existing `createApp` signed-key resolver and clock seams;
it runs actual HTTP sockets, SQL migrations, PostgreSQL reads/writes and process
exit/restart. It does not exercise the production remote JWKS fetch, HTTPS
ingress, SQS, AWS availability or a deployed `src/server.ts` environment.
The injected clock advances exercise the existing synthetic freshness/lease
bounds, not validated driver response times. PostgreSQL remains running across
the API/dispatch restarts; database failover/power-loss durability is not tested.

Synthetic channel support and provider acceptance are test declarations. A stub
call, an accepted job, contact acknowledgement and reported contact action are
different facts; none establishes delivered notifications or useful real help.
No physical-device, human-factors, incident, participant or provider qualification
evidence is collected. The original evidence gates remain open.

The next integration step belongs to component44's reviewed CI seam. UI-driven
browser coverage follows the runnable frontend foundation and its documented
authentication/API boundary; these HTTP tests do not count as UI/device proof.

## Redacted acceptance receipts

The adapter targets Q52's independently authored format
`andes.app-acceptance.receipt/1`. The original-backend checker
`e3ed9720ad1490a1797adbb3ed1a8c76eadffe50` (PR60) remains a rejecting control
for the new backend. `ORACLE_SHA` identifies Q52's matching checker
`7a7d28cbd711cfd6a1a86ec6d8a94ab6e044d366`, independently accepted by Q48 in
[comment6243116212](https://github.com/Bimbi-Dev/andes-hackathon/pull/60#issuecomment-6243116212).
Its implementation is not copied into this lane. To export facts from an actual isolated run, select
a **new**, absolute local directory outside Git:

```sh
APP_INTEGRATION_EVIDENCE_DIR=/tmp/andes-q46-receipts-unique node scripts/app-integration/run.mjs
```

The directory must not already exist. It is created privately and survives cluster
cleanup. `http-records.json` contains selected redacted HTTP observations and case
bindings; `acceptance-receipt.json` groups those observations into the twelve
ordered cases consumed by the independent checker. Both files have mode 0600 and
a 512 KiB bound. Do not commit or paste them into a PR. Give an authorised local
reviewer their path plus the producer commit, exact command and raw test output.

Receipt export checks that `src/`, `db/`, manifests and compiler config still match
backend `5591c9b55fe7f4505e36ccee96d27aa913e0debf`, including unstaged, untracked
and Git-ignored runtime files. Git ignore rules never remove files from the runtime
inventory: the migrator can execute an ignored numbered SQL file. Export requires
a Git checkout containing that commit. A changed
backend needs source review and coordinated oracle rebinding before receipt reuse;
setting a revision label cannot bypass the source check.

Capture happens only after real HTTP response JSON is read. Named slots bind an
observed request to a case; duplicate slots or a case order differing from actual
observation order are rejected. Partial/absent cases are omitted, so Q52 reports
them as pending (`exit 2`). There is no fallback to its synthetic examples.
Unexpected observed status/results remain unchanged for the checker to reject.
Caller-supplied JSON alone cannot authenticate that HTTP happened.

The adapter derives registered route patterns from actual request paths. Opaque ID,
place/action-text and key aliases preserve equality and distinctness across request
and response records; original UUIDs and idempotency keys are excluded. Tokens,
headers, phone values, coordinates and raw trip text are not captured. Source
`capturedAt`, server `receivedAt`/`readAt` and `ageMs` remain unchanged. Producer
`observedAt` is a separate wall-clock field in the selected HTTP records; the
server clock advances are still synthetic engineering controls.

Use the independently checked-out exact frozen checker head above:

```sh
node "$(realpath /path/to/pr60/evidence/app-acceptance/check.mjs)" /tmp/andes-q46-receipts-unique/acceptance-receipt.json
```

Exit 0 means `backend-receipt-checks-pass` only. `wholeAppAccepted` remains false.
Missing-case and altered-source-time controls must yield exits 2 and 1,
respectively. Require nonempty, parseable JSON with that disposition as well as the
exit code. The original PR60 CLI path-alias defect remains corrected in this
checker revision; Q46 independently reran the actual receipt, missing/falsified
controls and symlinked/noncanonical entrypoints with nonempty JSON. The actual journey
includes confirmation replay/new-key conflict,
stranger SOS rejection, and a separate still-active trip for revocation (so denial
cannot be explained by prior arrival). No browser, provider or physical evidence
is added by normalizing these backend observations.

## Accepted client against real PostgreSQL/HTTP

The explicit client seam extracts the six native TypeScript API/session files from
Q45's accepted commit `78efad0a207e98cc44336a03ba6af9fc0c1d2901` (PR59) into a
private temporary module directory. It does not copy or edit client implementation
inside this branch. Node 24's native TypeScript support runs the unchanged client:

```sh
git fetch origin pull/59/head
node scripts/app-integration/check-client-seam.mjs
```

The frozen object must be available locally, and backend source must still match
the pinned revision. The command runs the existing integration suite plus the
explicit `tests/app-integration/client-seam.mjs` test. That file deliberately has
no `.test.mjs` suffix: default backend runs do not silently claim client coverage
when the accepted client source is unavailable. Only the explicit seam supplies
its module path/revision and includes the test. No new dependencies are installed.

Client tests create a second uniquely named database on the owned server, isolated
from the concurrently running direct-HTTP journey. They use the existing API test
process and actual signed driver/contact/stranger identities, with distinct
memory sessions. No token/signing key is logged, persisted or passed in a URL.
API children receive only the ephemeral public verification key; the signing key
and credentials remain in the test process's memory. Database and module-directory
cleanup are owned by the test/runner that created them.

Coverage includes typed identity/consent/draft/confirmation/location/SOS APIs,
canonical same-key paths, source-age preservation, actual API restart, arrival
preserving SOS, explicit driver resolution and recipient revocation without a
cached snapshot. The loss control makes one **real committed** truck request,
discards its actual response in the injected transport, verifies an unknown
outcome with no automatic retry, and explicitly reconciles with the same key/body.
The same key under another signed actor returns that actor's distinct object.

Response gates buffer bytes from real HTTP before signout/account replacement;
they do not invent server JSON. They verify rejection of old-account responses,
local unauthenticated blocking without another HTTP request, and a late real401
that cannot invalidate replacement credentials. Local missing-session failures
report `unauthenticated/not_sent` from the session boundary; in-flight read
invalidation reports `session_changed/not_applicable`. These are distinct cases.

This exercises the native client/backend boundary, with synthetic identities and
controlled transport faults. It does not exercise browser storage/rendering,
same-origin Vite proxy/CORS, remote OIDC login, physical capture or real delivery.
Q49's runnable foundation and proxy hooks remain necessary for UI-driven coverage.

## Reviewed source rebinding

The new integrated-source branch preserves PR58 at
`749f46fd34d2856dfd0b547fe38795d7bfc4fdc8` and all original `ebc8fb1` receipts.
It carries the same owned harness onto reviewed baseline `5591c9b`; source export
must compare against the actual integrated `src/`, migrations, manifests and
compiler configuration. The guarded delta includes the reviewed post-quota-wait
claim/expiry clock recheck and root package wiring. No source comparison is relaxed.

Reproduce source rebinding with fresh runs and fresh receipt files. The original
guard correctly rejected integrated source before any evidence directory was
created; the unchanged non-export harness independently passed 74 checks in a
scratch integration checkout. Those observations are preflight evidence, not a
relabelled original receipt or an independent acceptance of this new branch.

Matching Q52 oracle `7a7d28c` includes the missing-trip-identity and second-SOS
state/capability predicate repairs, plus the explicitly reviewed `5591c9b` binding.
Q48 independently confirmed the final checker; its review does not execute or
authenticate the producer's runtime. The older `e3ed972` checker remains an
intentional rejecting control for a `5591c9b` receipt. A backend label change alone must
never convert old receipt data into new evidence. Additional root test forwarding
changes `package.json`, so a later integration head must be explicitly reviewed
and rebound again before its receipts can be accepted.

Q52's ignored-migration finding is covered by
`tests/app-integration/source-pin.test.mjs`. It uses a private standalone clone,
verifies clean source as a positive control, adds a migration that matches the
actual runtime filename rule while excluded by that clone's Git rules, and
requires both the source guard and real export command to reject it before any
evidence directory is created. It changes no live source or shared Git excludes.

A fresh export at producer `f1eb570` passed typecheck/build and 76 real local
PostgreSQL/HTTP checks. Its twelve observed cases pass frozen `7a7d28c`; a missing
case stays pending, and altered source age, replay key, invented delivery, missing
trip identities and second-SOS state/capability each fail. Canonical/noncanonical
and symlinked calls emit nonempty JSON. Old/new receipts reject across checker
versions, and hashes confirm the source receipts remain unchanged. This is Q46's
pairing observation. Q52's independent producer-fix and fresh-runtime confirmation
remain separate from Q48's completed checker review. `wholeAppAccepted` is false.
