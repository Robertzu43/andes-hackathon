#!/usr/bin/env python3
"""Independent synthetic-only PR46 review controls; not wired into product CI.

Usage: python3 -I review-probes/incident-kit-followups.py ARCHIVE OUTPUT
Exit 1 means a review expectation failed; inspect results.json for the evidence.
The candidate archive is read only. All mutations and exports live under OUTPUT.
"""

import argparse
import csv
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    archive = args.archive.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    script = archive / "evidence/incident_kit.py"
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("reviewed_kit", script)
    kit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kit)
    results = []

    def rows(folder, table):
        with (folder / (table + ".csv")).open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            return reader.fieldnames, list(reader)

    def save(folder, table, fields, values):
        with (folder / (table + ".csv")).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(values)

    def edit(folder, table, key, **changes):
        fields, values = rows(folder, table)
        targets = [row for row in values if row[fields[0]] == key]
        assert len(targets) == 1, (table, key)
        targets[0].update(changes)
        save(folder, table, fields, values)

    def event(folder, event_type, **changes):
        fields, values = rows(folder, "timeline")
        row = dict.fromkeys(fields, "")
        row.update(event_id="SYN-A-W-E99", case_id="SYN-A-W", seq="99",
                   event_type=event_type, actor="driver", reported_by="record",
                   occurrence="unknown", source_ids="SYN-A-W-S4", time_basis="unknown",
                   time_zone="America/Sao_Paulo", note_redacted="SYNTHETIC probe")
        row.update(changes)
        values.append(row)
        save(folder, "timeline", fields, values)

    def run(name, mutate, expected, predicate=None, no_zones=False):
        folder = output / name
        # Refuse to overwrite existing evidence or delete any supplied path.
        shutil.copytree(archive / "evidence/fixtures/synthetic", folder)
        mutate(folder)
        destination = folder / "actual-export.json"
        command = [sys.executable, "-I", "-B", str(script), "export", str(folder), "--out", str(destination)]
        if no_zones:
            command = [sys.executable, "-I", "-B", "-c",
                       "import runpy,sys,zoneinfo; zoneinfo.available_timezones=lambda:set(); "
                       "sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')",
                       str(script), "export", str(folder), "--out", str(destination)]
        proc = subprocess.run(command, capture_output=True, text=True)
        payload = json.loads(destination.read_text()) if destination.exists() else None
        accepted = proc.returncode == 0 and payload is not None
        passed = ((accepted if expected == "accept" else proc.returncode == 1 and payload is None)
                  and "Traceback" not in proc.stderr)
        if predicate:
            passed = passed and predicate(proc, payload)
        item = dict(case=name, expected=expected, passed=bool(passed), cli_exit=proc.returncode,
                    wrote_export=payload is not None, stdout=proc.stdout, stderr=proc.stderr)
        (folder / "cli.stdout").write_text(proc.stdout)
        (folder / "cli.stderr").write_text(proc.stderr)
        results.append(item)
        print(json.dumps({key: item[key] for key in ("case", "passed", "cli_exit", "wrote_export")}))

    run("baseline", lambda f: None, "accept")
    run("self-report-contact-interview", lambda f: edit(
        f, "timeline", "SYN-A-W-E03", source_ids="SYN-A-W-S2", time_basis="unknown",
        observed_time="", observed_source_id=""), "reject")
    run("self-report-contact-interview-plus-metadata", lambda f: event(
        f, "dozed_off_report", occurrence="self_reported", reported_by="SYN-A-D",
        source_ids="SYN-A-W-S2;SYN-A-W-S4"), "reject")
    run("self-report-own-interview", lambda f: edit(
        f, "timeline", "SYN-A-W-E03", source_ids="SYN-A-W-S1", time_basis="unknown",
        observed_time="", observed_source_id=""), "accept")
    run("self-report-contact-supplied-message", lambda f: edit(
        f, "timeline", "SYN-A-W-E03", source_ids="SYN-A-W-S3"), "accept")

    def nonmessage_account(folder, provider):
        fields, values = rows(folder, "sources")
        row = dict(next(row for row in values if row["source_id"] == "SYN-A-W-S2"))
        row.update(source_id="SYN-A-W-S5", kind="independent_record", provided_by=provider,
                   note_private="SYNTHETIC provider's signed account only, not a message by the other participant")
        values.append(row)
        save(folder, "sources", fields, values)
        event(folder, "dozed_off_report", occurrence="self_reported", reported_by="SYN-A-D",
              source_ids="SYN-A-W-S5")

    run("self-report-contact-nonmessage-account", lambda f: nonmessage_account(f, "SYN-A-C"), "reject")
    run("self-report-own-nonmessage-account-control", lambda f: nonmessage_account(f, "SYN-A-D"), "accept")
    for event_type in ("dozed_off_report", "rest_difficulty", "rest_end", "rest_start",
                       "robbery", "robbery_attempt", "security_concern", "tiredness_report"):
        run("metadata-unknown-" + event_type, lambda f, kind=event_type: event(f, kind), "reject")
    run("metadata-unknown-contact-control", lambda f: event(
        f, "contact_unconfirmed", actor="contact"), "accept")
    run("consent-refusal-private", lambda f: edit(
        f, "participants", "SYN-B-C", consent_share_redacted="no"), "accept",
        lambda p, data: "consent_share_redacted" not in json.dumps(data)
        and "SYN-B-C" not in json.dumps(data)
        and "SYN-B-W" not in [case["case_id"] for case in data["cases"]])
    run("redaction-status-private", lambda f: None, "accept",
        lambda p, data: "redaction_status" not in json.dumps(data))

    def cp1252(folder):
        path = folder / "participants.csv"
        path.write_bytes(path.read_bytes().replace(b"owner_operator", "owner_opérator".encode("cp1252")))

    run("cp1252-diagnostic", cp1252, "reject",
        lambda p, data: "CSV UTF-8" in p.stdout + p.stderr
        and "UnicodeDecodeError" not in p.stderr)

    def locale(folder):
        for participant in ("SYN-B-D", "SYN-B-C"):
            edit(folder, "participants", participant, preferred_language="es-419")

    run("es-419-coverage", locale, "accept", lambda p, data:
        data["coverage"]["languages"].get("es-419") == 2
        and "Spanish (es) not represented" not in data["coverage"]["gaps"])
    redaction = {
        "comma-coordinates": "SYNTHETIC -23,550520, -46,633308",
        "space-coordinates": "SYNTHETIC -23.550520 -46.633308",
        "dms-coordinates": "SYNTHETIC 23°33′02″S 46°38′00″W",
        "short-date": "SYNTHETIC 14/09",
        "portuguese-date": "SYNTHETIC 14 de setembro",
        "lowercase-plate": "SYNTHETIC abc1d23",
        "argentine-plate": "SYNTHETIC AB 123 CD",
        "mexican-plate": "SYNTHETIC ABC-12-34",
        "bare-map-link": "SYNTHETIC maps.app.goo.gl/example",
        "bare-short-link": "SYNTHETIC bit.ly/example",
        "https-link-control": "SYNTHETIC https://example.com",
    }
    for name, text in redaction.items():
        run(name, lambda f, value=text: edit(f, "timeline", "SYN-A-W-E03", note_redacted=value), "reject")

    def identifier(folder, replacement):
        for table in kit.SCHEMA:
            fields, values = rows(folder, table)
            for row in values:
                for key, value in row.items():
                    row[key] = value.replace("SYN-B-C", replacement)
            save(folder, table, fields, values)

    for name, value in [("id-plate", "ABC1D23"), ("id-phone", "D-5511987654321"),
                        ("id-date", "C-2026-09-14")]:
        run(name, lambda f, replacement=value: identifier(f, replacement), "reject")
    run("invalid-id-diagnostic-private", lambda f: identifier(f, "SYNTHETIC PRIVATE NAME"), "reject",
        lambda p, data: "SYNTHETIC PRIVATE NAME" not in p.stdout + p.stderr)

    def complaint_clock(folder):
        fields, values = rows(folder, "sources")
        row = dict(next(row for row in values if row["source_id"] == "SYN-B-W-S4"))
        row.update(source_id="SYN-B-W-S5", evidence_basis="attributed_account",
                   note_private="SYNTHETIC complaint filing clock only")
        values.append(row)
        save(folder, "sources", fields, values)
        edit(folder, "timeline", "SYN-B-W-E04", source_ids="SYN-B-W-S1;SYN-B-W-S4;SYN-B-W-S5",
             observed_source_id="SYN-B-W-S5")

    run("complaint-filing-clock", complaint_clock, "reject")
    run("exclusive-none-channel", lambda f: edit(
        f, "cases", "SYN-A-W", arrangement_channels="none;whatsapp"), "reject")
    run("oversized-csv-diagnostic", lambda f: edit(
        f, "sources", "SYN-A-W-S1", note_private="X" * (csv.field_size_limit() + 1)), "reject")
    run("no-zone-database-export-warning", lambda f: None, "accept",
        lambda p, data: "no time-zone database" in p.stdout + p.stderr, no_zones=True)
    suite_command = [sys.executable, "-I", "-B", "-c",
                     "import sys,unittest,zoneinfo; zoneinfo.available_timezones=lambda:set(); "
                     "sys.path.insert(0,sys.argv[1]); "
                     "suite=unittest.defaultTestLoader.loadTestsFromName("
                     "'test_incident_kit.SyntheticCohortTest.test_fixture_passes_with_only_the_expected_warning'); "
                     "sys.exit(not unittest.TextTestRunner().run(suite).wasSuccessful())",
                     str(archive / "evidence")]
    proc = subprocess.run(suite_command, capture_output=True, text=True)
    results.append(dict(case="author-baseline-without-zone-database", expected="suite pass",
                        passed=proc.returncode == 0, cli_exit=proc.returncode,
                        stdout=proc.stdout, stderr=proc.stderr))
    summary = dict(runtime=sys.version, archive=str(archive), total=len(results),
                   passed=sum(item["passed"] for item in results),
                   failed=[item["case"] for item in results if not item["passed"]], results=results)
    (output / "results.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({key: summary[key] for key in ("total", "passed", "failed")}))
    return int(bool(summary["failed"]))


if __name__ == "__main__":
    sys.exit(main())
