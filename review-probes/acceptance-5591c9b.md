# Independent correction and integration re-review

Candidate: `5591c9b55fe7f4505e36ccee96d27aa913e0debf`,
[PR61](https://github.com/Bimbi-Dev/andes-hackathon/pull/61).
Verdict: **ACCEPT for the bounded backend correction and root integration**.
No Q48 blocking finding remains in this reviewed scope. Robert's separate review
and confirmation remain required before merge.

The [original FIX report](README.md) and its six original Git blobs are retained
unchanged. They concern backend `ebc8fb1`, where the expiry regression is red.
This candidate does not itself contain those external reviewer files: this
review branch restores them byte for byte from `de9cea5` for independent reruns.
The [blob receipt](results/5591c9b/probe-blobs.json) identifies each original and
restored hash. No probe or acceptance assertion was changed for the fix.

## Correction

`authorizeJob` refreshes the clock immediately after the contended account lock,
then denies expired claims and cancels expired jobs before creating an attempt.
Equality counts as expiry. Authorization and quota/request reservations use
the refreshed time; migration, lock ordering, idempotency and resend policy are
unchanged.

The unchanged 999 ms control succeeds with
`authorized_at=2026-10-17T12:00:00.999Z`. The unchanged 1001 ms regression now
rejects authorization, leaves no attempt, and records the expired job cancelled.
All 15 independent probes pass, preserving the forced close/SOS and stop/auth
orderings, real SIGKILL recovery, stale relay rejection and monotonic delivery.

All six new native tests also pass: job lifetime at 999/1000/1001 ms and claim
lease at 29999/30000/30001 ms, including fresh reservation timestamps. In a
disposable candidate archive, replacing only `src/notifications/dispatch.ts`
with its frozen `ebc8fb1` version makes all six fail for their expected
expiry/timestamp assertions. The live review checkout was never mutated for
this sensitivity check.

## Root integration

Both frozen backend `ebc8fb1` and reviewed main `3d7e724` are ancestors of the
candidate. The existing offline `evidence/`, recorder code and recorder tests
are unchanged against that reviewed main. Compared with the reviewed backend,
the only production source change is the bounded dispatch correction; API mounts,
authentication, database configuration and provider transports are unchanged.

The new root commands run backend checks and the existing offline toolkits.
Separate Python processes avoid their same-named module collisions. The pinned
package lock is unchanged. CI adds the tooling command after Python setup.
A controlled Python child exiting 23 makes `npm run test:tooling` exit 23; the
runner does not silently accept child failures. No new endpoint, synthetic
production login, UI, provider operation or deployment is supplied by this
integration receipt. Deferred UI/list/HTTP-harness integrations require their
own frozen-candidate review.

## Local evidence

Node 24.17.0, Python 3.14.7, PostgreSQL 16.14. The database is Q48's isolated
cluster on loopback, with unique per-test schemas and synthetic identities.

| Command/control | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run test:all` | 53 backend + 130 offline tests pass; 50/50 scenarios pass |
| `node --test --test-reporter=tap review-probes/backend-races.test.mjs` | 15/15 pass |
| `npm run demo` | synthetic actual-process restart journey passes |
| Six native boundary tests with old source in a disposable archive | 0 pass, 6 fail; exit 1 |
| Tooling runner with controlled Python exit 23 | exit 23 propagated |
| `git diff --check` against reviewed main | pass |

[Commands](results/5591c9b/checks.json),
[combined output](results/5591c9b/combined.txt),
[unchanged-probe TAP](results/5591c9b/independent.tap),
[restart demo](results/5591c9b/restart-demo.txt),
[old-source failures](results/5591c9b/sensitivity-old-source.tap), and
[failure propagation](results/5591c9b/failure-propagation.txt) are retained.
Output paths and trailing whitespace were normalized; assertion results and
diagnostics are preserved.

## Reciprocal review policy

Separately reviewed PR54 at `bd0c4ae42b085cc8efe315b1836f5bbf29303740`.
Its one-line correction permits explicit team visibility decisions, including
submission requirements, while preserving mandatory review and explicit billing
authorization. The reciprocal author/merger rule covers discussion comments,
inline threads and formal `COMMENTED` findings; original requested-change
reviewer confirmation and current-head/inbox checks remain required. The PR
template preserves the feedback-to-fix-to-confirmation evidence chain.

No additional blocking process gap was found. The author's linked response
addresses the visibility request and acknowledges the optional re-read
suggestion while retaining the stronger existing rule. Documentation diff and
whitespace checks pass; no code suite is applicable. The original Robert
CHANGES_REQUESTED still requires his confirmation. This is technical policy
acceptance, not that confirmation. See the [policy receipt](results/policy-bd0c4ae.json).

All software evidence remains local and synthetic. Live delivery, device/phone
capture, human consent, real help and product effectiveness remain unqualified.
No merge, reviewer dismissal, repository setting change or issue closure occurs.
