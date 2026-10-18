# Robert PR52 feedback disposition

Historical six-finding disposition for `4aca76c`. The newer Robert review
5560599386 and corrected source are covered by
[the complete current disposition](robert-current-disposition.md). Earlier
fixes and passing controls do not close later findings.

The six findings in [CHANGES_REQUESTED review 5560453602](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560453602)
against b34ca56a79515104d7412d46f0e20d7045a5ba8e are accepted. The original
review body, timestamp, reviewer, reviewed commit and URL are preserved in
[the review snapshot](reviews/robert-5560453602.json). The prior independent
F1–F4 review, probes and reproducer remain unchanged. No review was dismissed.

| Finding | Author disposition | Evidence and limits |
| --- | --- | --- |
| R1 Critical: silent session exhaustion and five-minute default | Fixed within adapter. Every executable finish emits one local session-stop with reason, stopped sharing state and resumability. Its reserved slot survives the ordinary cap. Default bounded duration is 24h, configurable to 7d; ordinary events 200000, raw callbacks per stream 10000000, retained buffer still 128. | Seven terminal paths, idempotency, sink withdrawal without recursive delivery, and 36000 fixes over ten synthetic foreground hours pass. Page kill/shutdown can prevent JS entirely; no server receipt is claimed. Budgets are engineering guardrails, not physical qualification. |
| R2 Critical: activation dead end, lock/background stop and missing legacy activation API | Fixed adapter lifecycle/seam. Previously granted streams can explicitly reacquire. A synchronous trusted-native-event bridge supports browsers lacking userActivation. Explicit resume restores intents in a new generation; best-effort screen wake lock releases on stop and late grant. | Trusted/untrusted/stale/async gesture controls, denied/revoked permission, obsolete GPS/motion callbacks, wake-lock unsupported/rejected/released/timeout and inclusive delayed-grant deadlines pass. Real locked-screen/background capture is unproven. Shared app Reanudar button binding awaits Q49 committed foundation/PR63; the factory already accepts its native event. |
| R3 Important: hardcoded low accuracy | Fixed. Default high-accuracy request hint is true; explicit boolean override remains available and recorded on every relevant outcome. | Tests preserve actual reported 5000m accuracy and unknown underlying source despite the hint. No assertion of GPS receiver use or achieved precision. |
| R4 Important: host must invent qualification/context/precise consent | Added trip-sharing factory accepting one selected reviewed-context packet and trip-bound consent reference. It supplies fixed purpose, high-accuracy watch and optional wake lock. | Missing consent, foreign-trip consent, absent review and synthetic review in device mode stay blocked. Qualified synthetic positive control emits exact coordinates. Withdrawal clears consent. No physical packet is fabricated; default real streams stay disabled while #9 is not-run. |
| R5 Minor: only iOS motion permission route | Fixed code path. With an exposed DeviceMotionEvent but no requestPermission, explicitly qualified/gesture-driven browser-managed listening is supported. Permission stays unknown. | No-motion-API and no-gesture controls stay blocked; the browser-managed positive control emits unclassified components. Existing express-permission request/grant/revocation checks remain. No Android device qualification claim. |
| R6 Minor: error flood exhausts emissions | Fixed. Nonterminal GPS errors have a separate interval throttle and suppression count; raw callbacks remain bounded. Denial bypasses throttle and immediately retires the watch. | 1000 transient errors produce one error observation and 999 suppressions; a useful fix remains possible. Interval-boundary error and immediate denial remain observable. |

## Actual checks

On Node 22.22.3, the current adapter suite plus unchanged recorder suite passed
**82/82** (51 adapter, 31 recorder). Fourteen new adapter-only R1/R2/R3/R5/R6
regressions failed **14/14** against the frozen b34ca56 adapter before the repair,
and pass now. The baseline folder uses that exact old adapter with the new test
file; the new factory is present only to satisfy its top-level import and is not
called by the selected baseline pattern. R4 has a separate new factory test.
No physical API, provider, DB, install, deployment or merge was used.

```sh
author_dir=$(mktemp -d)
git archive 4aca76c34a5c1639dccad9cff6a01f00f7023ac2 | tar -x -C "$author_dir"
node --test "$author_dir/tests/phone-observations/adapter.test.mjs" "$author_dir/tests/phone-capability/recorder.test.mjs"
# Reproduce historical independent expectations with the parameterized commands
# in review-fixes.md, setting ANDES_CANDIDATE_DIR to this author_dir.
```

The exact preserved independent probes now report **19/22 pass, 3 fail**.
P03 and F4 still assert enableHighAccuracy:false; P06 asserts that absence of
requestPermission must be unsupported. Those assertions conflict with Robert's
R3 and R5 requests. The untouched reproducer passes F1–F3 and fails F4 solely on
the same boolean expectation; original per-request options remain present. These
are reported differences requiring independent reviewer disposition, not a green
independent verdict. The full original evidence hashes are in
[review-fixes.md](review-fixes.md) and were rechecked unchanged.

Historical raw author outputs remain preserved as `andes-phone-review-tests.tap`,
`andes-phone-robert-baseline.tap` and `andes-phone-preserved-probes.tap`.
New portable reviewer evidence is linked in the current disposition.

## Integration boundary and outstanding confirmations

The sink still performs no transport. Q42's queue owns mapping qualified location
observations to the strict location batch contract, source timestamps, stable
idempotency keys, source-time limits and durable delivery state. Client receipt
time must never replace a missing source epoch. Other observations are not location
batch payloads. The new local stop seam is:

```js
{ type: 'session-stop', data: { reason, sharingState: 'stopped', resumable } }
```

The inspected backend head c752de8a3b424bcbc086764dc11052348b27e320 has no
/v1/trips/:id/sharing endpoint or cited security spec. Its authoritative route and
UI integration are separately owned and remain pending; no server-side prevention
of silent-stop alerts is asserted here.

Original reviewer Robert and independent reviewer52 must assess the exact new SHA.
All changes remain on the retained published phone branch/PR52, without merging,
main pushes, history rewriting, physical-matrix edits or changes to collaborator code.
Driver PR63 and its published branch remain separate.
