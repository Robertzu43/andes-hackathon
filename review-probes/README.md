# Independent backend concurrency review

Reviewed backend: `ebc8fb1d36f441ef012ca585201cefabf61383d6`
(`codex/aws-durable-backend`). Reviewer lane: Q48. Verdict: **FIX** for one
reproduced expiry race. This branch adds probes and evidence only.

The oracle is the [runtime contract](../docs/contracts/runtime.md): trip closure
must preserve SOS, stop-first must prevent fresh authorization, an authorized
attempt must survive as a fact without automatic resend, expired work must not
receive fresh authority, transport must not grant authority, and provider facts
must not regress. Transaction barriers force the relevant order; SIGKILL probes
use separate OS processes and reconnect through a new context.

## Finding: expiration is checked before a contended quota lock

`src/notifications/dispatch.ts:63` samples `ctx.clock()`, and lines 65/72
check claim/job lifetime against that value. The account lock at line 80 can
then wait. After the wait, lines 95–99 insert the attempt and authorize the job
using the old time, without checking whether the job has expired meanwhile.

Deterministic reproduction, using the supported injected clock:

1. Claim an eligible synthetic SMS job and give it 1000 ms of remaining life.
2. Hold its existing `quota_accounts` row with `FOR UPDATE` on another client.
3. Start `authorizeJob` and observe its quota-lock wait in `pg_stat_activity`.
4. Advance the clock by 1001 ms, release the lock, and await authorization.

Expected: reject fresh authorization and create no attempt. Actual: one
authorized attempt; `expires_at=12:00:01.000Z`, current clock
`12:00:01.001Z`, and backdated `authorized_at=12:00:00.000Z`.
The otherwise identical 999 ms positive control authorizes successfully.
An account-lock wait near a job's expiry is sufficient; the probe does not need
a 30-second lease wait, a timeout, provider traffic, or clock rollback.

Recheck time-dependent eligibility after the contended account lock and before
creating send authority. Use that refreshed time for the authorization and
reservation facts. Preserve both boundary controls, cancellation ordering, and
the one-attempt/no-resend invariant. The backend owner owns the production fix;
this review does not change their implementation.

## Evidence and reproduction

Node 24.17.0; PostgreSQL 16.14; dedicated local cluster/database; synthetic
identities, clock, provider responses and transport only. No AWS/provider calls.

```sh
export TEST_DATABASE_URL='postgresql://YOUR_LOCAL_TEST_ROLE@127.0.0.1:YOUR_PORT/YOUR_DISPOSABLE_DB'
npm ci
npm run typecheck
npm test
node --test --test-reporter=tap review-probes/backend-races.test.mjs
```

The last command intentionally exits **1** on this reviewed backend: 14 pass,
one fails at the 1001 ms expiry boundary. The assertion is retained as a failing
regression, outside the existing default `tests/*.test.mjs` selection. It must
turn green after the owner fixes the production race; do not weaken or skip it.

The original suite passes **47/47**; typecheck and build pass. An initial
socket-only database configuration made the bootstrap test fail because that
test reconstructs TCP connection components. The final full-suite evidence
uses the same isolated cluster on loopback and passes without code changes.

The 14 passing independent cases cover:

- Forced close-before-SOS and SOS-before-close, with active SOS preserved and
  newly authorized alerts withholding closed-map coordinates.
- Both transaction orders for resolve, trip revoke and standing revoke against
  authorization; no lock timeout/deadlock, stop-first denial, and preservation
  of prior authorized facts.
- Ordinary pending/claimed cancellation, preservation of authorized work, and
  stale transport replay rejection after closure.
- A relay paused outside SQL while resolution commits, followed by rejection
  of the published stale envelope.
- Real SIGKILL after committed claim and authorization, new-context recovery,
  duplicate replay, and one attempt maximum. A claimed-only crash can recover
  and send once; an authorized crash becomes unknown and never sends again.
- A paused reconciliation read returning queued after a delivered callback;
  the delivered fact and stopped reconciliation remain intact.
- The valid 999 ms expiry control.

Raw [baseline](results/ebc8fb1/baseline.txt),
[independent TAP](results/ebc8fb1/independent.tap), and
[command results](results/ebc8fb1/checks.json) are retained. Production source,
SQL migrations and package manifests match the reviewed backend exactly.

This review proves local software behavior only. Live delivery, AWS availability,
device capture, real consent, physical evidence, and safety outcomes remain
unqualified. It supplies no merge approval from Robert and closes no issue.
