# Browser durable observation queue and upload bridge

Lane 42 deliverable. Framework-neutral ES modules under
[`web/src/lib/observations/`](../../web/src/lib/observations/), dependency-free,
tested with Node's built-in runner and injected in-memory stores.

```
adapter sink ──► pipeline.mjs ──► queue.mjs ──► upload.mjs ──► POST /v1/trips/:id/locations
                 (sync boundary    (IndexedDB    (idempotent
                  + staging)        durable)      batched drain)
```

## What this is and is not

It durably queues **consented location samples** captured by the
[#19 phone observation adapter](../phone-observations/README.md) and uploads
them to Robert's backend (runtime contract: `docs/contracts/runtime.md` on
`main`).
It has no UI, no SOS path, no automatic sensor start, no freshness or liveness
claims, and no invented endpoints. An upload receipt is a server receipt fact —
never evidence that a trip is healthy, fresh or being tracked right now.

**Source-backed gap:** the backend currently accepts location samples only.
Adapter motion, permission and other observation events have no route. They are
dropped at the pipeline boundary with an explicit `unmappedNoRoute` count — not
queued, not uploaded anywhere. Geolocation events whose coordinates were
redacted at acquisition (no per-request consent) are likewise never queued
(`droppedNoCoordinates`). A route for non-location observation evidence is an
#18 contract decision and is reported as a gap, not worked around.

**Lifecycle intent is local and separate from samples.** `session-start` /
`session-stop` events are observed into a page-lifetime intent map
(`lifecycleObserved`, per-trip `tripStatus()`), never staged, never uploaded,
never treated as delivery evidence. Trip stop intent is NOT reported to the
backend: Robert's `/sharing` stop endpoint does not exist in the fetched
contract (`codex/aws-durable-backend` @ `ebc8fb1`), and this module does not
POST to unimplemented paths or invent a success shape. When that endpoint
lands, stop reporting is a separate binding — the queue only exposes
`tripStatus(tripId)` = latest intent + durable unsent counts, where `unsent` is
queue occupancy, not a freshness or trip-health statement.

## Storage boundary

The queue talks to two narrow key/value collections (`records`, `meta`) behind
the contract in `store.mjs`. `idb-store.mjs` implements it over IndexedDB;
tests inject an in-memory double. If IndexedDB is missing, blocked or refused,
`openObservationStores()` returns `{ ok: false, reason }` — the host must
surface an explicit storage-unavailable state. There is no silent memory
fallback that would pretend durability.

**Concurrency.** Every queue mutation runs under one origin-wide Web Lock
(`navigator.locks`, `andes-observation-queue`) and re-reads storage inside it;
nothing durable is cached in memory. Two tabs, or an in-flight upload and a
sign-out wipe in one tab, therefore never interleave a read-modify-write: a
wiped record is never re-created, queue ids never collide and a stale tab
cannot erase another tab's revocation tombstone. Without Web Locks (browsers
older than 2022) the lock only serialises one tab. Opening the queue resets
`uploading` records to `pending`, including another live tab's in-flight
batch; the server keeps the first sample per capture time, so the possible
resend is harmless.

Real-browser IndexedDB behaviour (quota, eviction) is not exercised by this
slice's Node tests; it is follow-up evidence once the shared frontend
foundation exists.

## Queue semantics (`queue.mjs`)

- **Bounded**: 2000 retained records (`QUEUE_LIMITS.capacity`). Overflow evicts
  the oldest `failed` record, then the oldest `pending` one, counted as
  `droppedOverflow`. Records in flight (`uploading`) are never evicted.
- **Scoped**: every record carries `tripId` + `userId` (the signed-in owner's
  OIDC sub, supplied by the host — never read from an event). Enqueue and
  drain are scoped; a flush uploads only the current subject's records, and
  only with a bearer token whose `sub` is that subject (see the bridge).
- **Retention mirrors the server window**: captures older than 24 h or more
  than 30 s in the future are dropped with `droppedOutOfBounds` at enqueue.
  Every enqueue and every open sweeps the whole store: records of any owner
  and state (including `failed`) whose capture is older than 24 h, records of
  revoked scopes, and durable intents holding either, are deleted. At batch
  time a capture within 60 s of the 24 h edge is dropped rather than sent to a
  guaranteed 400, and one within 5 s of the +30 s edge is held (still
  `pending`) until it is safely inside. Duplicate capture timestamps within a trip keep the first queued copy
  (`droppedDuplicate`), matching the server's first-commit-wins rule.
- **Crash recovery**: on open, records left in `uploading` by an interrupted
  page return to `pending` once, counted as `recoveredAfterInterruption`.
- **Revocation**: `wipeScope({ tripId, userId })` marks the scope revoked
  synchronously (so a sample reaching the sink meanwhile is refused), persists
  the tombstone before deleting anything, then deletes every retained record
  and intent for the scope and counts `wipedByRevocation`. `takeBatch` yields
  nothing for a revoked scope. The persisted tombstone is a one-way
  FNV-1a hash of the scope pair, never owner/trip plaintext — consent must
  survive restart, but the identity does not need to sit in durable meta to
  do that (reversing the hash requires already knowing both UUIDs). Consent
  withdrawal is deletion, not a "stop uploading but keep" mode. The host must
  separately call the adapter's own `revokeConsent()` to stop capture.
- **Per-trip exposure**: `scopeCounts({ tripId, userId })` returns
  `{ pending, uploading, failed, unsent, revoked }` so a host can honestly
  render "N samples not yet sent" / "storage unavailable" / "queue wiped"
  without inventing delivery state.
- **Failed is a retained state**: records that exhaust upload attempts stay in
  the queue as `failed` for inspection (`failedRetained`) until their capture
  leaves the 24 h window, and are the first evicted when capacity is full.
- **Sign-out is deletion**: `wipeUser(userId)` deletes every retained record
  for the subject, counts `wipedBySignout`, and revokes all of their scopes
  **for the session only** — the revocation is held in memory, never
  persisted, so sign-out leaves no owner/trip plaintext in durable meta.
  (Per-trip consent revocation via `wipeScope` IS persisted: it must survive
  restart to block re-entry.) Used by `pipeline.signOut()`.
- **Ambiguous intent is durable**: `setStickyIntent(scope, {samples, key,
  queueIds, sessionId})` persists an unacknowledged batch as its own meta
  record (`intent:<userId> →<tripId>`) holding the exact replay contract —
  `intent: { key, body, userId, tripId, sessionId }` — plus the owning
  `queueIds`. `stickyIntent` / `stickyScopes` / `clearStickyIntent` expose
  it. A reload cannot lose the original intent, so a retry can never regrow
  or rekey. Wipes delete the intent record with the records, and no intent is
  written for a revoked scope or once any of its records is gone, so a late
  failure cannot resurrect wiped coordinates.

## Upload bridge (`upload.mjs`)

Written directly against the runtime contract (see above for its location):

- `POST {baseUrl}/v1/trips/{tripId}/locations` (trailing slashes on `baseUrl`
  are ignored) with `Authorization: Bearer` from the host's `getAccessToken`,
  `Content-Type: application/json`, and an `Idempotency-Key` derived as
  `loc1-<sha256hex>` of the canonical batch descriptor
  (`{ v, route, tripId, samples }`). Same content → same key, so a reconnect
  retry replays the server's persisted response instead of double-inserting.
  69 visible ASCII chars, within the 1–128 contract bound.
- **Owner scoping.** `flush({ userId })` sends only that subject's records; a
  flush with no owner yet (an `online` event before the first scoped flush)
  sends nothing. Before every request the token's JWT `sub` (decoded, not
  verified; the server verifies) must equal the batch's `userId`, otherwise
  nothing is sent, the records stay `pending` and the pump reports
  `auth-blocked` / `token-owner-mismatch`. One owner's coordinates never
  travel with another identity's credentials; an opaque token is refused.
- Batches of at most 100 samples (`batchSize` is validated against the server
  maximum), drained FIFO per scope, up to 10 batches per flush.
- Source timestamps are preserved end to end: `capturedAt` is the adapter
  event's `sourceTime.value` (basis `unix-epoch-ms`, provenance
  `position.timestamp`) rendered as ISO. Client receipt time is never
  substituted. Samples lacking a source time, coordinates or a finite accuracy
  never reach the wire (the server schema requires all four fields).

Receipt handling — a batch is deleted only when the response **proves** it:

- **2xx is not enough on its own.** The body must decode as JSON, `body.id`
  must equal the target trip id and `body.received` must equal the number of
  samples sent. Anything else is a `receipt-mismatch` — and it is treated as
  AMBIGUOUS (the server may have persisted the batch): nothing is deleted,
  the records settle back to `pending` as retained unsent work, the exact
  intent is pinned durably, `receiptMismatches` is counted, an attempt is
  spent and a backoff retry is scheduled. The retry replays the identical
  payload under the identical key; after `maxAttempts` the records are
  retained as `failed`.
- **Ambiguous outcomes are sticky AND durable.** On a network error, 5xx or
  unverifiable receipt the server may already hold the batch, so the exact
  `(body, idempotency key)` are persisted per scope as a durable intent
  record (`setStickyIntent`) and the records are released back to `pending`
  — `uploading` only ever means "a request is in flight right now"; the
  retry contract lives in the intent, not in record state. The next flush —
  including the first flush after a page reload or crash — retries that
  identical payload BEFORE any new batch is taken; newer samples always
  follow as their own batch with their own key. A retry never regrows or
  rekeys, so a re-POST can never produce an `idempotency_conflict`. If the
  records were wiped while sticky, or a sample has aged to within 60 s of the
  24 h edge, the intent is abandoned and the survivors regroup under a new key.
  **Network errors and timeouts never spend retry budget**: being offline
  cannot fail a sample; it is resent on the next backoff retry or `online`
  event. 5xx and unverifiable receipts do spend it.
- **Retirement gates, synchronous where it matters.** The token is resolved
  first, then the batch records are re-read; a FINAL synchronous check of
  `stopped` and `isScopeRevoked` sits after the last await, immediately
  before `fetch` — nothing can interleave between the check and the request.
  A second synchronous gate after the response arrives prevents ALL local
  side effects (receipt write, deletion, counters) when stop/signOut/revoke
  landed while the request was in flight: unconfirmed is never deleted, and
  no receipt fact is recreated after sign-out. The same gate sits in the
  rejection path: an ambiguous network failure surfacing after retirement
  settles the records without pinning a new sticky intent, so a post-sign-out
  rejection cannot re-persist owner/trip/sample plaintext. `stop()` also aborts
  the request on the wire; `pipeline.stop()`/`signOut()` stop the uploader
  before any await.
- **Timeouts cover the body.** `requestTimeoutMs` (15 s) spans the request and
  the response body, so a stalled body cannot hang the shared flush. A
  client-side failure (store error, missing `crypto.subtle`) releases the
  batch back to `pending` instead of leaving it `uploading`.
- `unacknowledgedBatches` in `state()` counts sticky batches awaiting a valid
  receipt.

Other responses:

| Server response | Bridge behaviour |
| --- | --- |
| valid 2xx receipt | Records deleted, `uploaded` counted, receipt stored as a fact |
| 2xx that is not a valid receipt | Ambiguous: intent pinned, attempt counted, backoff, `receiptMismatches` |
| network error / timeout | Ambiguous: intent pinned, attempt NOT counted, backoff and `online` retry |
| 401 / token unavailable / token `sub` ≠ owner | `auth-blocked`; records stay pending, attempts NOT burned |
| 403 `forbidden` | That trip is skipped for this flush; records stay pending (they expire with the window); other trips still upload |
| 400 `invalid_request` / `capture_time_out_of_bounds`, several samples | Nothing deleted: the batch is halved until the offending sample is isolated |
| 400 `invalid_request`, one sample | Permanent; `rejectedValidation` |
| 400 `capture_time_out_of_bounds`, one sample older than 12 h | Permanent; `rejectedBounds` |
| 400 `capture_time_out_of_bounds`, one recent sample | Device clock ahead of the server: attempt counted, backoff, resent later |
| 404 `trip_not_found` | Permanent; `rejectedMissing` |
| 404 with any other code (e.g. route not found) and other 4xx | Retried with backoff, attempt counted; nothing deleted |
| 408 / 429 | Retried with backoff, attempt NOT counted |
| 409 `location_stopped` | The trip is closed for good (the backend only clears `map_active` on arrival/cancel): the scope is wiped and tombstoned, `tripStoppedRejections` counted, never retried |
| 409 `idempotency_conflict` | Permanent; `conflictErrors` — deterministic keys make this a client defect signal, never retried |
| 5xx | Ambiguous: intent pinned, attempt counted, backoff |

`flush()` is idempotent (concurrent callers join the same in-flight drain) and
reconnect-aware: an optional injected `onlineTarget` (e.g. `window`) re-triggers
a flush on `online`. Backoff retries use an injected `timers` object, so tests
drive them deterministically. `navigator.onLine` is never trusted as a gate.

## Sink boundary (`pipeline.mjs`)

The adapter requires a **synchronous** sink (a thenable or a throw counts as a
sink error). IndexedDB writes are async, so the sink validates and maps
synchronously into a small bounded staging list (512) and an immediately
scheduled serialized drain persists to the queue. Events killed mid-staging are
lost — a documented, counted window (`stageOverflow`, `persistErrors`), closed
best-effort by awaiting `pipeline.drain()` before `pagehide`. The sink never
throws and never returns a value.

Mapping rules, all counted at the boundary: schema mismatch → `unmappedSchema`;
non-geolocation types → `unmappedNoRoute`; redacted coordinates →
`droppedNoCoordinates`; missing accuracy → `droppedMissingAccuracy`;
missing/non-epoch or out-of-range source time → `droppedBadSourceTime`. The pipeline declares
the schema string itself and deliberately does not import the adapter module —
`web/` consumes the event shape, not the tools tree.

## Host wiring

```js
import { openObservationStores, openObservationQueue, createLocationUploader, createObservationPipeline }
  from './lib/observations/index.mjs';

const opened = await openObservationStores();
if (!opened.ok) { /* render explicit storage-unavailable state */ }
else {
  const queue = await openObservationQueue(opened.stores);
  const uploader = createLocationUploader({
    queue, baseUrl: 'https://api.example.com',
    getAccessToken,           // host OIDC session; tokens are never stored here
    onlineTarget: window,     // reconnect trigger
  });
  // ownerSubject MUST be the `sub` claim of the tokens getAccessToken returns;
  // the uploader refuses to send a batch with a token for any other subject.
  const pipeline = createObservationPipeline({ queue, uploader, ownerSubject: oidcSub });
  const adapter = createPhoneObservationAdapter({ sink: pipeline.sink /* + qualification, contextKey */ });
  // adapter.start(...) / acquireLocation(...) remain explicit, gated, host-driven
  // on trip close: await pipeline.revokeTrip(tripId); adapter.stop();
  // on owner sign-out: await pipeline.signOut();  // wipes all owner records, revokes scopes
}
```

## Verify

Node 24.17 (app-supported runtime), no install, no server, no device:

```sh
node --test web/tests/observations/*.test.mjs
```

78 tests covering the queue (bounds, dedupe, overflow, FIFO, recovery,
revocation, persistence across reopen, per-scope unsent exposure), the bridge
(contract shape, batching, idempotent reconnect retry, every response class,
owner scoping, stop, sticky ambiguous-batch retries — including across a full
queue+uploader restart —, receipt validation, final synchronous retirement
gates before fetch and after response, network exhaustion) and the pipeline
boundary (source-time preservation, redaction honored, no-route counts,
lifecycle intent, synchronous sink contract, sign-out wipe, sign-out privacy
and in-flight receipt suppression), plus one regression test per finding of
the gatekeeper review of `170e83a` (owner/token scoping, sign-out and
revocation races swept over store timings, two-tab writes, offline retries,
closed trips, per-sample isolation and window margins, error codes, per-trip
403, expiry, stuck uploads and far-future source times). Real-browser IndexedDB storage tests are
follow-up evidence after the shared frontend foundation lands.
