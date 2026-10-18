AI-assisted independent **Codex / Q48**, posted from **sebasbimbi**.
Review-only follow-up to Robert reviews5560729918 and5560746793, bounded to
the existing clock/expiry/phone/lease findings. No production implementation.

Exact tested inputs:

- PR61: `5591c9b55fe7f4505e36ccee96d27aa913e0debf`.
- PR83: `b95ff267d297d1fe1f27fa8b016940996690691c`.
- Original PR74 correction: `27e4f94b5962e88735fdb8fc3fea8cc3e842baa4`.

**PR74 original P2/P3 technically resolved at27e4f94.** Build and all five
unchanged focused controls pass (three0/1001/60001ms clock cases and two
no-delay/actual1002.103ms lock controls). Every new opening retains60000ms grace;
the long injected-clock case no longer creates an immediately expired check.
The EOF check is clean. Original technical confirmation is posted in
[comment6243673402](https://github.com/Bimbi-Dev/andes-hackathon/pull/74#issuecomment-6243673402).
This is not full-PR/human approval. PR83b95 still has the older sweeper.

**PR61 and PR83 remain FIX for three independently reproduced dispatch cases.**
Both fresh archives build on Node24.17.0; each runs the same7 focused SQL cases
on owned PostgreSQL16.14:4 pass,3 fail, no cancellations/skips. Positive controls
and the delayed-recovery observation are distinguished below.

1. **Both-expired work remains pending instead of terminally cancelled.**
   PR61 dispatch.ts:84 and PR83:90 check lease before job expiry after the quota
   wait. Claim a job with both deadlines at30000ms. Prime its age to29900ms
   before authorization; hold the unique quota row, observe the authorization's
   actual backend PID blocked, await101ms and advance the controlled clock101ms.
   After release and recoverWork, status is pending, version1, no attempt,
   although expires_at is30000 and current time30001. Expected: cancelled,
   version2, no attempt. The job-expiry-only control cancels/version2 as intended.
   Make terminal job-expiry handling win over the lease early return, retaining
   the claim owner/token/version guards; assert final state after recovery.
2. **An old destination is authorized after verified-phone change commits.**
   PR61:67 and PR83:70 cache the joined identity before quota contention. While
   authorization is blocked, a genuinely signed contact JWT request to GET/me
   commits a different verified phone. SQL confirms that new binding before
   the quota lock is released. Both heads nevertheless persist an authorized
   attempt to the old phone. No provider call is made. Re-read the binding at
   authorization's decision point or serialize its update with an appropriate
   identity lock. The unchanged-phone control still authorizes. If using
   FOR SHARE, validate that re-verification blocks until authorization commits;
   that is a legitimate alternative ordering, not a failed fix. The supplied
   repro specifically exercises a re-verification committed first.
3. **claimJob uses a pre-lock clock and claims already-expired work.**
   PR61:45 and PR83:48 sample before pool/row waits. Hold the trip row and start
   a claim for work expiring1000ms later; after observing its exact PID blocked,
   await1001ms and advance the controlled clock. Both return a claim with status
   claimed/version1 after job expiry, with claim_until derived from the old time.
   The no-wait control claims valid work. Read time after the relevant locks,
   before due/expiry/lease comparisons and new lease timestamps. This probe
   does not claim a provider send occurred; later authorization still guards it.

The first two reproduce Robert's required findings; the third reproduces his
claim-clock follow-up. The original5591c9b targeted expiry fix still works for
its single-lifetime control. Its previous bounded acceptance does not clear
these additional findings or the other current requested changes.

**Lease/requeue observation, not a new send-policy acceptance:** with a still-valid
job, a claim aged29900ms and101ms of quota contention, lease expiry returns null.
recoverWork restores pending, but an already-published outbox row is not republished
at30001ms; it is republished at60001ms. That real SQL/stub-relay observation passes
on both heads. Queue acknowledgement follows from runJob/consume's source; no real
queue ACK was executed. Address the requested latency gap or obtain the reviewer's
explicit disposition while preserving owner/token/job-expiry safety. Do not simply
weaken the old expired-claim guards to make an emergency send happen.

The review probe uses a unique quota project per case and targets only the
operation's real PostgreSQL backend PID. It always releases the held transaction
and awaits pending work, even when barrier observation fails. These controls avoid
the any-schema/hard-coded-project/unawaited-promise weaknesses noted in the review.
The application clocks are controlled; short101/1001ms timer holds are actual,
and long claim ages are primed before the SQL transaction. No long SQL wait or
new operational cadence is asserted.

Q46 owns the five hardening/env/empty-allowlist/legacy-locale cases. CI, insights,
known-limit documentation and human/merge confirmation remain with their assigned
owners. None is cleared by this scoped result. No broad83/82 proof campaign,
deployment, live provider, feature or policy research was started. The owned DB
is stopped and all disposable schemas are removed. Refs #27, #61, #74, #83.
