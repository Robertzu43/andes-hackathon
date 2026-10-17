# Provisional safe check-in contract · #24

This is a **synthetic, offline proposal**, prepared for Sebastian's #24 handoff.
It is not Robertzu43's frozen API, a #23 adaptive policy, or a usable application.
Robert retains ownership of #4/#23 and the server dependencies. #23 and the
parent section's evidence gates remain open. No issue is completed by this kit.

Target context: independent LATAM freight drivers/owner-operators with typically
one or two trucks, including Brazil. No country, language, phone, road condition
or interaction mode has been physically validated by these fixtures.

## Reproduce offline

Python 3.10+; standard library only, no installs, database, server or network.
Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 evidence/checkins/run_scenarios.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s evidence/checkins -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 evidence/checkins/run_scenarios.py --json
```

The first command checks exact expected dispositions/reasons and invariants;
the second also exercises malformed input, ordering, replay and state-history
cases. It also plants a moving-candidate defect in a disposable temporary copy
and requires the runner to reject it; the working evaluator is never mutated.
Both return nonzero on failure. The last emits expanded synthetic
input/expected/actual records to stdout without writing files. Each case in
[scenarios.json](scenarios.json) inherits `base_input` and applies its listed
dot-path replacements. No fixture is a physical observation or real assessment.

## Bounded decision contract

`evaluate(snapshot)` in [evaluator.py](evaluator.py) is pure and detached from
device/UI/notification code. The input must declare `synthetic: true`.
Production input is rejected. Unknown/malformed/extra fields default to `defer`
with no candidate actions. An output never authorises actual interaction.

| Disposition | Meaning in this offline proposal |
|---|---|
| `suppress` | Do not offer this interaction now: moving observation, lost permission, revoked stationary evidence, or an unsupported mode |
| `defer` | Context, evidence or time ordering is unresolved; reconsider only with resolved, fresh inputs |
| `stationary_candidate` | Synthetic prerequisites permit considering OK/rest/help in a later stationary study |

A candidate requires all of the following: visual/manual mode, an explicit
stationary or planned-stop opportunity, current stationary motion observation,
current parked road context, granted permission, and current stationary-only
interaction assessment. A zero-speed/traffic-light stop is not a parked
opportunity. A planned stop does not override motion or context uncertainty.
`parked` is a supplied, qualified observation label; the evaluator cannot prove
the location is safe, nor can a driver's report substitute for that observation.

Audio/hands-free is unvalidated and suppressed even when stationary here.
There is no moving-authorisation input. Future moving-use evidence would require
a separately reviewed contract revision; it cannot toggle this proposal on.

Every result keeps `request_visual_manual`, `request_audio`,
`interaction_required_to_prevent_alarm` and `production_authorised` false.
Candidate actions are vocabulary, not rendered buttons or instructions.
`B_attention` is always null. There are no reminders, grace timers, notifications,
alarm cancellation, deadline escalation, risk scores or adaptive follow-ups.
Server lost-contact handling remains with Robert and its own gates; the safe
fallback must never make a driver interact merely to prevent an alarm.

`driver_condition` and `nonresponse_meaning` remain `unknown` for every result.
This evaluator does not ingest responses. In a future response contract, OK is a
time-specific attributed report, rest/tiredness a report, and help an explicit
request. None independently establishes wellbeing, sleep or robbery. Preserve
those reports separately from phone observations and independent corroboration;
do not overwrite a help state with a late OK. Intake, delivery, escalation and
report reconciliation are outside this slice (#18/#23/#25–#27).

## Evidence and clock inputs

All four required observations include an enumerated `value`, `source_kind`,
nonempty `source_ref`, nonnegative integer `sequence`, `clock_id`,
`observed_at_ms`, `received_at_ms` and `valid_until_ms`. Booleans are not times.
Motion, road and permission require `source_kind: observation`; stationary
interaction evidence requires `independent_assessment`. These are synthetic
provenance labels only; string presence cannot authenticate an assessor or sensor.

All times must be in one explicitly comparable monotonic clock domain/epoch.
Wall-clock timestamps from another device/server cannot be compared directly.
Required ordering is `observed <= received <= now` and `observed < valid_until`;
freshness is `now < valid_until`. Expiry at equality is unresolved. The supplied
expiry values are fixture inputs, not measured capability limits or production
TTLs. All numbers in the fixtures are illustrative ticks; no cadence, attention
or freshness threshold is frozen here. Real expiry justification belongs to the
upstream evidence/contract owners.

`previous` is either an explicit initial synthetic bootstrap (`null`) or the
last resolved output `checkpoint`. For each field, sequence, observation time
and receipt time cannot decrease. An identical same-sequence replay may be used
only while still fresh; changed same-sequence contents are unresolved. A reversed
evaluation clock, epoch change, incompatible source clock, impossible ordering
or invalid prior checkpoint prevents a new checkpoint as well as a candidate.
There is no silent reordering, timestamp clamping, TTL extension or clock reset.

A clock-resolved suppression/expiry still advances the input checkpoint. That
retains newer moving/lost-permission evidence against delayed old stationary/
granted data. `checkpoint: null` means **retain the last resolved checkpoint**,
never erase history and retry with `previous: null`. Explicit reconciliation and
new qualified observations are required after loss of clock/history continuity.
The pure function cannot detect a caller withholding or replacing history and
does not persist a checkpoint. Production ingestion/authentication/reconciliation
needs Robert's contract; these fixtures cannot supply it.

## Required suppression and uncertainty coverage

| Brief requirement | Reproducible cases/checks |
|---|---|
| Moving visual/manual and demanding road contexts | `moving_visual_manual`, `moving_curve`, `moving_intersection`, `moving_traffic_stop` |
| Stop plan is insufficient; temporary traffic stop is excluded | `planned_stop_does_not_override_motion`, `planned_stop_with_unknown_motion`, `stationary_in_traffic_is_not_parked` |
| Unknown/stale motion or road; contradictory states | `motion_unknown`, `road_unknown`, both unknown, both expiry cases, stationary/curve/driving/intersection and moving/parked conflicts |
| Permission loss/unknown/expiry, evidence missing/revoked/expired | Corresponding permission and stationary-evidence cases; cached grant replay unit test |
| Moving audio unavailable; no implicit verified mode | `audio_moving_unavailable`, `audio_stationary_unvalidated`, `mode_unknown` |
| No response stays unknown; no alarm-prevention interaction | `no_reply_remains_unknown` and invariants on every table case |
| Stale/reversed/out-of-order clocks and replay | Future/receipt/expiry/evaluation/epoch cases, sequence/time regressions and conflicting/identical replays |
| Late data cannot erase later unsafe observation | Checkpoint chain test for moving → delayed stationary → new parked observations |

## Human evidence remains blank

[Stationary comprehension protocol/form](stationary-comprehension.md) and
[independent human-factors protocol/form](human-factors-assessment.md) are blank
researcher records. They do not authorise participant contact, recruitment,
collection, a pilot or moving interaction. Participant-facing ES/PT-BR scripts
are intentionally absent; future scripts need the required copy review and
independent comprehension evidence in each tested locale.

Automation can establish deterministic behaviour for these supplied inputs and
the stated invariants. It cannot establish actual stationarity, correct road
classification, permission truth, human comprehension, eyes-off-road cost,
driving performance, reduced crime/fatigue harm, provider behaviour or operational
alarm burden. Stationary study results also cannot prove driving safety.
Self-reported ease cannot satisfy the independent attention gate.

If the independent assessment is unavailable, fails or is inconclusive, moving
interaction remains excluded. Retain stationary/planned-stop candidates and
separately gated server lost-contact handling. Record reviewer pass, revise,
stop or inconclusive against prespecified criteria; preserve failures and missing
evidence. Passing these software checks does not satisfy that disposition.
