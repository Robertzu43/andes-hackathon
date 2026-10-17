"""Adversarial offline regression checks; no participant or provider evidence."""

from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from evaluator import RecordError, evaluate, instant, load_record


ROOT = Path(__file__).resolve().parent
AT = instant("2026-10-17T12:30:00Z")


def fixture(name="candidate"):
    return load_record(ROOT / "fixtures" / f"synthetic-{name}.json")


class ContactContractTests(unittest.TestCase):
    def setUp(self):
        self.record = fixture()
        self.contact = self.record["contacts"][0]

    def result(self, at=AT):
        return evaluate(self.record, at)

    def assert_blocked(self, result):
        self.assertEqual(result["model_escalation_candidates"], [])
        self.assertFalse(result["shared_trip_data_released"])
        self.assertFalse(result["assistance_established"])

    def test_candidate_is_only_a_model_candidate_never_enrolment_or_assistance(self):
        result = self.result()
        self.assertEqual(result["model_escalation_candidates"], ["CONTACT-SYNTH1"])
        self.assertTrue(result["links"][0]["model_contract_valid"])
        self.assertEqual(result["product_eligibility"], "untested")
        self.assertEqual(result["enrolment_readiness"], "untested")
        self.assertFalse(result["shared_trip_data_released"])
        self.assertFalse(result["assistance_established"])
        self.assertEqual(result["contacts"][0]["model_channel_order"], ["sms"])

    def test_pending_rejected_and_revoked_contact_never_qualify_or_allow_link(self):
        for state in ("pending", "rejected", "revoked"):
            with self.subTest(state=state):
                self.contact["state"] = state
                result = self.result()
                self.assert_blocked(result)
                self.assertEqual(result["model_outcome"], "no_authorised_contact")
                self.assertFalse(result["links"][0]["model_contract_valid"])

    def test_missing_or_revoked_consent_dominates_accepted_contact_and_live_link(self):
        for actor in ("driver_state", "contact_state"):
            for state in ("missing", "revoked"):
                with self.subTest(actor=actor, state=state):
                    record = fixture()
                    record["contacts"][0]["trip_consent"][actor] = state
                    result = evaluate(record, AT)
                    self.assert_blocked(result)
                    self.assertFalse(result["links"][0]["model_contract_valid"])
        for state in ("missing", "revoked"):
            self.record["trip"]["sharing_state"] = state
            self.assert_blocked(self.result())
            self.assertFalse(self.result()["links"][0]["model_contract_valid"])

    def test_revocation_rechecked_after_previously_valid_snapshot(self):
        self.assertTrue(self.result()["links"][0]["model_contract_valid"])
        self.contact["trip_consent"]["contact_state"] = "revoked"
        self.assert_blocked(self.result())
        self.assertFalse(self.result()["links"][0]["model_contract_valid"])

    def test_consent_for_another_trip_never_carries_over(self):
        self.contact["trip_consent"]["trip_id"] = "TRIP-OTHER"
        result = self.result()
        self.assert_blocked(result)
        self.assertFalse(result["links"][0]["model_contract_valid"])

    def test_acknowledgement_alone_leaves_action_capacity_unknown(self):
        result = evaluate(fixture("acknowledgement-only"), AT)
        self.assert_blocked(result)
        self.assertEqual(result["model_outcome"], "capacity_unconfirmed")
        self.assertTrue(result["contacts"][0]["acknowledged"])
        self.assertEqual(result["contacts"][0]["recorded_action_status"], "none")

    def test_no_reply_stays_unknown_and_never_becomes_an_incident(self):
        record = fixture("acknowledgement-only")
        record["contacts"][0]["observations"].update(acknowledged=None, response="unknown")
        result = evaluate(record, AT)
        self.assert_blocked(result)
        self.assertEqual(result["model_outcome"], "capacity_unconfirmed")
        self.assertIsNone(result["contacts"][0]["acknowledged"])
        self.assertNotIn("robbery", json.dumps(result))
        self.assertNotIn("fatigue", json.dumps(result))

    def test_cannot_assist_overrides_other_positive_boxes(self):
        self.contact["observations"]["response"] = "cannot_assist"
        result = self.result()
        self.assert_blocked(result)
        self.assertEqual(result["model_outcome"], "no_contact_can_act")
        self.assertEqual(result["contacts"][0]["recorded_action_status"], "planned")

    def test_unavailable_and_unwilling_are_honest_terminal_outcomes(self):
        for key, value in (("availability", "unavailable"), ("willingness", "no")):
            with self.subTest(key=key):
                record = fixture()
                record["contacts"][0]["observations"][key] = value
                result = evaluate(record, AT)
                self.assert_blocked(result)
                self.assertEqual(result["model_outcome"], "no_contact_can_act")

    def test_all_unavailable_is_terminal_without_inventing_rescue(self):
        result = evaluate(fixture("all-unavailable"), AT)
        self.assert_blocked(result)
        self.assertEqual(result["model_outcome"], "no_contact_can_act")

    def test_any_unknown_capacity_prevents_all_unavailable_claim(self):
        record = fixture("all-unavailable")
        record["contacts"][1]["observations"].update(response="unknown", availability="unknown")
        result = evaluate(record, AT)
        self.assert_blocked(result)
        self.assertEqual(result["model_outcome"], "capacity_unconfirmed")

    def test_unavailable_first_contact_hands_off_in_explicit_order(self):
        result = evaluate(fixture("escalation"), AT)
        self.assertEqual(result["model_escalation_candidates"], ["CONTACT-SYNTH2"])
        record = fixture("escalation")
        record["contacts"][0]["observations"] = deepcopy(record["contacts"][1]["observations"])
        record["escalation_order"].reverse()
        self.assertEqual(evaluate(record, AT)["model_escalation_candidates"],
                         ["CONTACT-SYNTH2", "CONTACT-SYNTH1"])

    def test_missing_willingness_availability_and_teach_back_each_block(self):
        for key in ("willingness", "availability", "role_understood", "handoff_understood", "mutual_understanding"):
            with self.subTest(key=key):
                record = fixture()
                record["contacts"][0]["observations"][key] = "unknown"
                self.assert_blocked(evaluate(record, AT))

    def test_action_must_be_separate_from_willingness_and_acknowledgement(self):
        self.contact["observations"].update(action_status="none", action_note=None)
        self.assert_blocked(self.result())

    def test_reported_or_corroborated_synthetic_label_never_establishes_real_help(self):
        for status in ("planned", "attempted", "reported", "independently_corroborated"):
            with self.subTest(status=status):
                self.contact["observations"]["action_status"] = status
                result = self.result()
                self.assertFalse(result["assistance_established"])
                self.assertFalse(result["contacts"][0]["assistance_established"])
                self.assertEqual(result["product_eligibility"], "untested")

    def test_country_and_language_are_independent_and_never_imply_nearby_help(self):
        for phone_country in ("CO", "BR", "MX", None):
            for language in ("es", "pt-BR"):
                with self.subTest(phone_country=phone_country, language=language):
                    self.contact["phone_number_country"] = phone_country
                    self.contact["preferred_language"] = language
                    self.assertEqual(self.result()["model_escalation_candidates"], ["CONTACT-SYNTH1"])
                    self.contact["observations"]["mutual_understanding"] = "unknown"
                    self.assert_blocked(self.result())
                    self.contact["observations"]["mutual_understanding"] = "yes"
        self.assertNotIn("nearby", json.dumps(self.result()))

    def test_matching_language_or_country_cannot_replace_teach_back(self):
        self.contact["phone_number_country"] = self.record["driver"]["country"]
        self.contact["preferred_language"] = self.record["driver"]["preferred_language"]
        self.contact["observations"]["mutual_understanding"] = "unknown"
        self.assert_blocked(self.result())

    def test_no_language_is_inferred_from_country(self):
        for actor in ("driver", "contact"):
            record = fixture()
            target = record["driver"] if actor == "driver" else record["contacts"][0]
            target["preferred_language"] = None
            self.assert_blocked(evaluate(record, AT))

    def test_only_current_preferred_and_recorded_reachable_channels_are_candidates(self):
        for changes in ({"current": False}, {"preferred": []}, {"verified_reachable": []},
                        {"preferred": ["voice"]}):
            with self.subTest(changes=changes):
                record = fixture()
                record["contacts"][0]["channels"].update(changes)
                self.assert_blocked(evaluate(record, AT))
        self.contact["channels"].update(preferred=["voice", "sms"], verified_reachable=["sms", "voice"])
        self.assertEqual(self.result()["contacts"][0]["model_channel_order"], ["voice", "sms"])

    def test_no_contacts_has_no_authorised_contact(self):
        self.record.update(contacts=[], escalation_order=[], links=[])
        self.assert_blocked(self.result())
        self.assertEqual(self.result()["model_outcome"], "no_authorised_contact")

    def test_evaluation_does_not_mutate_input(self):
        before = deepcopy(self.record)
        self.result()
        self.assertEqual(self.record, before)


class LinkContractTests(unittest.TestCase):
    def test_exact_issue_and_expiry_boundaries_and_timezone_equivalence(self):
        record = fixture()
        for timestamp, valid in (("2026-10-17T11:59:59Z", False), ("2026-10-17T12:00:00Z", True),
                                 ("2026-10-17T12:59:59Z", True), ("2026-10-17T13:00:00Z", False),
                                 ("2026-10-17T08:00:00-05:00", False)):
            with self.subTest(timestamp=timestamp):
                self.assertEqual(evaluate(record, instant(timestamp))["links"][0]["model_contract_valid"], valid)

    def test_link_revocation_does_not_revoke_contact_but_denies_link(self):
        record = fixture()
        record["links"][0]["revoked"] = True
        result = evaluate(record, AT)
        self.assertFalse(result["links"][0]["model_contract_valid"])
        self.assertEqual(result["model_escalation_candidates"], ["CONTACT-SYNTH1"])
        self.assertFalse(result["shared_trip_data_released"])

    def test_wrong_driver_trip_or_recipient_is_denied(self):
        for key, value in (("driver_id", "DRIVER-OTHER"), ("trip_id", "TRIP-OTHER"),
                           ("contact_id", "CONTACT-OTHER")):
            with self.subTest(key=key):
                record = fixture()
                record["links"][0][key] = value
                self.assertFalse(evaluate(record, AT)["links"][0]["model_contract_valid"])

    def test_empty_or_overbroad_scope_is_denied(self):
        for scope in ([], ["truck_reference"], ["status_uncertainty", "truck_reference"]):
            with self.subTest(scope=scope):
                record = fixture()
                record["links"][0]["scope"] = scope
                self.assertFalse(evaluate(record, AT)["links"][0]["model_contract_valid"])
        record = fixture()
        record["trip"]["shared_fields"] = ["observation_age"]
        self.assertFalse(evaluate(record, AT)["links"][0]["model_contract_valid"])

    def test_zero_shared_or_consented_fields_cannot_qualify_or_allow_link(self):
        for location in ("trip", "contact"):
            record = fixture()
            if location == "trip":
                record["trip"]["shared_fields"] = []
            else:
                record["contacts"][0]["trip_consent"]["fields"] = []
            result = evaluate(record, AT)
            self.assertEqual(result["model_escalation_candidates"], [])
            self.assertFalse(result["links"][0]["model_contract_valid"])


class MalformedRecordTests(unittest.TestCase):
    def test_malformed_records_fail_without_partial_evaluation(self):
        mutations = [
            (("version",), True), (("version",), 2), (("evidence_kind",), "observation"),
            (("contacts",), {}), (("links",), {}), (("trip",), []),
            (("trip", "sharing_state"), []), (("trip", "shared_fields"), ["full_route"]),
            (("driver", "country"), "Brazil"), (("driver", "preferred_language"), ""),
            (("contacts", 0, "state"), "ACCEPTED"), (("contacts", 0, "id"), "+551100000000"),
            (("contacts", 0, "channels", "current"), "true"),
            (("contacts", 0, "channels", "preferred"), ["sms", "sms"]),
            (("contacts", 0, "channels", "verified_reachable"), ["email"]),
            (("contacts", 0, "observations", "acknowledged"), 1),
            (("contacts", 0, "observations", "availability"), "yes"),
            (("contacts", 0, "observations", "action_note"), None),
            (("contacts", 0, "observations", "action_note"), "   "),
            (("escalation_order",), []), (("escalation_order",), ["CONTACT-OTHER"]),
            (("escalation_order",), ["CONTACT-SYNTH1", "CONTACT-SYNTH1"]),
            (("links", 0, "revoked"), 0), (("links", 0, "scope"), ["full_route"]),
            (("links", 0, "scope"), ["status_uncertainty", "status_uncertainty"]),
            (("links", 0, "expires_at"), "2026-10-17T12:30:00"),
            (("links", 0, "expires_at"), "not-a-date"),
            (("links", 0, "expires_at"), "2026-10-17T11:00:00Z"),
        ]
        for path, value in mutations:
            with self.subTest(path=path, value=value):
                record = fixture()
                target = record
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                with self.assertRaises(RecordError):
                    evaluate(record, AT)

    def test_missing_unknown_duplicate_and_inconsistent_records_are_rejected(self):
        records = [fixture() for _ in range(7)]
        del records[0]["contacts"][0]["trip_consent"]
        records[1]["contacts"][0]["phone_number"] = "REAL DATA DISALLOWED"
        records[2]["contacts"].append(deepcopy(records[2]["contacts"][0]))
        records[3]["links"].append(deepcopy(records[3]["links"][0]))
        records[4]["contacts"][0]["observations"]["action_status"] = "none"
        records[5]["contacts"][0]["trip_consent"]["fields"] = None
        records[6]["links"][0]["expires_at"] = records[6]["links"][0]["issued_at"]
        for index, record in enumerate(records):
            with self.subTest(index=index), self.assertRaises(RecordError):
                evaluate(record, AT)

    def test_blank_human_record_cannot_be_used_as_a_synthetic_pass(self):
        blank = load_record(ROOT / "templates" / "blank-walkthrough.json")
        self.assertIsNone(blank["product_eligibility"])
        self.assertIsNone(blank["trip_enrolment_readiness"])
        with self.assertRaises(RecordError):
            evaluate(blank, AT)

    def test_clock_must_be_explicit_and_timezone_aware(self):
        for at in (None, "now", datetime(2026, 10, 17, 12, 30)):
            with self.subTest(at=at), self.assertRaises(RecordError):
                evaluate(fixture(), at)

    def test_duplicate_json_keys_and_non_finite_values_are_rejected(self):
        for data in ('{"state":"accepted","state":"revoked"}', '{"value":NaN}', '{"value":Infinity}'):
            with self.subTest(data=data), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "record.json"
                path.write_text(data, encoding="utf-8")
                with self.assertRaises(RecordError):
                    load_record(path)

    def test_cli_outputs_deterministic_json_and_nonzero_on_bad_input(self):
        command = [sys.executable, "-B", str(ROOT / "evaluator.py")]
        good = subprocess.run(command + [str(ROOT / "fixtures" / "synthetic-candidate.json"),
                                         "--at", "2026-10-17T12:30:00Z"], capture_output=True, text=True)
        self.assertEqual(good.returncode, 0, good.stderr)
        self.assertEqual(json.loads(good.stdout), evaluate(fixture(), AT))
        for data in ('{}', '{', '[]'):
            with self.subTest(data=data), tempfile.TemporaryDirectory() as temp:
                path = Path(temp) / "record.json"
                path.write_text(data, encoding="utf-8")
                bad = subprocess.run(command + [str(path), "--at", "2026-10-17T12:30:00Z"],
                                     capture_output=True, text=True)
                self.assertEqual(bad.returncode, 2)
                self.assertEqual(bad.stdout, "")
                self.assertIn("error", json.loads(bad.stderr))


if __name__ == "__main__":
    unittest.main()
