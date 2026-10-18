"""Provisional #24 synthetic interaction contract; no production side effects."""

from copy import deepcopy


VERSION = "checkins-provisional-1"
FIELDS = {"motion", "road", "permission", "interaction_evidence"}
VALUES = {
    "motion": {"stationary", "moving", "unknown"},
    "road": {"parked", "driving", "curve", "intersection", "traffic_stop", "unknown"},
    "permission": {"granted", "lost", "unknown"},
    "interaction_evidence": {"stationary_validated", "revoked", "unknown"},
}
OBSERVATION_KEYS = {
    "value", "observed_at_ms", "received_at_ms", "valid_until_ms",
    "sequence", "clock_id", "source_kind", "source_ref",
}


def _integer(value):
    return type(value) is int and value >= 0


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _observations_valid(observations):
    if not isinstance(observations, dict) or observations.keys() != FIELDS:
        return False
    for field, item in observations.items():
        if not isinstance(item, dict) or item.keys() != OBSERVATION_KEYS:
            return False
        if not isinstance(item["value"], str) or item["value"] not in VALUES[field]:
            return False
        if not all(_integer(item[key]) for key in (
            "observed_at_ms", "received_at_ms", "valid_until_ms", "sequence"
        )):
            return False
        expected_kind = (
            "independent_assessment" if field == "interaction_evidence" else "observation"
        )
        if item["source_kind"] != expected_kind:
            return False
        if not _text(item["clock_id"]) or not _text(item["source_ref"]):
            return False
    return True


def _snapshot_valid(snapshot):
    required = {
        "synthetic", "clock_id", "now_ms", "previous", "mode",
        "opportunity", "observations",
    }
    if not isinstance(snapshot, dict) or snapshot.keys() != required:
        return False
    if snapshot["synthetic"] is not True or not _text(snapshot["clock_id"]):
        return False
    if not _integer(snapshot["now_ms"]):
        return False
    if snapshot["mode"] not in ("visual_manual", "audio_hands_free", "unknown"):
        return False
    if snapshot["opportunity"] not in ("stationary", "planned_stop", "none"):
        return False
    if not _observations_valid(snapshot["observations"]):
        return False
    previous = snapshot["previous"]
    if previous is None:
        return True
    return (
        isinstance(previous, dict)
        and previous.keys() == {"clock_id", "now_ms", "observations"}
        and _text(previous["clock_id"])
        and _integer(previous["now_ms"])
        and _observations_valid(previous["observations"])
    )


def evaluate(snapshot):
    """Return a synthetic candidate or no-interaction decision, without mutating input.

    Expiry times are supplied fixture inputs, never an attention/cadence threshold.
    Callers must retain the last resolved checkpoint; unresolved input cannot clear it.
    """
    result = {
        "contract_version": VERSION,
        "synthetic": True,
        "production_authorised": False,
        "disposition": "defer",
        "reasons": [],
        "candidate_actions": [],
        "request_visual_manual": False,
        "request_audio": False,
        "interaction_required_to_prevent_alarm": False,
        "driver_condition": "unknown",
        "nonresponse_meaning": "unknown",
        "B_attention": None,
        "checkpoint": None,
    }
    if not _snapshot_valid(snapshot):
        result["reasons"] = ["invalid_snapshot"]
        return result

    reasons = result["reasons"]
    observations = snapshot["observations"]
    previous = snapshot["previous"]
    now = snapshot["now_ms"]
    clock = snapshot["clock_id"]
    clock_problem = False
    if previous is not None:
        if clock != previous["clock_id"]:
            reasons.append("clock_epoch_changed")
            clock_problem = True
        if now < previous["now_ms"]:
            reasons.append("evaluation_clock_reversed")
            clock_problem = True

    for field in sorted(FIELDS):
        item = observations[field]
        observed = item["observed_at_ms"]
        received = item["received_at_ms"]
        expires = item["valid_until_ms"]
        if item["clock_id"] != clock:
            reasons.append(field + ":clock_mismatch")
            clock_problem = True
        if not observed <= received <= now or expires <= observed:
            reasons.append(field + ":invalid_clock_order")
            clock_problem = True
        if now >= expires:
            reasons.append(field + ":expired")
        if previous is not None:
            old = previous["observations"][field]
            if (old["clock_id"] != previous["clock_id"]
                    or not old["observed_at_ms"] <= old["received_at_ms"] <= previous["now_ms"]
                    or old["valid_until_ms"] <= old["observed_at_ms"]):
                reasons.append(field + ":invalid_checkpoint")
                clock_problem = True
            if (item["sequence"] < old["sequence"]
                    or observed < old["observed_at_ms"]
                    or received < old["received_at_ms"]):
                reasons.append(field + ":out_of_order")
                clock_problem = True
            if item["sequence"] == old["sequence"] and item != old:
                reasons.append(field + ":conflicting_replay")
                clock_problem = True

    motion = observations["motion"]["value"]
    road = observations["road"]["value"]
    permission = observations["permission"]["value"]
    evidence = observations["interaction_evidence"]["value"]
    if snapshot["mode"] != "visual_manual":
        reasons.append("mode_unvalidated")
    if snapshot["opportunity"] == "none":
        reasons.append("no_stationary_opportunity")
    if motion != "stationary":
        reasons.append("motion_" + motion)
    if road != "parked":
        reasons.append("road_" + road)
    if (motion == "moving" and road == "parked") or (
        motion == "stationary" and road in {"driving", "curve", "intersection"}
    ):
        reasons.append("contradictory_context")
    if permission != "granted":
        reasons.append("permission_" + permission)
    if evidence != "stationary_validated":
        reasons.append("stationary_evidence_" + evidence)

    # This checkpoint is input history only; it is never a wellbeing/permission grant.
    # Even expired/unsafe observations advance history if their clocks are resolved.
    if not clock_problem:
        result["checkpoint"] = deepcopy({
            "clock_id": clock, "now_ms": now, "observations": observations,
        })
    if not reasons:
        result["disposition"] = "stationary_candidate"
        result["candidate_actions"] = ["ok", "rest", "help"]
    elif (snapshot["mode"] != "visual_manual" or motion == "moving"
          or permission == "lost" or evidence == "revoked"):
        result["disposition"] = "suppress"
    return result
