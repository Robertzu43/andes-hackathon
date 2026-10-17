# Contextual check-ins: proposal and published contract gaps

Status: review proposal, not an activated policy. This reconciles the latest
GPS/road-context and declared eating/busy/fuelling direction with existing
[PLAN](../../PLAN.md) issues #17, #20, #21, #23–27 and #29 and the
[scenario inventory](2026-10-17-contextual-checkin-scenarios.md). It selects no
numeric cadence, provider, live escalation rule or new API. Existing issue gates
remain open. Robert owns the forthcoming security/status/sharing contract;
lane44 coordinates integration rather than creating a parallel contract.

Publication update: Robert's [PR74](https://github.com/Bimbi-Dev/andes-hackathon/pull/74)
at `4c138ca1d00742400a850cd72b0888cc59260a36` now supplies status, sharing and
demo-session contracts. The inventory below preserves the earlier frozen baseline
and describes that new source separately. PR74 remains under independent review;
this proposal neither accepts it nor replaces Robert's implementation policy.

## Frozen baseline and newly published successor

Source inspected: Robert's frozen
[`c752de8a3b424bcbc086764dc11052348b27e320`](https://github.com/Bimbi-Dev/andes-hackathon/tree/c752de8a3b424bcbc086764dc11052348b27e320).
Its `src`, `db`, package manifests and compiler configuration are unchanged from
`ebc8fb1`; the later commit adds architecture material. Runtime integration
`5591c9b` separately corrects authorization time after a quota-lock wait. Neither
revision publishes the contextual policy below.

### Frozen c752 baseline

| Published seam | Actual behavior | Remaining gap |
| --- | --- | --- |
| Owner `GET /v1/trips/:id` | Returns the persisted trip, including `paused`, `checkins_active`, `map_active`, `status` and `version`. | No contextual decision, read timestamp, pause deadline or follow-up-policy DTO. A boolean is not an agreed bounded stop. |
| Owner `POST /v1/trips/:id/commands` | Body contains only `type`: `arrived`, `cancel`, `pause`, `resume`, `checkin_ok` or `rest_report`. It requires the normal actor-scoped idempotency key and returns `{id,command,automaticEscalation:false}`. | Extra activity/end-time fields are not supported; they must not be silently sent or inferred. |
| `pause` / `resume` | Changes pause/check-in flags and trip version. Pause cancels pending/claimed ordinary jobs; it leaves map sharing independent. | No declared activity, expected end, bounded extension or pause-expiry transition is persisted. |
| `checkin_ok` / `rest_report` | Records an attributed `trip_events` row with actor, kind and server time. | No prompt/opportunity binding, observation time or proof of alertness, sleep or recovery. |
| Arrival/cancel and explicit incident resolution | Closure stops map/check-ins and future ordinary authorizations. Security SOS resolution is a different authorized operation. | An ordinary OK, pause or arrival must not acquire incident-resolution semantics. Prior authorized sends cannot be promised recalled. |
| Locations, snapshot, incident read and durable jobs | Separate source/receipt/read age, current consent, incident state and send/delivery facts are implemented under their own contracts. | They do not establish driver presence, road workload, a prompt being perceived or useful contact action. |

The source inventory is in [runtime.md](../../contracts/runtime.md),
[trip commands](../../../src/trips/routes.ts) and the
[persisted schema](../../../db/migrations/001-core.sql). No status or sharing
endpoint is registered in this frozen backend. The proposed `/status` and
`/sharing` seams were unpublished at that snapshot. The following PR74 inventory
supersedes that absence for the new source, without changing the frozen evidence.

### PR74 source inventory, pending independent acceptance

The [new runtime contract](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/docs/contracts/runtime.md#security-checks-part-1)
and [route source](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/src/checks/routes.ts)
publish these actual seams:

| Route or configuration | Source-backed behavior | Binding limit |
| --- | --- | --- |
| `POST /v1/trips/:id/sharing` | Owner-only, idempotent `{state:'stopped'\|'resumed', reason:'user'\|'page_hidden'\|'permission_denied'\|'error'}` returns `{id,sharing}`. Stop preserves the first stop time; resume clears it. Closed trips return 409. | This reports sharing state, not a declared meal/rest or a general motion/lifecycle event stream. |
| `GET /v1/trips/:id/status` | Returns trip status/pause/expected arrival, an open asking check or null, latest incident or null, delivery facts and optional location freshness/age/capture-time/accuracy. Incident/delivery details require driver or incident scope; location metadata requires map access. | No coordinates, phone numbers or recipient IDs. The DTO has no `readAt`; clients must not invent one. Authorization and race review remain pending. |
| `POST /v1/demo/session` | Explicit demo mode exposes synthetic driver/family/colleague personas with tokens and seeded IDs. Production OIDC remains a different identity mode. | Source currently includes a live-phone configuration branch despite the PR body's refusal claim; that discrepancy was sent to the auth/privacy reviewer. It grants no permission for live sends or deployment. |
| Control-worker check configuration | All four `SILENCE_MS`, `ASK_GRACE_MS`, `ARRIVAL_GRACE_MS`, `CHECK_SWEEP_MS` must be positive integers; all unset disables checks and partial configuration fails. The production template leaves them unset. | Demo timing values are not approved safety bounds. This documentation change sets none of them. |

The [sweeper](https://github.com/Bimbi-Dev/andes-hackathon/blob/4c138ca1d00742400a850cd72b0888cc59260a36/src/checks/sweep.ts)
uses the latest location receipt, OK/resume, incident resolution or trip creation
as its silence signal. Arrival-overdue separately uses expected arrival and the
driver's last action. Thus fresh GPS can prevent a silence check when no expected
arrival is set; it still is not a human confirmation. This differs from the
proposal's independently agreed human-status follow-up and needs an explicit
policy reconciliation before live activation, not an unreviewed code override.

An unanswered asking check can create a `missed_check` incident with the same
fan-out as SOS: family gets SMS/WhatsApp/voice, colleague SMS/WhatsApp, group stays
unavailable. OK closes an asking check; it does not resolve an active incident.
Pause/arrival/cancel cancel asking checks. The new code still supplies no bounded
declared-activity pause, road-context veto or opportunity-expiry contract. The
proposal's separate unknown-status audience, timing and interaction requirements
remain review questions for Robert alongside this published demo behavior.

Lane41's PR65 is a separate driver-owned catalog/bootstrap proposal. It supplies
neither recipient invitation/shared-trip discovery nor the missing contextual
policy. Its current read-consistency finding also needs repair and reviewer
confirmation; catalog data must not be promoted into a safety/status decision.

## Proposed interpretation of the three independent dimensions

| Dimension | Preserve | Do not infer |
| --- | --- | --- |
| Observed phone movement and context | Source, observation age/accuracy, road/map-match uncertainty and unavailable coverage. | Device motion is the driver's presence or attention; stationary GPS or an absent hazard means safe to respond. |
| Driver-declared activity | Meal, fuel, rest, loading or busy, with who declared it, server acknowledgement and an agreed expected end. Local/offline intent remains visibly pending. | POI proximity confirms a stop; a rest declaration proves sleep; an unacknowledged local pause altered server deadlines. |
| Server follow-up and active SOS | Policy/version, agreed deadline, opportunity/delivery uncertainty, current consent and independent incident state. | Deferral is a failed answer; delivery is perception/help; an OK, pause or arrival resolves SOS. |

These are proposed distinctions, not newly implemented fields. A bounded,
server-acknowledged pause must not become indefinite reassurance. If it expires or
fresh observations contradict it, preserve the discrepancy and use the agreed
unknown-status process without forcing a driver to touch the phone. A driver must
not have to declare or extend a stop while moving merely to prevent an alarm.

## Two clocks and a final local veto

The opportunity clock determines whether an ordinary driver interaction may be
offered. Start evaluation with stationary/planned-milestone human confirmations;
ordinary visual/manual response demands stay deferred while moving. Known demanding
context can veto an opportunity; absence of such evidence cannot certify safety.
GPS liveness is not a human confirmation. Moving interaction still needs #24's
independent assessment, including any optional audio mode.

The independent server follow-up clock preserves the pre-agreed bounded response
to prolonged inability to confirm status, even when the browser disappears or
every ordinary opportunity is deferred. It does not label suppressed or
undeliverable prompts as failed answers, and it cannot postpone the contact-unknown
process forever. Audience, consent, bounds and escalation wording must be agreed
before activation; a missed response does not inherit the explicit SOS broadcast.

Before displaying a proposed opportunity, the client must reassess current
context, trip/session generation and the decision's validity. An expired or stale
server decision must not display later or create a burst after reconnect. External
WhatsApp/SMS/call delivery cannot guarantee this local last-moment check. A future
contract must specify decision expiry, deduplication and attribution without
pretending those fields already exist. Explicit SOS remains available under its
own consent and authorization rules.

## Evidence limits for GPS and road context

The [W3C Geolocation request algorithm](https://www.w3.org/TR/geolocation/#request-a-position)
waits for visibility when a document is hidden; watch updates require an active,
visible document. This supports treating unavailable web capture as unknown and
testing background/locked-phone behavior separately. It supplies no continuous
background guarantee or driver-attention assessment.

[Mapbox Map Matching](https://docs.mapbox.com/api/navigation/map-matching/)
matches supplied position traces to the road network and exposes confidence in
that match. That value is not driver safety. Design inference: a past trace alone
does not identify a future curve on an unknown route; forward context needs
appropriate route/network geometry, freshness, coverage and uncertainty. Matching
and cached/batched enrichment must not block the independent deadline or SOS path.

[HERE Routing v8 truck routing](https://docs.here.com/routing/docs/routing-v8-truck-routing)
is a documented truck-context candidate, not a selected provider or evidence that
every country/route is covered adequately. No credential, paid request or provider
activation is introduced here. Country, parallel-road ambiguity and unsupported
geometry remain explicit unknowns. References checked 2026-10-17; these API facts
do not validate an ANDES prompting policy.

## Proposed acceptance additions within existing issues

| Existing issue | Concrete proposal to review | Evidence needed before that gate can pass |
| --- | --- | --- |
| #17 | Distinguish declared activity, accepted bounded pause, extension/resumption and expired/contradictory pause; keep sharing and SOS independent. | Deterministic offline pause, lost response/same-key retry, expiry/restart, repeated extension, arrival versus dispatch and SOS versus late OK timelines. |
| #20 | Use qualified road context as an interruption veto; keep phone position, observed stop and declared activity separate. | Independently labelled curve/parallel-road/POI/cross-border traces, stale/poor accuracy and missing route geometry; no safe-stop or alertness inference. |
| #21 | Preserve source age and missing coverage through suspension and reconnect. | Hidden/locked/killed browser, delayed batch, revoked permission and phone unavailable; no old observation animated as current or treated as a reply. |
| #23–24 | Version a deterministic stationary/planned-stop opportunity rule; leave numeric bounds unset until the existing evidence process chooses them. | Suppression and attention cases C01–C16; stationary usability first, with independent assessment before any moving interaction. No LLM has live decision authority. |
| #25–26 | Count distinct eligible opportunities, technical availability and responses separately; preserve the independent follow-up clock. | Unplayed/suppressed versus unanswered cases, no prompt burst, C17–C20, stale OK after SOS and prolonged deferral without indefinite reassurance. |
| #27 | Persist deadline/generation and invalidate stale decisions; never infer cancellation of an already authorized send. | Barrier-controlled expiry/closure/pause races, restart, duplicate/reordered receipt and delayed local display, including renewed current-state checks. |
| #29 | Keep unconfirmed status, reported fatigue/rest support, explicit help, receipt and reported action distinct. | Contact-unavailable, voicemail, acknowledgement-without-action and conflicting reports C22–C24 with current consent and attributed outcomes. |

## Contract handoff to Robert

Before lane41/45/50/51 implement the missing seam, Robert needs to publish:

1. The reviewed status/sharing/security-policy semantics following the published
   PR74 contracts, including scopes, check-versus-incident meaning and activation
   limits. Any extensions need an explicit contract rather than parallel routes.
2. The declared-activity and bounded-pause acknowledgement/expiry contract, its
   offline pending state and interaction with independent follow-up and active SOS.
3. The opportunity identity/version, expiry, local veto and late-response rules,
   while numeric cadence and policy activation remain gated by #23–27.
4. Ownership and minimal authorized recipient invitation/shared-trip discovery,
   which is distinct from driver catalogs and must not expose a directory,
   coordinates, provider internals or unaccepted participants.

Lane44 owns shared mounts/root integration; lane41 implements agreed additive
reads; lane45 types published contracts; lane50/51 consume them in their journeys;
lane46/52 supply producer/evaluation evidence. No lane should invent a second
status/sharing implementation. This document is a review input for those owners,
not approval of runtime changes or closure of an issue.
