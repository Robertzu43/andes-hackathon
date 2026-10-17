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

Only explicit `acquireLocation({ watch: false })`,
`acquireLocation({ watch: true })` or `acquireMotion()` can initiate acquisition.
Both require a secure context, visible page and browser-observed
`navigator.userActivation.isActive === true`. Call directly within a supported
trusted gesture handler. A boolean argument cannot substitute for activation.
Missing activation support is blocked. Motion additionally requires the explicit
`DeviceMotionEvent.requestPermission` route and a grant before subscription;
browsers without that route remain unsupported. This is no Android support claim.

`stopLocation` and `stopMotion` invalidate their request tokens before cleanup.
`stop` and `revokeConsent` stop both streams, timers and permission/lifecycle
subscriptions. These operations are idempotent. A stopped session can be replaced
with a new explicit `start`; callbacks retain their original session/request and
cannot enter the replacement. One-shot requests settle once. Hidden pages,
`pagehide` and `freeze` terminate the session with no automatic resume.

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

Tests explicitly choose `mode: 'synthetic-test'`, inject both platform and clock,
and use `kind: 'synthetic-fixture'`. That kind is rejected in device mode, and
synthetic mode refuses the default real global platform. No fixture is imported
by the module. Synthetic results cannot populate the #9 matrix.

Permission snapshots retain state, raw browser state and source. They describe
the latest observed permission, not an ongoing OS guarantee. Passive monitors
are queried only after explicit acquisition, at most once per permission name
per session. Unsupported/rejected queries leave unknowns rather than asserting a
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
personal data. Withdrawal stops the session. It cannot erase data already passed
to the local consumer; host storage needs its own retention/deletion controls.
Platform error messages and user agents are never emitted. Motion components are
raw browser observations, potentially sensitive, and require the qualification,
gesture and permission gates. Their accuracy/freshness remain unknown.

The buffer retains only the current session. Snapshots and sink values are
detached JSON-safe copies. Restart discards the previous buffer, and page kill
loses all unexported memory. A local sink is not server acceptance or durable
storage. Consumers must not wire it to live uploads under this preparatory scope.
Sinks must return synchronously; exceptions/thenables count as `sinkErrors`, with
no retry, queue or delivery claim. Acquisitions/start from within the sink are
blocked; synchronous stop/consent withdrawal is supported.

## Provisional engineering budgets

`PROVISIONAL_BUDGET` is exported for explicit inspection/override. These are
software guardrails, **not preregistered or accepted #9/#11 capability limits**.
No battery/data efficiency is claimed; the browser still controls sensor rate.

| Input | Default | Meaning |
| --- | --- | --- |
| `revision` | `engineering-only/1` | Must match explicit qualification |
| `bufferCapacity` | 128 | Retained local events; evictions counted |
| `maxEvents` | 256 | All emissions per session; cap terminates resources |
| `maxCallbacksPerStream` | 1024 | Callback processing before retiring each stream |
| `maxRequests` | 8 | All acquisition attempts past the gates per session |
| `maxSessionMs` | 300000 | Local deadline; checked against monotonic elapsed time too |
| `minEmitIntervalMs` | 1000 | Per-request observation emission spacing; no queued samples |
| `requestTimeoutMs` | 10000 | One-shot and motion-prompt local timeout |
| `maximumAgeMs` | 0 | Browser position cache request; callback age is still retained |
| `freshnessMs` | `null` | Unset means unknown, never fresh |
| `clockToleranceMs` | 100 | Wall/monotonic divergence flag; not accuracy certification |

All inputs are validated with finite upper bounds in `validateBudget`. Position
high-accuracy acquisition is disabled. A callback flood is discarded after its
cap; rate suppression retains no backlog. Counts include callback-budget overflow
once, then ignore that token. Permission and control events also consume the event
budget. At the event cap, cleanup proceeds even if no terminal event fits; read
`snapshot().stopReason`. Events evicted from the buffer still reached the sink
once, subject to its diagnostic failures.

## Reproduce and remaining evidence

Use Node **22.22.3**, built-in tests, no installation, server, DB or real device:

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
