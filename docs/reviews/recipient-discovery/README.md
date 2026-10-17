# Recipient invitation and shared-trip discovery proposal

**Reviewable contract proposal, not implemented routes.** Q44 owns the interface
partition and route names; Q41 owns owner catalogs, Q45 typed transport, Q51 contact
UI and Robert the known-trip status/sharing contract. Q59 changes review artifacts
only. Internal owner acknowledgement is pending and does not prevent publication
of this proposal. No competing route, schema, adapter or foundation is added.

Codus planner: **pl_mvd1u5yz_f780e7**, “Recipient invitations and shared trips”.
The first implementation prerequisite is **Confirm the read partition**. The
planner has eight connected workflow steps, one scope note and a source/consent
verification sub-plan. It is a contract map; its terminal is proposal handoff,
not a completed product journey.

## Actual source at review intake

| Candidate | Exact head | Relevant facts |
| --- | --- | --- |
| Robert PR74 | 4c138ca1d00742400a850cd72b0888cc59260a36 | Actual status/sharing endpoints, role-based incident fan-out, demo personas |
| Integration PR68 | 938a8dfcd5d35b39ae91171dd7fe7d538c2eb2bf | Integrates owner-scoped catalog reads, not recipient discovery |
| Owner reads PR65 | 748d30c6e6c595fd1a2c2c648a045750de3dd9c8 | Profile, trucks, contacts, trips, bootstrap; contacts/trips filter driver_id=actor |

PR74's issue discussion, reviews and inline comments were fetched with complete
pagination: all empty at intake. These are unmerged source candidates, not a
statement that routes are deployed. [source-inventory.json](source-inventory.json)
records the inspected source blob IDs and route declarations.

At **PR74**, GET `/v1/trips/:id/status` **exists** in
[checks/routes.ts:19](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/src/checks/routes.ts#L19).
It accepts a known trip UUID and authorizes the driver or a current accepted,
unrevoked trip contact. Incident and delivery fields require incident scope;
location requires map scope and map_active. POST `/v1/trips/:id/sharing` also
exists and is owner-only/idempotent. Older absence statements tied to c752de8
do not describe this new candidate.

Status is not discovery: a caller must already know the trip UUID. It returns
neither top-level tripId nor server readAt at this head. The client must bind the
response to its requested trip/identity and must not manufacture a server time
anchor. GET `/v1/trips/:id/snapshot` remains the actual map-authorized read with
capturedAt, receivedAt, accuracy, ageMs, freshness and readAt. No sourceAge field
is invented. PR74's app-level hook sets no-store on responses.

At [PR68 client-read/routes.ts](https://github.com/Bimbi-Dev/andes-hackathon/blob/938a8dfcd5d35b39ae91171dd7fe7d538c2eb2bf/src/client-read/routes.ts),
GET `/v1/contacts` is outgoing driver management, and GET `/v1/trips` is the
driver's own catalog. Changing their meaning based on a UI role would conflate
two authorization domains. An empty owner list is not evidence that a contact
has no received invitation/shared trip.

## Minimal proposed capabilities

These are semantic capability names, **not published HTTP paths or DTOs**. Q44
chooses separate names or explicit response partitions with Q41 before code.
Neither accepts a caller-selected recipient, driver UUID or phone search key.
Identity always comes from the authenticated request.actor.id.

| Capability | Minimum proposed information | Boundaries |
| --- | --- | --- |
| List received invitation/grant references | grantId, driverId, requested map/incident scopes, accepted scopes or null, pending/accepted/revoked state, server readAt, fixed page bound and hasMore | Query contact_grants.contact_id=actor. Do not return other contacts, phone numbers, raw trip text, coordinates or guessed inviter names/times. Accepted scopes can remain historical after revocation; they are not current authorization |
| List currently shared trip references | tripId, grantId, driverId, accepted map/incident scopes, trip status, server readAt, fixed page bound and hasMore; optional approved truckLabel from the existing truck row | Join trip_grants and contact_grants for actor; standing accepted, both revocations absent, at least one accepted scope. Return identifiers needed for current protected reads and trip revoke, not copied status/location/delivery projections |

An invitation lookup for a known grant ID may be a filtered use of the same
recipient-owned read, if Q44 chooses it. It must enforce the same actor predicate;
being given a grant UUID is never authority. Empty results, unavailable reads and
truncated results must remain distinct in the UI. Use stable order plus an
explicit bound; hasMore=true must not be labelled “all invitations/trips”. Cursor
pagination or exhaustive retrieval is a further owner decision, not claimed here.

The two reads should carry a server-owned readAt for their own query result.
That field means when the server assembled the read; it is not invitation creation
time, location capture time, or a promise that later authorization is unchanged.
Do not copy a browser timestamp into readAt. Current contact_grants has no
created_at column, so invitedAt cannot be supplied without a separately approved
source/schema change. Existing accepted_at/revoked_at may be exposed if needed,
without fabricating missing timestamps.

## Authorization follows the existing model

The existing [accept route](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/src/contacts/routes.ts#L17)
requires contact_id=actor, a verified token phone exactly matching the invitation,
a nonempty subset of requested scopes, and no accepted/revoked conflict. A phone
match alone never selects another identity's invitation. Discovery must not
silently accept, widen scope or send a notification. A pending invitation may be
visible to its bound account while accept still returns verified_phone_mismatch;
UI readiness must not bypass that server check.

[Trip confirmation](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/src/trips/routes.ts#L40)
attaches explicitly selected accepted grants to trip_grants. **Standing acceptance
does not automatically attach an existing trip.** An accepted contact with no
trip_grants row must not acquire shared-trip discovery from driver_id alone.

| Case | Invitation/grant inbox | Shared-trip reference and subsequent facts |
| --- | --- | --- |
| No verified session / expired JWT | Unauthorized | Unauthorized; retire old-session caches |
| Different account, even same phone | No other identity's invitation | No other identity's trip |
| Bound account, pending invitation | Pending requested scopes only | No trip access from pending consent |
| Phone unverified or does not match | Do not treat discovery as acceptance | Existing accept refuses; no manufactured grant |
| Accepted standing grant, no trip attachment | Accepted standing state | No shared trip |
| Accepted map only, attached and unrevoked | Historical accepted scopes | Current trip reference/status; snapshot only while map_active; no incident ID or deliveries |
| Accepted incident only, attached and unrevoked | Historical accepted scopes | Current trip reference/status/incident reads; no location/coordinates |
| Both accepted, attached and unrevoked | Historical accepted scopes | Both independently authorized fact domains |
| Standing revoke | Own revoked state may remain historical | No new shared-trip reference or protected read |
| Trip-only revoke | Standing consent remains for other trips | Exclude that trip; do not imply global revocation |
| Arrived/cancelled trip with unresolved incident | Standing state unaffected | Authorized incident contact must still discover/reach the unresolved incident; do not filter every closed trip out |
| List/read races with revoke | Result was a past server read | Recheck on every protected detail/action; clear concealed data on denial, never use cached list flags as a capability |

Map inactive means map unavailable, not incident resolved. Arrival/cancel commands
do not resolve active incidents; [incident reads/acknowledgements](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/src/incidents/routes.ts#L31)
check incident consent without requiring an active trip. Only the driver resolves.
If active-incident trips receive priority in a bounded list, compute that priority
only for incident-authorized recipients so ordering does not reveal incident
existence to map-only contacts. Publish overflow behavior; do not hide urgent
authorized work behind an unexplained first-page cutoff.

The proposed eligibility predicates intentionally do not add a new verified-phone
requirement to every read: current status/map/incident authorization uses bound
account and accepted grants. The accept and delivery paths have their own phone
checks. Any stronger read policy is an explicit Robert/owner contract change.

## What this enables, and what it does not

The contact opens their own inbox, reviews actual requested scopes, explicitly
accepts through the existing endpoint, then chooses a discovered shared-trip
reference. The UI uses returned IDs for existing status/snapshot/incident and
revoke operations; no UUID guessing or synthesized grant metadata is needed for
that already-provisioned account/grant path. A fresh status can supply the latest
authorized incident ID for that known trip at PR74; it does not discover which
trip to open initially.

Two honest product gaps remain. Driver POST `/v1/contacts` still requires an
**existing recipient identity UUID** plus phone; this proposal does not implement
phone-only invitations, create an identity, search an identity directory or prove
that arbitrary new recipients can be invited. Also identities has no display name:
driverId is a technical key, not proof that a person can recognize the inviter.
Q44/Q41 must choose a consented existing display source or keep that recognition
gate explicit. No invented name/plate/country or unapproved phone disclosure fills
the gap. A truck label can distinguish authorized trip rows but does not identify
the human inviter by itself.

The reads are SQL-only and require no provider call or notification. Existing
delivery work stays in Robert's current durable job/outbox pipeline. Reusing
contact discovery must never introduce synchronous SMS/WhatsApp/voice sends or
equate a list/acceptance receipt with delivery, assistance, safety or wellbeing.

## Owner handoff and future verification

Q44 freezes capability names, response partition, list ordering and ownership;
Q41 implements only the agreed owned read seam. Q45 normalizes the published DTOs
and preserves server readAt; Q51 binds UI selection/session retirement and honest
empty/error/truncation states. Robert confirms any changed privacy/lifecycle
policy. Current reviewer/human confirmation remains separate from this proposal.

Before claiming implementation complete, the responsible lanes should use owned
isolated SQL/HTTP fixtures for the matrix above, verify no-store and stable bounded
ordering, and assert reads have no writes/jobs/sends. Compare denied/incomplete
controls with authorized positive controls, including real accepted standing
consent without attachment and closed trip with active incident. Then verify the
actual contact inbox → invitation → shared trip path with authenticated browser
state, ES/PT-BR copy, session changes and revocation. Fixture-provided UUID hints
cannot stand in for discovery. No shared DB, .env, server, provider, deployment or
UI evidence was used/claimed in Q59's source-only proposal review.
