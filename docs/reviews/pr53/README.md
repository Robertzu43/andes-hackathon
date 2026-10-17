# PR53 retirement review

Decision: **retire unmerged**, following Robert's explicit request in
[review 5560599519](https://github.com/Bimbi-Dev/andes-hackathon/pull/53#pullrequestreview-5560599519).
This is not a fix, ACCEPT, dismissed review, merge, or completion of #22.
The original branch `sebasbimbi/feat/andes-monitoring-state` and its frozen source,
tests and evidence at `e9df5cbfd5c2cfbb19698d46bb957b8561920e66` must remain.
This review lives on the separate `sebasbimbi/test/andes-robert-monitoring` branch.

## Evidence and authority

[feedback.json](feedback.json) preserves complete paginated issue discussion,
formal reviews and inline comments fetched at 2026-10-17T23:44:11Z: one discussion,
three reviews, zero inline comments. It includes both Robert's earlier
[COMMENTED review](https://github.com/Bimbi-Dev/andes-hackathon/pull/53#pullrequestreview-5560453685)
and latest CHANGES_REQUESTED review; reviewDecision alone was not used.
The earlier independent preparatory ACCEPT and author's 14-probe reply remain
historical evidence, not current integration acceptance.

Q49 explicitly confirmed no PR53 import/consumer at foundation
`6f8dc52a566d3880cf1f10bbfd5282a888725ca1` and authorized normal closure after this
independent consumer/replacement audit, retaining the frozen branch and product
issues. Q45 independently confirmed no API/gateway/adapter dependence at
`7e241c39a31d4eaba5f8028fd977e06f6ca72d4d`; createDriverTransport injects no
monitoring projection. Both identified the actual server snapshot contract below.
Andes-terminal also explicitly authorized reviewed retirement after the audit.
Q51/Q50 were contacted about their owned feature seams; no source edits were made
in their lanes. These communications are owner/coordinator confirmations, not
formal reviews submitted from a different GitHub account.

## Every finding's disposition

All rows have disposition **retired-unmerged**. No assertion below silently resolves
a review thread or substitutes for Robert's original-reviewer/human confirmation.
Rows consolidate the overlapping earlier uncertainty/history findings, retaining
five blockers and thirteen follow-ups. Probe IDs refer to [reproduce.mjs](reproduce.mjs)
and raw results in [reproductions.json](reproductions.json).

| Finding | Source and reproducer | Exact-head observation |
| --- | --- | --- |
| B1 same-session 1 Hz ordering; earlier overlap/null uncertainty | project.mjs:101–106; B1-1Hz-2/10/60, F3-overlap-3sec-2sec, F3-old-null-uncertainty | All tested multi-point streams lose lastKnown; old null uncertainty also blocks selection |
| B2 unusable point hides last usable location | :199–201; B2-overlapping-unusable-point | Overlapping newer inaccurate point removes selection. Non-overlapping newer point control retains the old stale usable point; the broader wording does not hold for every newer point |
| B3 raw-JSON duplicate identity | :77–87; B3-duplicate-receipt/timestamp-spelling | Retry receipt changes and equivalent timestamp spelling both produce conflicting-event-id and null report |
| B4 historical conflict poisons newer valid facts | :90–96; B4-old-conflict-poisons-newer | Old reversed sequence/time pair hides a later valid location |
| B5 insensitive false-freshness matrix | fault-matrix.test.mjs:28; B5-matrix-insensitive | All 80 combinations pass after removing session/reversal/disagreement production guards in a disposable archive. A separate recent-source restart control changes unknown to recent, proving the mutation has an effect |
| F01 phone +300 ms vs server | :152; F1-phone-ahead-300ms | unknown/source-after-server-receipt despite server tolerance |
| F02 negative minimum age from source uncertainty; latest review :160 | :160; F2-uncertainty-near-now | 5 s-old point with 30 s uncertainty has min age -25 s and event-in-server-future |
| F03 remote device permission | :204–206; F4-remote-permission-unknown | unknown permission overrides recent location status |
| F04 real backend shape/vocabulary | :6,57,197,221; F5-* | Six backend job states, omitted uncertainty and accuracy field all throw for the whole projection |
| F05 sleep/resume clock disagreement | :119–135; F6-paused-clock-resume | Paused monotonic/advanced wall time yields unknown; this is synthetic clock input, not a measurement of any physical browser |
| F06 old agreement allegedly gates deadline comparison | :214; K1-old-agreement-before/reached | Narrow counterexample: stale agreement with fresh server anchor compares before/reached. The code checks reasons and anchor recency, not deadline.status. Retain the finding for Robert's clarification; no dismissal or repair claim |
| F07 stale valid server anchor | :163; K3-stale-anchor | Definitely old location retains age bounds but becomes unknown; reached deadline comparison becomes unknown |
| F08 open and closed copies of gap | :186; K4-open-and-closed-gap | Both versions survive exact-JSON dedup; open copy covers later facts |
| F09 event ID conflict across messages | :224; K5-cross-message-event-id | Per-message splitting leaves both facts selected without conflicting-event-id |
| F10 invalid deadline revision | :209; K6-bad-deadline-revision | One invalid historical revision throws for the whole projection |
| F11 rejected evidence counted twice | :202; K7-unusable-in-two-evidence-fields | Under a history conflict the same rejected ID occurs in evidence and unusableEvidence; no duplicate within a single list is asserted |
| F12 unexplained unknown | :147; K8-empty-unknown-reasons | Empty report/location histories return unknown with empty reasons |
| F13 quadratic selection | :85–95; K9-complexity | 3,600 same-session records require 6,478,200 pair checks and at least 12,956,400 timestamp parses; structural count, not a wall-time benchmark |

33 reproduction/control records completed on Node **24.17.0**. Exit zero means the
listed behavior was observed; it does not mean the module meets its requirements.
The unchanged author suite passes **51/51** on Node24.17.0 and the historical
Node22.22.3, illustrating why its green result cannot override reproduced findings.
[matrix-mutant.tap](matrix-mutant.tap) retains the unchanged five matrix groups'
output from the disposable mutant. No real source or author fixtures were mutated.

## Consumer audit and actual replacement

[audit.mjs](audit.mjs) performs a read-only Git inventory of exact commits, checking
tracked source/test files for the module path, export and version identifiers and
checking that the module itself is absent. CodeGraph tools were not exposed in
this session. [consumer-audit.json](consumer-audit.json) records tree IDs, counts
and inventory hashes. No missing index was inferred from unavailable tooling.

| Lane | Exact SHA | Source/test files scanned |
| --- | --- | ---: |
| Foundation handoff | 3283fe675ebeee04bb2be8a62f42ab5c475b4b0e | 43 |
| Foundation current PR56 | 6f8dc52a566d3880cf1f10bbfd5282a888725ca1 | 43 |
| Driver current PR63 | 80e9d45f9a234de54b1017e856e8349c097b8760 | 31 |
| Contact current PR62 | 21cd50ac15c22a2a3cc71bf105336e8ebc77c285 | 32 |
| Client handoff | 292d3c4e6ebe6831c3aec5d9db3824e17ee64be7 | 42 |
| Client current PR59 | 7e241c39a31d4eaba5f8028fd977e06f6ca72d4d | 42 |

All six contain zero module references and no src/monitoring-state module.
Manual source tracing also found:

- Foundation `web/src/main.tsx` mounts FoundationRoot without feature-route injection;
  `foundation/app.tsx` defaults routes to empty and shows unavailable placeholders.
- Driver `controller.mjs:13,44–52` has an optional injected monitoringProjection,
  default null/unavailable, with no import or PR53 binding. Its snapshot includes
  the raw server fact and separate clientReceivedAtMs. A generic optional callback
  is not evidence that PR53 is required.
- Contact `journey.ts:237–252` consumes getTripSnapshot and preserves server fields.
- Client `client.ts:137`, `responses.ts` snapshot decoder and `types.ts` implement
  the real location snapshot; `driver.ts` maps readSnapshot to getSnapshot, with no
  projection injection. Contact `journeys.ts` is a semantic facade over that API.

At backend `c752de8a3b424bcbc086764dc11052348b27e320`,
`src/location/routes.ts:26–34` implements **GET /v1/trips/:id/snapshot** for the
owner or currently authorized accepted map contact, under the trip lock. It
returns no-store `{tripId, location, freshness, ageMs, readAt}`; location carries
capturedAt, receivedAt, latitude, longitude and accuracy. Server readAt comes from
ctx.clock(), ageMs is max(0, serverNow - captured_at), and fresh means <=120000 ms.
That bound remains synthetic/unqualified. No location means unavailable/null age.
There is no wire field named sourceAge.

The latest review names `/v1/contact/trips/:id/location`. That alias was not found
in this inspected backend or actual client; the existing authorized snapshot above
is the verified replacement path. `/v1/trips/:id/status` and `/sharing` are also
absent here and cannot be fabricated to complete a screen. Snapshot data alone
does not supply a last driver response, server deadline, delivery, continuous
monitoring, incident cause or wellbeing. Owner catalogs also lack server readAt;
browser time must not be substituted for a missing server timestamp.

Thus closure removes no demonstrated runtime dependency. It does not establish
that the real driver/contact UI journeys are integrated or complete.

## Follow-on source-age bridge finding

**P2, owner Q51 / original reviewer Q43: not repaired in this lane.**
PR62 `21cd50a`, `journey.ts:74–81` computes ageMs + clientNow - serverReadAt,
mixing two wall clocks. With server age120s and actual elapsed120s, an aligned
client gives240s, a client60s behind gives180s, and one60s ahead gives300s. A backward
client step can make displayed age decrease while still passing now>=readAt.
A capturedAt300ms ahead accepted/clamped by the real backend instead produces
null age in the helper. Raw freshness remains labelled serverFreshnessAtRead,
live remains false, and authorization still requires a server check; no current
live/safe card or UI exploit was observed. Those limits accompany this finding.

[bridge-reproduce.mjs](bridge-reproduce.mjs) and
[bridge-results.json](bridge-results.json) preserve source-level reproductions.
The existing contact/privacy suite passes **21/21** on the same archived PR62.
Q51 was asked to own a narrow correction preserving the server response and using
only qualified elapsed time from a same-client receipt, or showing as-of-read age
without inventing a current estimate. Q43 was asked to confirm any corrected SHA.
No new projection or duplicated foundation is proposed.

## Reproduce and remaining gates

Use Node24.17.0. No package install, shared DB, .env, app server or port is needed.
Fetch the pinned commits read-only if they are not already in the local Git object
store. From this repository, prepare fresh archives in an owned temporary directory:

```sh
mkdir -p /tmp/andes-pr53-review-repro/pr53 /tmp/andes-pr53-review-repro/pr62
git archive e9df5cbfd5c2cfbb19698d46bb957b8561920e66 | tar -x -C /tmp/andes-pr53-review-repro/pr53
git archive 21cd50ac15c22a2a3cc71bf105336e8ebc77c285 | tar -x -C /tmp/andes-pr53-review-repro/pr62
node docs/reviews/pr53/reproduce.mjs /tmp/andes-pr53-review-repro/pr53
node docs/reviews/pr53/audit.mjs
node docs/reviews/pr53/bridge-reproduce.mjs /tmp/andes-pr53-review-repro/pr62
node --test /tmp/andes-pr53-review-repro/pr53/tests/monitoring-state/*.test.mjs
node --test /tmp/andes-pr53-review-repro/pr62/web/tests/contacts/journey.test.mjs /tmp/andes-pr53-review-repro/pr62/web/tests/privacy/consent.test.mjs
git diff --check
```

The original PR has no reported CI checks. No UI was changed or browser-verified.
All reproductions are synthetic and may preserve defects intentionally for review.
Robert's request supplies the human direction to retire PR53; his review is not
dismissed or converted to approval. Clarification of the bounded counterexamples
and original-reviewer confirmation of any replacement/follow-on fix remain open.
#22, #21, parent #3 and other product UI issues stay open until real required
journeys/evidence are established. Nothing here authorizes author merge, branch
deletion, deployment, spending, participant notifications or product-safety claims.
