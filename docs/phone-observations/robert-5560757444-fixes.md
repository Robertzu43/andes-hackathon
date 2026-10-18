# PR52: corrections for Robert review5560757444

The [latest CHANGES_REQUESTED review](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560757444)
targets exact `9f87e2c08be8ac9e9324136fd0c4401ad8823bc6`. It confirms earlier
B1–B5, suspended withdrawal N1 and local pipeline composition, then identifies
four new blockers and additional should-fix items. Both earlier human requests
and this review remain preserved. No old approval or passing suite clears these
new findings. The exact review is copied in [the snapshot](reviews/robert-5560757444.json).

This is a narrow review correction under the development freeze. It starts no
new issue, feature, actual-backend composition, device test or deployment.

| Required finding | Correction and regression |
| --- | --- |
| N2: explicit stop while hidden resumes | Stop clears intents even when already suspended and changes a resumable stop to explicit-stop. Resume after pagehide, freeze or hidden visibility is refused; no new watch starts. Consent withdrawal retains its independent terminal latch. |
| Withdrawn queue drain | Both wrapper drain and flush reject after withdrawal, including pending, failed and completed deletion. The supplied queue owns its internal deletion/drain. Tests prove no external drain delegation while pending/failed, useful drain before withdrawal, and deletion retry without restored consent. |
| Gesture false success | The trusted gesture bridge no longer adds an outer transaction around already transactional public operations. GPS result resolves after its sink effects; trip start also checks capture after wake-lock setup. Synchronous stop/revoke returns ok:false, while a valid gesture still starts useful GPS. |
| Native code1 with site granted | Native failure latches locationNeedsGesture. Passive site-granted observations cannot authorize another GPS request until an explicit user action; a useful native callback clears the latch.100 passive polls make no extra native calls or request charges, and motion remains available. |

| Should-fix | Correction and limits |
| --- | --- |
| N3: denied optional motion blocks GPS resume | Resume checks requested streams separately. Valid GPS resumes while denied motion stays denied and is not re-requested. The independent host-consent-withdrawal latch still forbids all revoked resume. |
| X1/X3: reload/resume identities collide | Each adapter gets a cryptographic instance identity in event IDs. The trip factory generates a fresh runtime session ID on each start, and resume gets another before sessionSequence resets. Tests recreate identical trip templates and resume them without ID collision. Direct low-level callers still supply fresh IDs for independently started sessions; tripId remains the stable trip correlation. Missing cryptographic randomness fails closed. |
| p5: unavailable API burns requests | Charge only a supported acquisition attempt. Missing GPS, motion permission route and wake-lock APIs cannot exhaust unrelated stream requests. Rejected gates remain uncharged and coalesced. |
| p4: first permission grant discarded | Acquiring/replacing a GPS token no longer bumps the permission-evidence epoch. A delayed first grant can arm the current one-shot acquisition timer. Native permission failure still invalidates older evidence; confirmed-denial controls remain. |
| p3: rejection loses timeout reason | Motion rejection uses the same token failure reason as the grant branch. Inclusive late rejection returns permission-prompt-timeout and matches its emitted event. |
| p6: unsupported queries / wake-lock diagnostic | TypeError/NotSupportedError query failures count as unsupported queries; fulfilment/listener faults still count as observer errors and remain caught. Wake-lock gates use their own diagnostic stream while retaining location qualification and consent requirements. |
| p7: copied README budget shape | README now shows a complete exported-budget spread and lists both permissionPromptTimeoutMs and maxRawCallbacksPerStream. Incomplete copied shapes remain explicit validation errors; this does not invent matching physical qualification. |
| N13: normal flapping ends before24h | Engineering-only/5 default maxEvents400000 covers a foreground synthetic day with one GPS fix, one transient GPS error and one motion emission per second. The old200000 default stops this case early. Raw/work/session caps remain finite; custom rates can still exhaust them earlier. No physical resource or background-duration promise follows. |

## Verification and review handoff

Node24.17.0, detached synthetic platform/clock, no dependency install or services.
Eleven new `GATE` regressions fail **11/11** against the exact9f87 source and
pass on the repair. Existing author/recorder checks and the twelve Q57 controls
remain. Q52's exact original reviewer artifacts and expected historical red
outputs are unchanged; the v3 contract, five independent denial/deadline/privacy
controls and versioned lifecycle controls are rerun against the correction.

Actual correction runs: **113 author/recorder +12 Q57 follow-up +22 unchanged
contract-v3 +5 unchanged independent controls +16 unchanged lifecycle-v2 =168
passes**. These are correction-owner reruns; fresh Q52 independent confirmation
of the new head is still required. The prior157-check acceptance covered9f87 only.

```sh
node --test tests/phone-observations/adapter.test.mjs tests/phone-capability/recorder.test.mjs
node --test --test-name-pattern='^GATE ' tests/phone-observations/adapter.test.mjs
```

The frozen correction SHA and actual before/after results accompany the handoff,
outside the commit containing this report. Q52 must independently assess that
exact new head; the9f87 scoped technical acceptance is historical. Q44 owns the
consolidated Robert handoff, so no duplicate public re-review request is sent.
Robert's own confirmation remains required. No author merge or product-issue
closure is performed.

Real queue/backend composition remains held under the review-only freeze.
Optional raw motion stays outside the GPS-only trip path. Physical iPhone lock,
background operation, matched battery/data and delivery/human evidence remain
unproven. No unrelated PR53 retirement semantics are changed here.
