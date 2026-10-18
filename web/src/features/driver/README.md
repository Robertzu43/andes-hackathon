# Driver journey controller

Memory-only, nonvisual controller for PR63 / Refs #13. The typed HTTP client,
shared app, tour and unfinished driver UI have separate owners and branches.
No private data, credential or uncertain intent is persisted by this controller.

Bind `setSession` only to the verified backend actor UUID. Rebinding the same
verified actor retains pending/unknown writes, trip and incident state. Clearing
or changing accounts retires waits and clears private state; the SDK must also
compare issuer/subject before declaring credential continuity. No bearer token
enters this module. Disposal clears listeners and private state.

Ordinary forms/commands require explicit stationary or allowed-assistance mode.
SOS bypasses that interaction gate. Auth, online transport and a known trip are
still required; a local blocked/offline action is never claimed sent. Construction,
network changes, reads and session refresh never start an automatic write.

Each explicit OK or rest report creates a new intent/key; simultaneous identical
pending calls coalesce. SOS always reaches the transport rather than returning a
cached incident. A later explicit press after uncertainty retries the original
SOS key/body; a later press after acceptance creates a new intent and lets the
server deduplicate active incidents. Arrival/cancel do not resolve an incident.

The transport returns `ok`, `rejected`, `not_sent` or `unknown`. `not_sent` proves
zero dispatch for that attempt, and does not lock a fresh intent. All confirmed
HTTP4xx, including429, remain rejected. After an earlier unknown, a new not-sent
attempt or a generic403 cannot disprove the earlier commit. Explicit
`retryUnknown(slot,{confirmed:true})` retains the exact original body/key.
For confirmation only, `contact_not_accepted`, `draft_incomplete` and
`truck_not_owned` are known rejections checked inside the actual backend's
idempotent operation after successful receipt replay; those narrow results can
release the uncertain confirmation for explicit correction. Pre-lookup
`forbidden`, authorization failures and `idempotency_conflict` cannot.

A failed initial `openTrip` never binds a mistyped/foreign trip. A confirmed trip
cannot be replaced by another journey. An unknown confirmation can be reconciled
with `openTrip` of that exact draft ID; the owner read can bind the persisted trip
and enable SOS while retaining the original uncertain confirmation receipt.
New draft IDs remain blocked. A request actually retired by the timeout stays
unknown and ignores late callbacks. Wall-clock changes do not invalidate an
acknowledgement received before that timeout executes. Client receipt time is
separate from source time and may remain unknown.

Locale is canonicalized with `Intl.getCanonicalLocales` before both draft and
confirmation sends. Country and time zone are explicit independent inputs.
`expectedArrivalAt` is an optional explicit-offset instant, never inferred.
It follows published PR74/27e4f94; the current base dfa308b does not yet implement
that additive field or status endpoint. Omit it on that base. SDK81 and the
corrected runtime must provide the real binding before the app enables it.
`refreshStatus()` uses additive `readStatus` to consume actual server checks,
incidents and distinct delivery facts; an older transport leaves it unavailable.
Status reads are bounded, source facts remain as-of-read, and a denied status
read does not erase the separately authorized incident cache.

`provideSelectionEvidence` accepts host-normalized authenticated owner catalogs,
not fabricated ownership or contact acceptance. Pending/revoked/unscoped grants
are not selectable. Backend ownership/consent is rechecked on every write.
The bounded two-truck UI guard is not a cross-device backend count constraint.
Repeated registration of the same captured label reuses its accepted intent;
new labels create distinct intents. Partial drafts do not activate trips.
Confirmation needs explicit review and complete fields; repeated confirmation
shares one immutable request/key. Historical activation receipts are marked
`invalidated` by later commands and must not be rendered as current trip status.

Snapshot capture/server receipt/read times and client receipt stay separate.
No local cadence, advancing freshness, location-based eligibility, delivery,
wellbeing or help-arrival claim is inferred. PR53's projector is retired from
production integration: the optional injected projection seam is retained only
for compatibility; leave it unbound. Notifications share one detached immutable
snapshot across at most16 listeners. At most5 write and4 read slots exist; no
history, polling, automatic resend or unbounded buffer is introduced.

## Reproduction and evidence

Use Node24–26 and the existing TypeScript5.9.3 compiler:

```sh
node --test web/tests/driver/journey.test.mjs
node "$TSC_JS" --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM web/tests/driver/contracts.types.ts
ANDES_REVIEW_DRIVER_ROOT="$PWD" node "$REVIEW_PROBES/driver-sos-safety.probes.mjs"
ANDES_DRIVER_RUNTIME_ROOT="$BACKEND_ARCHIVE" TEST_DATABASE_URL="$OWNED_TEST_DATABASE_URL" node --test web/tests/driver/persisted.integration.mjs
```

Current author result:42 native checks, strict consumer compilation,11 unchanged
independent SOS controls and6 actual signed API/PostgreSQL16.14 journeys pass.
Backend dfa308b was built in an isolated archive; all47 backend tests pass.
The same6 persisted assertions against80e9d45 produce2 passes/4 failures;
the independent11-case controls produce3 passes/8 failures at that old head.
These are author reruns, not independent confirmation of the new source.

See [gatekeeper disposition](gatekeeper-5560841617.md), original review snapshot
and untouched red/green raw results in `web/tests/driver/evidence/`.
Original published branches/reviews and all14 unfinished UI files remain
preserved. No merge, provider send, production login, physical phone qualification
or whole-app acceptance is claimed. Runtime/status/SDK integration, fresh UI
proof and independent47/gatekeeper review remain required.
