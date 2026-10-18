"""Issue-11 oracle: declaration completeness must never become pilot acceptance."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from check_contract import check_contract, load_contract


ROOT = Path(__file__).resolve().parent


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.document = load_contract(ROOT / "fixtures/synthetic-complete.json")

    def check(self, document=None):
        result = check_contract(self.document if document is None else document)
        self.assertIs(result["pilot_ready"], False)
        self.assertEqual(result["independent_acceptance"], "not_verified")
        self.assertGreater(len(result["limitations"]), 0)
        return result

    def assert_blocked(self, code):
        result = self.check()
        self.assertFalse(result["syntactically_complete"])
        self.assertIn(code, {p["code"] for p in result["errors"] + result["gaps"]})

    def cli(self, path):
        run = subprocess.run([sys.executable, "-B", str(ROOT / "check_contract.py"), str(path)],
                             text=True, capture_output=True, timeout=10)
        self.assertEqual(run.stderr, "")
        report = json.loads(run.stdout)
        self.assertFalse(report["pilot_ready"])
        self.assertEqual(report["independent_acceptance"], "not_verified")
        return run.returncode, report

    def test_real_template_retains_all_unset_thresholds_and_prerequisites(self):
        real = load_contract(ROOT / "decision-contract.template.json")
        self.assertEqual(real["evidence_mode"], "real")
        self.assertEqual({t["name"] for t in real["thresholds"]},
                         {"T_action", "Delta_action", "B_false", "B_attention"})
        self.assertTrue(all(t["value"] is None for t in real["thresholds"]))
        self.assertTrue(all(t["review"]["disposition"] == "pending" for t in real["thresholds"]))
        self.assertEqual(real["freeze"]["state"], "draft")
        self.assertEqual({p["issue"] for p in real["prerequisites"]}, {"#1", "#8", "#9", "#10"})
        result = self.check(real)
        self.assertTrue(result["schema_valid"])
        self.assertFalse(result["syntactically_complete"])
        self.assertEqual(self.cli(ROOT / "decision-contract.template.json")[0], 1)

    def test_complete_synthetic_declaration_never_becomes_real_acceptance(self):
        result = self.check()
        self.assertTrue(result["syntactically_complete"])
        self.assertEqual(result["evidence_mode"], "synthetic")
        self.assertEqual(result["declaration_status"], "complete_unverified")
        self.assertEqual(self.cli(ROOT / "fixtures/synthetic-complete.json")[0], 0)

    def test_even_complete_real_declarations_are_not_verified(self):
        # Deliberately relabel fictitious records to demonstrate the truth limit.
        self.document["evidence_mode"] = "real"
        for source in self.document["sources"]:
            source["kind"] = "observed"
        self.assertTrue(self.check()["syntactically_complete"])

    def test_synthetic_sources_cannot_enter_a_real_contract(self):
        self.document["evidence_mode"] = "real"
        self.assert_blocked("synthetic_in_real")

    def test_negative_fixture_controls_through_same_cli(self):
        cases = load_contract(ROOT / "fixtures/synthetic-cases.json")["cases"]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "negative.json"
            for case in cases:
                with self.subTest(case["name"]):
                    document = copy.deepcopy(self.document)
                    target = document
                    for part in case["path"][:-1]:
                        target = target[part]
                    target[case["path"][-1]] = case["value"]
                    path.write_text(json.dumps(document), encoding="utf-8")
                    code, result = self.cli(path)
                    self.assertEqual(code, 1)
                    self.assertIn(case["code"], {p["code"] for p in result["errors"] + result["gaps"]})

    def test_all_deterministic_gate_failures_remain_blocking(self):
        for index in range(4):
            with self.subTest(gate=index):
                self.setUp()
                gate = self.document["deterministic_gates"][index]
                gate["test"]["outcome"] = "fail"
                gate["disposition"] = "stop"
                gate["acceptance"]["review"]["disposition"] = "stop"
                self.assert_blocked("test_not_passed")

    def test_all_adverse_claim_dispositions_remain_blocking(self):
        for claim in range(3):
            for disposition in ("pending", "revise", "stop", "inconclusive"):
                with self.subTest(claim=claim, disposition=disposition):
                    self.setUp()
                    self.document["claims"][claim]["disposition"] = disposition
                    self.assert_blocked("disposition")

    def test_undeclared_or_self_review_is_blocking(self):
        self.document["thresholds"][0]["review"]["reviewer"] = self.document["author"]
        self.assert_blocked("self_review")
        self.setUp()
        self.document["claims"][0]["acceptance"]["review"]["independent_of_implementation"] = False
        self.assert_blocked("independence_undeclared")

    def test_revision_change_requires_review_again(self):
        self.document["revision"] = "synthetic-2"
        self.assert_blocked("review_revision")

    def test_missing_claim_gate_threshold_or_prerequisite_is_blocking(self):
        for key in ("claims", "deterministic_gates", "thresholds", "prerequisites", "baselines"):
            with self.subTest(key=key):
                self.setUp()
                self.document[key].pop()
                self.assert_blocked("coverage")

    def test_added_scope_cannot_inherit_another_scopes_thresholds(self):
        other = copy.deepcopy(self.document["scopes"][0])
        other["id"] = "another-country-language-route-device"
        self.document["scopes"].append(other)
        self.assert_blocked("coverage")

    def test_evidence_must_declare_the_criteria_scope(self):
        other = copy.deepcopy(self.document["scopes"][0])
        other["id"] = "another-scope"
        self.document["scopes"].append(other)
        self.document["sources"][0]["scope_ids"] = ["another-scope"]
        self.assert_blocked("evidence_scope")

    def test_plan_is_not_measured_evidence(self):
        self.document["sources"][0]["kind"] = "plan"
        self.assert_blocked("plan_only")

    def test_input_limitations_and_source_provenance_are_required(self):
        for parent, key in ((self.document["provenance"], "input_limitations"),
                            (self.document["sources"][0], "provenance"),
                            (self.document["sources"][0], "limitations")):
            original = parent[key]
            parent[key] = None
            self.assert_blocked("unset")
            parent[key] = original

    def test_duplicate_ids_or_evidence_references_are_not_coverage(self):
        for key in ("scopes", "sources", "thresholds", "claims", "deterministic_gates", "prerequisites"):
            with self.subTest(key=key):
                self.setUp()
                self.document[key].append(copy.deepcopy(self.document[key][0]))
                self.assert_blocked("duplicate")
        self.setUp()
        self.document["claims"][0]["source_refs"] *= 2
        self.assert_blocked("duplicate")

    def test_bool_nan_infinity_and_negative_thresholds_are_rejected(self):
        for value in (True, False, float("nan"), float("inf"), -1, "1"):
            with self.subTest(value=value):
                self.document["thresholds"][0]["value"] = value
                self.assert_blocked("range" if value == -1 else "type")

    def test_zero_time_improvement_rejected_but_zero_burden_not_invented(self):
        for index in (0, 1):
            self.setUp()
            self.document["thresholds"][index]["value"] = 0
            self.assert_blocked("range")
        self.setUp()
        self.document["thresholds"][2]["value"] = 0
        self.assertTrue(self.check()["syntactically_complete"])

    def test_units_cannot_conflate_burden_with_location_coverage(self):
        self.document["thresholds"][2]["unit"] = "unnecessary_escalations_per_covered_driver_hour"
        self.assert_blocked("unit")
        self.setUp()
        self.document["baselines"][0]["units"].remove("active_trip_hour")
        self.assert_blocked("units")

    def test_declared_freeze_requires_complete_current_preregistered_record(self):
        self.document["freeze"].update(state="declared_frozen")
        self.assert_blocked("freeze_record")
        self.document["freeze"].update(revision="synthetic-1", record_ref="synthetic://freeze",
                                       before_implementation_and_outcome_inspection=True)
        self.assertTrue(self.check()["syntactically_complete"])
        self.document["thresholds"][0]["value"] = None
        self.assert_blocked("freeze_blocked")

    def test_draft_cannot_carry_an_apparent_freeze_record(self):
        self.document["freeze"]["record_ref"] = "synthetic://freeze"
        self.assert_blocked("draft_freeze")

    def test_missing_fields_unknown_fields_and_versions_fail_closed(self):
        del self.document["exposure"]
        self.assert_blocked("missing_field")
        self.setUp()
        self.document["pilot_ready"] = True
        self.assert_blocked("unknown_field")
        for version in (True, 99):
            self.setUp()
            self.document["schema_version"] = version
            self.assert_blocked("enum")

    def test_malformed_roots_and_null_containers_do_not_crash(self):
        for value in (None, [], 42, "SYNTHETIC"):
            result = check_contract(value)
            self.assertFalse(result["syntactically_complete"])
            self.assertFalse(result["pilot_ready"])
        for key in ("scopes", "claims", "freeze", "provenance", "exposure"):
            self.setUp()
            self.document[key] = None
            self.assert_blocked("type")

    def test_every_leaf_can_be_missing_or_wrong_typed_without_crashing(self):
        def leaves(value, path=()):
            if isinstance(value, dict):
                for key, child in value.items():
                    yield from leaves(child, path + (key,))
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    yield from leaves(child, path + (index,))
            else:
                yield path

        for path in leaves(self.document):
            for replacement in (None, {"unexpected": "shape"}):
                document = copy.deepcopy(self.document)
                target = document
                for part in path[:-1]:
                    target = target[part]
                target[path[-1]] = replacement
                with self.subTest(path=path, replacement=replacement):
                    self.check(document)

    def test_cli_sanitizes_invalid_mode_in_report(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "invalid-mode.json"
            path.write_text('{"evidence_mode":1e999}', encoding="utf-8")
            code, result = self.cli(path)
            self.assertEqual(code, 1)
            self.assertIsNone(result["evidence_mode"])

    def test_cli_rejects_duplicate_keys_invalid_utf8_nonfinite_and_missing_files(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "input.json"
            for data in (b'{"schema_version":1,"schema_version":1}', b'NaN', b'Infinity', b'{', b'\xff'):
                with self.subTest(data=data):
                    path.write_bytes(data)
                    code, result = self.cli(path)
                    self.assertEqual(code, 2)
                    self.assertEqual(result["errors"][0]["code"], "input")
            self.assertEqual(self.cli(Path(folder) / "missing.json")[0], 2)


if __name__ == "__main__":
    unittest.main()
