"""Offline safety invariants from the #24 brief; no participant or device evidence."""

from copy import deepcopy
from itertools import product
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from evaluator import evaluate
from run_scenarios import materialize, run


class CheckinContractTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads(Path(__file__).with_name("scenarios.json").read_text())
        self.base = deepcopy(self.document["base_input"])

    def test_synthetic_decision_table(self):
        cases = self.document["cases"]
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        for record in run(self.document):
            with self.subTest(case=record["id"]):
                self.assertEqual(record["failures"], [])

    def test_moving_and_unknown_never_qualify_across_modes_and_opportunities(self):
        for motion, road, mode, opportunity in product(
            ("moving", "unknown"),
            ("parked", "driving", "curve", "intersection", "traffic_stop", "unknown"),
            ("visual_manual", "audio_hands_free", "unknown"),
            ("stationary", "planned_stop", "none"),
        ):
            with self.subTest(motion=motion, road=road, mode=mode, opportunity=opportunity):
                snapshot = deepcopy(self.base)
                snapshot["observations"]["motion"]["value"] = motion
                snapshot["observations"]["road"]["value"] = road
                snapshot["mode"] = mode
                snapshot["opportunity"] = opportunity
                result = evaluate(snapshot)
                self.assertNotEqual(result["disposition"], "stationary_candidate")
                self.assertEqual(result["candidate_actions"], [])
                self.assertFalse(result["request_visual_manual"])
                self.assertFalse(result["request_audio"])
                self.assertFalse(result["interaction_required_to_prevent_alarm"])
                self.assertEqual(result["nonresponse_meaning"], "unknown")

    def test_each_required_observation_and_checkpoint_is_validated(self):
        for field in self.base["observations"]:
            for location in ("current", "previous"):
                for bad_value in (None, [], {}, "stationary", 0):
                    with self.subTest(field=field, location=location, value=bad_value):
                        snapshot = deepcopy(self.base)
                        container = snapshot if location == "current" else snapshot["previous"]
                        container["observations"][field] = bad_value
                        self.assertEqual(evaluate(snapshot)["reasons"], ["invalid_snapshot"])
            for key in self.base["observations"][field]:
                snapshot = deepcopy(self.base)
                del snapshot["observations"][field][key]
                self.assertEqual(evaluate(snapshot)["reasons"], ["invalid_snapshot"])

    def test_unrecognised_input_never_becomes_a_candidate(self):
        for value in (None, [], {}, True, "snapshot"):
            self.assertEqual(evaluate(value)["reasons"], ["invalid_snapshot"])
        for key in self.base:
            snapshot = deepcopy(self.base)
            del snapshot[key]
            self.assertEqual(evaluate(snapshot)["reasons"], ["invalid_snapshot"])
        snapshot = deepcopy(self.base)
        snapshot["moving_authorised"] = True
        self.assertEqual(evaluate(snapshot)["reasons"], ["invalid_snapshot"])

    def test_expiry_and_reordering_apply_to_every_field(self):
        for field in self.base["observations"]:
            for change, reason in (
                ({"valid_until_ms": 1000}, "expired"),
                ({"sequence": 8}, "out_of_order"),
                ({"sequence": 9}, "conflicting_replay"),
                ({"observed_at_ms": 969}, "out_of_order"),
                ({"received_at_ms": 1001}, "invalid_clock_order"),
                ({"clock_id": "other"}, "clock_mismatch"),
            ):
                with self.subTest(field=field, change=change):
                    snapshot = deepcopy(self.base)
                    snapshot["observations"][field].update(change)
                    result = evaluate(snapshot)
                    self.assertIn(field + ":" + reason, result["reasons"])
                    self.assertEqual(result["candidate_actions"], [])

    def test_late_stationary_cannot_erase_resolved_moving_observation(self):
        moving = deepcopy(self.base)
        moving["observations"]["motion"]["value"] = "moving"
        moving["observations"]["road"]["value"] = "driving"
        checkpoint = evaluate(moving)["checkpoint"]
        self.assertIsNotNone(checkpoint)
        late = deepcopy(self.base)
        late["now_ms"] = 1001
        late["previous"] = checkpoint
        late["observations"]["motion"]["sequence"] = 9
        result = evaluate(late)
        self.assertEqual(result["candidate_actions"], [])
        self.assertIsNone(result["checkpoint"])
        recovered = deepcopy(moving)
        recovered["now_ms"] = 1002
        recovered["previous"] = checkpoint  # Keep the resolved history through the failure.
        for field in ("motion", "road"):
            recovered["observations"][field].update(
                sequence=11, observed_at_ms=1001, received_at_ms=1001
            )
        recovered["observations"]["motion"]["value"] = "stationary"
        recovered["observations"]["road"]["value"] = "parked"
        self.assertEqual(evaluate(recovered)["disposition"], "stationary_candidate")

    def test_permission_loss_cannot_be_cleared_by_cached_grant(self):
        lost = deepcopy(self.base)
        lost["observations"]["permission"]["value"] = "lost"
        checkpoint = evaluate(lost)["checkpoint"]
        cached = deepcopy(self.base)
        cached["previous"] = checkpoint
        result = evaluate(cached)
        self.assertIn("permission:conflicting_replay", result["reasons"])
        self.assertEqual(result["candidate_actions"], [])

    def test_returned_checkpoint_is_detached_and_repeatable(self):
        before = deepcopy(self.base)
        result = evaluate(self.base)
        self.assertEqual(self.base, before)
        self.assertEqual(result, evaluate(self.base))
        result["checkpoint"]["observations"]["motion"]["value"] = "moving"
        self.assertEqual(self.base, before)

    def test_runner_detects_an_intentionally_wrong_expected_decision(self):
        document = deepcopy(self.document)
        document["cases"] = [{
            "id": "negative-control", "expected": {"disposition": "suppress"}
        }]
        self.assertTrue(run(document)[0]["failures"])

    def test_fixture_replacements_cannot_silently_invent_fields(self):
        with self.assertRaises(ValueError):
            materialize(self.document, {"replace": {"invented_field": True}})

    def test_malformed_scalars_are_conservative(self):
        for field in self.base["observations"]:
            for key in ("sequence", "observed_at_ms", "received_at_ms", "valid_until_ms"):
                for value in (True, None, -1, 1.5, float("nan"), "1000", [], {}):
                    with self.subTest(field=field, key=key, value=value):
                        snapshot = deepcopy(self.base)
                        snapshot["observations"][field][key] = value
                        self.assertEqual(evaluate(snapshot)["reasons"], ["invalid_snapshot"])

    def test_moving_defect_is_caught_in_disposable_copy(self):
        source = Path(__file__).parent
        with tempfile.TemporaryDirectory(prefix="andes-checkin-control-") as directory:
            target = Path(directory)
            for name in ("evaluator.py", "run_scenarios.py", "scenarios.json"):
                shutil.copyfile(source / name, target / name)
            evaluator = target / "evaluator.py"
            original = evaluator.read_text()
            gate = "    if not reasons:\n"
            self.assertEqual(original.count(gate), 1)
            evaluator.write_text(original.replace(
                gate, '    if not reasons or motion == "moving":\n'
            ))
            result = subprocess.run(
                [sys.executable, str(target / "run_scenarios.py")],
                capture_output=True, text=True, timeout=10, check=False,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("FAIL moving_visual_manual: stationary_candidate", result.stdout)


if __name__ == "__main__":
    unittest.main()
