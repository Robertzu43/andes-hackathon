# Monitoring facts for #22

`src/monitoring-state/project.mjs` exports `projectMonitoringState(input)`, a pure ES module for a future Active Trip / Contact Response consumer. This is executable preparation for independent LATAM freight owner-operators, including Brazil. It has no framework, DOM, timers, persistence, network calls, sends or production API. It does not establish monitoring capability, wellbeing or safety.

This branch starts from `origin/main` at `bc8eeabfe5220e66a83be972b480a1d1ae8d87d2`. No frozen #18/#21 client/server contract exists in that base. The vocabulary below is **provisional and local to this module**, proposed to Robertzu43 for his #18 event and #21 reconciliation/deadline ownership. It is not an agreed backend schema or evidence of integration. #22 remains blocked by #21 and parent #3; independent review and human/device evidence remain open.

## Reproduce with no dependencies

Use Node **22.22.3**, with that binary on PATH. No package install or running service is required.

```sh
node --version
node --test tests/monitoring-state/*.test.mjs
node --input-type=module <<'JS'
import { projectMonitoringState } from './src/monitoring-state/project.mjs';
import { fixture } from './tests/monitoring-state/fixtures.mjs';
console.log(JSON.stringify(projectMonitoringState(fixture()), null, 2));
JS
```

All fixtures are synthetic. Phone events, server records and the separate external observer gap log are invented inputs, with surrogate references and coordinates `(0, 0)`. They provide no physical-device result, qualification, comprehension result or efficacy proof. Tests perform no provider activation, participant contact, device exercise, spending, deployment or pilot.

## Proposed input mapping

Every projection consumes the complete relevant retained snapshot for **one trip**. Pass known empty histories as `[]`; omitted histories also mean no supplied evidence. Pass unknown server evidence as `null`. Structurally invalid input throws `TypeError`, so a consumer must show a data-error/unknown state rather than keep an old reassuring rendering.

| Input | Required meaning / proposed owner |
| --- | --- |
| `tripId` | Surrogate trip identity; adapter must bind the correct truck, user and access scope (#18) |
| `clock` | `{sessionId, wallMs, monotonicMs}` at projection; wall is epoch milliseconds and monotonic is session-local milliseconds (#19/browser caller) |
| `previousClock` | Previous observation of those clocks, or `null`; retain it across calls, do not replace a suspension gap with an unrelated recent tick (#19/#21 adapter) |
| `serverObservation` | `{id, tripId, observedAt, receivedClock, uncertaintyMs, provenance}`; `receivedClock` is captured when this server-time observation reached this page. Its uncertainty must include server alignment, transport latency and clock error. `provenance.kind` is `server-observation` (#18/#21) |
| `budgets` | Explicit finite nonnegative `responseMs`, `locationMs`, `notificationMs`, `serverMs`, `clockSkewMs`, `maxTickGapMs`, `maxAccuracyMeters`; no defaults, certified thresholds or capability claims |
| `availability` | Required `visibility: visible/hidden/unknown`, `connection: online/offline/unknown`, `locationPermission: granted/denied/prompt/unavailable/unknown`. These are caller observations, not proof of reachability or capture |
| `responses`, `locations` | Source-time phone/report events, preserving server receipt separately (#18/#19/#21) |
| `deadlines` | Server-owned agreement/revision history with `dueAt`, never browser-renewed (#21) |
| `notifications` | Per-message server state histories with `notificationId` and `state` (#18/#21/channel adapter) |
| `coverageGaps` | `{id, tripId, startAt, endAt, provenance}`; `endAt: null` means open. Preserve the independent observer record separately from device/server records. Unknown intervals have no inferred cause (#9/#21) |

Timestamp strings use `YYYY-MM-DDTHH:MM:SS[.fff]` plus `Z` or signed `HH:MM` (hours 00–23, minutes 00–59). Fractional seconds have 1–3 digits. Calendar components are checked before conversion; offset changes are compared as instants. Finer precision needs an explicit adapter decision rather than silent truncation. Locale, country and IANA zone context can be kept by the caller; they never change an agreed instant. No phone-prefix country inference occurs.

Each history event contains `id`, `tripId`, `sourceAt`, `receivedAt`, `timeUncertaintyMs` and `provenance: {kind, reference}`. `receivedAt` is a server receipt/event-trace instant, **not** the upload animation or browser render time. `timeUncertaintyMs` is an explicit symmetric bound mapping the source timestamp into server time; `null` means unknown, not zero. Provenance references must point to access-controlled records in an eventual integration; this module only carries surrogate labels and cannot verify them.

| History | Additional fields and semantics |
| --- | --- |
| Response | `sessionId`, integer `sequence`, `provenance.kind: driver-report`, `response: ok/fatigue/sleepiness/help-request/security-concern/reported-attempted-robbery/reported-robbery-theft/rest-planned/rest-started/rest-ended`. Even `ok` is a time-specific attributed report; none is independent corroboration |
| Location | `sessionId`, integer `sequence`, `provenance.kind: device-observation`, numeric `latitude`, `longitude`, `accuracyMeters` (or `null`). Usability requires known accuracy within the explicit caller budget; that budget is not proof the GPS is correct |
| Deadline | Integer `revision`, `provenance.kind: server-state`, `sourceAt` is agreement/revision time, `dueAt` is the agreed server-owned deadline. Revisions must represent the authoritative active agreement supplied by Robert's adapter |
| Notification | Integer `revision`, `provenance.kind: server-state`, `notificationId`, `state: scheduled/accepted/delivered/failed/cancelled`. `sourceAt` is the server's status observation time. These are attributed server records; `accepted` never becomes `delivered` or a driver response |

All histories must be bounded upstream (#21). The module compares small retained histories, including pairwise conflict checks; it is not an unbounded event store. The adapter must retain a last usable point/report and needed conflicts/gaps despite buffer eviction. Completeness, event identity, revisions, clock/session authenticity and provenance authenticity are outside a pure function's proof. Calling a fabricated recent sample a server observation, omitting a gap, supplying a false uncertainty bound or discarding history can defeat any projection; tests cannot establish those inputs in the real world.

## Output and time interpretation

| Output | Meaning for a future consumer |
| --- | --- |
| `response` | Latest unambiguous driver report; independent of location, notification or deadline |
| `location` | Last unambiguous usable point. `unusableEvidence` retains rejected points; permission loss preserves the known point and its age |
| `deadline` | `owner: server`, retained agreement and `comparison: before/reached/uncertain/unknown`. This comparison never dispatches or reschedules anything |
| `notifications` | `status: unknown` with no supplied records, otherwise `recorded`; `messages` are separate per-message projections, each with its own status/age/history |
| `time` | `status: recent/stale/unknown`, projected server-time bounds, original anchor/provenance and clock anomaly reasons |
| `coverage` | `unknown` or `interrupted`, supplied gaps and availability observations. An interrupted historical interval stays visible after recovery; it does not say the page is currently unavailable |
| `liveMonitoring`, `wellbeing`, `incidentCause` | Always `false`, `unknown`, `unknown`. Point observations and reports cannot establish a continuous monitored interval or confirm safety, sleep or robbery |

Each fact exposes `status`, `lastKnown`, `ageMs: {min,max}` (or `null`), retained normalised `evidence`, and machine-readable `reasons`. `recent` means a time-specific fact lies entirely inside its **provisional supplied** budget with usable recent server-time evidence. `stale` means its entire age bound exceeds that budget. A straddling boundary, unknown source uncertainty, future/skewed source or receipt, conflicting history, or absent/stale server-time evidence yields `unknown`. A stale server anchor may retain projected age bounds for context; they are not fresh authoritative time. Negative ages are retained as uncertainty diagnostics and never produce `recent`.

`location.freshness` separately retains the fact's time assessment; `location.status` becomes `unavailable` for denied/unavailable permission or `unknown` for prompt/unknown permission. Permission loss never deletes the previous coordinates, source timestamp or age. Hidden/offline observations mark coverage interrupted while allowing an already observed recent report to remain visible as a time-specific fact.

Time advances only from a supplied server observation plus elapsed time **within the same session**, checking monotonic against wall-clock delta. Differences within `clockSkewMs` expand the time interval to span both elapsed estimates; they never become fabricated precision. Reversal or disagreement beyond that budget invalidates the estimate. An old session's anchor cannot be reused after restart. A fresh anchor in a new session can age new facts but cannot fill the old missing interval. A large local observation gap remains diagnostic even when both clocks advance consistently. A local tick alone establishes neither server reachability nor new location/response evidence. Absence of a detected clock anomaly proves no clock authenticity or continuous execution.

Exact duplicates collapse; input order and receipt order cannot select the newest phone fact. Source time and its uncertainty determine whether a latest response/point is identifiable. Duplicate IDs with different contents, conflicting same-session sequence values, source time reversal against sequence, or overlapping time bounds preserve the records and return unknown selection. Server deadlines and each notification use server revision, with conflicts remaining unknown. Historical contradictions are deliberately conservative; a separate reconciliation contract must resolve them. Equal source instants do not prove response ordering. These rules do not silently fabricate a new authoritative record.

A known deadline is preserved even when its agreement record is old. `deadline.status` describes agreement-record freshness; `comparison` compares the immutable `dueAt` against recent usable server-time bounds independently. The deadline is `reached` at its exact instant, `before` only when the whole time interval is earlier, and `uncertain` when the interval straddles it. Missing or invalid server-time evidence makes the comparison unknown. The supplied highest server revision may supersede a deadline; browser activity, country, locale, zone, reconnection and response events cannot. Server job durability, active/cancelled agreement selection and action execution remain Robert's work.

## Synthetic evidence and remaining gates

`project.test.mjs` covers positive independently known facts, no-response uncertainty, source/receipt skew, uncertainty bounds, expiry-style deadline boundaries, stale known facts, unusable points, event identity conflicts, source reversal, multiple sessions, notification evidence, input purity and strict timestamp components. `fault-matrix.test.mjs` crosses five lifecycle/server faults with four availability states and duplicate/reordered upload variations (80 combinations), and has a positive recovery control. It checks zero old-source `recent` assertions while preserving the previous facts and observer gap. The shared fixture separately labels device/report events, server trace records and independent observer gaps. All are synthetic; an author test pass is not independent review.

Remaining integration decisions for Robert #18/#21: freeze event IDs/sequence scope and timestamp uncertainty semantics; agree server-time anchoring/latency bounds; specify how active agreements, cancellation and revisions are selected; map real provider observations to notification states; retain bounded history plus unresolved conflicts/coverage gaps; bind truck/trip/session and access scope; choose evidence-based freshness/accuracy budgets. There is no server adapter or production API here, so none of these mappings is claimed integrated.

Independent review must record pass/revise/stop/inconclusive against an exact frozen SHA. Physical observer logs compared with actual device and server traces, page-loss deadline execution, and Spanish/PT-BR driver/contact walkthroughs remain unperformed. No human UI comprehension result exists because this slice builds no UI. Any future false-live assertion or misunderstanding that could delay help or create reassurance reopens the capability/UX gate. Do not close #22/#21/#3 on the strength of these synthetic results.
