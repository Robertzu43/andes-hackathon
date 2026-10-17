"""All records here are fabricated. Even mode='live' is only a validation input."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import check


HERE = Path(__file__).resolve().parent


def blank():
    return json.loads((HERE / "matrix.blank.json").read_text())


def claimed_support():
    """A complete *assertion* for testing; never exported as actual evidence."""
    doc = blank()
    doc["record_kind"] = "evidence"
    row = doc["rows"][0]
    row["state"] = "supported"
    row["scope"].update(driver_country="PE", recipient_country="BR", number_country="CL",
                        language="pt-BR", channel="whatsapp", audience="individual",
                        provider="fabricated-provider", account_ref="fake-account", recipient_ref="fake-recipient")
    when = "2026-10-17T12:00:00-05:00"

    def add(eid, kind, mode="live", provider_id=None):
        row["evidence"].append({"id": eid, "kind": kind, "mode": mode,
            "observed_at": when, "recorded_at": when, "locator": "https://example.invalid/fabricated",
            "attributed_to": "fake-recipient" if kind != "provider_receipt" else "fake-provider",
            "summary": "Fabricated test assertion only; no actual live observation",
            "provider_id": provider_id, "scope": copy.deepcopy(row["scope"]), "verification": "verified",
            "verification_ref": "fake-verification-record" if kind == "provider_receipt" else None})

    add("docs", "official_document", "documentation")
    for name, value, kind in (("account", "eligible", "account_record"),
                              ("opt_in", "confirmed", "consent_record"),
                              ("number_format", "verified", "number_record"),
                              ("template", "approved", "template_record"),
                              ("comprehension", "observed", "comprehension_observation")):
        add(name, kind)
        row["checks"][name] = {"value": value, "evidence_ids": [name]}
    row["checks"]["existing_group"]["value"] = "not_applicable"
    row["terms"] = {"evidence_id": "docs", "checked_at": when}
    attempt = row["attempt"]
    attempt.update(provider_id="fake-message-1", environment="live", receipt_status="delivered",
                   receipt_meaning="Provider-reported delivery only", receipt_source_id="docs")
    for name, value, kind in (("acceptance", "accepted", "provider_receipt"),
                             ("delivery", "delivered", "provider_receipt"),
                             ("recipient_observation", "arrived", "recipient_observation"),
                             ("acknowledgement", "acknowledged", "acknowledgement_observation")):
        add(name, kind, provider_id="fake-message-1")
        attempt[name].update(value=value, evidence_ids=[name])
    attempt["acknowledgement"]["path"] = "Explicit stationary reply confirming receipt; fabricated"
    return doc


class MatrixChecks(unittest.TestCase):
    def assert_bad(self, doc, text):
        result = check.check(doc)
        self.assertFalse(result["consistent"], result)
        self.assertTrue(any(text in error for error in result["errors"]), result["errors"])

    def test_blank_preserves_unknowns(self):
        result = check.check(blank())
        self.assertTrue(result["consistent"])
        self.assertIn("rows[0]: cost unknown; no free/zero-cost inference", result["gaps"])
        self.assertIn("not verified", result["limitation"])

    def test_partial_synthetic_is_consistent_without_support(self):
        doc = json.loads((HERE / "examples/partial.synthetic.json").read_text())
        self.assertTrue(check.check(doc)["consistent"])

    def test_complete_assertion_is_not_a_truth_certificate(self):
        result = check.check(claimed_support())
        self.assertTrue(result["consistent"], result)
        self.assertTrue(any("useful action unknown" in gap for gap in result["gaps"]))
        self.assertIn("authenticity", result["limitation"])

    def test_mock_and_sandbox_cannot_be_promoted_to_supported(self):
        for mode in ("synthetic", "sandbox", "documentation"):
            doc = claimed_support()
            doc["rows"][0]["evidence"][1]["mode"] = mode
            with self.subTest(mode=mode):
                self.assert_bad(doc, "supported requires live")

    def test_document_and_account_labels_cannot_prove_receipt_or_arrival(self):
        for eid in ("docs", "account", "delivery"):
            doc = claimed_support()
            doc["rows"][0]["attempt"]["recipient_observation"]["evidence_ids"] = [eid]
            with self.subTest(eid=eid):
                self.assert_bad(doc, "evidence kind")

    def test_synthetic_document_cannot_claim_live(self):
        doc = claimed_support()
        doc["record_kind"] = "synthetic"
        self.assert_bad(doc, "synthetic documents cannot claim supported")

    def test_supported_requires_actual_arrival_ack_and_path(self):
        for stage in ("recipient_observation", "acknowledgement"):
            doc = claimed_support()
            doc["rows"][0]["attempt"][stage].update(value="unknown", evidence_ids=[])
            self.assert_bad(doc, "supported requires")
        doc = claimed_support()
        doc["rows"][0]["attempt"]["acknowledgement"]["path"] = None
        self.assert_bad(doc, "explicit path")

    def test_status_meanings_are_channel_specific(self):
        for channel, status in (("sms", "sent"), ("sms", "read"), ("whatsapp", "accepted"),
                                ("voice", "ringing"), ("sms", "completed")):
            doc = claimed_support()
            row = doc["rows"][0]
            row["scope"]["channel"] = channel
            for e in row["evidence"]:
                e["scope"]["channel"] = channel
            row["attempt"]["receipt_status"] = status
            with self.subTest(channel=channel, status=status):
                self.assert_bad(doc, "receipt status")

    def test_completed_voice_is_not_acknowledgement(self):
        doc = claimed_support()
        row = doc["rows"][0]
        row["scope"]["channel"] = "voice"
        for e in row["evidence"]:
            e["scope"]["channel"] = "voice"
        row["attempt"].update(receipt_status="completed", receipt_meaning="Connection/audio only; may be voicemail")
        row["attempt"]["acknowledgement"].update(value="unknown", evidence_ids=[])
        self.assert_bad(doc, "supported requires acknowledgement")

    def test_no_reply_keeps_action_unknown_and_no_incident_field(self):
        doc = claimed_support()
        row = doc["rows"][0]
        row.update(state="conditional", conditions=["No reply observed"])
        row["attempt"]["acknowledgement"].update(value="not_observed")
        self.assertTrue(check.check(doc)["consistent"])
        row["attempt"]["incident"] = "robbery"
        self.assert_bad(doc, "unknown field")

    def test_missing_or_duplicate_evidence_is_rejected(self):
        doc = claimed_support()
        doc["rows"][0]["checks"]["account"]["evidence_ids"] = ["missing"]
        self.assert_bad(doc, "dangling")
        doc = claimed_support()
        doc["rows"][0]["evidence"].append(copy.deepcopy(doc["rows"][0]["evidence"][0]))
        self.assert_bad(doc, "duplicate evidence")
        doc = claimed_support()
        doc["rows"][0]["checks"]["account"]["evidence_ids"] = []
        self.assert_bad(doc, "no evidence")

    def test_scope_cannot_move_to_another_country_language_or_account(self):
        for field, value in (("recipient_country", "PE"), ("number_country", "BR"),
                             ("driver_country", "MX"), ("language", "es"), ("account_ref", "other")):
            doc = claimed_support()
            doc["rows"][0]["scope"][field] = value
            with self.subTest(field=field):
                self.assert_bad(doc, "scope differs")

    def test_one_attempt_cannot_expand_matrix_coverage(self):
        doc = claimed_support()
        reused = copy.deepcopy(doc["rows"][0])
        reused["id"] = "another-coverage-row"
        doc["rows"].append(reused)
        self.assert_bad(doc, "cannot be reused")

    def test_group_docs_and_account_eligibility_are_insufficient(self):
        doc = claimed_support()
        row = doc["rows"][0]
        row["scope"].update(audience="existing_group", group_ref="fake-group")
        for e in row["evidence"]:
            e["scope"] = copy.deepcopy(row["scope"])
        row["checks"]["existing_group"] = {"value": "verified", "evidence_ids": ["docs"]}
        self.assert_bad(doc, "evidence kind")

    def test_receipts_need_verified_provenance_and_matching_message(self):
        for field, value, error in (("provider_id", "another", "provider id/environment"),
                                    ("verification", "unknown", "verified provider receipt"),
                                    ("verification_ref", None, "separate verification record")):
            doc = claimed_support()
            receipt = next(e for e in doc["rows"][0]["evidence"] if e["id"] == "delivery")
            receipt[field] = value
            self.assert_bad(doc, error)

    def test_timestamps_offsets_order_and_attribution(self):
        for field, value, error in (("observed_at", "2026-10-17T12:00:00", "offset-aware"),
                                    ("recorded_at", "2026-10-16T12:00:00Z", "recorded before"),
                                    ("attributed_to", " ", "empty text")):
            doc = claimed_support()
            doc["rows"][0]["evidence"][1][field] = value
            self.assert_bad(doc, error)
        doc = claimed_support()
        ack = next(e for e in doc["rows"][0]["evidence"] if e["id"] == "acknowledgement")
        ack["observed_at"] = "2026-10-17T11:00:00-05:00"
        self.assert_bad(doc, "chronology")

    def test_failed_receipt_and_arrival_conflict_is_preserved(self):
        doc = claimed_support()
        doc["rows"][0]["attempt"]["delivery"]["value"] = "failed"
        self.assert_bad(doc, "conflicts with recipient arrival")

    def test_offset_components_are_validated_before_parsing(self):
        for offset in ("+00:99", "+01:60", "-00:60", "-01:99", "+24:00", "-24:00"):
            doc = claimed_support()
            row = doc["rows"][0]
            stamp = "2026-10-17T12:00:00" + offset
            for e in row["evidence"]:
                e["observed_at"] = e["recorded_at"] = stamp
            row["terms"]["checked_at"] = stamp
            with self.subTest(offset=offset):
                self.assert_bad(doc, "invalid offset-aware timestamp")

    def test_valid_offsets_remain_accepted(self):
        for offset in ("Z", "+00:00", "-05:00", "+05:45", "+23:59", "-23:59"):
            doc = claimed_support()
            row = doc["rows"][0]
            stamp = "2026-10-17T12:00:00" + offset
            for e in row["evidence"]:
                e["observed_at"] = e["recorded_at"] = stamp
            row["terms"]["checked_at"] = stamp
            with self.subTest(offset=offset):
                self.assertTrue(check.check(doc)["consistent"])

    def test_corroborated_action_requires_separate_observer(self):
        doc = claimed_support()
        row = doc["rows"][0]
        e = copy.deepcopy(row["evidence"][-1])
        e.update(id="action", kind="independent_action_observation")
        row["evidence"].append(e)
        row["attempt"]["useful_action"] = {"value": "corroborated", "evidence_ids": ["action"]}
        self.assert_bad(doc, "distinct independent observer")
        e["attributed_to"] = "fake-independent-observer"
        self.assertTrue(check.check(doc)["consistent"])

    def test_action_reporter_cannot_be_the_only_corroborator(self):
        doc = claimed_support()
        row = doc["rows"][0]
        report = copy.deepcopy(row["evidence"][-1])
        report.update(id="action-report", kind="action_report", attributed_to="fake-reporter-B")
        corroboration = copy.deepcopy(report)
        corroboration.update(id="corroboration", kind="independent_action_observation")
        row["evidence"].extend([report, corroboration])
        row["attempt"]["useful_action"] = {
            "value": "corroborated", "evidence_ids": ["action-report", "corroboration"]}
        self.assert_bad(doc, "distinct independent observer")
        corroboration["attributed_to"] = "fake-independent-C"
        self.assertTrue(check.check(doc)["consistent"])

    def test_cost_and_terms_cannot_lose_their_date_or_source(self):
        doc = claimed_support()
        doc["rows"][0]["cost"].update(amount=0, currency="USD", unit="message")
        self.assert_bad(doc, "cost requires a source")
        doc = claimed_support()
        doc["rows"][0]["terms"]["checked_at"] = None
        self.assert_bad(doc, "terms requires a source")

    def test_unavailable_needs_basis_and_conditional_needs_reason(self):
        doc = blank()
        doc["record_kind"] = "evidence"
        doc["rows"][0].update(state="unavailable", conditions=["No applicable evidence yet"])
        self.assert_bad(doc, "unavailable requires")
        doc["rows"][0].update(state="conditional", conditions=[])
        self.assert_bad(doc, "requires explicit conditions")

    def test_untested_cannot_hide_an_attempt(self):
        doc = claimed_support()
        doc["rows"][0]["state"] = "untested"
        self.assert_bad(doc, "untested conflicts")

    def test_document_locator_must_be_well_formed_https(self):
        for locator in ("https://[invalid", "http://example.invalid", "file:///private/source"):
            doc = claimed_support()
            doc["rows"][0]["evidence"][0]["locator"] = locator
            self.assert_bad(doc, "HTTPS source")

    def test_malformed_shapes_fail_without_traceback(self):
        for doc in (None, [], {}, {"schema_version": "2", "record_kind": "blank", "rows": []}):
            with self.subTest(doc=doc):
                self.assertFalse(check.check(doc)["consistent"])
        doc = blank()
        del doc["rows"][0]["scope"]["driver_country"]
        self.assert_bad(doc, "missing field")
        doc = blank()
        doc["rows"][0]["cost"]["amount"] = True
        self.assert_bad(doc, "invalid type")

    def test_cli_exit_codes_and_no_site_packages(self):
        for filename, code in (("matrix.blank.json", 0), ("examples/partial.synthetic.json", 0),
                               ("examples/false-supported.synthetic.json", 1), ("missing.json", 2)):
            run = subprocess.run([sys.executable, "-B", "-S", str(HERE / "check.py"), str(HERE / filename)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, code, run.stderr + run.stdout)
            self.assertIn("consistent", json.loads(run.stdout))
        for text in ('{"rows":[],"rows":[]}', '{"value":NaN}', 'not json'):
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json") as f:
                f.write(text)
                f.flush()
                run = subprocess.run([sys.executable, "-B", "-S", str(HERE / "check.py"), f.name],
                                     capture_output=True, text=True)
                self.assertEqual(run.returncode, 2, run.stdout)
                self.assertNotIn("Traceback", run.stderr)


if __name__ == "__main__":
    unittest.main()
