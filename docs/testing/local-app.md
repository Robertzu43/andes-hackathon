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

## Browser seam: the web app's proxy against the real backend

`scripts/app-integration/check-browser-seam.mjs` serves this checkout's own
`web/` (its `vite.config.ts`, `package.json`, lock and the client in
`web/src/lib/api`) against this checkout's backend on a disposable PostgreSQL.
Nothing is copied or pinned, so a change to the web app or backend on `main` is
what this check tests. It runs in CI in the `app-integration` job.

```sh
npm ci && (cd web && npm ci)
node scripts/app-integration/check-browser-seam.mjs
```

It builds the backend, then runs `tests/app-integration/browser-proxy.mjs`. That
file has no `.test.mjs` suffix because it needs `web/node_modules`, which
`run.mjs` does not install. Its eight checks:

- The fixture-only credential POST rejects GET, a missing header and foreign origins.
- The Vite dev proxy passes real `/v1/me` authentication. The client gateway
  authenticates only after that real read, sends once for a duplicate `begin()`
  and persists one SQL identity. The dev server serves the test mount hook and
  the bootstrap, which imports the checkout's client.
- A production build behind `vite preview` forwards signed reads and idempotent
  truck writes, and its bundles contain neither the mount hook nor fixture modules.
- The unconfigured production proxy answers JSON 503 `api_unconfigured`, not SPA HTML.
- Signout and a server-refused credential (gateway state `error`) leave the session anonymous.
- The interactive CLI removes its database and run directory after SIGHUP, and
  after SIGKILL of its whole process group.

### Interactive fixture

```sh
node scripts/app-integration/browser-fixture.mjs
```

It prints the loopback `/session` URL. In the browser console or automation:

```js
const fixture = await import('/__andes_fixture__/bootstrap.mjs');
const session = fixture.mountSession();
```

Continue then gets a short-lived synthetic signed credential from a same-origin
fixture-only POST (exact origin and host plus a custom header, CORS off) and
verifies it through the real `/v1` proxy. Credentials stay in memory, never in a
URL, storage or logs, and the token's phone claim is fictional
(`+1 555 555 0146`). This is a test credential issuer, not production login.
The bootstrap is a virtual module of the fixture's dev server, so it is never
written into `web/` or a production build. Vite's cache and build output go to a
private `andes-q46-browser-*` temp directory; the checkout stays clean.

A separate resource-owner process (its own process group, private IPC and a
ten-minute deadline) holds the database and run directory. They are removed on
normal close, SIGINT, SIGTERM, SIGHUP, parent disconnect, or SIGKILL of the
foreground process group. PostgreSQL uses port 56446 by default; set
`APP_INTEGRATION_PG_PORT` to run beside another owned cluster, and
`APP_INTEGRATION_PG_BIN` when `pg_config` belongs to another installation.

This is server and session seam evidence, not UI acceptance: it covers no
feature routes, viewports, accessibility, OIDC, provider delivery or whole-app
readiness.
