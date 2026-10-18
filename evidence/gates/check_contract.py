"""Check preparatory declarations, never evidence truth or pilot readiness (stdlib)."""

import argparse
import json
import math
from pathlib import Path
import sys


DISPOSITIONS = ("pending", "pass", "revise", "stop", "inconclusive")
THRESHOLDS = {"T_action", "Delta_action", "B_false", "B_attention"}
CLAIMS = {"H1", "H2", "H3"}
GATES = {"G1", "G2", "G3", "G4"}
UNITS = {
    "delivered_prompt", "eligible_prompt", "trip", "covered_driver_hour",
    "contact_action", "independently_labelled_event", "active_trip_hour",
}
REVIEW = {
    "reviewer": "text", "independent_of_implementation": "bool",
    "record_ref": "text", "revision": "text", "disposition": DISPOSITIONS,
    "limitations": "text",
}
EVALUATION = {
    "id": "text", "scope_id": "text", "claim_or_constraint": "text",
    "source_refs": ["text"],
    "test": {"procedure": "text", "result_refs": ["text"],
             "outcome": ("not_run", "pass", "fail", "inconclusive")},
    "acceptance": {"criterion": "text", "evidence_refs": ["text"], "review": REVIEW},
    "disposition": DISPOSITIONS, "disposition_reason": "text",
}
SCHEMA = {
    "schema_version": (1,), "purpose": ("preparatory",),
    "evidence_mode": ("real", "synthetic"), "revision": "text", "author": "text",
    "provenance": {"authority_refs": ["text"], "prepared_at": "text",
                   "input_limitations": "text"},
    "scopes": [{"id": "text", "country": "text", "language": "text",
                "route_conditions": "text", "device_conditions": "text",
                "retest_before_extension": "text"}],
    "sources": [{"id": "text", "kind": ("plan", "synthetic", "observed", "recalled",
                                           "independently_labelled"),
                 "reference": "text", "provenance": "text", "limitations": "text",
                 "scope_ids": ["text"]}],
    "baselines": [{"scope_id": "text", "description": "text", "source_refs": ["text"],
                   "variation_method": "text", "units": ["text"]}],
    "exposure": {
        "overall_burden_denominator": ("all_registered_active_trip_hours",),
        "include_sensor_network_gaps": (True,), "trip_end_censoring": "text",
        "road_rate_denominator": ("qualified_location_covered_driver_hours",),
        "location_qualification": "text", "gap_reporting": "text",
    },
    "thresholds": [{
        "name": "text", "scope_id": "text", "value": "number", "unit": "text",
        "measurement_definition": "text",
        "justification_refs": {"reconstructed_timelines": ["text"],
                               "baseline_variation": ["text"],
                               "contact_tolerance": ["text"],
                               "human_factors_review": ["text"]},
        "review": REVIEW,
    }],
    "claims": [EVALUATION], "deterministic_gates": [EVALUATION],
    "prerequisites": [{"issue": ("#1", "#8", "#9", "#10"),
                       "evidence_refs": ["text"], "review": REVIEW}],
    "freeze": {"state": ("draft", "declared_frozen"), "revision": "optional_text",
               "record_ref": "optional_text",
               "before_implementation_and_outcome_inspection": "optional_bool"},
}


def report(errors, gaps, mode=None):
    complete = not errors and not gaps
    return {
        "evidence_mode": mode if isinstance(mode, str) and mode in {"real", "synthetic"} else None,
        "schema_valid": not errors,
        "syntactically_complete": complete,
        "declaration_status": ("complete_unverified" if complete else "blocked"),
        "independent_acceptance": "not_verified",
        "pilot_ready": False,
        "errors": errors,
        "gaps": gaps,
        "limitations": [
            "Local declaration checks only; references are not opened or authenticated.",
            "Reviewer identity, independence, evidence truth and chronology are not verified.",
            "Synthetic examples and scripted checks cannot establish real-world acceptance.",
            "No pilot authorisation, incident validation, product-safety result or issue closure.",
        ],
    }


def check_contract(document):
    """Return path-specific problems. Null/empty fields remain visible evidence gaps."""
    errors, gaps = [], []

    def add(target, path, code, message):
        target.append({"path": path, "code": code, "message": message})

    def shape(value, spec, path):
        if value is None:
            if isinstance(spec, (dict, list)):
                add(errors, path, "type", "Required container cannot be null")
                return
            if isinstance(spec, str) and spec.startswith("optional_"):
                return
            add(gaps, path, "unset", "UNSET; supply a justified declaration")
        elif isinstance(spec, dict):
            if not isinstance(value, dict):
                add(errors, path, "type", "Expected an object")
                return
            for key in sorted(value.keys() - spec.keys()):
                add(errors, path + "." + key, "unknown_field", "Unrecognised field")
            for key, child in spec.items():
                if key not in value:
                    add(errors, path + "." + key, "missing_field", "Required field absent")
                else:
                    shape(value[key], child, path + "." + key)
        elif isinstance(spec, list):
            if not isinstance(value, list):
                add(errors, path, "type", "Expected an array")
            elif not value:
                add(gaps, path, "empty", "Required declarations/evidence absent")
            else:
                for i, item in enumerate(value):
                    shape(item, spec[0], f"{path}[{i}]")
        elif isinstance(spec, tuple):
            if not any(type(value) is type(choice) and value == choice for choice in spec):
                add(errors, path, "enum", "Unsupported value")
        elif spec in ("text", "optional_text"):
            if not isinstance(value, str):
                add(errors, path, "type", "Expected a string")
            elif not value.strip() or value.strip().upper() in {"UNSET", "TODO", "TBD"}:
                add(gaps, path, "unset", "Placeholder is not evidence")
        elif spec in ("bool", "optional_bool"):
            if type(value) is not bool:
                add(errors, path, "type", "Expected a boolean")
        elif spec == "number":
            if type(value) not in (int, float) or (isinstance(value, float) and not math.isfinite(value)):
                add(errors, path, "type", "Expected a finite number, not a boolean")
            elif value < 0:
                add(errors, path, "range", "Threshold cannot be negative")

    shape(document, SCHEMA, "$")
    # Do not traverse malformed containers. Still return their visible gaps.
    if errors:
        return report(errors, gaps, document.get("evidence_mode") if isinstance(document, dict) else None)

    def unique(rows, field, path):
        seen = set()
        for i, row in enumerate(rows):
            value = row[field]
            if value in seen:
                add(errors, f"{path}[{i}].{field}", "duplicate", "Duplicate identifier")
            seen.add(value)
        return seen

    scopes = unique(document["scopes"], "id", "$.scopes")
    unique(document["sources"], "id", "$.sources")
    sources = {s["id"]: s for s in document["sources"]}
    mode, revision = document["evidence_mode"], document["revision"]

    def evidence(refs, path, scope_ids):
        if len(refs) != len(set(refs)):
            add(errors, path, "duplicate", "Duplicate evidence reference")
        for ref in refs:
            source = sources.get(ref)
            if source is None:
                add(errors, path, "dangling_reference", "Unknown source ID")
            elif source["kind"] == "plan":
                add(gaps, path, "plan_only", "A plan cannot satisfy measured evidence")
            elif not scope_ids.issubset(set(source["scope_ids"])):
                add(errors, path, "evidence_scope", "Source does not declare the required scope")

    def review(value, path):
        if value["reviewer"] is not None and value["reviewer"] == document["author"]:
            add(errors, path, "self_review", "Author cannot declare independent acceptance")
        if value["independent_of_implementation"] is not True:
            add(gaps, path, "independence_undeclared", "Independent review declaration missing")
        if value["revision"] != revision:
            add(gaps, path, "review_revision", "Review does not identify this revision")
        if value["disposition"] != "pass":
            add(gaps, path, "review_not_accepted", "Pending/adverse/inconclusive review blocks acceptance")

    for i, source in enumerate(document["sources"]):
        if not set(source["scope_ids"]).issubset(scopes):
            add(errors, f"$.sources[{i}]", "source_scope", "Unknown source scope")
        if mode == "real" and source["kind"] == "synthetic":
            add(errors, f"$.sources[{i}]", "synthetic_in_real", "Synthetic source in real declaration")

    def scope_rows(key, identity, expected):
        rows = document[key]
        pairs = set()
        for i, row in enumerate(rows):
            path = f"$.{key}[{i}]"
            pair = (row["scope_id"], row[identity]) if identity else (row["scope_id"],)
            if pair in pairs:
                add(errors, path, "duplicate", "Duplicate declaration for scope")
            pairs.add(pair)
            if row["scope_id"] not in scopes:
                add(errors, path, "unknown_scope", "Unknown scope ID")
            if identity and row[identity] not in expected:
                add(errors, path, "unknown_id", "Unsupported claim/gate/threshold")
        required = {(s, item) for s in scopes for item in expected} if identity else {(s,) for s in scopes}
        if not required.issubset(pairs):
            add(gaps, "$." + key, "coverage", "Every scope needs every required declaration")
        return rows

    for i, baseline in enumerate(scope_rows("baselines", None, set())):
        path = f"$.baselines[{i}]"
        if set(baseline["units"]) != UNITS or len(baseline["units"]) != len(UNITS):
            add(errors, path + ".units", "units", "Register each required unit exactly once")
        evidence(baseline["source_refs"], path + ".source_refs", {baseline["scope_id"]})

    for i, threshold in enumerate(scope_rows("thresholds", "name", THRESHOLDS)):
        path = f"$.thresholds[{i}]"
        if threshold["name"] in {"T_action", "Delta_action"}:
            if threshold["unit"] != "seconds":
                add(errors, path + ".unit", "unit", "Action-time threshold unit must be seconds")
            if threshold["value"] is not None and threshold["value"] <= 0:
                add(errors, path + ".value", "range", "Action time/improvement must be positive")
        if threshold["name"] == "B_false" and threshold["unit"] != "unnecessary_escalations_per_active_trip_hour":
            add(errors, path + ".unit", "unit", "Overall burden must use all active trip-hours")
        for kind, refs in threshold["justification_refs"].items():
            evidence(refs, path + ".justification_refs." + kind, {threshold["scope_id"]})
        review(threshold["review"], path + ".review")

    for key, required in (("claims", CLAIMS), ("deterministic_gates", GATES)):
        for i, item in enumerate(scope_rows(key, "id", required)):
            path = f"$.{key}[{i}]"
            for label, refs in (("source_refs", item["source_refs"]),
                                ("test.result_refs", item["test"]["result_refs"]),
                                ("acceptance.evidence_refs", item["acceptance"]["evidence_refs"])):
                evidence(refs, path + "." + label, {item["scope_id"]})
            review(item["acceptance"]["review"], path + ".acceptance.review")
            if item["test"]["outcome"] != "pass":
                add(gaps, path + ".test", "test_not_passed", "Test absent, failed or inconclusive")
            if item["disposition"] != "pass":
                add(gaps, path, "disposition", "Revise/stop/inconclusive/pending remains blocking")
            elif item["test"]["outcome"] != "pass" or item["acceptance"]["review"]["disposition"] != "pass":
                add(errors, path, "contradictory_pass", "Pass conflicts with test/reviewer disposition")

    prerequisites = unique(document["prerequisites"], "issue", "$.prerequisites")
    if prerequisites != {"#1", "#8", "#9", "#10"}:
        add(gaps, "$.prerequisites", "coverage", "Preserve #1 and #8–#10 evidence gates")
    for i, item in enumerate(document["prerequisites"]):
        evidence(item["evidence_refs"], f"$.prerequisites[{i}].evidence_refs", scopes)
        review(item["review"], f"$.prerequisites[{i}].review")

    freeze = document["freeze"]
    if freeze["state"] == "declared_frozen":
        if (freeze["revision"] != revision or not freeze["record_ref"]
                or freeze["before_implementation_and_outcome_inspection"] is not True):
            add(errors, "$.freeze", "freeze_record", "Freeze needs revision, record and preregistration declaration")
        if gaps:
            add(errors, "$.freeze", "freeze_blocked", "Cannot declare a freeze with missing or adverse evidence")
    elif any(freeze[k] is not None for k in freeze if k != "state"):
        add(errors, "$.freeze", "draft_freeze", "Draft must leave freeze record fields null")
    return report(errors, gaps, mode)


def load_contract(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def reject_constant(_):
        raise ValueError("Non-finite JSON number")

    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle, object_pairs_hook=pairs, parse_constant=reject_constant)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contract", help="Path to a local decision-contract JSON file")
    args = parser.parse_args(argv)
    try:
        result = check_contract(load_contract(args.contract))
    except (OSError, ValueError, RecursionError):
        # Do not echo source contents, paths or OS details into shareable output.
        result = report([{"path": "$", "code": "input", "message": "Cannot read valid, unambiguous JSON"}], [])
        print(json.dumps(result, indent=2, allow_nan=False))
        return 2
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0 if result["syntactically_complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
