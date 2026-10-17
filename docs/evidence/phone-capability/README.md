# Phone capability evidence kit (#9)

Preparatory tooling for [#9 Test phone capability limits](https://github.com/Bimbi-Dev/andes-hackathon/issues/9). The issue stays open and blocked by [#8](https://github.com/Bimbi-Dev/andes-hackathon/issues/8). No physical-device observation has been made: every matrix row is `not-run`, the only available device is the owner's iPhone, and Android is untested. Nothing here is evidence that any phone state is supported.

ANDES is for independent freight truck drivers and owner-operators in Latin America, including Brazil (camioneros and caminhoneiros with one or two trucks). The kit measures what a web page can observe on the phone. It never measures or infers fatigue, sleep or robbery.

| File | Purpose |
|---|---|
| [`tools/phone-capability/recorder.js`](../../../tools/phone-capability/recorder.js) | Framework-neutral ES module that records page observations in memory and exports a JSON trace |
| [`tests/phone-capability/recorder.test.mjs`](../../../tests/phone-capability/recorder.test.mjs) | Deterministic Node tests against a synthetic environment |
| [`protocol.md`](protocol.md) | iPhone, Safari and Home Screen measurement protocol, freight cab qualification, battery/data baseline plan and sources |
| [`result-matrix.csv`](result-matrix.csv) | Blank result matrix: two `not-run` rows per case and context, plus the uncovered rows N1 to N4 |
| [`observer-log.csv`](observer-log.csv) | Blank independent observer log |

## Tests

```sh
node --test 'tests/phone-capability/*.test.mjs'
```

Node 22 or later, nothing to install. The tests cover the recorder lifecycle, monotonic and wall-clock gap evidence, unavailable or throwing APIs, denied and stale location results, redaction, the bounded buffer and cleanup after `stop()`. They run against a synthetic environment, so they prove recorder logic only. They say nothing about Safari, iOS or any phone state.

## Recorder

```js
import { createRecorder } from './recorder.js';

const recorder = createRecorder({ sessionLabel: 'C03-A-5m-1' });
recorder.start();             // listeners, timer ticks, passive permission query
recorder.mark('sync-start');  // align with the observer log
recorder.samplePosition({ enableHighAccuracy: true, timeout: 15000 }); // explicit; may prompt
recorder.stop();              // removes every listener, timer and location watch
const trace = recorder.exportTrace();
```

Nothing is attached, scheduled or queried until `start()`. Location is touched only by `samplePosition()` or `watchPosition()`. Motion and notification permission are read passively and never requested. Observations stay in memory only, up to `maxObservations`; when the buffer is full the oldest are dropped and counted. A page that is killed or a phone that shuts down loses its unexported trace, which is why the protocol exports before C14 and C15.

| Option | Default | Meaning |
|---|---|---|
| `sessionLabel` | `null` | Run ID linking the trace to the matrix row (up to 120 characters) |
| `maxObservations` | `5000` | Bounded buffer size |
| `tickIntervalMs` | `1000` | Timer interval used to detect gaps |
| `gapThresholdMs` | `2 × tickIntervalMs` | Elapsed time on either clock at or above which a tick becomes a `timer-gap` observation |
| `staleAfterMs` | `null` | Optional instrument threshold for `freshness`; `null` keeps it `unknown` because the #11 limit is UNSET |
| `rawCoordinates` | `false` | Tester's explicit choice to keep latitude, longitude and altitude |
| `env` | `globalThis` | Injected environment, for tests only |

## Trace format

`exportTrace()` returns JSON-safe data with schema `andes.phone-capability.trace/1`:

- `session`: random `id`, `label`, `state`, `startedAt` and `stoppedAt` (each `{ mono, wall }`).
- `config`: the options above.
- `acquisition.geolocation`: the most recently requested position `options` per source (`sample`, `watch`), or `null` when that source was never requested. Kept in recorder state, outside the bounded buffer, so the acquisition settings survive even when the `geolocation-request` observation itself has been evicted (`summary.dropped`).
- `environment`: `source` (`global` or `injected`), `physicalDeviceVerified` (always `false`; a trace cannot prove which device or conditions produced it), `userAgent`, `navigatorStandalone`, `displayModeStandalone`, `timeOrigin`.
- `capabilities`: `secureContext`; `apis` with `exposed`, `not-exposed` or `unknown` for geolocation, permissions, motion, notifications, service worker, push, wake lock, battery, network information, page freeze and visibility; `permissionsAtStart` for motion (always `unknown`) and notifications. `exposed` means the object exists, not that it works on the device.
- `redaction.coordinates`: `omitted`, or `included-by-tester-choice`.
- `limits`: the interpretation limits that travel with every trace.
- `summary`: `recorded`, `retained`, `dropped`, `ticks`.
- `observations`: each has `seq`, `type`, `mono` (`performance.now()`) and `wall` (`Date.now()`).

| `type` | Extra fields |
|---|---|
| `start`, `stop` | `visibilityState`, `navigatorOnLine`, `timeZone` (IANA zone of the device) |
| `lifecycle` | `event` (`visibilitychange`, `pagehide`, `pageshow`, `freeze`, `resume`, `focus`, `blur`), `visibilityState`, `persisted`, `eventTimeStamp` |
| `network` | `event` (`online`, `offline`), `navigatorOnLine`, `eventTimeStamp` |
| `timer-gap` | `expectedIntervalMs`, `monoElapsedMs`, `wallElapsedMs` (negative when the wall clock stepped back) |
| `permission` | `name`, `state` (`granted`, `denied`, `prompt` or `unknown`), `source` (`query` or `change`), `error` |
| `mark` | `label` |
| `geolocation-request` | `source` (`sample` or `watch`), `options` |
| `geolocation` | `source`, `accuracyM`, `positionTimestamp`, `ageMs`, `freshness`, `providedFields`, and `coords` only by tester choice |
| `geolocation-error` | `source`, `code`, `codeName`, `message` |
| `geolocation-unavailable` | `source`, `reason` (`not-exposed` or `threw`), `error` |
| `geolocation-watch-cleared` | `error` |

Device observations are the only thing a trace contains. Attributed self-reports (rest, tiredness, a request for help, a reported robbery or attempt), suspected events and independently corroborated outcomes belong to #8 and the #18 event dictionary, which keep them apart.

## Privacy and storage

Coordinates are omitted unless a tester sets `rawCoordinates: true` for a specific run. Those traces, and any trace or log tied to a person or a real trip, stay out of this repository and out of issues. Redacted traces and observer logs from reviewed runs can be attached to #9 once the reviewer agrees.
