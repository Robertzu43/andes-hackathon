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
forces exit. `tests/app-integration/interrupt.test.mjs` interrupts nested runs
after their database exists and checks that nothing is left.

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
after every check passed does `run.mjs` create the evidence directory and write
`http-records.json` (selected redacted HTTP observations) and
`acceptance-receipt.json` (the twelve ordered cases for the checker). A failing
or interrupted run writes nothing. Both files are mode 0600 and bounded to
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
[`evidence/app-acceptance/oracle.mjs`](../../evidence/app-acceptance/oracle.mjs),
currently `main` at `3a1491a4be1e32a1daa24a72d1afd374760147fd`. Export first
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
source in a private clone: clean source passes, and an ignored migration is
refused before any evidence directory exists.
