# Phone observation adapter — preparatory #19 tooling

Framework-neutral browser ES module: [`adapter.mjs`](../../src/phone-observations/adapter.mjs).
It emits **local phone observations** to an injected synchronous sink. It has no
transport, backend endpoint, provider, notification, persistence, crash/assault
detector, sleep/fatigue classifier or wellbeing inference. Silence remains unknown.
The intended product serves independent Latin American freight owner-operators,
including Brazil, with one or two trucks. This module establishes no country,
language, browser or physical-device support.

The merged [#9 matrix](../evidence/phone-capability/result-matrix.csv) is entirely
`not-run`. No real stream is enabled by default. Physical qualification, matched
battery/data recordings, accepted budgets and independent review remain outstanding.
This implementation does not complete the physical evidence requirements of #19.

## Use and lifecycle

```js
import { createPhoneObservationAdapter } from '../../src/phone-observations/adapter.mjs';

const adapter = createPhoneObservationAdapter({
  sink: (event) => { /* bounded, local-only consumer */ },
});
adapter.start({ sessionId: 'unique-session', tripId: 'opaque-trip', revision: 'build-sha' });
// Even inside a click handler, this returns { ok: false, reason: 'unqualified' }.
adapter.acquireLocation();
adapter.stop();
const localSnapshot = adapter.snapshot();
```

Construction attaches nothing. `start` installs only a bounded session deadline
and visibility/page lifecycle listeners; it neither queries permissions nor
acquires sensors. Each new session needs an externally unique opaque `sessionId`,
an opaque `tripId` and a build revision. An optional `truckId` remains an opaque
reference. Caller context is copied. Calling `start` while active throws.
Event IDs also include a cryptographically random adapter-instance identity, so
recreating an adapter cannot repeat its event IDs. The trip factory generates
a fresh runtime session ID on every start; resume generates another fresh session
ID before resetting `sessionSequence`. The trip factory requires `tripId` and
`revision`; a legacy input `sessionId` is ignored. `snapshot().sessionId` exposes
the actual runtime identity. Direct adapter
callers must still provide a fresh session ID for each independently started session.

Only explicit `acquireLocation({ watch: false })`,
`acquireLocation({ watch: true })` or `acquireMotion()` can initiate acquisition.
Both require a secure context, visible page and qualification. Initial acquisition
requires browser activation, or `withUserGesture(event, action)` called synchronously
inside a trusted native click, pointerup, touchend or Enter/Space keydown dispatch.
The bridge checks the native Event instance, `isTrusted`, currentTarget and eventPhase;
a retained event, synthetic dispatch or boolean cannot substitute. It supports
browsers without `navigator.userActivation` without creating background prompts.
An already observed granted stream can be explicitly reacquired in the same session.
When present, motion `requestPermission` is invoked synchronously and requires a
grant. Otherwise an exposed DeviceMotionEvent can use browser-managed event delivery:
permission stays unknown, and qualification/gesture/visibility gates still apply.
This supplies no Android or Safari physical support claim.

`stopLocation` and `stopMotion` invalidate their request tokens before cleanup.
`stop` and `revokeConsent` stop both streams, timers and permission/lifecycle
subscriptions. These operations are idempotent. A stopped session can be replaced
with a new explicit `start`; callbacks retain their original session/request and
cannot enter the replacement. One-shot requests settle once. Hidden pages,
`pagehide` and `freeze` terminate the session with no automatic resume. Each
termination delivers one `session-stop` with reason, `sharingState: 'stopped'`
and resumable status, including budget exhaustion and reentrant sink withdrawal.
One terminal slot is reserved beyond the ordinary event cap. Explicit stop or
consent withdrawal while suspended delivers one additional `session-stop` with
the final reason and `resumable: false`; repeated calls emit nothing further.
Consumers should apply the latest intent for that session. It is a local signal,
not server receipt; a killed process may never execute lifecycle handlers.

`resume()` requires an explicit new gesture on a visible page after suspension or
a normal duration/event budget stop. It creates a new generation for the same
trip with a fresh runtime session ID and restores requested location/motion/wake-lock intents.
Old callbacks remain inert. Consent withdrawal, explicit stop, denied/revoked
permissions and clock failures cannot be bypassed by resume. Results retain each
requested stream outcome; no location success is inferred from session start.
Explicit stop while already suspended cancels resume intent as well. Denial of
optional motion cannot block an otherwise permitted GPS resume; its separate
motion result remains denied and no new motion request is made.

`requestWakeLock()` optionally requests a screen wake lock with bounded waiting.
Unsupported, rejected, timed-out and browser-released locks are explicit local
events; late grants are released. Stop releases held locks. A held lock is only
best effort while visible and cannot promise capture under lock, page kill or
power policy. Its gate requires a live, visible, secure, qualified session and
available request budget; GPS permission or activation does not gate the wake API.
Repeated unavailable-API calls emit one diagnostic per session and increment
`summary.suppressedBlocked`, consuming no requests or GPS history.
Resume requests another lock only after the new user action.

The browser cannot cancel a `getCurrentPosition` callback or an outstanding
motion permission promise. Tokens ignore their eventual answers. Timeouts bound
our waiting state; the total request cap also bounds abandoned browser requests.
Cleanup errors are counted; a throwing platform cleanup cannot be guaranteed to
release its native resource. Timer execution/cleanup cannot be guaranteed while
the browser is suspended, killed or shut down. Duration is checked again before
new acquisition and callbacks. Pending motion answers also recheck the session
and request deadlines and visibility before applying an answer and after local
permission-event delivery, before subscribing. Deadlines are inclusive even when
browser timers have not executed. This is no background-liveness promise.

## Qualification is separate from API availability

The default `mode` is `device`, and default `qualification` is `null`. Exposed
APIs and successful synthetic fixtures never change this. The host must supply
an independently reviewed configuration, under separate physical-test authority:

| Field | Required value/meaning |
| --- | --- |
| `schema` | `andes.phone-observations.qualification/1` |
| `kind` | `physical-device-review` in device mode |
| `disposition` | `qualified` |
| `evidenceRef` | Opaque bounded reference to reviewed physical evidence |
| `contextKey` | Exact match to the configured measured context |
| `budgetRevision` | Exact match to the supplied budget revision |
| `streams.geolocation`, `streams.motion` | Each enabled stream must explicitly be `true` |

The host is responsible for binding the context key to the actual measured
device/browser/OS, origin, placement, visibility and operating conditions, and
ensuring the budget values match that revision's reviewed evidence. This is an
explicit trusted configuration boundary, not device attestation or evidence
verification. No qualifying production configuration is supplied in this PR.
Only visible acquisition is implemented, even if another context was reviewed.

Tests explicitly choose `mode: 'synthetic-test'`, inject both detached platform and clock,
and use `kind: 'synthetic-fixture'`. That kind is rejected in device mode, and
synthetic mode refuses inherited global aliases and directly reused native
browser objects/timers at construction and acquisition. No fixture is imported
by the module. Synthetic results cannot populate the #9 matrix.

Permission snapshots retain state, raw browser state and source. They describe
the latest observed permission, not an ongoing OS guarantee. Passive monitors
are queried only after explicit acquisition, with one passive subscription per
permission name per session. Code1 can trigger a fresh status query because a
dismissed prompt does not prove persistent denial. Only browser-confirmed denial
is terminal; ambiguous errors retain unknown until fresh evidence arrives.
An after-error query applies only while its evidence epoch and GPS request
generation still match. A late answer from a failed request cannot cancel a new
gesture retry. The initial permission monitor remains session-scoped, so a late
grant can still arm the replacement one-shot's full acquisition deadline.
After a native GPS code1 failure, a site-level granted status alone cannot enable
passive GPS retries. A new user gesture is required until a useful position
callback re-establishes acquisition; blocked polling consumes no request budget.
Unsupported/rejected queries leave unknowns rather than asserting a
grant or denial. `granted` becoming denied/prompt/unknown is recorded as `revoked`
and retires that stream. A single sensor grant cannot restore a revoked combined
motion grant. When a browser cannot expose motion permission changes, silence is
unknown; the host must call `revokeConsent` when its consent is withdrawn. A new
explicit session is required to retry a denied/revoked permission.
Conflicting later passive answers and change events remain local observations
with `applied: false`; they cannot replace that session's terminal permission
state or its original source.

## Privacy and local retention

Location callbacks emit accuracy, source timestamp, age, freshness and ordering;
latitude, longitude, altitude, heading and speed are omitted by default. Precise
latitude/longitude require, on that specific request, all of:
`preciseConsent: { granted: true, purpose: 'bounded-purpose', reference: 'opaque-consent-reference' }`.
Purpose/reference are snapshotted before acquisition; use opaque values with no
personal data. Withdrawal stops the session and purges buffered and pending
coordinates, including after suspension or explicit stop. It clears retained
consent/intents and prevents precise resume. It cannot erase copies already passed
to the local consumer; host storage needs its own retention/deletion controls.
Platform error messages and user agents are never emitted. Motion components are
raw browser observations, potentially sensitive, and require the qualification,
gesture and permission gates. Their accuracy/freshness remain unknown.

The buffer retains only the current session. Snapshots and sink values are
detached JSON-safe copies. Restart discards the previous buffer, and page kill
loses all unexported memory. A local sink is not server acceptance or durable
storage. Any approved uploader remains a separate consumer with its own server contract,
consent, authentication, durable queue and receipt handling.
Events are captured into a bounded local delivery queue and flushed at settled
transition boundaries; pre-acquisition phases still permit cancellation before
native sensor work. Sinks must return synchronously; exceptions/thenables count
as `sinkErrors`, with no retry or delivery claim. Acquisitions/start from within the sink are
blocked; synchronous stop/consent withdrawal is supported.

## Provisional engineering budgets

`PROVISIONAL_BUDGET` is exported for explicit inspection/override. These are
software guardrails, **not preregistered or accepted #9/#11 capability limits**.
No battery/data efficiency is claimed; the browser still controls sensor rate.
Overrides must preserve the complete shape, including the separate prompt and
raw-callback bounds. Start from the exported object rather than an old copied
table; changed values still require matching independently reviewed qualification.

```js
import { PROVISIONAL_BUDGET } from '../../src/phone-observations/adapter.mjs';
const budget = { ...PROVISIONAL_BUDGET, bufferCapacity: 128 };
// Pass this complete object as `budget`; qualification.budgetRevision must match.
```

Old copied objects missing `permissionPromptTimeoutMs` or
`maxRawCallbacksPerStream` are rejected with `RangeError`, rather than silently
changing a reviewed budget. Migrate them using the complete exported spread above.

| Input | Default | Meaning |
| --- | --- | --- |
| `revision` | `engineering-only/5` | Must match explicit qualification |
| `bufferCapacity` | 128 | Retained local events; evictions counted |
| `maxEvents` | 400000 | Ordinary emissions; one reserved stop plus at most one final nonresumable intent update |
| `maxCallbacksPerStream` | 10000000 | Motion work after throttle; GPS callbacks before retiring that stream |
| `maxRawCallbacksPerStream` | 10000000 | Independent raw-callback safety cap, including suppressed samples |
| `maxRequests` | 100 | Supported acquisition requests; unavailable APIs and blocked calls consume none |
| `maxSessionMs` | 86400000 | Local deadline; checked against monotonic elapsed time too |
| `minEmitIntervalMs` | 1000 | Per-request observation emission spacing; no queued samples |
| `requestTimeoutMs` | 10000 | GPS acquisition timeout after a known permission grant |
| `permissionPromptTimeoutMs` | 120000 | Separate bounded permission wait, also constrained by session expiry |
| `maximumAgeMs` | 0 | Browser position cache request; callback age is still retained |
| `freshnessMs` | `null` | Unset means unknown, never fresh |
| `clockToleranceMs` | 100 | Wall/monotonic divergence flag; not accuracy certification |

All inputs have finite upper bounds in `validateBudget`, including a seven-day
maximum configurable session. Default duration is 24 hours, rather than five
minutes. This is a software ceiling, not a measured capability/resource budget.
The default ordinary cap covers a synthetic foreground day with one GPS fix,
one transient GPS error and one motion emission per second. Custom rates and
budgets still need their own reviewed resource evidence; a higher event rate can
reach the finite cap earlier.
Location requests default to `enableHighAccuracy: true`; an explicit boolean
override and the original options remain observable on results and errors. The
browser treats this as a hint: underlying source and achieved accuracy remain
unknown/measured per callback, never inferred from the option. Motion samples
suppressed by the emission interval do not consume the useful-work cap. Raw
callbacks remain observable in `summary.callbacks`; `processedCallbacks` and
`suppressedMotion` distinguish useful processing from suppressed motion samples.
The separate raw cap retires only the affected stream with reason
`raw-callback-budget`; useful-work exhaustion reports `callback-budget`.
Both caps are finite, and rate suppression retains no backlog. Nonterminal GPS
errors have a separate one-second throttle and suppressed-error count; permission
denial bypasses it, cancels the watch and remains observable. Successful fixes
retain their own throttle. Permission/control events consume the ordinary budget;
the final stop event always has its reserved slot. Buffer evictions still reached
the sink once, subject to diagnostic failures.

## Trip integration

[`trip-sharing.mjs`](../../src/phone-observations/trip-sharing.mjs) exports
`createTripPhoneObservations({ trip, reviewedContext, locationConsent, sink })`.
The host selects an actual reviewed context packet `{ key, qualification, budget }`
and records `locationConsent: { granted: true, tripId, reference }`. The factory
binds that consent to the exact trip and supplies the fixed purpose, context,
watch/high-accuracy options and wake-lock request. `startSharing(event)` and
`resumeSharing(event)` accept the currently dispatched native button event;
`stopSharing()`, `revokeConsent()` and `snapshot()` complete the host seam.
Missing consent, another trip's consent, missing review or synthetic review in
device mode cannot enable acquisition. Withdrawal clears factory consent.

The host's **Compartir ubicación**, **Reanudar** and **Dejar de compartir** button
handlers can call those methods directly with their event. Resume is always an
explicit action; expose each method's result and each local stop event in UI.
This PR supplies the controller seam, not the shared app screen. Actual driver UI
binding awaits the committed Q49 foundation and is tracked separately in PR63.
No qualifying physical packet exists yet; a host must not manufacture one.

`createQueuedTripPhoneObservations({ pipeline, trip, reviewedContext, locationConsent })`
composes this GPS-only controller with the existing Q42 observation pipeline.
It delegates the sink, `drain()`, `flush()` and trip status to that pipeline;
mapping, storage, authentication, retry identity and HTTP remain queue-owned.
`stopSharing()` synchronously stops capture and retains queued samples according
to queue policy. `revokeConsent()` synchronously stops/purges capture first, then
deletes and revokes that trip's queue scope. Await its `{ ok, reason }` result.
`snapshot().queueWithdrawal` and `status()` expose pending/complete/failed deletion;
a failed deletion is retryable while capture and wrapper uploads remain blocked.
Wrapper `drain()` stays blocked during pending/failed deletion. Once deletion
and the queue's revocation tombstone succeed, it delegates the global pipeline
drain so unrelated trips can progress. This trip's capture, resume and `flush()`
remain blocked. Queue-owned deletion uses its own internal drain.
Copies already transmitted cannot be recalled. A local stop is not server sharing
acknowledgement. Raw motion is retained only as explicit opt-in qualification and
confounder evidence outside this active-trip controller; no incident rule consumes it.

Only location events with explicit qualified coordinates, finite accuracy no
greater than 100000 and a valid original source epoch can map to the existing
backend `/v1/trips/:id/locations` contract. Preserve `position.timestamp`; never
substitute client receipt time. Batch only the four accepted fields, within server
time/size limits, with a stable idempotency key across retries. The separate Q42
queue owns this mapping. At inspected backend `c752de8a3b424bcbc086764dc11052348b27e320`,
no `/sharing` route exists: stop events remain local until its owner publishes an
authoritative contract. This adapter adds no HTTP, server sharing fact or alert.

## Reproduce and remaining evidence

Use Node **24.17.0**, built-in tests, no installation, server, DB or real device:

```sh
node --test tests/phone-observations/adapter.test.mjs tests/phone-capability/recorder.test.mjs
```

The synthetic confounders cover phone handling, drop, pothole and passenger
movement. Their author labels are separate fixture metadata, never inferred
outcomes or emitted classifications. See [verification](verification.md) for the
result and [event boundary](event-boundary.md) for Robert's #18 handoff.

The existing #9 recorder was read and left unchanged. We retain its separation of
wall/monotonic clocks, explicit location requests, redaction and bounded in-memory
traces. Its recorder is single-use, polls on start, records no motion samples and
does not expose the per-request token/event-sink boundary needed here, so it is not
wrapped or rewritten. It remains the independent capability evidence instrument.

Primary platform references consulted on 17 October 2026:
[W3C Geolocation](https://www.w3.org/TR/geolocation/) for source timestamps,
cache/accuracy/permission semantics;
[W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/)
for transient activation, express permission and visible-document events;
[W3C High Resolution Time](https://www.w3.org/TR/hr-time-3/)
for the distinction between monotonic measurement and adjustable wall time.

Additional platform references for the review corrections:
[W3C Screen Wake Lock](https://www.w3.org/TR/screen-wake-lock/) and
[WHATWG DOM trusted events](https://dom.spec.whatwg.org/#dom-event-istrusted).
