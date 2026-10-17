# PR52: Robert feedback at 4aca76c

Verdict: **FIX / merge HOLD** for author head
`4aca76c34a5c1639dccad9cff6a01f00f7023ac2`. This report is independent
synthetic software evidence, not device qualification or Robert's confirmation.

Both Robert reviews target the older `b34ca56a79515104d7412d46f0e20d7045a5ba8e`:
[5560453602](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560453602)
and [5560599386](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560599386).
Read complete paginated REST discussion, inline comments and formal reviews,
and GraphQL review threads. At this capture: two discussion comments, five
reviews, zero inline comments and zero threads; all page cursors exhausted.
[Captured feedback](results/pr52-4aca76c/feedback.json) retains full review
bodies, reviewed commits, identities and source URLs. COMMENTED findings count.

The independent Q52
[534dba0 report](https://github.com/Bimbi-Dev/andes-hackathon/blob/534dba01b2d53bfd970c858be8f2cc53458439dd/review-probes/phone-4aca76c-review.md)
is consistent with the rerun here. Earlier accepted fixes do not clear newer
findings. No source, original reviewer evidence, review state or product issue
was changed by this review.

## Exact-head results

Runtime: preinstalled **Node 24.17.0**. No dependency install, real sensor,
shared database, environment change, app server, network provider, notification,
deployment or auxiliary coding agent was used. GitHub reads fetched feedback.

| Check | Result |
| --- | --- |
| Existing author adapter + unchanged recorder tests | 82 pass / 0 fail |
| Unchanged original reviewer suite | 19 pass / 3 fail: P03/F4 high-accuracy defaults and P06 browser-managed motion differ from subsequent requested behavior |
| Explicit Q52 contract-v2 suite from 534dba0 | 22 pass / 0 fail |
| Unchanged Q52 lifecycle probe from 534dba0 | 8 pass / 8 fail; [actual/expected output](results/pr52-4aca76c/lifecycle.json) |
| New complementary Robert probes | 2 pass / 10 fail; [TAP](results/pr52-4aca76c/followup.tap) and [source](robert-pr52-followup.test.mjs) |

Original file SHA-256 values remain unchanged:
`probes.test.mjs`: `0da135e3c2aa6dc9364d955b948e35e6d75fa57f8d36aa14b5a567e92321f756`;
`reproduce.mjs`: `abc8294f928c03f838d03016df051634d47b8f20c73a416dbd87954504db5a85`.
The three historical expectation conflicts are disclosed, not edited into passes.

## Latest Robert review: every blocker

| Item | Disposition on 4aca76c |
| --- | --- |
| B1: callback budget before motion throttle | Default now survives 30 simulated seconds at 60Hz (Q52 L10); old 17-second default symptom is superseded. Root cause remains: complementary B1 exhausts a valid cap8 on suppressed callbacks while only a few useful observations are emitted. Retained motion needs a correction or Robert's explicit disposition. |
| B2: transient GPS errors bypass throttle | Corrected: unchanged L08 emits one error and suppresses 999 while a later useful fix survives. Finite raw-callback guard remains separate. |
| B3: blocked acquisition consumes useful event budget | Still fails L09 and complementary B3 under cap10: repeated rejected motion requests retire the useful GPS watch. Raising the default only moves the threshold. |
| B4: precise buffer survives consent withdrawal | Still fails L05/L06, active and after stop. L04 additionally resumes precise GPS after hide → withdrawal → show → resume. Clear retained coordinates, intents and factory consent gates across stopped and active states; consumer-owned prior copies require their own deletion path. |
| B5: Object.create(window) synthetic alias | Still fails L07 with inert fake Node globals and default clock; one inherited native spy is called. Require detached injected platform and clock, and reject global/prototype/native-capability aliases. This is no claim of a JavaScript security sandbox. |

## Latest Robert review: every should-fix

| Item | Disposition on 4aca76c |
| --- | --- |
| S1: terminal event | Corrected locally. Q52 L01/L02 prove reserved stop slot, one terminal delivery and no nested sink call. Receipt by a backend sharing endpoint remains pending. |
| S2: code1 prompt dismissal | Complementary S2 fails: a fresh browser prompt status still leaves acquisition permanently denied. A code1 error alone must not invent persistent user denial or permission grant. Paired actual browser denial remains blocked (positive control passes). Old queries must not reopen a newer confirmed denial. |
| S3: prompt latency and retry budget | GPS and motion grants after the 10-second acquisition timeout fail the new controls. W3C [Geolocation §7.2](https://www.w3.org/TR/geolocation/#timeout-member) excludes permission wait from acquisition timeout. Separate bounded permission-wait/session expiry from acquisition work; do not burn retries merely while one prompt is pending. Session-expiry positive control passes. Any finite prompt bound and changed historic deadline expectations require explicit disclosure. |
| S4: geo versus geolocation | Complementary S4 fails: callback-budget stop reports internal `geo`; use public `geolocation`. |
| S5: synchronous GPS denial/stop returns success | Q52 L12 and complementary S5 fail. Return the settled request result after cancellation/denial and sink effects; retain useful synchronous-success controls. |
| S6: permission-monitor fulfilment throw | Q52 L13 observes an unhandled rejection. Catch faults from fulfilment and listener setup as well as promise rejection; retain bounded attribution. |
| S7: motion setTimeout throw | Q52 L11 throws synchronously and strands the motion token. Retire the request and return an attributed failure; consume an already-created permission promise's later rejection. |
| S8: cancellation/clock reason codes | Both complementary controls fail. Sink cancellation leaves session active but says session-stopped; a backwards request clock is reported as timeout/obsolete rather than clock uncertainty. |
| S9: ordinary event sink re-entry | Terminal deferral works, but ordinary `emit` still invokes the sink inside transitions. Complementary S9 proves a synchronous native watch callback invokes the sink before native assignment returns. Queue bounded events and flush at settled phases, preserving pre-acquisition cancellation and nonrecursive stop behavior. |
| S10: repeated JSON serialization | Source still copies permission, retained event and sink payload separately. Capture a detached event once, then provide a detached consumer copy; preserve snapshot isolation and privacy purging of pending deliveries. |
| S11: personal paths in reproduction docs | Still present in author verification/review-fix documents. Replace runnable commands with portable archive paths/variables; keep old test counts explicitly historical. Portable reviewer commands are below. |

## Earlier Robert review and utility request

| Earlier finding | Disposition |
| --- | --- |
| R1: silent exhaustion / five-minute cap | Local terminal emission and longer finite defaults are implemented; ten-hour foreground simulation is author logic evidence. Page kill can still prevent JavaScript. No server receipt or uninterrupted lock capture is established. |
| R2: activation / hidden-page dead end / wake lock | Explicit resume, trusted synchronous legacy-event bridge and best-effort wake lock exist. Q52 positive controls pass; suspended-consent revocation still blocks acceptance. Actual Reanudar UI and real device traces need integration evidence. |
| R3: low-accuracy hint | Default high-accuracy true and measured-source uncertainty are preserved. The hint cannot establish actual GPS receiver use or accuracy. |
| R4: integrator invents qualification / consent | Factory binds a reviewed packet and exact trip consent. No physical qualification packet exists; defaults must remain fail-closed. Convenience does not manufacture physical evidence. |
| R5: Android motion path | Explicit browser-managed motion path exists; permission remains unknown. Later recommendation to remove motion is addressed by the scope below, not presumed accepted. |
| R6: transient error flood | Local throttle passes the unchanged positive control. |

Agreed internal scope: **active-trip sharing is GPS-only**. The trip factory
already starts GPS and wake lock; it never calls `acquireMotion`. Retain raw
motion only as an explicitly opted-in, qualification-gated evidence capability
for PLAN #19/#9, outside the active-trip path. PLAN #19 requires confounder and
resource evidence and allows removing a motion rule without observable benefit;
no rule here consumes motion or classifies a crash, assault or sleep. Robert
still needs to confirm this reasoned response to his remove-motion suggestion.
Retaining dormant code requires fixing its applicable defects.

Queue owner Q42 owns PR66's durable uploader. Coordinate its pending Q47
findings before proving **real adapter → reviewed queue → actual backend**.
Do not add a duplicate uploader or fabricate a sharing endpoint. Preserve
position source time, strict four-field payloads, age/accuracy validation and
stable retry idempotency keys; client receipt time is not missing source time.
Actual sharing-state acknowledgement, app resume controls and withdrawal of
already queued coordinates belong in the same coordinated integration proof.

## Portable reproduction and remaining gates

Run from this reviewer checkout with Node24.17.0 on PATH. Each author archive
is disposable and exact; these commands use no shared runtime service.

```sh
author_dir=$(mktemp -d)
reviewer_dir=$(mktemp -d)
git archive 4aca76c34a5c1639dccad9cff6a01f00f7023ac2 | tar -x -C "$author_dir"
git archive 534dba01b2d53bfd970c858be8f2cc53458439dd review-probes | tar -x -C "$reviewer_dir"
node --test "$author_dir/tests/phone-observations/adapter.test.mjs" "$author_dir/tests/phone-capability/recorder.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node --test "$reviewer_dir/review-probes/phone-contract-v2.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node "$reviewer_dir/review-probes/phone-4aca76c-lifecycle.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node --test --test-reporter=tap review-probes/robert-pr52-followup.test.mjs
```

Expected baseline exit codes: 0, 0, 1, 1. The two failing suites are deliberate
regression evidence against the immutable unfixed head, not passing production
checks. The original Q52 files and raw failed outputs remain untouched.

Q50 has source corrections in progress; Q57 has not overwritten or edited that
work. Q52 retains independent review. Before acceptance: freeze corrected SHA,
rerun originals and positive controls, disclose any versioned contract changes,
obtain Q52 independent confirmation, reply to every Robert item against the
actual PR head and request his re-review. No reviewer confirmation is implied
by this report. No author merge, dismissal or product-issue closure is allowed.

Physical iPhone lock/background traces, Android support, device qualification,
matched battery/data cost, provider delivery and human benefit remain not-run
or unproven. Synthetic logic cannot clear those gates.
