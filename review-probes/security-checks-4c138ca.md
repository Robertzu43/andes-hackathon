AI-assisted independent review by **Codex / Q48**, posted from **sebasbimbi**:
**FIX — check-sweeper / incident / dispatch lifecycle only** at PR74 head
`4c138ca1d00742400a850cd72b0888cc59260a36`, base
`c752de8a3b424bcbc086764dc11052348b27e320`.

I read the security-check design, runtime contract, relevant source and issue
11/27/29 gates. Q43 independently owns the new route-auth and demo-isolation
audit. This verdict does not clear that review or any human/product evidence gate.

**P2 — the sweep's old clock consumes a new check's response window.**
[`checkOnce`, sweep.ts:51](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/src/checks/sweep.ts#L51)
captures one `now` before candidate queries and all trip-lock waits. At line56 it
passes that old value into `sweepTrip`; lines46–47 persist `created_at` and
`ask_until` from it. A check that only becomes visible after waiting receives a
shortened, potentially expired response window.

Independent real-PostgreSQL reproduction with the declared demo settings and a
controlled application clock:

1. Create an active synthetic trip and advance to silence+1ms.
2. Hold its SQL trip row in another transaction; start checkOnce and verify its
   SELECT FOR UPDATE is blocked.
3. Advance the controlled clock, release the row and let the check commit.
4. Read the persisted timestamps and run another sweep.

| Clock advance while blocked | Remaining ASK_GRACE_MS=60000 after opening | Result |
| --- | --- | --- |
| 0ms | 60000ms | Valid control |
| 1001ms | 58999ms | Response window shortened by the lock wait |
| 60001ms | -1ms | Newly committed check already expired; next sweep creates an incident |

The last case is a controlled elapsed-clock injection, not a real minute-long
SQL wait: the runtime has a 5s statement timeout. That timeout does not correct
the stale-clock calculation; ordinary shorter waits also lose grace, and one
clock value is reused across the entire batch. These are test values, not newly
proposed operational timing thresholds.

Read the clock inside the locked per-trip transaction before deciding and
timestamping the transition. Preserve the fresh eligibility/incident checks.
Add the delayed-opening regression and the no-wait control; a new check needs
the complete configured grace period when it actually opens.

**P3 — whitespace check fails on three new EOF blank lines.**
`git diff --check c752de8 4c138ca` exits2 for runtime.md:135,
checks.test.mjs:230 and demo.test.mjs:77. Remove those extra blank lines.

The existing authorization-expiry correction is a separate integration dependency:

- PR74 alone does not include PR61 `5591c9b55fe7f4505e36ccee96d27aa913e0debf`.
  The unchanged original15 review probes pass14/fail1: an authorization waiting
  1001ms on quota can outlive its 1000ms remaining job lifetime.
- A clean local `git merge-tree --write-tree` of PR74 and that exact PR61 head
  yields tree `52f0cc4c56e5e1caf631d14af504c78e2f73c63a`. This is a reproducible
  local combined tree, not an already-integrated PR head.
- That tree passes all15 unchanged review probes and all6 committed expiry
  regressions. Relative to PR74, its only src/db delta is the dispatcher clock
  correction. The new sweeper timing defect remains reproducible there.

Runtime results, Node24.17.0 / isolated PostgreSQL16.14:

| Candidate | Declared backend tests | New lifecycle probes | Original15 probes |
| --- | --- | --- | --- |
| Exact PR74 | 69/69 | 26/28; two clock variants of one P2 defect | 14/15; known missing PR61 fix |
| Combined tree above | 75/75, including6 expiry regressions | 26/28; same P2 defect | 15/15 |

Typecheck passes on both. Preserved original probes and process helper match
their exact Git blobs at de9cea552a9742acbc236f3586331adab4983835; no expectations
were weakened. Saved logs normalize local path prefixes; whitespace-only TAP separator
indentation is removed. Assertions/outcomes are unchanged; original outputs stay
in the review scratch archive. Metadata records input trees, source blobs,
pre-normalization log hashes and failures.

Passing coverage includes concurrent new-check deduplication, sharing idempotency
and changed-content409, both orders of pause/open and arrival/cancel/pause/lateOK
against escalation, both SOS/escalation orders with one role-based fan-out and
no duplicate send, actual SIGKILL before escalation commit and a fresh-process
restart, explicit resolution/re-alert boundaries, pause/resume, closed-map
disclosure, native loopback HTTP status, and all16 timing-presence combinations.
Automatic checks stay off by default and all four timings are required; production
infrastructure supplies none. Explicit SOS remains available during pause/closure.

The documented SOS shortcut is visible: an already committed missed-check send
is neither rewritten nor resent after SOS; a pending voice job gets SOS wording.
This does not prove urgent SOS re-notification of already-alerted contacts.
Likewise, a server-side asking row does not prove a prompt was delivered, eligible
or seen. Deferred/missing prompts must not be counted as failed driver responses.
Unknown location and pause remain explicit, without a wellbeing assertion. The
bounded unconfirmed-status path in issue27 does not establish robbery, fatigue,
help, safety or UI prompt delivery, and does not waive issue11's interaction gates.

Additional executed policy observations distinguish that engineering contract
from an evaluated service policy:

- A previously unseen, newer capture uploaded599000ms late updates received_at
  to now. It suppresses the silence check while the map correctly stays stale,
  with no driver OK. Replaying the same capture later does not update received_at
  and no longer prevents a silence check. GPS receipt is a phone/network fact,
  not an attributed human response or proof of wellbeing.
- A new GPS receipt does not veto arrival-overdue: the independent driver_at
  clock still opens the overdue check. This valid control passes.
- Pause still suppresses all automatic checks after7 simulated days, including
  an overdue arrival; explicit SOS remains available. No pause-expiry or separate
  always-on overdue policy is implemented. That matches the written engineering
  eligibility rule, but does not establish an acceptable indefinite pause policy.

These are observed policy gaps/limits to evaluate with the latest user rules,
not additional implementation failures against the frozen spec. No new cadence
or pause timeout is proposed here.

Run the new standalone probes against a built disposable archive:

```sh
Q48_REVIEW_CANDIDATE=/path/to/built/archive \
TEST_DATABASE_URL="$OWNED_TEST_DATABASE_URL" \
node --test --test-concurrency=1 /path/to/review-probes/security-check-lifecycle.test.mjs
```

Keep helpers/check-sweep-worker.mjs beside the driver in its helpers directory.
The tests use synthetic signed sessions, real SQL, controlled clocks and local
mock transports. No AWS deployment, live channel, physical phone or human evidence
was used. No author source, merge, setting or issue state was changed. Refs #27, #74.
