# Provisional client event boundary for #18

This is an author-owned #19 boundary for discussion with **@Robertzu43**, the
accountable #18 event-contract owner and #21 server-state owner. No frozen
client/server contract was present at base
`bc8eeabfe5220e66a83be972b480a1d1ae8d87d2`. This schema implements no Robert-owned
API, server receipt, state machine, upload or integration. #19 remains blocked
on #18 agreement and physical qualification. No issue should close from this PR.

Every event uses `andes.phone-observations.provisional/1`,
`category: 'phone-observation'` and `interpretation: 'observation-only'`.

| #18 requested concept | Local representation / unresolved boundary |
| --- | --- |
| Event/trip/session IDs | Opaque caller `tripId`; event ID includes a cryptographically random adapter-instance identity, generation and monotonic emission sequence. Trip-factory start and every resume create a fresh runtime `sessionId`; direct adapter callers supply a fresh session ID for independently started sessions. |
| Truck reference | Optional opaque `truckId`, otherwise `null` |
| Sequence | `sequence` increases across this adapter's lifetime; `sessionSequence` starts at 1 for each explicit session. Callback arrival order is preserved; duplicate/reordered sources are not deduplicated into new facts. |
| Source time | Location: `{ value, basis: 'unix-epoch-ms', provenance: 'position.timestamp' }`; motion: `{ value, basis: 'dom-event-ms-unreconciled', provenance: 'event.timeStamp' }`. Unknown values are `null`; control events have `sourceTime: null`. |
| Receipt time | `clientReceiptTime: { wallMs, monoMs }` captures the local callback/event observation. `serverReceiptTime: null` always. The backend must assign its own receipt and reconciliation evidence. |
| Latency and skew | `provenance.clock: 'device-unreconciled'`, `serverLatency: 'unknown'`; sticky `clockUncertain` if either clock is missing, monotonic regresses or wall/monotonic elapsed values diverge beyond a provisional tolerance. No cross-device latency precision. |
| Offset / IANA zone | `utcOffsetMinutes: null`; `timeZone: { value: null, provenance: 'unknown' }`. Epoch source values are instants, not local-hour claims. #18 must agree explicit source offset/zone provenance before local-hour derivation. No agreed deadline exists or is moved here. |
| Country / locale | `country: { value: null, provenance: 'unknown' }`. No phone prefix, IP, coordinates or device zone is used to invent country. Driver/contact locale and report context are outside this observation module. |
| Revision / policy | Caller `revision` and explicit `budgetRevision`; `policyVersion: null` because #18/#21 policy is not supplied. |
| Permission / visibility | Per-stream `{ state, browserState, source }`, plus the page's current `visibility` or `unknown`; the snapshot is not evidence of continued OS permission. |
| GPS accuracy / age / provenance | `data.accuracyM`, `ageMs`, `freshness`, `sourceOrder`, exact request ID/options and `locationSource: 'browser-geolocation-underlying-source-unknown'`. API availability does not prove a GPS receiver source. |
| Route progress / motion change | `routeProgress: 'unknown'`, `candidateMotionChange: 'unclassified'`; no accepted route geometry/change threshold or classifier is supplied. |
| Device liveness | A callback establishes only that this page observed that callback. No liveness assertion survives gaps, lock, page kill or shutdown. |
| Reports, prompts, sends, delivery, responses, wellbeing, independent outcomes | Not emitted. These remain separate Robert-owned #18/#21 facts, including fatigue/rest/security reports and contradictory accounts. |
| Sensitive evidence | Precise position is redacted unless request-specific consent/purpose is provided. Opaque references only; external storage/access control is not implemented. |

Location age is a signed `client wall - source wall` measurement. Negative,
missing, clock-uncertain or threshold-unset ages retain `freshness: 'unknown'`.
Other ages become `stale` or `within-provisional-budget`, never a safety or device
qualification claim. A motion DOM timestamp is not converted into an invented
epoch or source/server receipt. Its physical acquisition time and freshness are
unknown. Identical location source times are preserved; emitted source times
earlier than the request's previous emitted maximum are flagged `reordered`.

The sink receives events synchronously once. Buffer eviction, rate suppression,
callback budgets, cleanup failures and consumer errors have explicit local
summaries; they are not delivery outcomes. Each request's events retain their
original request ID and options. Session cleanup retires request tokens before
unsubscription, so late callbacks do not become events in a newer session.
GPS error, local timeout and platform-failure events carry the original `watch`
and `options` alongside `requestId`, even after eviction of the request event.
Conflicting passive permission observations are retained as `permission-observed`
with `applied: false` once the session's permission is denied/revoked. They do not
replace the terminal state's original provenance or reopen acquisition.

Before integration, Robert and Sebastian must agree versioned field names,
timestamp/zone encoding, server reconciliation, IDs/deduplication, country/locale
provenance, consent references/access control, policy versions and resource
budgets. The backend must keep observer ground truth and attributed reports
separate from any rule output. The synthetic fixtures supply no qualified
phone stream, incident denominator, independently observed event or replay claim.

## Lifecycle handoff after Robert's review

`session-stop` now carries `data: { reason, sharingState: 'stopped', resumable }`
for every executable terminal path. It retains the same trip/session/revision
envelope and null source/server times. One extra terminal slot survives an
exhausted ordinary budget; sink-triggered stop is delivered after that sink returns.
This is not an acknowledged server sharing transition. Q42 owns queue mapping;
Robert owns any new `/sharing` endpoint, its idempotency and state semantics.
No such route existed at inspected backend c752de8a3b424bcbc086764dc11052348b27e320.

`resume()` creates another adapter generation with a fresh runtime session ID in the same trip
only after an explicit gesture, and never consumes old callback tokens. Wake-lock
requested/held/released/unavailable events are local capability observations.
Browser-managed motion retains unknown permission rather than inventing a grant.
Default high accuracy is a request hint; emitted request options and measured
accuracy remain independent. See [Robert disposition](robert-review-fixes.md).
