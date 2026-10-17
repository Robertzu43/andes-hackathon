# Local backend integration runtime

Lane 46 owns `tests/app-integration/**`, `scripts/app-integration/**` and this file.
The initial source base is Robert's `codex/aws-durable-backend` at
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

The adapter targets Q52's independently authored schema
`andes.app-acceptance.receipt/1` at frozen commit
`5f43ebbc4c711dde68e436ae34510f357fc9f4ac` (draft PR60). Its implementation is
not copied into this lane. To export receipts from an actual isolated run, select
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
backend `ebc8fb1d36f441ef012ca585201cefabf61383d6`, including unstaged and untracked
runtime changes. Export requires a Git checkout containing that commit. A changed
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

Against an independently checked-out PR60 at its exact frozen head:

```sh
node "$(realpath /path/to/pr60/evidence/app-acceptance/check.mjs)" /tmp/andes-q46-receipts-unique/acceptance-receipt.json
```

Exit 0 means `backend-receipt-checks-pass` only. `wholeAppAccepted` remains false.
Missing-case and altered-source-time controls must yield exits 2 and 1,
respectively. Require nonempty, parseable JSON with that disposition as well as the
exit code. At the frozen PR60 version, macOS `/var` versus `/private/var` aliases
can bypass the CLI entrypoint and return empty output; canonical paths avoid it.
This reproducible issue has been reported to its owning lane. The actual journey
includes confirmation replay/new-key conflict,
stranger SOS rejection, and a separate still-active trip for revocation (so denial
cannot be explained by prior arrival). No browser, provider or physical evidence
is added by normalizing these backend observations.
