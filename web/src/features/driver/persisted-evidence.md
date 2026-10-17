# Driver controller / persisted backend evidence

Author evidence on 17 October 2026; independent review pending. This extends the
26 synthetic controller checks and strict TypeScript consumer checks with four
actual signed-identity API/PostgreSQL journey tests. It supplies no UI, physical,
human comprehension, live notification or production-login qualification.

## Exact runtime and isolation

- Controller freeze for this run: `24a2e8919179503ff984c04b3cf9ef3e56018932`.
- Backend archive: `ebc8fb1d36f441ef012ca585201cefabf61383d6`, extracted with
  `git archive` into `/private/tmp/andes-driver50-runtime` and built with its pinned
  TypeScript 5.9.3 compiler. The preinstalled dependency directory from component46
  was referenced read-only via a temporary symlink; no install or root edit.
- Node 24.17.0; lane-owned PostgreSQL **16.14**, satisfying the backend's 15+ requirement.
- A newly initialized disposable cluster at `/private/tmp/andes-driver50-postgres`,
  loopback only, port **65450**, role `driver50_fixture`, database `driver50_journey`.
  The backend test fixture creates/drops a distinct random schema for each test.
  No other lane's port, cluster, database or data was reused. The cluster was
  stopped after the tests, and `pg_isready` reported no response.
- Actual backend `createApp`, signed JWT verification, migrations and SQL transactions
  ran. `channelSupport: []` was explicitly supplied; no delivery worker, callback
  credential, provider request, SQS transport or AWS service was activated.

The initial sandboxed `initdb` could not allocate PostgreSQL shared memory. It
was retried with approved local process permissions, not substituted with a
mock or silently counted as a test pass.

## Reproduce

Prepare a separate backend archive at the exact commit above, supply the pinned
dependencies, and build it with that archive's `tsconfig.json`. Start a lane-owned
disposable PostgreSQL cluster/database with the Codus service pipeline. The test
requires explicit paths and database configuration; missing configuration fails
rather than skipping the checks.

```sh
ANDES_DRIVER_RUNTIME_ROOT=/private/tmp/andes-driver50-runtime \
TEST_DATABASE_URL=postgresql://driver50_fixture@127.0.0.1:65450/driver50_journey \
node --test web/tests/driver/persisted.integration.mjs
```

No password, JWT, real participant identity or private trip was captured in output.
All test labels, phone claims, locations and identities are synthetic fixtures.
The dedicated local role uses trust only inside this disposable loopback cluster;
this is not deployable authentication configuration.

## Result: four passed, zero failed

| Actual persisted path | Evidence asserted |
| --- | --- |
| Draft → explicit duplicate confirm → active read → check-in/rest reports → SOS → arrival → new API instance | No trip exists before confirmation; duplicate confirm creates one trip; explicit country/locale/zone and selected accepted grant persist; location capture/receipt/read times remain separate and server age becomes stale; arrival closes map while SOS stays active. The original API/pools are closed; a new API/context with a new test verification key and the same verified subject reads the persisted arrived trip and active incident. |
| Server commits but confirmation/SOS response is lost | Controller outcome remains unknown and does not invent activation/incident state; explicit retries preserve exact original keys/body. SQL contains one trip, one incident and one SOS report event. |
| Standing contact revoked after selection but before confirm | Actual API returns 409 `contact_not_accepted`; no trip is inserted and no local activation is manufactured. Updated catalog evidence blocks the stale selection; an explicit empty selection may then confirm with no grants. |
| Signed foreign identity guesses another trip UUID | Trip read and SOS return 403; controller retains no protected trip/incident facts, and no incident is inserted. |

The complete journey asserts group/SMS/voice/WhatsApp job facts are all
`unavailable` and the dispatch outbox has zero rows. This is not observed delivery,
contact action, wellbeing or an independently corroborated incident.

## Integration seam limits

`persisted.integration.mjs` uses the actual Fastify injection boundary, not native
browser HTTP/fetch. Its test-only operation mapper points only at the implemented
routes. This is not a replacement production client or a claim of component45
integration. The controller's typed transport port remains explicit.

Because the base has no truck/contact catalog read routes, this test reads the
actual persisted owner/grant rows and supplies normalized selection evidence from
those rows. No acceptance is fabricated, but this **does not implement or verify a
catalog HTTP route**. Component41's published read contract and component45's
binding are still needed for a browser journey. Production OIDC, proxy/CORS,
durable client intent recovery after page kill, reviewed monitoring projection and
component49/Brain UI foundation remain separate work. The accepted phone adapter
and Robert-owned #18/#21 contracts are neither copied nor changed here.
