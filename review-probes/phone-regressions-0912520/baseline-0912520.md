# Independent phone regressions: FIX at 0912520

Reviewed source: `091252042581490313437c9035c5165c76828221` (PR52).
Comparison source: `9f87e2c08be8ac9e9324136fd0c4401ad8823bc6`.
Runtime: Node22.22.3; detached synthetic platform and clocks; no real streams, provider sends or physical qualification.

Robert's live required findings in review5560875615 remain binding. The earlier scoped174-pass receipt covered earlier counterexamples and is historical; it does not clear these new findings. Read the current issue comments, formal reviews including COMMENTED, and inline/thread collections (both empty in captured PR52 snapshot). No author source changed or merge performed.

## Run the unchanged independent checks

Archive either exact source into an empty directory, then run:

```sh
git archive 091252042581490313437c9035c5165c76828221 src/phone-observations | tar -x -C /ABS/ARCHIVE
ANDES_CANDIDATE_DIR=/ABS/ARCHIVE node --test review-probes/phone-regressions-0912520/probes.test.mjs
```

Use Node22.22.3. Probe SHA256: `473ba0a4fd67358fa1a8d55b63af47937d84d0955e61f6e1453d2c9ab50cea86`. Source/blob hashes are in `source-manifest.json`. The suite imports only the actual adapter/factory exports; it reuses the existing Node test fixture mechanism and adds no framework. Positive controls assert useful GPS, live revocation, bounded unsupported GPS diagnostics, explicit active stop, and coordinate purge.

Exact head: **4 passed / 7 failed / 0 skipped, exit1**. Previous source: **7 passed / 4 failed / 0 skipped, exit1**. Raw outputs are retained beside this report.

| Case | Previous source | Reviewed head | Observation and attribution |
|---|---|---|---|
| N01 stale after-error query vs gesture retry | pass | fail | Retry reports success and has one watch; late prompt removes it and the later fix is lost. New regression. |
| N02 revoked GPS with no location intent on resume | pass | fail | Permission becomes unknown and a new native watch opens after stopLocation/pagehide/resume. New regression. |
| N03 unavailable wake lock diagnostics | pass | fail | 1000 calls evict the retained GPS fix at head. Previous source stops spending requests near its request cap and retains the fix. The diagnostic bound allows maxRequests plus two permission/block diagnostics. New regression. |
| N04 explicit stop after suspension | fail: reason stays pagehide | fail: sink still resumable | Head repairs snapshot reason but does not publish the terminal update. Distinct partially repaired behavior, not a wholly passing previous case. |
| N05 factory start suspended during wake callback | fail: start falsely succeeds | fail: failed start resumes | Head returns failure, but resumeSharing still starts native GPS. One-shot sink suspension isolates the later resume. |
| N06 GPS code1 latch vs independent wake lock | pass | fail | Visible screen wake API is never called without activation after GPS denial. Regression in gate coupling. |
| N07 consent withdrawal while suspended | fail | fail | Both retain resumable pagehide reason and no terminal sink update. Existing should-fix, not claimed as newly introduced. |
| C01 ordinary GPS/live permission revocation | pass | pass | One useful fix, watch cleared on revocation, no new native acquisition. |
| C02 unsupported GPS work | fail | pass | Known earlier defect is repaired: 1000 unavailable GPS calls coalesce and spend no native requests. |
| C03 explicit stop while active | pass | pass | Sink terminal event is nonresumable. |
| C04 withdrawal while active | pass | pass | Precise coordinates purge, terminal reason and resume gate work. |

## Review scope and remaining work

N01–N05 independently reproduce the five required current findings. N06–N07 cover two current should-fix lifecycle/gate items. Other live README, queue-drain semantics and cleanup feedback still require author disposition and original gatekeeper confirmation; this suite does not claim to cover or clear them. Q57 owns author repairs, Q44 coordinates original-thread replies. A corrected exact SHA must run these unchanged assertions and relevant existing suites before a new scoped verdict.

All fixtures are explicitly synthetic. Budget values are engineering guardrails, not resource or phone evidence. The user owns the physical iPhone; background/physical gates remain open. Actual assembled-app acceptance additionally awaits Q44's URL and exact source, Tándem adoption, Driver.js and Q56's visual/a11y receipt. No new test-framework, app build, live provider or deployment action occurred.
