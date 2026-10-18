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
branch `codex/aws-durable-backend`, not merged here).
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

Real-browser IndexedDB behaviour (quota, eviction, concurrent tabs) is not
exercised by this slice's Node tests; it is follow-up evidence once the shared
frontend foundation exists. Concurrent-tab writers are out of scope here.

## Queue semantics (`queue.mjs`)

- **Bounded**: 2000 retained records (`QUEUE_LIMITS.capacity`). Overflow evicts
  the oldest `pending` record, counted as `droppedOverflow`. Records in flight
  (`uploading`) are never evicted.
- **Scoped**: every record carries `tripId` + `userId` (the signed-in owner's
  OIDC sub, supplied by the host — never read from an event). Enqueue and
  drain are scoped; a flush uploads only the current subject's records.
- **Retention mirrors the server window**: captures older than 24 h or more
  than 30 s in the future are dropped with `droppedOutOfBounds` — at enqueue
  and again at batch time, so aged-out records are never sent to a guaranteed
  400. Duplicate capture timestamps within a trip keep the first queued copy
  (`droppedDuplicate`), matching the server's first-commit-wins rule.
- **Crash recovery**: on open, records left in `uploading` by an interrupted
  page return to `pending` once, counted as `recoveredAfterInterruption`.
- **Revocation**: `wipeScope({ tripId, userId })` deletes every retained record
  for the scope, counts `wipedByRevocation`, and remembers the scope as revoked
  so late sink events cannot re-enter. Consent withdrawal is deletion, not a
  "stop uploading but keep" mode. The host must separately call the adapter's
  own `revokeConsent()` to stop capture.
- **Per-trip exposure**: `scopeCounts({ tripId, userId })` returns
  `{ pending, uploading, failed, unsent, revoked }` so a host can honestly
  render "N samples not yet sent" / "storage unavailable" / "queue wiped"
  without inventing delivery state.
- **Failed is a retained state**: records that exhaust upload attempts stay in
  the queue as `failed` for inspection (`failedRetained`). Nothing is silently
  discarded.
- **Sign-out is deletion**: `wipeUser(userId)` deletes every retained record
  for the subject, counts `wipedBySignout`, and revokes all of their scopes
  **for the session only** — the revocation is held in memory, never
  persisted, so sign-out leaves no owner/trip plaintext in durable meta.
  (Per-trip consent revocation via `wipeScope` IS persisted: it must survive
  restart to block re-entry.) Used by `pipeline.signOut()`.
- **Ambiguous intent is durable**: `setStickyIntent(scope, {samples, key,
  queueIds})` persists an unacknowledged batch's exact content + idempotency
  key into queue meta; `stickyIntent` / `stickyScopes` / `clearStickyIntent`
  expose it. A reload cannot lose the original intent, so a retry can never
  regrow or rekey. Wipes clear the intent with the records.

## Upload bridge (`upload.mjs`)

Written directly against the runtime contract (see above for its location):

- `POST {baseUrl}/v1/trips/{tripId}/locations` with `Authorization: Bearer`
  from the host's `getAccessToken`, `Content-Type: application/json`, and an
  `Idempotency-Key` derived as `loc1-<sha256hex>` of the canonical batch
  descriptor (`{ v, route, tripId, samples }`). Same content → same key, so a
  reconnect retry replays the server's persisted response instead of
  double-inserting. 74 visible ASCII chars, within the 1–128 contract bound.
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
  the exact intent is pinned durably, `receiptMismatches` is counted and the
  pump halts for operator attention. The next flush replays the identical
  payload under the identical key.
- **Ambiguous outcomes are sticky AND durable.** On a network error, 5xx or
  unverifiable receipt the server may already hold the batch, so the records
  stay `uploading` and the exact `(samples, idempotency key, queueIds)` are
  persisted per scope in queue meta (`setStickyIntent`). The next flush —
  including the first flush after a page reload or crash — retries that
  identical payload BEFORE any new batch is taken; newer samples always
  follow as their own batch with their own key. A retry never regrows or
  rekeys, so a re-POST can never produce an `idempotency_conflict`. If the
  records were wiped while sticky, the intent is abandoned with them. Sticky
  retries consume attempts and can exhaust `maxAttempts` into the retained
  `failed` state like any other failure.
- **Retirement gates, synchronous where it matters.** The token is resolved
  first, then the batch records are re-read; a FINAL synchronous check of
  `stopped` and `isScopeRevoked` sits after the last await, immediately
  before `fetch` — nothing can interleave between the check and the request.
  A second synchronous gate after the response arrives prevents ALL local
  side effects (receipt write, deletion, counters) when stop/signOut/revoke
  landed while the request was in flight: unconfirmed is never deleted, and
  no receipt fact is recreated after sign-out.
- `unacknowledgedBatches` in `state()` counts sticky batches awaiting a valid
  receipt.

Other responses:

| Server response | Bridge behaviour |
| --- | --- |
| valid 2xx receipt | Records deleted, `uploaded` counted, receipt stored as a fact |
| 401 / 403 / token unavailable | `auth-blocked`; records stay pending, attempts NOT burned (host problem, not retry budget) |
| 400 `capture_time_out_of_bounds` | Permanent; `rejectedBounds` (should be unreachable given client-side window checks) |
| 400 / 422 other | Permanent; `rejectedValidation` |
| 404 | Permanent; `rejectedMissing` |
| 409 `location_stopped` | Records stay pending without burning attempts; scope skipped for the rest of the flush; `tripStoppedRejections` counted. A map can be reactivated, so the samples are retained for a later flush |
| 409 `idempotency_conflict` | Permanent; `conflictErrors` — deterministic keys make this a client defect signal, never retried |

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
missing/non-epoch source time → `droppedBadSourceTime`. The pipeline declares
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

53 tests covering the queue (bounds, dedupe, overflow, FIFO, recovery,
revocation, persistence across reopen, per-scope unsent exposure), the bridge
(contract shape, batching, idempotent reconnect retry, every response class,
owner scoping, stop, sticky ambiguous-batch retries — including across a full
queue+uploader restart —, receipt validation, final synchronous retirement
gates before fetch and after response, network exhaustion) and the pipeline
boundary (source-time preservation, redaction honored, no-route counts,
lifecycle intent, synchronous sink contract, sign-out wipe, sign-out privacy
and in-flight receipt suppression). Real-browser IndexedDB storage tests are
follow-up evidence after the shared frontend foundation lands.
