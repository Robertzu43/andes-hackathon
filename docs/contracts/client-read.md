# Client read contract

Additive owner-scoped reads for the persisted web journey. These routes do not replace `GET /v1/me`, trip detail, snapshot or incident reads in [runtime.md](runtime.md). They are authenticated with the same trusted OIDC bearer token, use `Cache-Control: no-store`, and never accept an owner/body ID. SQL filters bind every row to the authenticated actor.

| Route | Response |
| --- | --- |
| `GET /v1/profile` | `{id, phone, phoneVerified, readAt}` for the authenticated identity. `phone` is the current stored E.164 claim value or null; `phoneVerified` is the persisted trusted-claim state. |
| `GET /v1/trucks` | `{trucks, limit, hasMore, readAt}`. `trucks[]` contains `{id,label}` for trucks owned by the actor, ordered by label then id. Fixed first-page bound: 100 rows; `hasMore` reports truncation. |
| `GET /v1/contacts` | `{contacts, limit, hasMore, readAt}`. Driver-owned standing grants ordered by phone then id. Each row is `{id, contactId, phone, map:{requested,accepted}, incident:{requested,accepted}, status, acceptedAt, revokedAt, revokedBy}`. `status` is `pending`, `accepted` or `revoked`; `revokedBy` is `driver`, `contact` or null. Fixed first-page bound: 100 rows. |
| `GET /v1/trips` | `{active, recent, limits, hasMore, readAt}`. Driver-owned trips only. `active` contains active trips ordered newest first; `recent` contains arrived/cancelled trips ordered by closure/creation newest first. Trip summaries contain `{id, truckId, origin, destination, country, locale, timeZone, status, mapActive, checkinsActive, paused, version, createdAt, closedAt, contactGrantIds}`. Bounds: 50 active and 20 recent. |
| `GET /v1/bootstrap` | One owner-scoped initial load: `{profile, trucks, contacts, trips:{active,recent}, limits:{trucks,contacts,activeTrips,recentTrips}, hasMore:{trucks,contacts,activeTrips,recentTrips}, readAt}`. The list entries have the same shapes and fixed bounds as the focused list routes above. |

Every response carries `readAt`: the server's own clock (ISO 8601 UTC) at the moment the request was received. It is the as-of timestamp a client may attribute to this read; it is never derived from the client clock. Each route runs its queries in one transaction at the database's default (read committed) isolation. `bootstrap` runs its four reads sequentially inside a single read-committed transaction, so each statement sees committed state at its own start; it is not a repeatable-read snapshot across the whole load, and rows may change between statements. No stronger atomicity is implied.

The reads deliberately exclude bearer tokens, raw draft text, location coordinates/history, provider/job/outbox state and other drivers' records. Cross-identity requests authenticate as their own identity and therefore receive their own empty lists, not another driver's data. Revoked standing contacts remain visible to the driver as management records with `status: 'revoked'`; trip `contactGrantIds` preserve the selected grant IDs for correlation with that standing-contact list.

These are bounded first-page reads, not a cursor/pagination contract. Reload-safe pagination and page-boundary evidence are a follow-up slice.
