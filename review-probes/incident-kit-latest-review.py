#!/usr/bin/env python3
"""Synthetic CLI controls for Robert review5560681899; archive and fresh output args."""
import csv
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    archive, output = map(lambda value: Path(value).resolve(), sys.argv[1:])
    output.mkdir(parents=True, exist_ok=True)
    script = archive / "evidence/incident_kit.py"
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("reviewed_kit", script)
    kit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kit)
    results = []

    def read(folder, table):
        with (folder / (table + ".csv")).open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            return reader.fieldnames, list(reader)

    def save(folder, table, fields, values):
        with (folder / (table + ".csv")).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(values)

    def edit(folder, table, key, **changes):
        fields, values = read(folder, table)
        targets = [row for row in values if row[fields[0]] == key]
        assert len(targets) == 1
        targets[0].update(changes)
        save(folder, table, fields, values)

    def run(name, mutate, accepted, cp1252=False, discard_table=False, secret=None):
        folder = output / name
        shutil.copytree(archive / "evidence/fixtures/synthetic", folder)
        mutate(folder)
        args = [str(script), "check", str(folder)]
        command = [sys.executable, "-I", "-B", *args]
        if cp1252:
            # -I ignores PYTHONIOENCODING, so force the equivalent stream encoding
            # explicitly and print its value to prove this control is effective.
            command = [sys.executable, "-I", "-B", "-c",
                       "import runpy,sys;sys.stdout.reconfigure(encoding='cp1252');"
                       "sys.stderr.reconfigure(encoding='cp1252');"
                       "print('encoding='+sys.stdout.encoding,file=sys.stderr);"
                       "sys.argv=sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')", *args]
        proc = subprocess.run(command, capture_output=True)
        encoding = "cp1252" if cp1252 else "utf-8"
        stdout, stderr = proc.stdout.decode(encoding), proc.stderr.decode(encoding)
        passed = proc.returncode == (0 if accepted else 1) and "Traceback" not in stderr
        if cp1252:
            passed = passed and "encoding=cp1252" in stderr and "CSV UTF-8" in stdout
        if secret:
            passed = passed and secret not in stdout + stderr
        retained = None
        if discard_table:
            report = kit.Report()
            tables = kit.read_tables(folder, report)
            retained = len(tables["participants"])
            passed = passed and retained == 0 and bool(report.errors) and "0 participants" in stdout
        item = dict(case=name, expected_accept=accepted, passed=bool(passed), cli_exit=proc.returncode,
                    partial_rows_retained=retained, stdout=stdout, stderr=stderr)
        results.append(item)
        print(json.dumps({key: item[key] for key in ("case", "passed", "cli_exit", "partial_rows_retained")}))

    def secondhand(folder, kind, provider):
        fields, values = read(folder, "sources")
        row = dict(values[0])
        row.update(source_id="SYN-A-W-S5", kind=kind, provided_by=provider,
                   evidence_basis="attributed_account", timestamped_record="no", source_time_zone="")
        values.append(row)
        save(folder, "sources", fields, values)
        edit(folder, "timeline", "SYN-A-W-E10", event_type="dozed_off_report", actor="driver",
             reported_by="SYN-A-C", occurrence="reported_second_hand", source_ids="SYN-A-W-S5",
             time_basis="unknown", observed_time="", observed_source_id="")

    for name, kind, provider, expected in [
        ("secondhand-other-person-interview", "interview_driver", "SYN-A-D", False),
        ("secondhand-own-interview", "interview_contact", "SYN-A-C", True),
        ("secondhand-other-person-nonmessage", "other", "SYN-A-D", False),
        ("secondhand-own-nonmessage", "other", "SYN-A-C", True),
        ("secondhand-contact-words-supplied-by-driver-message", "sms", "SYN-A-D", True),
    ]:
        run(name, lambda folder, k=kind, p=provider: secondhand(folder, k, p), expected)

    def cp_input(folder):
        path = folder / "participants.csv"
        path.write_bytes(path.read_bytes().replace(b"owner_operator", "owner_opérator".encode("cp1252")))

    run("cp1252-input-and-stdout", cp_input, False, cp1252=True)

    def late_error(folder, mode):
        fields, values = read(folder, "participants")
        base = dict(values[0])
        padded = []
        for index in range(100):
            row = dict(base)
            row.update(participant_id="P%03d-D" % index, pair_id="P%03d" % index,
                       consent_ref="SYNTHETIC " + "x" * 600)
            padded.append(row)
        save(folder, "participants", fields, padded)
        path = folder / "participants.csv"
        assert path.stat().st_size > 32768
        with path.open("ab") as handle:
            handle.write(b"\xff\n" if mode == "decode" else b'"unterminated')

    run("late-decode-discards-earlier-rows", lambda f: late_error(f, "decode"), False, discard_table=True)
    run("late-csv-error-discards-earlier-rows", lambda f: late_error(f, "csv"), False, discard_table=True)
    run("non-ascii-numeric-region", lambda f: edit(f, "participants", "SYN-B-D", preferred_language="es-٤١٩"), False)
    run("ascii-numeric-region-control", lambda f: edit(f, "participants", "SYN-B-D", preferred_language="es-419"), True)

    def duplicate_private_id(folder):
        fields, values = read(folder, "participants")
        for row in values[:2]:
            row["participant_id"] = "SYNTHETIC PRIVATE NAME"
        save(folder, "participants", fields, values)

    run("duplicate-invalid-id-does-not-echo", duplicate_private_id, False, secret="SYNTHETIC PRIVATE NAME")
    summary = dict(runtime=sys.version, archive=str(archive), total=len(results),
                   passed=sum(item["passed"] for item in results),
                   failed=[item["case"] for item in results if not item["passed"]], results=results)
    (output / "results.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({key: summary[key] for key in ("total", "passed", "failed")}))
    return int(bool(summary["failed"]))


if __name__ == "__main__":
    sys.exit(main())
