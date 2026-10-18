# Local backend integration runtime

`scripts/app-integration/run.mjs` runs the backend on a disposable PostgreSQL
database and drives a synthetic HTTP journey through real API and dispatch
processes. It adds no app routes and changes no backend policy; routes come from
[the executable runtime contract](../contracts/runtime.md). It runs in CI as the
`app-integration` job.

## Reproduce

Use Node **24–26**, PostgreSQL **15+** server binaries and the checked-in npm lock:

```sh
npm ci
node scripts/app-integration/run.mjs
```

PostgreSQL is found through `pg_config --bindir`. To pick another server or port:

```sh
APP_INTEGRATION_PG_BIN=/opt/homebrew/opt/postgresql@16/bin \
APP_INTEGRATION_PG_PORT=56446 node scripts/app-integration/run.mjs
```

The command typechecks and builds the backend, runs every `tests/*.test.mjs` and
`tests/app-integration/*.test.mjs` check, then cleans up. It exits nonzero on any
setup, check or cleanup failure. A missing dependency or occupied port is a
failure, never a skipped or simulated run. The harness never reads `.env`, never
reuses `DATABASE_URL` and never starts Compose's shared default ports.

## Isolation and cleanup

Default mode creates a private `andes-q46-*` directory under the system temp
directory, initializes its own PostgreSQL cluster there and creates a randomly
named `andes_q46_<16 hex digits>` database. PostgreSQL listens only on
`127.0.0.1:56446` (or `APP_INTEGRATION_PG_PORT`) with a random SCRAM password
and a private Unix socket. The password file is removed right after `initdb`;
the credential stays in memory and is never printed. The temp path must stay
short enough for the socket (103 bytes on macOS).

The HTTP listener binds `127.0.0.1` on an OS-assigned port. API and dispatch
children get an allowlisted environment: provider, AWS and OIDC credentials,
the app's database settings and `.env` are not inherited. A local provider stub
returns synthetic acceptance and logs only channel and attempt ID. All phone
numbers are fictional (`+1 555 555 01xx`).

Success, failure and interruption all take the same cleanup path: drop the
run's database, close pools, stop the owned PostgreSQL and remove the run
directory. On SIGINT or SIGTERM (Ctrl-C, a CI cancellation, `kill`) the runner
stops its current command, starts no new one, cleans up and exits 130 or 143.
The owned PostgreSQL runs in its own process group, so a terminal Ctrl-C reaches
only the runner, which drops the database before stopping it. A second signal
forces exit. `tests/app-integration/interrupt.test.mjs` sends each signal to
nested owned-cluster and shared-server runs after their database exists. The
shared-server control owns a separate server and verifies its complete database
inventory and input sentinel remain unchanged, without sweeping sibling tests.

SIGKILL or machine loss cannot run cleanup. Then find the specific
`postgres -D .../andes-q46-*/data` process by its run directory and confirm its
command before stopping it or removing the directory. Never stop another
PostgreSQL or clean up by a broad process-name match.

## Shared-server mode

With an explicit loopback administrative URL, the harness creates and drops its
own randomly named database on that server instead of starting a cluster:

```sh
APP_INTEGRATION_ADMIN_URL="postgresql://user@127.0.0.1:5432/postgres" node scripts/app-integration/run.mjs
```

Only `postgres:`/`postgresql:` URLs with a loopback host and no query options are
accepted. Never pass a production or shared-data URL. The role must be able to
create databases and run the bootstrap privilege tests. The input database is
not reset or migrated, and the server is not stopped.
`node scripts/app-integration/check-ci-seam.mjs` runs the suite this way against
a second owned server and checks that its input data and database list survive.

## Scenario coverage and limits

| Scenario | Positive control | Rejection / persistence control |
|---|---|---|
| Identity | Real RS256 signature and `/v1/me` registration | Missing/incorrect signature rejected; server identity survives actual API restart |
| Owned truck | Create under authenticated driver | Same mutation key/body returns same UUID; changed body or missing key rejected |
| Contact consent | Intended verified recipient accepts requested scopes | Wrong user and unverified phone cannot accept |
| Trip preparation | Explicit complete fields + accepted contact confirm | Incomplete draft activates nothing; another user cannot borrow truck or confirm |
| Location | Captured, received and read timestamps remain distinct | Unavailable/fresh/stale states, future sample rejection, stranger read/upload denial |
| Trip lifecycle | Pause preserves map, resume re-enables checkins | OK/rest remain attributed, `automaticEscalation:false` (check timings unset), no inferred incident |
| API restart | Actual child exits; new process reads same PostgreSQL state | Same signed user, truck/trip/location and idempotent response persist |
| SOS/contact | Duplicate taps share episode; contact can acknowledge/report action | Stranger cannot read; contact cannot resolve; acknowledgement/action leave SOS active |
| Dispatch restart | Abandoned unattempted claim becomes executable after lease | Ambiguous authorized attempt stays unknown, exactly one stub send across two recovery processes, zero delivered jobs |
| Arrival/resolution | Arrival closes map while SOS remains readable/actionable | Further location upload denied; only driver resolves; pending work cancels |
| Revocation | Contact revokes trip grant; owner revokes standing grant | Contact loses incident read; later confirmation denied; closure and revocation survive another API restart |
| Runtime guard | Generated local test database | Remote/schema-bearing admin URLs and borrowed database names rejected; child environment leaks nothing |
| Receipt export | A passing run writes a receipt | Changed or ignored backend source, a failing run and an interrupt write nothing |

The fixture uses `createApp`'s signed-key resolver and clock seams with real
HTTP sockets, SQL migrations and process restarts. It does not exercise remote
JWKS, HTTPS ingress, SQS, AWS or a deployed `src/server.ts`. Clock advances test
the synthetic freshness and lease bounds, not validated driver response times.
PostgreSQL stays up across restarts; failover and power loss are not tested. A
stub call, an accepted job, an acknowledgement and a reported action are
different facts, and none of them is a delivered notification or real help. No
device, human, participant or provider evidence is collected.

The typed web client is tested against the real backend by its own integration
tests; this harness keeps no copy of it.

## Redacted acceptance receipts

To export receipts from a run, pass a **new** absolute directory outside Git:

```sh
APP_INTEGRATION_EVIDENCE_DIR=/tmp/andes-q46-receipts-unique node scripts/app-integration/run.mjs
node evidence/app-acceptance/check.mjs /tmp/andes-q46-receipts-unique/acceptance-receipt.json
```

The journey writes its observations to a private file in the run directory. Only
after every check and owned-resource cleanup passed does `run.mjs` create the
evidence directory and write
`http-records.json` (selected redacted HTTP observations) and
`acceptance-receipt.json` (the twelve ordered cases for the checker). A failing
or interrupted run, including a failure during cleanup after every test passed,
writes no receipt. The cleanup-failure regression injects its exception after
actually releasing the nested database, so the control leaves no test resources.
Both files are mode 0600 and bounded to
512 KiB. The receipt records `suiteResult: "pass"` and `producerRevision`, the
producer's `HEAD` (with `+dirty` when the tree has changes); the adapter refuses
an isolated-run receipt without both. Do not commit or paste receipts into a PR.

Checker exit 0 means `backend-receipt-checks-pass` only, and `wholeAppAccepted`
stays false. A missing case is pending (exit 2); a failed predicate is exit 1.

Captured fields are aliased: opaque IDs, place/action text and idempotency keys
keep equality without their values. Tokens, headers, phone values, coordinates
and raw trip text are not captured. Source `capturedAt`, server
`receivedAt`/`readAt` and `ageMs` stay unchanged. Partial cases are omitted,
never filled from synthetic examples, and observed failures stay failures.

## Backend binding

The producer and the checker share one constant, `BACKEND_SHA` in
[`evidence/app-acceptance/oracle.mjs`](../../evidence/app-acceptance/oracle.mjs);
[`rebindings.md`](../../evidence/app-acceptance/rebindings.md) names the current
target and its source review. Export first
checks that `src/`, `db/`, the manifests and the compiler config match it,
including unstaged, untracked and Git-ignored files (the migrator runs an ignored
numbered SQL file), and checks again before writing. Export needs a Git checkout
containing that commit.

When the backend changes, the harness still runs and CI stays meaningful, but
export is refused until the binding is updated: review the source delta for the
twelve cases, record it in
[`rebindings.md`](../../evidence/app-acceptance/rebindings.md), then change
`BACKEND_SHA`. Changing a receipt's revision label is never evidence.
`tests/app-integration/source-pin.test.mjs` checks the guard on the pinned
source in a private clone (checked out with `--no-overlay`, so backend files
added after the pin are removed): clean source passes, and an ignored migration is
refused before any evidence directory exists.

## Real browser fixture and proxy preparation

The opt-in browser fixture extracts exact foundation
`6f8dc52a566d3880cf1f10bbfd5282a888725ca1` and accepted API/gateway
`db7034fc9e1dba035b87368117376e9730d6b830` into a private directory. The backend
remains pinned to `5591c9b`. It reuses an explicitly supplied installed web package
whose package and lockfile match the frozen foundation, with caches in the private
run directory. It installs nothing and changes no shared frontend source.

```sh
git fetch origin 6f8dc52a566d3880cf1f10bbfd5282a888725ca1
git fetch origin db7034fc9e1dba035b87368117376e9730d6b830
APP_INTEGRATION_WEB_ROOT=/absolute/frozen-foundation/web node scripts/app-integration/check-browser-seam.mjs
```

This runs backend typecheck/build plus eight checks over actual development and
production-preview HTTP sockets, signed `/v1/me`, SQL identity persistence,
production-proxy idempotent truck creation, missing-target JSON503, rejected
authorization and owned-resource cleanup. It consumes the existing API45 gateway;
the gateway only authenticates after actual server identity verification. Its
token-free snapshot and duplicate-begin behavior are checked. This does not
exercise the newer owner-read routes or any driver/contact feature controller.

For an interactive local fixture, start this command through Codus's dev aux slot:

```sh
APP_INTEGRATION_WEB_ROOT=/absolute/frozen-foundation/web node scripts/app-integration/browser-fixture.mjs
```

The printed `/session` URL is the actual loopback server. After it loads, use the
development browser console or browser automation to mount the existing shell:

```js
const fixture = await import('/__andes_fixture__/bootstrap.mjs');
const session = fixture.mountSession();
```

Clicking Continue obtains an explicitly synthetic, short-lived signed credential
from a same-origin fixture-only POST and verifies it through the real `/v1` proxy.
Credentials stay in memory, never build environment, URL, storage or logs. The
fixture POST requires the exact local origin/host and a custom header; CORS is
disabled. This is a test credential issuer, not production login or provider
revocation. Signout clears the memory session. The shared demo notice remains
visible, and no feature journey or notification outcome is invented.

Production builds omit the test mount hook and fixture modules. The separate
production-preview proxy is exercised by the explicit check, without browser-hook
injection. The interactive process stops after ten minutes or SIGINT/SIGTERM,
closing its web/API children and dropping only its owned database/temporary files.
Terminal SIGHUP triggers cleanup too. A separate IPC resource owner holds the
disposable database and removes the extraction after parent disconnect, including
forced SIGKILL that cannot run a foreground signal handler. That owner uses a
separate process group, private IPC and a ten-minute deadline, so a PTY group kill
cannot skip its cleanup. Real CLI-child regressions cover both hangup and forced
process-group exit, requiring removed extraction and a
freed owned PostgreSQL port. The original aux-stop failure remains preserved in
the provisional browser observation record.
Do not run it concurrently with another owned cluster on port56446; select an
explicit spare `APP_INTEGRATION_PG_PORT` when needed.

Select the intended PostgreSQL installation explicitly with
`APP_INTEGRATION_PG_BIN=/absolute/postgresql/bin` when the aux shell's `pg_config`
belongs to another runtime. The observed Conda shell selected `/opt/anaconda3/bin`
and failed cluster initialization; the explicit local PostgreSQL16.14 directory
worked. No source guard or database isolation was weakened to resolve it.

The prior fixture `c2501a4` remains frozen against foundation `3283fe6`. Its native
agent-Chrome observations include actual Continue → signed `/v1/me` → authenticated,
ES/PT-BR, signout, locale-only storage and a persisted synthetic SQL identity.
The new foundation binding changes only the reviewed header CSS for readable
Portuguese labels at narrow widths; it preserves package/session/proxy exports.
Old captures retain their original source identity and are not relabelled.

The released `andes-operate-v1` contract and foundation scope remain the visual
oracle. Browser observations of this fixture are provisional server/session seam
evidence. A Git-bound UI Evidence Manifest and independent review are still
required for complete UI proof; this harness does not accept all twelve routes,
all five viewports, accessibility, provider delivery or whole-app readiness.
