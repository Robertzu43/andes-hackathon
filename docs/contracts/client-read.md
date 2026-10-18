# Client read contract

Owner-scoped catalogs for the persisted web journey. All five routes require the trusted OIDC bearer token, send `Cache-Control: no-store`, and bind every row to that request's actor. No query/body ID can choose another owner. Public DTO types are exported from `src/client-read/contracts.ts`; consumers should use this contract rather than raw database rows.

| Route | Response |
| --- | --- |
| `GET /v1/profile` | `{id, phoneVerified, readAt}`. Both profile fields come from `request.actor`, never a later read of the mutable identity row. No phone value is returned, including the current token's phone. |
| `GET /v1/trucks` | `{trucks, limit, hasMore, readAt}`. Entries are `{id,label}`, ordered by label then id. Bound: 100. |
| `GET /v1/contacts` | `{contacts, limit, hasMore, readAt}`. Driver-owned standing grants ordered by id, independent of private phone values. Bound: 100. |
| `GET /v1/trips` | `{active, recent, limits, hasMore, readAt}`. Active trips are ordered by creation time then id, descending. Arrived/cancelled trips are ordered by closure-or-creation time then id, descending. Bounds: 50 active, 20 recent. |
| `GET /v1/bootstrap` | `{profile, trucks, contacts, trips:{active,recent}, limits:{trucks,contacts,activeTrips,recentTrips}, hasMore:{trucks,contacts,activeTrips,recentTrips}, readAt}`. The same DTOs and limits in one database snapshot. |

`ClientContact` contains `{id, contactId, role, map:{requested,accepted}, incident:{requested,accepted}, status, acceptedAt, revokedAt, revokedBy}`. `status` is `pending`, `accepted` or `revoked`; `revokedBy` is `driver`, `contact` or null. `role` is the stored `family`/`colleague` role, or null when unavailable. Phones are neither selected for the response nor used for ordering.

`ClientTripSummary` contains `{id, truckId, origin, destination, country, locale, timeZone, status, mapActive, checkinsActive, paused, version, createdAt, closedAt, expectedArrivalAt, sharingStoppedAt, contactGrantIds}`. Timestamps are ISO 8601 strings or null. `contactGrantIds` includes only selected grants whose per-trip and standing grants remain unrevoked, accepted, and authorize at least one scope. These IDs identify effective consent, not evidence that anyone is watching or has acknowledged a message. A standing contact may remain accepted after revocation for one trip; that trip no longer lists the grant, while other authorized trips can retain it.

## Snapshot and pool behavior

Authentication and catalog queries use `telemetryPool`, separate from the command pool used by explicit SOS. Polling does not borrow SOS connections. The shared `readSnapshot` wrapper acquires a connection, begins `REPEATABLE READ READ ONLY`, and executes `SELECT pg_current_snapshot()` to pin the snapshot before sampling the injected server clock for `readAt`. `BEGIN` alone does not establish the snapshot. Queuing before connection acquisition therefore cannot make a response include writes committed after its own acquisition timestamp.

All queries in a response use that pinned snapshot. Concurrent commits after acquisition remain invisible to the response, so a trip cannot move from active to recent halfway through bootstrap. Profile identity and verification describe the authenticated request; they intentionally do not follow a parallel token updating the shared identities row. `readAt` describes snapshot acquisition, not the age of location, event, delivery or participant evidence. It is not a freshness claim and is never derived from the client clock. Separate requests may see different committed states.

`readTransaction` delegates to the common transaction helper with a fixed BEGIN statement; commit, rollback and release have one implementation. Append-only migration `009-client-read-indexes.sql` adds indexes matching owner predicates and catalog ordering for trucks, standing contacts, active trips and recent trips, after the reconciled runtime's migrations. Existing runtime migration files are unchanged.

## Runtime compatibility and deliberate projections

This branch integrates `main` at `f75de59fa1d4190cfe8a204f2ea5d42833d6f46b`, including the merged #74/#80/#83 runtime. Queries select the real `contact_grants.role`, `trips.expected_arrival_at` and `trips.sharing_stopped_at` columns directly. Unset arrival and sharing timestamps remain null. App registration preserves the runtime's demo, checks and insights routes and the authentication presence clock while mounting the five catalog routes. Tests exercise the actual demo session issuer with a fictional configured live destination, persisted roles, draft confirmation, sharing stop/resume, owner detail and `/status`.

| Catalog field | Existing owner detail (`GET /v1/trips/:id`) | Runtime `/status` |
| --- | --- | --- |
| `status`, `paused` | Same persisted fields | `trip.status`, `trip.paused` |
| `expectedArrivalAt` | `expected_arrival_at` when available | `trip.expectedArrivalAt` |
| `sharingStoppedAt` | `sharing_stopped_at` when available | Not present in PR #74's current status envelope |
| Other summary fields | Camel-case projection of the corresponding persisted row | Status is a separate check/incident/delivery/location envelope |
| `contactGrantIds` | Derived from effective standing and trip grants | No equivalent list |

The bounded catalog projection remains distinct deliberately: copying raw detail would expose internal owner columns, while copying the status envelope would require per-trip incident/location work and widen the read surface. Existing detail and status responses are not changed. The named exported DTO and regression comparison against owner detail make that distinction explicit without silently changing existing clients.

These reads exclude phone values, bearer tokens, raw draft text, coordinates/history, provider/job/outbox state, and other actors' records. They are bounded first-page reads with truthful `hasMore`, not a cursor/pagination contract. Recipient discovery belongs to PR #86's separate actor-bound routes; these five routes do not claim to provide it.
