# Trusted-contact journey state

This is headless browser application logic. It is based on Robert's backend at
`ebc8fb1d36f441ef012ca585201cefabf61383d6`, specifically
`docs/contracts/runtime.md`, `src/contacts/routes.ts`, `src/location/routes.ts`
and `src/incidents/routes.ts`. It has no UI, visual system, transport, tokens,
storage, notification sends or optional research/data-pool implementation.
Lane49's shared foundation gates rendering; lane45 owns authenticated HTTP/session
transport. The small `ContactApi` interface is an injection seam for that adapter,
not a claim that a shared client or missing backend read already exists.

Run the standalone tests using the backend's supported Node24–26 runtime:

```sh
node --test web/tests/contacts/*.test.mjs web/tests/privacy/*.test.mjs
```

Node24's native TypeScript support runs these modules without installing packages.
Type-check with TypeScript5.9.3 when available:

```sh
tsc --noEmit --strict --skipLibCheck --target ES2023 --lib ES2023,DOM \
  --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions \
  web/src/features/contacts/journey.ts web/src/features/privacy/consent.ts
```

## Actual API mapping for lane45

Every write receives `{signal,idempotencyKey}`; the adapter must send the key as
`Idempotency-Key`. Revoke, acknowledgement and resolution have an empty JSON body.
Every read receives `{signal}`. Adapter failures expose numeric `status` (or
`statusCode`); raw HTTP response/error strings are never copied into journey state.
No operation silently obtains another user's credentials from a role selection.

| Interface method | Backend route and body |
| --- | --- |
| `inviteContact(body, options)` | `POST /v1/contacts`, `{contactId,phone,map,incident}` |
| `acceptContact(id, body, options)` | `POST /v1/contacts/:id/accept`, `{map,incident}` |
| `revokeContact(id, options)` | `POST /v1/contacts/:id/revoke`, `{}` |
| `revokeTripContact(tripId, grantId, options)` | `POST /v1/trips/:id/contacts/:grantId/revoke`, `{}` |
| `getTripSnapshot(tripId, options)` | `GET /v1/trips/:id/snapshot` |
| `getIncident(id, options)` | `GET /v1/incidents/:id` |
| `acknowledgeIncident(id, options)` | `POST /v1/incidents/:id/acknowledgements`, `{}` |
| `reportIncidentAction(id, body, options)` | `POST /v1/incidents/:id/actions`, `{action}` |
| `resolveIncident(id, options)` | `POST /v1/incidents/:id/resolve`, `{}` |

`setSession({actorId,view})` consumes the registered identity from `/v1/me` and a
local journey view. It is not authentication or authorization. The adapter must
bind every operation to that same authenticated session and call `setSession`
on logout, reauthentication, identity or role-view changes. The backend remains
the authority for verified phone, invitation recipient, trip ownership and current
standing/trip consent on every protected request. Never expose a production role
switch that changes only these local fields while retaining another user's token.

## State and privacy behaviour

Invitation creation records pending consent only after a matching server receipt;
it sends no invitation notification. Acceptance allows a nonempty subset of the
requested map/incident scopes, then waits for a matching server receipt. A supplied
invitation hint is caller metadata, not authoritative grant discovery. The backend
must reject a forged/stale hint or mismatched verified phone. Acceptance is a
historical command receipt; `privacy.currentAuthorization` always requires another
server check rather than granting a protected view from local consent flags.

Role/session/trip changes abort outstanding signals and discard protected data and
receipt history. Abort does not promise that a server mutation was cancelled.
Late results from the previous context are ignored, including transports that
ignore AbortSignal. Reordered reads cannot overwrite newer results. Each read
clears that view before loading; 401/403/404 invalidates both protected views and
all outstanding operations. A401 also clears the local session. Error categories
preserve invalid/authentication/forbidden/missing/conflict/unsupported/server/network.

Standing and per-trip revocation clear protected data before the request, and
again after confirmation. Protected reads are blocked during pending/uncertain
revocation. An ambiguous write remains uncertain, does not create a receipt, and
is never automatically replayed. `retryUncertainCommand()` is an explicit user
action reusing the exact original key/body. It is unavailable after identity/trip
changes. There is no promise that revocation cancels already authorized provider
work; no restore/re-enrolment operation is invented.

Location state preserves capturedAt, receivedAt, server readAt, server freshness
at that read and source age separately. `locationAge(snapshot, nowMs)` can age that
cached fact; clock reversal behind readAt, future capture or unavailable location
gives unknown age. It never labels the cache live, refreshes authorization or
promotes old uploads to a new source observation. The backend's120-second bound
is synthetic engineering policy, not qualified phone coverage or a safety promise.

An SOS acknowledgement is an attributed receipt, distinct from an action report.
Free-text inability-to-assist and later contradictory reports remain separate own
action receipts without claiming help or resolving the incident. They are not
independently corroborated outcomes. Only the driver's authenticated operation can
resolve; the local view/owner check is an additional UX guard. Because the resolve
response has no resolvedAt, the journey requires another incident read before
presenting a resolved incident fact. Arrival/map closure is not incident resolution.
Operational sharing never implies research permission; research reuse, account
deletion and restoring revoked consent are explicitly unsupported here.

## Missing backend support sent to41/44 through Brain

At the frozen backend SHA there is no contact/grant list or invitation metadata
read, so another signed-in contact cannot discover pending invitations or requested
scopes from this module. Invitation creation requires an already registered target
UUID and its destination phone. Caller hints and local receipts cannot restore that
history after reload. No fabricated grant-read route or production share link exists.

The incident read returns only id/tripId/status/createdAt/resolvedAt/groupCapability.
It has no acknowledgement/action history, participant availability, structured
cannot-assist state or conflict-resolution interface. This journey retains only its
own successful action receipts in memory. Rendering other people's reports or
reconciling disputes requires41's actual read contract. Real auth/session integration
awaits45; UI awaits49; auth/privacy review belongs43 and functional UI review52.

The standalone unit tests use synthetic transport receipts and failure/race probes.
They do not prove backend authentication. The persisted scenarios below add real
signed-JWT and PostgreSQL integration with invented identities. Browser OIDC login,
lane45's actual transport, data retention/deletion policy and human/device gates
remain open. Neither suite proves provider delivery, consent comprehension,
physical-device capability, qualification or safety. No participants, notifications,
recruitment, spending, deployment or collection is used.

## Persisted driver/contact role-switch scenarios

With Node24–26 and local PostgreSQL15+ binaries, from the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node web/tests/contacts/run-persisted.mjs
```

The bounded runner builds the unchanged backend and creates a disposable cluster
under a fresh private `/private/tmp/andes-l51-*` directory. PostgreSQL listens only
on that private Unix socket, not TCP; it does not connect to an existing database.
The runner supplies its own synthetic TEST_DATABASE_URL, forces live-send permission
off, stops its child database and deletes the temporary cluster afterward. The
default binaries are `/opt/homebrew/bin/postgres` and `/opt/homebrew/bin/initdb`;
override `ANDES_TEST_POSTGRES` / `ANDES_TEST_INITDB` with local executable paths.
Each scenario additionally uses the backend helper's unique disposable SQL schema.
Without an explicit test DB, the normal test glob visibly skips these three cases.

The three persisted cases use the actual Fastify routes, PostgreSQL transactions
and signed synthetic JWT verification. They verify narrowed consent denies maps;
unverified-phone acceptance fails; acknowledgement and contradictory reported
actions persist separately while SOS remains active after arrival; trip-only
revocation permits a different trip while standing revocation denies future trips;
and fresh browser controllers cannot recover revoked protected data. Forging only
the local view/identity never replaces the JWT: contact credentials cannot resolve,
stranger credentials cannot read, and only the driver's credential resolves before
fresh contact reads observe resolution. Calls use Fastify injection, not an external
network server, OIDC login, AWS, a provider adapter or a production account.

Refs #15, #35, #14. No issue completion is implied.
