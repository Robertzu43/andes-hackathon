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
changes. A refusal of that retry (including409) does not disprove the original
possible commit: the outcome remains uncertain and revocation keeps protected
reads blocked. Authentication failure clears the session and prevents replay in
another identity. Same-session protected-read denial also preserves a prior unknown
write outcome. A first-attempt definitive4xx remains rejected, distinct from this
prior-unknown case. There is no promise that revocation cancels already authorized provider
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


## Contact-route readiness inventory

Source review: backend `c752de8a3b424bcbc086764dc11052348b27e320` runtime and
contacts/location/incidents/API route files; those route files are unchanged from
the tested `ebc8fb1` feature base. Published, unmerged PR65 at
`748d30c6e6c595fd1a2c2c648a045750de3dd9c8` supplies `docs/contracts/client-read.md`,
`src/client-read/routes.ts` and its tests. Its additions are inventoried here,
not imported or claimed integrated. Brain's contacts/invitation/contact-trip/privacy
blueprints determine the UI tasks; rendering still waits for49's committed foundation.

Lane45 owns authenticated transport/session binding. A route UUID never grants
access. Each write below uses the existing authenticated Idempotency-Key contract.

| App route/control | Actual inputs and supported action | Missing support or boundary |
| --- | --- | --- |
| `/contacts`: reload | PR65 contacts/bootstrap GET returns driver-owned grant ID/contactId/phone, requested/accepted scopes, status and consent timestamps/attribution | Bound100 and hasMore; no cursor. Recipient requests return their own driver lists, not incoming invitations. |
| `/contacts`: invite | Registered target UUID, E.164 destination and nonempty map/incident scopes; existing contacts POST records pending state | No directory/phone-to-user lookup, enrollment or invitation notification. Pending is not accepted. |
| `/contacts`: revoke | Known grant ID from driver catalog or own receipt; existing standing revoke POST with empty body | Server checks participant; permanent, including future trip selection. No restore operation. |
| `/contact/invitations/:grantId`: load | Route grant ID and current recipient need requested scopes, driver binding and current grant state | Incoming invitation list/detail is missing. A local hint or URL cannot restore authoritative metadata. |
| `/contact/invitations/:grantId`: accept | Explicit nonempty subset of requested scopes; existing accept POST | Verified destination/recipient checks stay server-owned; handle revoked/already-accepted/phone conflicts. No invitation-expiry field exists. |
| `/contact/invitations/:grantId`: withdraw | Known grant ID; existing standing revoke | No invented reject/restore/acceptance-notification action. |
| `/contact/trips/:tripId`: discover | Trip ID needs driver/grant/effective permissions and active incident binding | PR65 trip list is driver-only; contact shared-trip discovery is missing. Selected grant IDs do not prove current authorization. |
| `/contact/trips/:tripId`: location | Existing snapshot GET rechecks current map consent/map-active | Preserve capture/receipt/read times and age. Map403 does not deny a separately permitted incident. |
| `/contact/trips/:tripId`: incident | Existing incident GET with known incident UUID | UUID discovery from a shared trip is missing. Read returns only ID/trip/status/createdAt/resolvedAt/group capability; open SOS survives arrival under incident consent. |
| `/contact/trips/:tripId`: acknowledge | Read active incident; existing acknowledgement POST with empty body | Receipt is not action, delivery, help or resolution. |
| `/contact/trips/:tripId`: action/cannot assist | Active incident plus explicit1–300-character report; existing actions POST | Free-text attributed reports only; other participants' history and structured inability/conflict reconciliation are absent. |
| `/contact/trips/:tripId`: revoke trip | Known trip/grant IDs; existing trip revoke POST | Other trips may retain standing consent; ambiguous revoke keeps reads blocked; authorized prior work may complete. |
| `/contact/trips/:tripId`: resolve | Existing resolve POST is driver-only | Contact UI must not offer it; arrival/ack/action never resolves. |
| `/privacy`: inspect/revoke | Driver catalog supplies current standing state; existing standing/trip revokes accept known IDs | Recipient standing management and effective per-trip-revocation reload are missing reads. Local receipts remain historical. |
| `/privacy`: optional reuse/restore/deletion | No supporting API/prerequisite evidence | Explain unsupported capability; no research toggle, restore, deletion or emergency-number action is enabled. |

PR65 profile GET exposes only the current actor's id/phone/verification, not a
user directory. Driver trip summaries retain selected grant IDs,50active/20recent
bounds and truncation flags; they expose no effective per-trip-grant revocation,
incident discovery, coordinates or provider facts. Forthcoming response/deadline/
channel status remains a separate actual-contract dependency; PR53 stays unwired.

### Minimal retrieval request to41

Q41 chooses/publishes paths and DTOs;45 types actual contracts before51 consumes
them. The immediate need is two bounded participant-authorized retrievals with
stable IDs/order and explicit truncation:

1. Incoming invitation list/detail for the authenticated recipient: grant ID,
   driver binding, requested/accepted operational scopes, pending/accepted/revoked
   state and applicable existing consent timestamps. This supports invitation
   reload and recipient consent management. A minimal revoked tombstone must not
   retain protected trip access. Exclude others' phones/claims, route/cargo/location
   details and provider internals.
2. Shared-trip list/detail for an authenticated accepted contact: trip/driver/grant
   binding, current effective map/incident permissions or denial, per-trip revoke
   state and permitted active-incident UUID. Keep an open incident discoverable
   after arrival/map closure under incident consent. Reuse snapshot for coordinates
   and age; discovery need not duplicate notification or event-history APIs.

Both reads distinguish unauthorized/missing from legitimate empty results and
recheck standing/trip revocation under existing backend rules. No query/body owner
selects another actor. Useful controls: stranger, wrong recipient, narrowed scope,
revoke then reload, arrived trip with active SOS. Shared phone values cannot prove
identity/consent. Driver per-trip-grant-state reload, structured inability, report
history, directory enrollment, deletion and channel/deadline status remain explicit
separate gaps outside this minimal request. No scaffold or success fixture is added.

Refs #15, #35, #14. No issue completion is implied.
