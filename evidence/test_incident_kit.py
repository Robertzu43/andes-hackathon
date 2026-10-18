"""Tests for incident_kit.py. Run from the repository root:

    python3 -m unittest discover -s evidence
"""

import csv
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import incident_kit as kit

KIT = Path(__file__).resolve().parent
FIXTURE = KIT / "fixtures" / "synthetic"
GOLDEN = FIXTURE / "expected-export.json"


def run_cli(*args):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = kit.main([str(arg) for arg in args])
    return code, out.getvalue(), err.getvalue()


def events_of(result):
    return {event["event_id"]: event for case in result["cases"] for event in case["events"]}


class SyntheticCohortTest(unittest.TestCase):
    def test_fixture_passes_with_only_the_expected_warning(self):
        _, report = kit.check(FIXTURE)
        self.assertEqual(report.errors, [])
        expected = ["pair SYN-B: has no ordinary-trip case"]
        expected += [
            f"timeline.csv line {line} ({event}): verify message authorship against reported_by "
            "in the original during independent trace review"
            for line, event in ((4, "SYN-A-W-E03"), (18, "SYN-A-W-E16"),
                                (24, "SYN-A-O-E05"), (31, "SYN-B-W-E07"))
        ]
        if not kit.ZONES:
            expected.insert(0, "time zones: no time-zone database found, so zone names and offsets were not checked")
        self.assertEqual(report.warnings, expected)

    def test_export_matches_the_reviewed_golden_file(self):
        result, _ = kit.export(FIXTURE)
        self.assertEqual(result, json.loads(GOLDEN.read_text(encoding="utf-8")))

    def test_export_values_match_hand_calculation(self):
        result, _ = kit.export(FIXTURE)
        cases = {case["case_id"]: case for case in result["cases"]}
        events = events_of(result)
        self.assertEqual(sorted(cases), ["SYN-A-W", "SYN-B-W"])
        self.assertEqual(result["excluded_cases"],
                         {"count": 1, "by_reason": {"redaction": 1, "trace_review": 1}})

        brazil = cases["SYN-A-W"]
        self.assertEqual(brazil["anchor_local_hour"], 14)  # trip start remembered from 14:00
        # Check-in remembered as due 21:00-21:30; the call log shows the fellow driver called at 22:14.
        self.assertEqual(brazil["window"]["duration_min"], {"min": 44, "max": 74})
        self.assertFalse(brazil["window"]["traceable_to_records"])
        self.assertEqual(events["SYN-A-W-E02"]["observed_offset_min"], 12)
        self.assertEqual(events["SYN-A-W-E13"]["recall_gap_min"], 9)  # logged 22:14, remembered by 22:05
        self.assertEqual(events["SYN-A-W-E16"]["recall_gap_min"], -4)  # logged 22:31, remembered from 22:35
        self.assertEqual(events["SYN-A-W-E17"]["recalled_offset_min"], {"earliest": 690, "latest": 720})

        colombia = cases["SYN-B-W"]
        self.assertEqual(colombia["anchor_local_hour"], 22)
        self.assertEqual(colombia["window"]["duration_min"], {"min": 26, "max": 26})  # 01:12 to 01:38
        self.assertTrue(colombia["window"]["traceable_to_records"])
        self.assertEqual(events["SYN-B-W-E04"]["recall_gap_min"], 0)
        self.assertEqual(events["SYN-B-W-E07"]["recall_gap_min"], -8)

    def test_export_keeps_reports_suspicions_and_corroboration_apart(self):
        events = events_of(kit.export(FIXTURE)[0])
        self.assertEqual(events["SYN-A-W-E03"]["occurrence"], "self_reported")  # tiredness message
        self.assertEqual(events["SYN-A-W-E03"]["reported_by"], "SYN-A-D")
        self.assertEqual(events["SYN-A-W-E09"]["occurrence"], "suspected")  # attributed fear, unverified
        self.assertEqual(events["SYN-A-W-E09"]["basis_source_id"], "SYN-A-W-S2")
        self.assertIn("explicitly said they feared robbery", events["SYN-A-W-E09"]["basis_note"])
        self.assertEqual(events["SYN-A-W-E18"]["event_type"], "contact_unconfirmed")
        self.assertEqual(events["SYN-A-W-E18"]["occurrence"], "unknown")
        self.assertIsNone(events["SYN-A-W-E18"]["basis_source_id"])
        self.assertEqual(events["SYN-B-W-E04"]["occurrence"], "corroborated")  # invented video observations
        self.assertEqual(events["SYN-B-W-E04"]["basis_source_id"], "SYN-B-W-S4")
        self.assertIn("wholly invented roadside video", events["SYN-B-W-E04"]["basis_note"])
        unknown = events["SYN-A-W-E15"]
        self.assertEqual(unknown["time_basis"], "unknown")
        self.assertIsNone(unknown["observed_offset_min"])
        self.assertIsNone(unknown["recalled_offset_min"])
        self.assertEqual(events["SYN-A-W-E06"]["conflicts_with"], ["SYN-A-W-E14"])
        self.assertEqual(events["SYN-A-W-E14"]["conflicts_with"], ["SYN-A-W-E06"])

    def test_export_drops_dates_and_private_columns(self):
        result, _ = kit.export(FIXTURE)
        text = json.dumps(result)
        for leaked in ("2026-", "storage_ref", "consent_ref", "consent_recording", "note_private",
                       "redaction_status", "consent_share_redacted", "no stored file", "no consent form"):
            self.assertNotIn(leaked, text)
        self.assertEqual(result["coverage"]["gaps"], ["Android not represented"])

    def test_command_line(self):
        code, out, _ = run_cli("check", FIXTURE)
        self.assertEqual(code, 0)
        self.assertIn("SYN-A-W worrying: window 44-74 min", out)
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "export.json"
            code, out, _ = run_cli("export", FIXTURE, "--out", target)
            self.assertEqual(code, 0)
            self.assertEqual(target.read_text(encoding="utf-8"), GOLDEN.read_text(encoding="utf-8"))
            self.assertIn("excluded reason redaction: 1", out)
            self.assertNotIn("SYN-A-O", out)


class KitFilesTest(unittest.TestCase):
    def test_templates_match_the_schema(self):
        for table, columns in kit.SCHEMA.items():
            with self.subTest(table=table):
                lines = (KIT / "templates" / f"{table}.csv").read_text(encoding="utf-8").splitlines()
                self.assertEqual(lines, [",".join(columns)])

    def test_data_dictionary_documents_every_column(self):
        dictionary = (KIT / "data-dictionary.md").read_text(encoding="utf-8")
        for table, columns in kit.SCHEMA.items():
            section = dictionary.split(f"## {table}.csv", 1)[1].split("\n## ", 1)[0]
            for column in columns:
                with self.subTest(table=table, column=column):
                    self.assertIn(f"`{column}`", section)

    def test_fixture_is_conspicuously_synthetic(self):
        for table, columns in kit.SCHEMA.items():
            rows = csv.DictReader(io.StringIO((FIXTURE / f"{table}.csv").read_text(encoding="utf-8")))
            for row in rows:
                self.assertTrue(next(iter(row.values())).startswith("SYN-"), row)
                if table == "cases":
                    self.assertEqual(row["synthetic"], "yes")
                for column, spec in columns.items():
                    free_text = isinstance(spec, str) and spec.rstrip("?") in ("text", "private")
                    if free_text and row[column]:
                        self.assertTrue(row[column].startswith("SYNTHETIC"), (table, column, row[column]))


class RuleTest(unittest.TestCase):
    """Each test breaks one rule in a copy of the synthetic cohort."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "cohort"
        shutil.copytree(FIXTURE, self.folder)

    def tearDown(self):
        self.tmp.cleanup()

    def edit(self, table, row_id, **changes):
        path = self.folder / f"{table}.csv"
        rows = list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))
        fields = list(rows[0]) + [name for name in changes if name not in rows[0]]
        matched = [row for row in rows if row[fields[0]] == row_id]
        self.assertEqual(len(matched), 1, row_id)
        matched[0].update(changes)
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=fields, restval="")
        writer.writeheader()
        writer.writerows(rows)
        path.write_text(out.getvalue(), encoding="utf-8")

    def add_source(self, row_id, **changes):
        path = self.folder / "sources.csv"
        rows = list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))
        fields = list(rows[0])
        row = dict.fromkeys(fields, "")
        row.update({"source_id": row_id, "case_id": "SYN-A-W", "kind": "other",
                    "provided_by": "SYN-A-C", "evidence_basis": "contact_status_only",
                    "timestamped_record": "no", "storage_ref": "SYNTHETIC no stored file",
                    "note_private": "SYNTHETIC"})
        row.update(changes)
        rows.append(row)
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=fields, restval="")
        writer.writeheader()
        writer.writerows(rows)
        path.write_text(out.getvalue(), encoding="utf-8")

    def errors(self):
        return kit.check(self.folder)[1].errors

    def assertRejected(self, fragment):
        errors = self.errors()
        self.assertTrue(any(fragment in error for error in errors), "\n".join(errors) or "no errors")

    def test_times_need_an_offset(self):
        self.edit("timeline", "SYN-A-W-E02", observed_time="2026-09-14T14:12")
        self.assertRejected("observed_time must be a date and time with its UTC offset")

    @unittest.skipUnless(kit.ZONES, "no time-zone database on this machine")
    def test_offsets_must_match_the_zone(self):
        self.edit("timeline", "SYN-A-W-E02", observed_time="2026-09-14T14:12-05:00")
        self.assertRejected("observed_time offset does not match America/Sao_Paulo, which was at -03:00")

    def test_observed_times_need_a_timestamped_record(self):
        self.edit("timeline", "SYN-A-W-E02", source_ids="SYN-A-W-S1", observed_source_id="SYN-A-W-S1")
        self.assertRejected("observed times need a timestamped record; SYN-A-W-S1 is an account")

    def test_interviews_are_never_timestamped_records(self):
        self.edit("sources", "SYN-A-W-S1", timestamped_record="yes", source_time_zone="America/Sao_Paulo")
        self.assertRejected("an interview is an account")

    def test_recalled_range_runs_forward(self):
        self.edit("timeline", "SYN-A-W-E01",
                  recalled_earliest="2026-09-14T14:30-03:00", recalled_latest="2026-09-14T14:00-03:00")
        self.assertRejected("recalled_earliest is after recalled_latest")

    def test_recalled_times_need_the_named_participants_own_account(self):
        self.edit("timeline", "SYN-A-W-E07", source_ids="SYN-A-W-S1")
        self.assertRejected("recalled times need the named participant's own attributed account")
        result, report = kit.export(self.folder)
        self.assertIsNone(result)
        self.assertTrue(any("recalled times need the named participant's own attributed account" in error
                            for error in report.errors))

    def test_recalled_times_need_an_attributed_account_from_that_participant(self):
        self.add_source("SYN-A-W-S5")
        self.edit("timeline", "SYN-A-W-E07", source_ids="SYN-A-W-S1;SYN-A-W-S5")
        self.assertRejected("recalled times need the named participant's own attributed account")
        self.edit("sources", "SYN-A-W-S5", evidence_basis="attributed_account")
        result, report = kit.export(self.folder)
        self.assertEqual(report.errors, [])
        event = events_of(result)["SYN-A-W-E07"]
        self.assertEqual(event["source_ids"], ["SYN-A-W-S1", "SYN-A-W-S5"])

    def test_unknown_time_stays_unknown(self):
        self.edit("timeline", "SYN-A-W-E15", observed_time="2026-09-14T22:40-03:00", time_zone="America/Sao_Paulo")
        self.assertRejected("observed_time must be empty when time_basis is unknown")

    def test_sources_must_exist_in_the_same_case(self):
        self.edit("timeline", "SYN-A-W-E01", source_ids="SYN-A-W-S9")
        self.assertRejected("a cited source is not in sources.csv")
        self.edit("timeline", "SYN-A-W-E01", source_ids="SYN-B-W-S1")
        self.assertRejected("a cited source belongs to another case")

    def test_conflicts_stay_inside_the_case(self):
        for target, message in (("SYN-A-W-E06", "an event cannot conflict with itself"),
                                ("SYN-A-W-E99", "conflicts_with is not in timeline.csv"),
                                ("SYN-B-W-E01", "conflicts_with belongs to another case")):
            with self.subTest(target=target):
                self.edit("timeline", "SYN-A-W-E06", conflicts_with=target)
                self.assertRejected(message)

    def test_a_record_cannot_show_tiredness_or_robbery(self):
        self.edit("timeline", "SYN-A-W-E03", occurrence="recorded")
        self.assertRejected("a phone or message record cannot show tiredness_report")

    def test_self_report_needs_an_attributed_account(self):
        self.edit("timeline", "SYN-A-W-E10", event_type="robbery", actor="driver",
                  reported_by="SYN-A-D", occurrence="self_reported")
        self.assertRejected("self_reported needs a cited attributed account")

    def test_driver_message_supplied_by_contact_can_be_self_reported(self):
        self.edit("timeline", "SYN-A-W-E10", event_type="robbery", actor="driver",
                  reported_by="SYN-A-D", occurrence="self_reported",
                  source_ids="SYN-A-W-S3", observed_source_id="SYN-A-W-S3")
        result, report = kit.export(self.folder)
        self.assertEqual(report.errors, [])
        event = events_of(result)["SYN-A-W-E10"]
        self.assertEqual(event["occurrence"], "self_reported")
        self.assertEqual(event["reported_by"], "SYN-A-D")
        self.assertEqual(event["source_ids"], ["SYN-A-W-S3"])

    def test_self_report_cannot_rest_on_the_other_participants_interview(self):
        self.edit("timeline", "SYN-A-W-E03", source_ids="SYN-A-W-S2",
                  time_basis="unknown", observed_time="", observed_source_id="")
        self.assertRejected("self_reported needs the participant's own attributed account")
        result, report = kit.export(self.folder)
        self.assertIsNone(result)
        self.assertTrue(any("self_reported needs the participant's own attributed account" in error
                            for error in report.errors))

    def test_second_hand_report_needs_an_attributed_account(self):
        self.edit("timeline", "SYN-A-W-E10", event_type="dozed_off_report", actor="driver",
                  reported_by="SYN-A-C", occurrence="reported_second_hand")
        self.assertRejected("reported_second_hand needs a cited attributed account")

    def test_second_hand_report_needs_the_reporting_participants_account(self):
        self.edit("timeline", "SYN-A-W-E15", source_ids="SYN-A-W-S1")
        self.assertRejected("reported_second_hand needs the reporting participant's own attributed account")
        self.edit("timeline", "SYN-A-W-E15", source_ids="SYN-A-W-S2")
        self.assertEqual(self.errors(), [])

    def test_second_hand_nonmessage_account_cannot_borrow_another_provider(self):
        self.add_source("SYN-A-W-S5", kind="other", provided_by="SYN-A-D", evidence_basis="attributed_account")
        self.edit("timeline", "SYN-A-W-E15", source_ids="SYN-A-W-S5")
        self.assertRejected("reported_second_hand needs the reporting participant's own attributed account")
        self.edit("sources", "SYN-A-W-S5", provided_by="SYN-A-C")
        self.assertEqual(self.errors(), [])

    def test_self_report_needs_own_nonmessage_account(self):
        self.add_source("SYN-A-W-S5", kind="independent_record", evidence_basis="attributed_account")
        self.edit("timeline", "SYN-A-W-E03", source_ids="SYN-A-W-S5",
                  time_basis="unknown", observed_time="", observed_source_id="")
        self.assertRejected("self_reported needs the participant's own attributed account")
        self.edit("sources", "SYN-A-W-S5", provided_by="SYN-A-D")
        self.assertEqual(self.errors(), [])

    def test_unknown_cannot_label_sensitive_or_rest_events_from_metadata(self):
        for event_type in sorted(kit.SENSITIVE | kit.REST_REPORTS):
            with self.subTest(event_type=event_type):
                self.edit("timeline", "SYN-A-W-E10", event_type=event_type, occurrence="unknown")
                result, report = kit.export(self.folder)
                self.assertIsNone(result)
                self.assertTrue(any(event_type in error for error in report.errors), report.errors)

    def test_self_report_names_the_person_even_when_a_message_records_it(self):
        self.edit("timeline", "SYN-A-W-E03", reported_by="record")
        self.assertRejected("self_reported needs the participant whose account it is in reported_by")

    def test_location_metadata_cannot_be_recorded_as_rest(self):
        self.edit("sources", "SYN-A-W-S4", kind="location_history")
        self.edit("timeline", "SYN-A-W-E10", event_type="rest_start", actor="driver")
        self.assertRejected("rest_start needs a participant account; location or contact metadata can only record a stop")

    def test_consent_reference_is_required(self):
        self.edit("participants", "SYN-A-D", consent_ref="")
        self.assertRejected("consent_ref is required")
        result, report = kit.export(self.folder)
        self.assertIsNone(result)
        self.assertTrue(any("consent_ref is required" in error for error in report.errors))

    def test_corroboration_needs_an_independent_record(self):
        self.edit("timeline", "SYN-B-W-E04", source_ids="SYN-B-W-S1;SYN-B-W-S3", observed_source_id="SYN-B-W-S3")
        self.assertRejected("occurrence corroborated needs a cited independent_record")

    def test_reporting_someone_elses_experience_is_second_hand(self):
        self.edit("timeline", "SYN-A-W-E09", occurrence="self_reported")  # the contact on the driver's robbery
        self.assertRejected("SYN-A-C is reporting the driver's experience; use reported_second_hand")

    def test_a_suspicion_needs_the_person_who_held_it(self):
        self.edit("timeline", "SYN-A-W-E10", occurrence="suspected")  # reported_by is record
        self.assertRejected("a suspicion needs the participant who held it in reported_by")

    def test_no_reply_alone_cannot_be_promoted_to_suspicion(self):
        for event_type in ("tiredness_report", "dozed_off_report", "robbery_attempt", "robbery"):
            with self.subTest(event_type=event_type):
                self.edit("timeline", "SYN-A-W-E10", event_type=event_type,
                          occurrence="suspected", reported_by="SYN-A-C",
                          basis_source_id="SYN-A-W-S4", basis_note="SYNTHETIC: unanswered call only")
                self.assertRejected("suspicion needs a cited account supplied by the participant")

    def test_suspicion_requires_an_explicit_basis_and_source(self):
        self.edit("timeline", "SYN-A-W-E09", basis_note="")
        self.assertRejected("suspected needs basis_note")
        self.edit("timeline", "SYN-A-W-E09", basis_note="SYNTHETIC: contact explicitly feared robbery",
                  basis_source_id="")
        self.assertRejected("suspected needs basis_source_id")

    def test_suspicion_cannot_borrow_another_persons_account(self):
        self.edit("timeline", "SYN-A-W-E09", source_ids="SYN-A-W-S1", basis_source_id="SYN-A-W-S1")
        self.assertRejected("suspicion needs a cited account supplied by the participant")

    def test_unanswered_contact_exports_as_unknown_without_an_incident_label(self):
        self.edit("timeline", "SYN-A-W-E10", event_type="contact_unconfirmed", occurrence="unknown")
        result, report = kit.export(self.folder)
        self.assertEqual(report.errors, [])
        event = events_of(result)["SYN-A-W-E10"]
        self.assertEqual(event["event_type"], "contact_unconfirmed")
        self.assertEqual(event["occurrence"], "unknown")

    def test_contact_status_cannot_be_labeled_a_suspicion(self):
        self.edit("timeline", "SYN-A-W-E09", event_type="contact_unconfirmed")
        self.assertRejected("contact_unconfirmed must keep occurrence unknown")

    def test_police_complaint_repeating_an_allegation_is_not_corroboration(self):
        self.edit("sources", "SYN-B-W-S4", evidence_basis="attributed_account",
                  note_private="SYNTHETIC: complaint only repeats the driver's allegation")
        self.assertRejected("corroboration needs independent observations supporting this event")
        self.edit("sources", "SYN-B-W-S4", evidence_basis="unknown")
        self.assertRejected("corroboration needs independent observations supporting this event")

    def test_corroboration_requires_its_specific_source_and_basis(self):
        self.edit("timeline", "SYN-B-W-E04", basis_note="")
        self.assertRejected("corroborated needs basis_note")
        self.edit("timeline", "SYN-B-W-E04", basis_note="SYNTHETIC: independent witness account",
                  basis_source_id="SYN-B-W-S1")
        self.assertRejected("corroboration needs independent observations supporting this event")

    def test_basis_source_must_be_cited_in_the_same_event(self):
        self.edit("timeline", "SYN-A-W-E09", basis_source_id="SYN-B-W-S4")
        self.assertRejected("basis_source_id must also be listed in source_ids")

    def test_rerecorded_allegation_can_remain_attributed_self_report(self):
        self.edit("sources", "SYN-B-W-S4", evidence_basis="attributed_account")
        self.edit("timeline", "SYN-B-W-E04", occurrence="self_reported",
                  basis_source_id="", basis_note="", time_basis="recalled",
                  observed_time="", observed_source_id="")
        result, report = kit.export(self.folder)
        self.assertEqual(report.errors, [])
        event = events_of(result)["SYN-B-W-E04"]
        self.assertEqual(event["occurrence"], "self_reported")
        self.assertIsNone(event["observed_offset_min"])

    def test_basis_notes_are_scanned_for_identifiers(self):
        self.edit("timeline", "SYN-A-W-E09", basis_note="SYNTHETIC: ask person@example.com")
        self.assertRejected("basis_note seems to contain an email address")

    def test_source_classification_does_not_upgrade_interviews_or_call_metadata(self):
        self.edit("sources", "SYN-A-W-S2", evidence_basis="independent_observation")
        self.assertRejected("an interview needs evidence_basis attributed_account")
        self.assertRejected("independent_observation needs kind independent_record")
        self.edit("sources", "SYN-A-W-S2", evidence_basis="attributed_account")
        self.edit("sources", "SYN-A-W-S4", evidence_basis="attributed_account")
        self.assertRejected("contact or location metadata alone is not an attributed account")

    def test_identifiers_in_exported_text_are_rejected_without_repeating_them(self):
        for text, label in (("SYNTHETIC call +55 00 00000-0000", "a phone number"),
                            ("SYNTHETIC write to nome@example.com", "an email address"),
                            ("SYNTHETIC see https://example.com/file", "a link"),
                            ("SYNTHETIC parked at 0.000000, 0.000000", "coordinates"),
                            ("SYNTHETIC plate ZZZ-0000", "a vehicle plate"),
                            ("SYNTHETIC left on 2026-09-14", "a calendar date"),
                            ("SYNTHETIC left on 14/09/2026", "a calendar date")):
            with self.subTest(label=label, text=text):
                self.edit("timeline", "SYN-A-W-E02", note_redacted=text)
                errors = self.errors()
                self.assertTrue(any(f"seems to contain {label}" in error for error in errors), errors)
                self.assertFalse(any(text in error for error in errors))

    def test_clock_times_and_distances_are_allowed_in_text(self):
        self.edit("timeline", "SYN-A-W-E02", note_redacted="SYNTHETIC left at 14:12 and stopped at 21:40 near km 120")
        self.assertEqual(self.errors(), [])

    def test_common_regional_identifiers_are_rejected(self):
        for value in ("-23,550520, -46,633308", "-23.550520 -46.633308", "23°33′02″S 46°38′00″W",
                      "14/09", "14 de setembro", "14 de septiembre", "abc1d23", "AB 123 CD",
                      "ABC-12-34", "maps.app.goo.gl/example", "bit.ly/example"):
            with self.subTest(value=value):
                self.edit("timeline", "SYN-A-W-E02", note_redacted="SYNTHETIC " + value)
                result, report = kit.export(self.folder)
                self.assertIsNone(result)
                self.assertTrue(any("note_redacted seems to contain" in error for error in report.errors),
                                report.errors)
                self.assertNotIn(value, "\n".join(report.errors))

    def test_ids_cannot_contain_common_private_identifiers(self):
        for value in ("ABC1D23", "D-5511987654321", "C-2026-09-14", "SYNTHETIC PRIVATE NAME"):
            with self.subTest(value=value):
                self.edit("participants", "SYN-A-D", participant_id=value)
                code, out, err = run_cli("check", self.folder)
                self.assertEqual(code, 1)
                self.assertNotIn(value, out + err)
                result, report = kit.export(self.folder)
                self.assertIsNone(result)
                self.assertTrue(report.errors)
                self.edit("participants", value, participant_id="SYN-A-D")

    def test_invalid_reference_ids_are_not_echoed(self):
        self.edit("timeline", "SYN-A-W-E02", source_ids="SYNTHETIC PRIVATE NAME")
        code, out, err = run_cli("check", self.folder)
        self.assertEqual(code, 1)
        self.assertNotIn("SYNTHETIC PRIVATE NAME", out + err)

    def test_complaint_filing_clock_cannot_time_incident(self):
        self.add_source("SYN-B-W-S5", case_id="SYN-B-W", kind="independent_record", provided_by="SYN-B-D",
                        evidence_basis="attributed_account", timestamped_record="yes", source_time_zone="America/Bogota")
        self.edit("timeline", "SYN-B-W-E04", source_ids="SYN-B-W-S1;SYN-B-W-S4;SYN-B-W-S5",
                  observed_source_id="SYN-B-W-S5")
        self.assertRejected("a filing clock is not an incident time")
        self.edit("timeline", "SYN-B-W-E04", observed_source_id="SYN-B-W-S4")
        self.assertEqual(self.errors(), [])

    def test_none_channel_is_exclusive(self):
        self.edit("cases", "SYN-A-W", arrangement_channels="none;whatsapp")
        self.assertRejected("arrangement_channels cannot combine none with other values")
        self.edit("cases", "SYN-A-W", arrangement_channels="none")
        self.assertEqual(self.errors(), [])

    def test_oversized_csv_cell_has_controlled_diagnostic(self):
        self.edit("sources", "SYN-A-W-S1", note_private="X" * (csv.field_size_limit() + 1))
        target = self.folder / "out.json"
        code, out, err = run_cli("export", self.folder, "--out", target)
        self.assertEqual(code, 1)
        self.assertIn("could not parse CSV", err)
        self.assertNotIn("Traceback", out + err)
        self.assertFalse(target.exists())

    def test_export_warns_when_zone_database_is_missing(self):
        with patch.object(kit, "ZONES", set()):
            code, out, err = run_cli("export", self.folder, "--out", self.folder / "out.json")
        self.assertEqual(code, 0, out + err)
        self.assertIn("no time-zone database", err)

    def test_malformed_csv_quotes_have_controlled_diagnostic(self):
        path = self.folder / "sources.csv"
        path.write_text(path.read_text(encoding="utf-8") + '"SYNTHETIC unclosed cell', encoding="utf-8")
        code, out, err = run_cli("check", self.folder)
        self.assertEqual(code, 1)
        self.assertIn("could not parse CSV", out)
        self.assertNotIn("SYNTHETIC unclosed cell", out + err)

    def test_window_rules(self):
        self.edit("cases", "SYN-A-W", window_start_event="SYN-A-W-E13", window_end_event="SYN-A-W-E07")
        self.assertRejected("window_start_event must come before window_end_event in seq")
        self.edit("cases", "SYN-A-W", window_start_event="", window_end_event="")
        self.assertRejected("actionable_window is yes, so window_start_event and window_end_event are required")

    def test_ids_and_seq_are_unique(self):
        self.edit("timeline", "SYN-A-W-E03", seq="2")
        self.assertRejected("case SYN-A-W: seq 2 is used 2 times")
        self.edit("timeline", "SYN-A-W-E02", event_id="SYN-A-W-E01")
        self.assertRejected("duplicate event_id SYN-A-W-E01")

    def test_truck_and_relationship_fields_follow_the_role(self):
        self.edit("participants", "SYN-A-C", trucks_operated="1")
        self.assertRejected("trucks_operated must be not_applicable for a contact")
        self.edit("participants", "SYN-A-D", relationship_to_driver="family")
        self.assertRejected("relationship_to_driver must be not_applicable for a driver")

    def test_drivers_outside_the_segment_are_flagged(self):
        self.edit("participants", "SYN-B-D", trucks_operated="3_or_more")
        _, report = kit.check(self.folder)
        self.assertIn("participants.csv line 4 (SYN-B-D): driver is outside the owner-operator segment "
                      "of one or two trucks", report.warnings)

    def test_european_portuguese_does_not_cover_brazilian_portuguese(self):
        self.edit("participants", "SYN-A-D", preferred_language="pt-PT")
        self.edit("participants", "SYN-A-C", preferred_language="pt-PT")
        result, report = kit.export(self.folder)
        self.assertEqual(report.errors, [])
        self.assertEqual(result["coverage"]["languages"], {"es": 2, "pt-PT": 2})
        self.assertIn("Brazilian Portuguese (pt-BR) not represented", result["coverage"]["gaps"])
        self.assertNotIn("Spanish (es) not represented", result["coverage"]["gaps"])

    def test_export_needs_consent_from_both_people(self):
        self.edit("participants", "SYN-B-C", consent_share_redacted="pending")
        result, _ = kit.export(self.folder)
        self.assertEqual([case["case_id"] for case in result["cases"]], ["SYN-A-W"])
        self.assertEqual(result["excluded_cases"]["by_reason"]["consent"], 1)
        self.assertNotIn("SYN-B", json.dumps(result))
        self.assertNotIn("SYN-B", json.dumps(result["participants"]))

    def test_exclusion_reasons_never_disclose_refusing_participant(self):
        self.edit("participants", "SYN-B-C", consent_share_redacted="no")
        result, report = kit.export(self.folder)
        self.assertEqual(report.errors, [])
        text = json.dumps(result)
        for private in ("SYN-B-C", "consent_share_redacted", "redaction_status"):
            self.assertNotIn(private, text)
        self.assertEqual(result["excluded_cases"]["by_reason"]["consent"], 1)
        self.assertNotIn("SYN-B", text)

    def assert_incomplete_pair_excluded(self, missing_role):
        # Keep only the enrolled person's ordinary-trip account for pair A.
        # Pair B remains complete and consenting, so it must still export.
        missing_id = {"driver": "SYN-A-D", "contact": "SYN-A-C"}[missing_role]
        source_id, event_id = {
            "driver": ("SYN-A-O-S2", "SYN-A-O-E02"),
            "contact": ("SYN-A-O-S1", "SYN-A-O-E01"),
        }[missing_role]
        keep = {
            "participants": lambda row: row["participant_id"] != missing_id,
            "cases": lambda row: row["case_id"] != "SYN-A-W",
            "sources": lambda row: row["case_id"] == "SYN-B-W" or row["source_id"] == source_id,
            "timeline": lambda row: row["case_id"] == "SYN-B-W" or row["event_id"] == event_id,
        }
        for table, predicate in keep.items():
            path = self.folder / f"{table}.csv"
            reader = csv.DictReader(io.StringIO(path.read_text(encoding="utf-8")))
            rows = [row for row in reader if predicate(row)]
            out = io.StringIO()
            writer = csv.DictWriter(out, fieldnames=reader.fieldnames)
            writer.writeheader()
            writer.writerows(rows)
            path.write_text(out.getvalue(), encoding="utf-8")
        self.edit("cases", "SYN-A-O", redaction_status="reviewed",
                  **{f"{missing_role}_review": "pending"})

        data, report = kit.check(self.folder)
        self.assertEqual(report.errors, [])  # Missing references must not mask the consent gap.
        self.assertIn(f"pair SYN-A: has no {missing_role} enrolled", report.warnings)
        target = self.folder / "out.json"
        code, out, err = run_cli("export", self.folder, "--out", target)
        self.assertEqual(code, 0, err)
        result = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual([case["case_id"] for case in result["cases"]], ["SYN-B-W"])
        self.assertEqual(result["excluded_cases"], {
            "count": 1, "by_reason": {"consent": 1, "participant_review": 1, "trace_review": 1},
        })
        self.assertEqual({person["pair_id"] for person in result["participants"]}, {"SYN-B"})
        self.assertEqual(result["coverage"]["pairs"], 1)
        self.assertIn("excluded reason consent: 1", out)
        self.assertNotIn("SYN-A-O", out)
        self.assertIn(f"export blocked: no {missing_role} enrolled", kit.summary(self.folder, data, report))

    def test_export_excludes_driver_only_pair(self):
        self.assert_incomplete_pair_excluded("contact")

    def test_export_excludes_contact_only_pair(self):
        self.assert_incomplete_pair_excluded("driver")

    def test_export_is_refused_while_errors_remain(self):
        self.edit("timeline", "SYN-A-W-E02", observed_time="")
        result, report = kit.export(self.folder)
        self.assertIsNone(result)
        self.assertTrue(report.errors)
        target = self.folder / "out.json"
        code, _, err = run_cli("export", self.folder, "--out", target)
        self.assertEqual(code, 1)
        self.assertFalse(target.exists())
        self.assertIn("Export refused", err)

    def test_added_columns_are_never_exported(self):
        self.edit("participants", "SYN-A-D", phone_note="SYNTHETIC added column")
        _, report = kit.check(self.folder)
        self.assertIn("participants.csv: 1 extra column(s) are ignored and never exported", report.warnings)
        self.assertNotIn("SYNTHETIC added column", json.dumps(kit.export(self.folder)[0]))

    def test_semicolon_separated_files_are_read(self):
        path = self.folder / "participants.csv"
        rows = list(csv.reader(io.StringIO(path.read_text(encoding="utf-8"))))
        out = io.StringIO()
        csv.writer(out, delimiter=";").writerows(rows)
        path.write_text(out.getvalue(), encoding="utf-8")
        self.assertEqual(self.errors(), [])

    def test_excel_byte_order_mark_is_accepted(self):
        path = self.folder / "cases.csv"
        path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
        self.assertEqual(self.errors(), [])

    def test_cp1252_spreadsheet_csv_gets_a_utf8_instruction(self):
        path = self.folder / "participants.csv"
        path.write_bytes(path.read_bytes().replace("owner_operator".encode(),
                                                   "owner_opérator".encode("cp1252")))
        errors = self.errors()
        self.assertTrue(any("participants.csv: is not valid UTF-8" in error for error in errors),
                        "\n".join(errors) or "no errors")
        self.assertTrue(any("CSV UTF-8" in error for error in errors))
        code, out, _ = run_cli("check", self.folder)
        self.assertEqual(code, 1)
        self.assertIn("CSV UTF-8", out)

    def test_cp1252_stdout_can_print_the_utf8_instruction(self):
        path = self.folder / "participants.csv"
        path.write_bytes(path.read_bytes().replace(b"owner_operator", "owner_opérator".encode("cp1252")))
        child = (
            "import runpy,sys; sys.stdout.reconfigure(encoding='cp1252',errors='strict'); "
            "sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')"
        )
        process = subprocess.run([sys.executable, "-I", "-c", child, str(KIT / "incident_kit.py"),
                                  "check", str(self.folder)], capture_output=True)
        self.assertEqual(process.returncode, 1)
        self.assertIn(b"CSV UTF-8", process.stdout)
        self.assertNotIn(b"UnicodeEncodeError", process.stderr)
        self.assertNotIn(b"Traceback", process.stderr)

    def test_late_decode_error_discards_partial_table(self):
        path = self.folder / "participants.csv"
        lines = path.read_bytes().splitlines(keepends=True)
        path.write_bytes(b"".join(lines) + lines[-1] * 250 + b"\xe9")
        report = kit.Report()
        tables = kit.read_tables(self.folder, report)
        self.assertEqual(tables["participants"], [])
        self.assertTrue(any("is not valid UTF-8" in error for error in report.errors), report.errors)

    def test_csv_error_discards_partial_table(self):
        path = self.folder / "participants.csv"
        path.write_text(path.read_text(encoding="utf-8") + '"SYNTHETIC unclosed cell', encoding="utf-8")
        report = kit.Report()
        tables = kit.read_tables(self.folder, report)
        self.assertEqual(tables["participants"], [])
        self.assertTrue(any("could not parse CSV" in error for error in report.errors), report.errors)

    def test_latin_american_spanish_tag_is_accepted(self):
        self.edit("participants", "SYN-B-D", preferred_language="es-419")
        self.edit("participants", "SYN-B-C", preferred_language="es-419")
        result, report = kit.export(self.folder)
        self.assertEqual(report.errors, [])
        self.assertEqual(result["coverage"]["languages"].get("es-419"), 2)
        self.assertNotIn("Spanish (es) not represented", result["coverage"]["gaps"])

    def test_numeric_language_region_requires_ascii_digits(self):
        self.edit("participants", "SYN-B-D", preferred_language="es-٤١٩")
        self.assertRejected("preferred_language must be a language tag")
        self.edit("participants", "SYN-B-D", preferred_language="es-419")
        self.assertEqual(self.errors(), [])

    def test_missing_table_is_reported(self):
        (self.folder / "sources.csv").unlink()
        self.assertRejected("sources.csv: file not found")

    def test_duplicate_headers_cannot_override_consent(self):
        self.edit("participants", "SYN-B-C", consent_share_redacted="no")
        path = self.folder / "participants.csv"
        original = path.read_text(encoding="utf-8")
        for duplicate in ("consent_share_redacted", " consent_share_redacted "):
            with self.subTest(duplicate=duplicate):
                rows = list(csv.reader(io.StringIO(original)))
                rows[0].append(duplicate)
                for row in rows[1:]:
                    row.append("yes")
                out = io.StringIO()
                csv.writer(out).writerows(rows)
                path.write_text(out.getvalue(), encoding="utf-8")
                result, report = kit.export(self.folder)
                self.assertIsNone(result)
                self.assertTrue(any("duplicate column" in e for e in report.errors), report.errors)

    def test_duplicate_headers_reject_every_table(self):
        for table in kit.SCHEMA:
            with self.subTest(table=table):
                path = self.folder / f"{table}.csv"
                original = path.read_text(encoding="utf-8")
                rows = list(csv.reader(io.StringIO(original)))
                rows[0].append(rows[0][0])
                for row in rows[1:]:
                    row.append(row[0])
                out = io.StringIO()
                csv.writer(out).writerows(rows)
                path.write_text(out.getvalue(), encoding="utf-8")
                self.assertRejected("duplicate column")
                path.write_text(original, encoding="utf-8")

    def test_excluded_cases_leave_only_generic_counts_in_json_and_cli(self):
        self.edit("participants", "SYN-B-C", consent_share_redacted="no")
        target = self.folder / "out.json"
        code, out, err = run_cli("export", self.folder, "--out", target)
        self.assertEqual(code, 0, err)
        text = target.read_text(encoding="utf-8")
        for private in ("SYN-B", "SYN-A-O", "consent_share_redacted", "redaction_status"):
            self.assertNotIn(private, text + out + err)
        result = json.loads(text)
        self.assertEqual(result["excluded_cases"]["count"], 2)
        self.assertEqual(result["excluded_cases"]["by_reason"]["consent"], 1)

    def test_export_requires_completed_participant_and_trace_reviews(self):
        defaults = dict(driver_review="confirmed", contact_review="corrected", trace_review="traced")
        for column, states in (("driver_review", ("pending", "declined", "disputed")),
                               ("contact_review", ("pending", "declined", "disputed")),
                               ("trace_review", ("pending", "not_traceable", "inconclusive"))):
            for state in states:
                with self.subTest(column=column, state=state):
                    self.edit("cases", "SYN-A-W", **{**defaults, column: state})
                    result, report = kit.export(self.folder)
                    self.assertEqual(report.errors, [])
                    self.assertEqual([c["case_id"] for c in result["cases"]], ["SYN-B-W"])
        self.edit("cases", "SYN-A-W", **defaults)
        self.assertEqual(len(kit.export(self.folder)[0]["cases"]), 2)

    def test_corroborated_rest_requires_a_participant_account(self):
        self.add_source("SYN-A-W-S9", kind="independent_record", evidence_basis="independent_observation")
        self.edit("timeline", "SYN-A-W-E03", event_type="rest_start", occurrence="corroborated",
                  source_ids="SYN-A-W-S9", basis_source_id="SYN-A-W-S9",
                  basis_note="SYNTHETIC tracker stop", time_basis="unknown",
                  observed_time="", observed_source_id="")
        self.assertRejected("rest_start needs a participant account")
        self.edit("timeline", "SYN-A-W-E03", source_ids="SYN-A-W-S9;SYN-A-W-S1")
        self.assertEqual(self.errors(), [])

    def test_zone_fields_reject_identifiers_without_a_zone_database(self):
        for table, row, column in (("timeline", "SYN-A-W-E02", "time_zone"),
                                    ("sources", "SYN-A-W-S3", "source_time_zone")):
            for value in ("MARIA SILVA +55 00 00000-0000", "MARIA-SILVA", "person@example.com"):
                with self.subTest(table=table, value=value), patch.object(kit, "ZONES", set()):
                    self.edit(table, row, **{column: value})
                    result, report = kit.export(self.folder)
                    self.assertIsNone(result)
                    self.assertTrue(any(column in e for e in report.errors), report.errors)
                    self.assertNotIn(value, "\n".join(report.errors))
            self.edit(table, row, **{column: "America/Sao_Paulo"})
        with patch.object(kit, "ZONES", set()):
            self.assertEqual(self.errors(), [])

    def test_missing_source_reference_is_not_echoed(self):
        self.edit("timeline", "SYN-A-W-E02", source_ids="MARIA-SILVA")
        code, out, err = run_cli("check", self.folder)
        self.assertEqual(code, 1)
        self.assertNotIn("MARIA-SILVA", out + err)
        self.assertIn("not in sources.csv", out)

    def test_ordinary_notes_and_reserved_code_ids_remain_valid(self):
        for value in ("300 km de serra", "1500 kg", "tank at 1/2", "open 24/7", "stopped.Then"):
            with self.subTest(value=value):
                self.edit("timeline", "SYN-A-W-E02", note_redacted=value)
                self.assertEqual(self.errors(), [])
        for code in ("SYN-1234", "CAS-0001"):
            with self.subTest(code=code):
                self.assertIsNone(kit.KINDS["id"](code))

    def test_id_scan_rejects_identifiers_directly(self):
        for value, fragment in (("ABC1D23", "vehicle plate"), ("D-5511987654321", "phone number"),
                                ("C-2026-09-14", "calendar date")):
            with self.subTest(value=value):
                self.assertIn(fragment, kit._id(value) or "")
                self.assertIn(fragment, kit.KINDS["id"](value) or "")

    def test_short_dates_and_coordinates_without_seconds_are_rejected(self):
        for value in ("14-09-26", "14.09", "14 setembro", "14 septiembre", "23°33′S 46°38′W"):
            with self.subTest(value=value):
                self.edit("timeline", "SYN-A-W-E02", note_redacted=value)
                self.assertRejected("note_redacted seems to contain")

    def test_extra_headers_never_echo_and_are_cp1252_safe(self):
        self.edit("participants", "SYN-A-D", **{"PRIVATE-秘密": "ignored"})
        code, out, err = run_cli("check", self.folder)
        self.assertEqual(code, 0)
        self.assertNotIn("PRIVATE-秘密", out + err)
        child = (
            "import runpy,sys; sys.stdout.reconfigure(encoding='cp1252',errors='strict'); "
            "sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')"
        )
        process = subprocess.run([sys.executable, "-I", "-c", child, str(KIT / "incident_kit.py"),
                                  "check", str(self.folder)], capture_output=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertNotIn(b"Traceback", process.stderr)

    def test_message_accounts_flag_authorship_for_trace_review(self):
        _, report = kit.check(self.folder)
        self.assertTrue(any("message authorship" in w for w in report.warnings), report.warnings)

    def test_cell_error_does_not_hide_other_rows_provenance_errors(self):
        self.edit("participants", "SYN-B-C", preferred_language="bad!")
        self.edit("timeline", "SYN-A-W-E03", source_ids="SYN-A-W-S2", time_basis="unknown",
                  observed_time="", observed_source_id="")
        self.assertRejected("self_reported needs the participant's own attributed account")


if __name__ == "__main__":
    unittest.main()
