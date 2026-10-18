"""Run the synthetic #24 decision table using only Python's standard library."""

import argparse
from copy import deepcopy
import json
from pathlib import Path

from evaluator import evaluate


FIXTURE = Path(__file__).with_name("scenarios.json")


def materialize(document, case):
    """Apply explicit dot-path replacements to a shared, fully synthetic input."""
    snapshot = deepcopy(document["base_input"])
    for path, value in case.get("replace", {}).items():
        target = snapshot
        parts = path.split(".")
        for part in parts[:-1]:
            target = target[part]
        if parts[-1] not in target:
            raise ValueError("Unknown fixture path: " + path)
        target[parts[-1]] = deepcopy(value)
    return snapshot


def run(document):
    records = []
    for case in document["cases"]:
        snapshot = materialize(document, case)
        actual = evaluate(snapshot)
        expected = case["expected"]
        failures = []
        for key, value in expected.items():
            if actual[key] != value:
                failures.append(f"{key}: expected {value!r}, got {actual[key]!r}")
        candidate = actual["disposition"] == "stationary_candidate"
        invariants = {
            "candidate_actions": ["ok", "rest", "help"] if candidate else [],
            "request_visual_manual": False,
            "request_audio": False,
            "interaction_required_to_prevent_alarm": False,
            "nonresponse_meaning": "unknown",
            "driver_condition": "unknown",
            "B_attention": None,
            "production_authorised": False,
            "synthetic": True,
        }
        for key, value in invariants.items():
            if actual[key] != value:
                failures.append(f"invariant {key}: expected {value!r}, got {actual[key]!r}")
        if evaluate(snapshot) != actual:
            failures.append("nondeterministic evaluation")
        if snapshot != materialize(document, case):
            failures.append("input mutated")
        records.append({
            "id": case["id"], "synthetic": True, "input": snapshot,
            "expected": expected, "actual": actual, "failures": failures,
        })
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print expanded synthetic I/O")
    args = parser.parse_args()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    records = run(document)
    if args.json:
        print(json.dumps(records, indent=2, sort_keys=True))
    else:
        for record in records:
            outcome = "FAIL" if record["failures"] else "PASS"
            print(f"{outcome} {record['id']}: {record['actual']['disposition']}")
            for failure in record["failures"]:
                print("  " + failure)
        failed = sum(bool(record["failures"]) for record in records)
        print(f"{len(records) - failed}/{len(records)} synthetic scenarios passed")
    return int(any(record["failures"] for record in records))


if __name__ == "__main__":
    raise SystemExit(main())
