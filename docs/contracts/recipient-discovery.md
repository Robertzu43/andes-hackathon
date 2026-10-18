# Recipient discovery: implementation contract

Partition frozen by Q44 for lane41 implementation. These two routes are **not
implemented or deployed by this document**. Q59's source proposal at `1a5e115`
and planner `pl_mvd1u5yz_f780e7` supply the authorization matrix. Existing sources
are owner catalogs PR65 `3ea6e1b` and Robert PR74 `4c138ca1`; neither provides
recipient discovery. The known-trip status/sharing routes remain Robert-owned.

Lane41 owns the new read module under `src/client-read/`, its tests and contract
implementation. It uses the existing coordinated `clientReadRoutes` mount;
lane44 owns any shared application mount change. Lane45 binds the actual published
DTOs after implementation; lane51 owns the contact inbox/selection UI. Existing
review, consent and product evidence gates remain in place.

## Exactly two list routes

Both routes derive the recipient from the verified `request.actor.id`. They accept
no driver/contact/phone selector or directory lookup. Responses use the existing
no-store and redacted error conventions. A missing/expired session is 401; a valid
account with no own rows gets an empty list. Same phone number is not same identity.

Both use a read-only REPEATABLE READ transaction and one real server `readAt`
sample inside the acquired transaction. It describes this projection's assembly
time, not invitation creation, location capture, a future authorization guarantee
or the source time of a later status request. The existing PR65 consistency finding
must be repaired with coherent reads, not by weakening its contract or merely
adding a timestamp.

Each list is a fixed first page of at most 100 rows. Fetch 101 authorized rows,
return the first 100 and set `hasMore` from the extra row. No cursor or exhaustive
retrieval is claimed. Empty, error/unavailable and truncated results remain
different UI states. Neither read writes state, enqueues work or sends messages.

### GET /v1/contact/invitations

Envelope: `{invitations, readAt, limit:100, hasMore}`.

| Row field | Meaning |
| --- | --- |
| `id` | Standing grant UUID, used by existing accept/revoke operations. |
| `driverId` | Persisted driver binding; a technical UUID, not a display name. |
| `requested` | `{map:boolean, incident:boolean}` from the grant. |
| `accepted` | Persisted `{map:boolean, incident:boolean}`; false before acceptance. Historical acceptance after revocation is not current permission. |
| `status` | `pending`, `accepted` or `revoked`, with revocation taking precedence. |
| `acceptedAt`, `revokedAt` | Persisted ISO timestamps or null. |

Query only `contact_grants.contact_id=actor.id`, ordered by grant UUID ascending
before the bound. Own revoked relationships may remain minimal tombstones in this
inbox. Do not include other contacts, phone numbers, recipient IDs, raw text,
coordinates, invented inviter names or `invitedAt`: the source has no invitation
creation timestamp. No extra invitation-detail route is needed for this slice.

The existing accept operation remains authoritative: the same bound account must
present the matching verified phone, choose a nonempty subset of requested scopes
and satisfy the current state checks. Discovery neither accepts nor widens consent.

### GET /v1/contact/trips

Envelope: `{trips, readAt, limit:100, hasMore}`.

| Row field | Meaning |
| --- | --- |
| `tripId`, `grantId`, `driverId` | Persisted trip, attached standing grant and driver UUIDs. |
| `status` | Persisted `active`, `arrived` or `cancelled`. |
| `scopes` | Effective projection flags: map requires accepted map scope plus active trip/map publication; incident requires accepted incident scope. Both require the standing and trip grant to remain current. |
| `activeIncidentId` | Active incident UUID only when incident scope is effective; otherwise null, including every map-only row. |

Eligibility requires an explicit `trip_grants` attachment, accepted standing
consent, no standing or per-trip revocation, and at least one accepted scope.
Standing acceptance alone never attaches existing trips. Include active trips.
Include a closed trip only when the recipient has incident scope and an active
incident still exists; map-only contacts get no such closed-trip reference.
Revoked trip references are excluded rather than returned with protected data.
An active relationship may still have unavailable map facts; the flags are a
snapshot, not a cached capability.

Filter for eligibility before ordering/bounding. First prioritize an active
incident **only when this recipient has incident scope**; map-only priority is
constant false regardless of hidden incidents. Then order by trip creation time
descending, trip UUID descending and grant UUID ascending. This keeps authorized
unresolved incidents reachable without revealing an incident through map-only
ordering or overflow. `hasMore` still warns that the first page is incomplete.

Do not copy status/location/delivery projections into this catalog. Use returned
references for the existing status, snapshot, incident, acknowledgement/action and
revoke operations. Every protected operation rechecks current authorization. A
list authorized before a concurrent revoke may arrive later; it never authorizes
a subsequent read or permits retaining concealed data after denial/session change.

## Verification and remaining product gaps

Before source review, lane41 covers signed authentication/no-store, two accounts
with the same phone, pending/accepted/revoked inbox state, accepted consent without
trip attachment, separate map/incident scopes, both revocation modes and closed
trip with unresolved incident. Add consistent-snapshot race controls, stable
boundaries/overflow and hidden-incident ordering controls. Reads must create no
jobs, state changes or provider traffic. The original Q43 PR65 finding needs its
own reporter confirmation; these additions do not clear it.

The first general path is: provisioned recipient signs in, lists own invitations,
explicitly accepts using the existing endpoint, lists authorized shared trips,
then opens actual protected facts. Fixture-provided grant/trip UUIDs do not prove
this discovery path. Lane45/51 must preserve server time and handle empty,
unavailable, truncated, revoked and changed-session states in the actual browser.

Two gaps stay explicit: creating a contact still requires an existing recipient
account UUID, and no real inviter display name is stored. This slice supplies no
phone-only onboarding, identity directory, name inference or complete retail
contact-add flow. It does not add new status/sharing routes, policy timing,
notifications or evidence acceptance.
