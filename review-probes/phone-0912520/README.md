# Independent Q52 review of PR52 0912520

Scoped technical **ACCEPT** at `091252042581490313437c9035c5165c76828221`, against frozen9f87e2c and Robert's CHANGES_REQUESTED review5560757444. This confirms source-level remediation only. Robert's confirmation remains required; this COMMENTED verdict does not clear human feedback, real queue/backend integration, device qualification or the no-merge rule. The old9f87 acceptance remains historical.

Clean detached exact source was reviewed without author changes. Source tree `2dd76225a21b5b53319769a7a42e7218d9845c1b` and test tree `c2ddc530d5a370a4d92544c6a3305d3529dc1696` match the correction handoff. All17 phone source/test/document and unchanged capability-recorder blobs match Git objects. Node24.17.0; detached synthetic platform/clock; no installs, service, network/device acquisition, backend mutation or physical measurement.

## All latest findings

| Finding | Independent disposition |
| --- | --- |
| N2 explicit stop while hidden | Stop clears intents and retires a suspended session's resumability. Author controls cover pagehide/freeze/visibility; new Q52 R01 confirms the actual trip factory refuses trusted resume without another native watch. |
| Withdrawn queue drain | Both drain and flush are gated while deletion is pending, failed and complete. R05 confirms useful delegation before withdrawal, no delegation afterward, retry of failed deletion without restoring capture or upload access. This cannot recall work already handed to a queue or network. |
| Gesture false success | Removing the extra outer gesture transaction lets each public operation settle its sink effects. Factory also checks after wake-lock setup. R02 exercises revocation specifically during wake-lock delivery: start returns false, buffered coordinates purge, late lock releases once and resume stays refused. Valid gesture/GPS controls still pass. |
| Native code1 with site granted | A separate needs-gesture latch survives passive site-granted observations. R03 observes one native failure,100 blocked passive polls with no request charges, useful motion, explicit successful GPS retry clearing the latch and a later useful passive acquisition under the restored grant. |
| N3 optional motion | GPS resumes despite denied optional motion; no new motion request is issued. R04 then withdraws host consent while suspended and confirms the independent terminal withdrawal latch still forbids resume. |
| X1/X3 identity reuse | Event IDs include a cryptographic adapter nonce; factory start and resume create fresh runtime session IDs. R06 observes eight unique session/event identities across four identical trip templates and their resumes while tripId remains stable. Direct low-level callers still owe fresh IDs for independently started sessions, as the API contract states. Missing secure randomness fails closed. |
| p5 unavailable API request charges | Only a supported acquisition attempt is charged. New gate checks and existing coalescing/budget controls preserve other streams after unsupported API polling. |
| p4 first grant evidence | Token replacement no longer advances the permission-evidence epoch; the delayed valid first grant arms the current one-shot acquisition timer. Native errors still advance evidence epochs; prior stale-query/confirmed-denial controls remain passing. |
| p3 rejected permission timeout | Rejection returns the token's attributed timeout/clock/cancellation reason consistently with its emitted event. |
| p6 diagnostic attribution | Unsupported query TypeError/NotSupportedError counts separately; fulfilment/listener faults remain observer errors. Wake-lock blocks have their own diagnostic stream while retaining required location qualification. |
| p7 README budget | Complete exported-budget spread and both prompt/raw-callback limits are documented. Incomplete budget shapes remain validation failures; revised limits require matching qualification revision. |
| N13 foreground flapping | Engineering-only/5 raises the finite ordinary event cap to400000. The author simulation retains GPS fixes/errors/motion through the foreground day before duration expiry. Raw/work/request/session caps remain finite; no battery/background capability is inferred. |

## Actual independent execution

| Suite against0912520 source | Result |
| --- | --- |
| Current author adapter plus unchanged capability recorder | 113/113 pass |
| Preserved Q57 complementary controls | 12/12 pass |
| Byte-unchanged Q52 contract-v3 and prior five independent controls | 27/27 pass |
| Byte-unchanged Q52 lifecycle-v2 | 16/16 pass |
| New Q52 R01–R06 controls | 6/6 pass |
| Total current checks | **174 pass** |
| New eleven GATE tests with frozen9f87 source | 0/11 pass,11 failures |
| New six Q52 controls with frozen9f87 source | 0/6 pass,6 failures |
| Unchanged original cc4dc5d22 probes with current source | 17/22; same five explicitly versioned expectation differences |
| Unchanged original four reproductions with current source | F1/F2 pass; F3 ambiguous-code1/site evidence and F4 high-accuracy expectation still differ |

Sensitivity fixtures use frozen9f87 source with the exact new test bytes, not edited implementation. Original red assertions are preserved. Original probes SHA256 remains `0da135e3c2aa6dc9364d955b948e35e6d75fa57f8d36aa14b5a567e92321f756`; reproducer remains `abc8294f928c03f838d03016df051634d47b8f20c73a416dbd87954504db5a85`. All reused sources have a separate hash manifest. The preserved lifecycle script prints its historical9f87 candidate; ANDES_CANDIDATE_DIR selected0912520 for the current run. Earlier v2/old lifecycle logs at2769 remain historical, not new runs.

## Feedback and remaining gates

Read all live PR52 surfaces:4 issue comments,7 complete formal reviews,0 inline comments/threads, pagination exhausted. This includes all three Robert requests, our COMMENTED findings/old scoped acceptances and the author's complete prior per-item reply. The latest Robert request explicitly acknowledges earlier fixes but requires these four new blockers and associated should-fix items; older green evidence cannot supersede it. The candidate's full disposition and copied human review were checked against actual source and probes.

No remaining technical blocker found in this bounded delta. Q44 owns the consolidated Robert handoff; this review makes no duplicate re-review request. Raw optional motion remains outside GPS-only trip capture, with no incident/sleep/safety rule. Matching reviewed physical qualification is still required, now including the changed budget revision. Actual adapter→queue→backend composition remains held under the review-only freeze. The wrapper's local guards prove no new delegation after withdrawal, not cancellation/deletion guarantees in an external queue or delivery system. Physical lock/background behavior, matched battery/data, durable real-browser storage, provider delivery and human outcomes remain NOT RUN. No new feature/composition, author source edit, deployment, merge or product issue closure.

## Reproduce

From this reviewer checkout with exact source objects fetched and Node24.17.0 on PATH:

```sh
author_dir=$(mktemp -d)
old_dir=$(mktemp -d)
git archive 091252042581490313437c9035c5165c76828221 | tar -x -C "$author_dir"
git archive 9f87e2c08be8ac9e9324136fd0c4401ad8823bc6 | tar -x -C "$old_dir"
node --test "$author_dir/tests/phone-observations/adapter.test.mjs" "$author_dir/tests/phone-capability/recorder.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node --test review-probes/phone-0912520/robert-pr52-followup.test.mjs review-probes/phone-9f87e2c/phone-contract-v3.test.mjs review-probes/phone-9f87e2c/phone-9f87-independent.test.mjs review-probes/phone-0912520/phone-independent-091.test.mjs
ANDES_CANDIDATE_DIR="$author_dir" node review-probes/phone-9f87e2c/phone-lifecycle-v2.mjs
# Sensitivity: only test bytes are overlaid on the old source fixture.
cp "$author_dir/tests/phone-observations/adapter.test.mjs" "$old_dir/tests/phone-observations/adapter.test.mjs"
node --test --test-name-pattern='^GATE ' "$old_dir/tests/phone-observations/adapter.test.mjs"
ANDES_CANDIDATE_DIR="$old_dir" node --test review-probes/phone-0912520/phone-independent-091.test.mjs
```

The author, preserved current-suite and lifecycle checks pass; the final two sensitivity checks exit1 with11/11 and6/6 failures. The untouched original probes/reproducer are also copied in historical-cc4dc5d2 for the deliberately preserved red contract observations. No command uses personal source paths, real sensors or credentials.
