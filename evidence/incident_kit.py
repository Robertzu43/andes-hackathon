#!/usr/bin/env python3
"""Check and export ANDES issue #8 freight trip reconstructions.

Reads the four kit tables (participants, cases, sources, timeline) as CSV files
from one folder. `check` prints errors, warnings, coverage and each case's
claimed intervention window. `export` writes the redacted JSON handoff, and only
for cases whose redaction was reviewed and whose pair agreed to share it.

Standard library only, Python 3.9 or newer:

    python3 evidence/incident_kit.py check evidence/private/<cohort>
    python3 evidence/incident_kit.py export evidence/private/<cohort> --out <file>.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, available_timezones

CONSENT = {"yes", "no", "pending"}
YES_NO_UNKNOWN = {"yes", "no", "unknown"}
REVIEW = {"pending", "confirmed", "corrected", "disputed", "declined"}
CHANNELS = {"whatsapp", "call", "sms", "radio", "location_sharing", "tracking_service", "other", "none", "unknown"}
CONCERNS = {"security", "fatigue", "lost_contact", "breakdown", "crash", "health", "other", "none"}

# A phone or message record can show that someone said they were tired or robbed,
# never that it happened. These event types need an account or corroboration.
SENSITIVE = {"tiredness_report", "dozed_off_report", "security_concern", "robbery_attempt", "robbery"}

# Location or contact metadata can record that the truck stopped. Rest itself is a
# participant-reported state, so these types need an attributed account too.
REST_REPORTS = {"rest_start", "rest_end", "rest_difficulty"}

# Each column maps to the set of values it allows, or to the name of a value
# kind checked in KINDS. A trailing "?" means the cell may be left empty.
SCHEMA = {
    "participants": {
        "participant_id": "id",
        "pair_id": "id",
        "role": {"driver", "contact"},
        "country_of_residence": "country",
        "preferred_language": "language",
        "phone_platform": {"iphone", "android", "other", "unknown"},
        "work_arrangement": {
            "owner_operator", "independent_driver", "fleet_employed", "other", "unknown", "not_applicable",
        },
        "trucks_operated": {"1", "2", "3_or_more", "unknown", "not_applicable"},
        "relationship_to_driver": {
            "family", "fellow_driver", "freight_company", "friend", "other", "unknown", "not_applicable",
        },
        "consent_ref": "private",
        "consent_recording": CONSENT,
        "consent_share_redacted": CONSENT,
    },
    "cases": {
        "case_id": "id",
        "pair_id": "id",
        "trip_kind": {"worrying", "ordinary"},
        "synthetic": {"yes", "no"},
        "concerns": "concerns",
        "trip_countries": "countries",
        "interview_language": "language",
        "load_status": {"loaded", "empty", "mixed", "unknown"},
        "haul_type": {"local", "interurban", "cross_border", "mixed", "unknown"},
        "corridor_label": "text?",
        "connectivity": {"good", "patchy", "none", "mixed", "unknown"},
        "arrangement": "text?",
        "arrangement_channels": "channels",
        "actionable_window": YES_NO_UNKNOWN,
        "someone_available_to_act": YES_NO_UNKNOWN,
        "unmet_problem": YES_NO_UNKNOWN,
        "window_start_event": "id?",
        "window_end_event": "id?",
        "driver_review": REVIEW,
        "contact_review": REVIEW,
        "trace_review": {"pending", "traced", "not_traceable", "inconclusive"},
        "redaction_status": {"not_started", "in_progress", "reviewed"},
    },
    "sources": {
        "source_id": "id",
        "case_id": "id",
        "kind": {
            "interview_driver", "interview_contact", "whatsapp_export", "call_log", "sms",
            "location_history", "tracking_log", "screenshot", "independent_record", "other",
        },
        "provided_by": "id",
        "evidence_basis": {"attributed_account", "independent_observation", "contact_status_only", "unknown"},
        "timestamped_record": {"yes", "no"},
        "source_time_zone": "zone?",
        "storage_ref": "private?",
        "note_private": "private?",
    },
    "timeline": {
        "event_id": "id",
        "case_id": "id",
        "seq": "int",
        "event_type": {
            "trip_start", "rest_start", "rest_end", "rest_difficulty", "checkin_due",
            "message_sent", "message_delivered", "message_read", "call_attempt", "call_connected", "contact_unconfirmed",
            "tiredness_report", "dozed_off_report", "security_concern", "robbery_attempt", "robbery",
            "help_request", "contact_concerned", "decision", "third_party_contacted",
            "assistance_arranged", "missed_opportunity", "arrival", "resolution", "other",
        },
        "actor": {"driver", "contact", "third_party", "system", "unknown"},
        "reported_by": "reporter",
        "occurrence": {"recorded", "self_reported", "reported_second_hand", "suspected", "corroborated", "unknown"},
        "source_ids": "ids",
        "basis_source_id": "id?",
        "basis_note": "text?",
        "time_basis": {"observed", "recalled", "both", "unknown"},
        "observed_time": "time?",
        "observed_source_id": "id?",
        "recalled_earliest": "time?",
        "recalled_latest": "time?",
        "time_zone": "zone?",
        "knew": "text?",
        "conflicts_with": "ids?",
        "note_redacted": "text?",
        "note_private": "private?",
    },
}

INTERVIEW_ROLE = {"interview_driver": "driver", "interview_contact": "contact"}

ID = re.compile(r"(?=.*[A-Z])[A-Z0-9][A-Z0-9-]{1,39}")
COUNTRY = re.compile(r"[A-Z]{2}")
LANGUAGE = re.compile(r"[a-z]{2,3}(-[A-Z]{2})?")
SEQ = re.compile(r"[1-9][0-9]{0,5}")
TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})")

# Exported free text is scanned for these before it leaves the private folder.
# Names and places cannot be caught this way; the redaction review covers them.
CLOCK_TIMES = re.compile(r"\b\d{1,2}:\d{2}(:\d{2})?\b")
IDENTIFIERS = [
    ("a calendar date", re.compile(r"\d{4}-\d{2}-\d{2}|\b\d{1,2}/\d{1,2}/\d{2,4}\b")),
    ("an email address", re.compile(r"[\w.%+-]+@[\w-]+(\.[\w-]+)+")),
    ("a link", re.compile(r"https?://|www\.", re.IGNORECASE)),
    ("coordinates", re.compile(r"-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}")),
    ("a phone number", re.compile(r"\+?\d(?:[\s().-]?\d){6,}")),
    ("a vehicle plate", re.compile(r"\b[A-Z]{3}[- ]?\d[A-Z0-9]\d{1,2}\b")),
]

ZONES = available_timezones()

CAVEAT = (
    "Exploratory reconstruction of a small cohort. It cannot show prevalence, regional "
    "demand or safety efficacy. Recalled times are memories; only observed times come "
    "from records. No reply alone leaves the incident unknown; it does not establish "
    "a suspicion of fatigue, sleep or robbery. A filed complaint alone does not corroborate its allegation."
)


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, where: str, message: str) -> None:
        self.errors.append(f"{where}: {message}")

    def warn(self, where: str, message: str) -> None:
        self.warnings.append(f"{where}: {message}")


def split(value: str) -> list[str]:
    return [part.strip() for part in value.split(";") if part.strip()]


def parse_time(value: str) -> datetime | None:
    """Parse an ISO 8601 time that carries its UTC offset; None otherwise."""
    if not TIME.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def minutes(span: timedelta) -> int:
    return int(span.total_seconds() // 60)


def seq_key(event: dict) -> int:
    return int(event["seq"]) if SEQ.fullmatch(event["seq"]) else sys.maxsize


def find_identifier(text: str) -> str | None:
    plain = CLOCK_TIMES.sub(" ", text)
    for label, pattern in IDENTIFIERS:
        if pattern.search(plain):
            return f"seems to contain {label}; redact it before export"
    return None


def _pattern(pattern: re.Pattern, problem: str):
    return lambda value: None if pattern.fullmatch(value) else problem


def _member(allowed: set):
    return lambda value: None if value in allowed else "must use " + ", ".join(sorted(allowed))


_id = _pattern(ID, "must use capital letters, digits and hyphens, with at least one letter")
_country = _pattern(COUNTRY, "must be a two-letter country code such as BR")

KINDS = {
    "id": _id,
    "ids": _id,
    "reporter": lambda v: None if v == "record" else _id(v),
    "country": _country,
    "countries": _country,
    "language": _pattern(LANGUAGE, "must be a language tag such as es or pt-BR"),
    "channels": _member(CHANNELS),
    "concerns": _member(CONCERNS),
    "int": _pattern(SEQ, "must be a whole number from 1"),
    "time": lambda v: None if parse_time(v) else (
        "must be a date and time with its UTC offset, such as 2026-09-14T21:40-03:00"
    ),
    "zone": lambda v: None if v == "unknown" or not ZONES or v in ZONES else (
        "must be an IANA time zone such as America/Sao_Paulo, or unknown"
    ),
    "text": find_identifier,
    "private": lambda v: None,
}
LISTS = {"ids", "countries", "channels", "concerns"}


def check_cell(report: Report, where: str, column: str, spec, value: str) -> None:
    if isinstance(spec, set):
        if value not in spec:
            report.error(where, f"{column} must be one of {', '.join(sorted(spec))} (found '{value}')")
        return
    kind = spec.rstrip("?")
    items = split(value) if kind in LISTS else ([value] if value else [])
    if not items:
        if not spec.endswith("?"):
            report.error(where, f"{column} is required")
        return
    for item in items:
        problem = KINDS[kind](item)
        if problem:
            # Never echo free text back: it is the part that may hold an identifier.
            shown = "" if kind == "text" else f" (found '{item}')"
            report.error(where, f"{column} {problem}{shown}")


def read_tables(folder: Path, report: Report) -> dict[str, list[dict]]:
    tables: dict[str, list[dict]] = {}
    for table, columns in SCHEMA.items():
        path = folder / f"{table}.csv"
        tables[table] = rows = []
        if not path.is_file():
            report.error(path.name, "file not found")
            continue
        with path.open(newline="", encoding="utf-8-sig") as handle:
            first_line = handle.readline()
            handle.seek(0)
            # Spanish and Portuguese spreadsheet locales often save CSV with ";".
            delimiter = ";" if ";" in first_line and "," not in first_line else ","
            reader = csv.DictReader(handle, delimiter=delimiter)
            header = [name.strip() for name in reader.fieldnames or []]
            missing = [name for name in columns if name not in header]
            if missing:
                report.error(path.name, "missing columns: " + ", ".join(missing))
                continue
            extra = [name for name in header if name and name not in columns]
            if extra:
                report.warn(path.name, "extra columns are ignored and never exported: " + ", ".join(extra))
            for raw in reader:
                cells = {key.strip(): (value or "").strip() for key, value in raw.items() if isinstance(key, str)}
                row = {name: cells.get(name, "") for name in columns}
                if not any(row.values()):
                    continue
                key = row[next(iter(columns))]
                row["_where"] = f"{path.name} line {reader.line_num}" + (f" ({key})" if key else "")
                if raw.get(None):
                    report.error(row["_where"], "row has more cells than the header")
                rows.append(row)
                for name, spec in columns.items():
                    check_cell(report, row["_where"], name, spec, row[name])
    return tables


def index(rows: list[dict], key: str, report: Report) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for row in rows:
        if row[key] in found:
            report.error(row["_where"], f"duplicate {key} {row[key]}")
        elif row[key]:
            found[row[key]] = row
    return found


def check_people(data: dict, report: Report) -> dict[str, list[dict]]:
    pairs: dict[str, list[dict]] = defaultdict(list)
    for person in data["people"].values():
        pairs[person["pair_id"]].append(person)
        where, driver = person["_where"], person["role"] == "driver"
        for column in ("work_arrangement", "trucks_operated", "relationship_to_driver"):
            # Truck details describe the driver; the relationship describes the contact.
            applies = driver != (column == "relationship_to_driver")
            if (person[column] == "not_applicable") == applies:
                report.error(where, f"{column} must {'be given' if applies else 'be not_applicable'} "
                                    f"for a {person['role']}")
        if driver and (person["work_arrangement"] == "fleet_employed" or person["trucks_operated"] == "3_or_more"):
            report.warn(where, "driver is outside the owner-operator segment of one or two trucks")
    for pair_id, members in sorted(pairs.items()):
        roles = Counter(member["role"] for member in members)
        trip_kinds = {case["trip_kind"] for case in data["cases"].values() if case["pair_id"] == pair_id}
        for role in ("driver", "contact"):
            if roles[role] > 1:
                report.error(f"pair {pair_id}", f"has {roles[role]} {role}s; a pair is one driver and one contact")
            elif not roles[role]:
                report.warn(f"pair {pair_id}", f"has no {role} enrolled")
        for kind in ("worrying", "ordinary"):
            if kind not in trip_kinds:
                report.warn(f"pair {pair_id}", f"has no {kind}-trip case")
    return dict(pairs)


def in_pair(data: dict, participant_id: str, case: dict) -> bool:
    person = data["people"].get(participant_id)
    return bool(person) and person["pair_id"] == case["pair_id"]


def check_sources(data: dict, report: Report) -> None:
    for source in data["sources"].values():
        where = source["_where"]
        case = data["cases"].get(source["case_id"])
        if not case:
            report.error(where, f"case_id {source['case_id']} is not in cases.csv")
            continue
        interview_role = INTERVIEW_ROLE.get(source["kind"])
        if not in_pair(data, source["provided_by"], case):
            report.error(where, f"provided_by {source['provided_by']} is not a participant in pair {case['pair_id']}")
        elif interview_role and data["people"][source["provided_by"]]["role"] != interview_role:
            report.error(where, f"{source['kind']} must be provided by the pair's {interview_role}")
        if interview_role and source["timestamped_record"] == "yes":
            report.error(where, "an interview is an account; set timestamped_record to no")
        if interview_role and source["evidence_basis"] != "attributed_account":
            report.error(where, "an interview needs evidence_basis attributed_account")
        if source["evidence_basis"] == "independent_observation" and source["kind"] != "independent_record":
            report.error(where, "independent_observation needs kind independent_record")
        if source["kind"] in {"call_log", "location_history", "tracking_log"} and source["evidence_basis"] == "attributed_account":
            report.error(where, "contact or location metadata alone is not an attributed account")
        if source["timestamped_record"] == "yes" and not source["source_time_zone"]:
            report.error(where, "source_time_zone is required for a timestamped record (IANA name or unknown)")


def check_events(data: dict, report: Report) -> None:
    by_case: dict[str, list[dict]] = defaultdict(list)
    for event in data["events"].values():
        where = event["_where"]
        case = data["cases"].get(event["case_id"])
        if not case:
            report.error(where, f"case_id {event['case_id']} is not in cases.csv")
            continue
        by_case[event["case_id"]].append(event)
        cited = []
        for source_id in split(event["source_ids"]):
            source = data["sources"].get(source_id)
            if not source:
                report.error(where, f"source {source_id} is not in sources.csv")
            elif source["case_id"] != event["case_id"]:
                report.error(where, f"source {source_id} belongs to case {source['case_id']}")
            else:
                cited.append(source)
        reporter = data["people"].get(event["reported_by"])
        if event["reported_by"] != "record" and not in_pair(data, event["reported_by"], case):
            report.error(where, f"reported_by {event['reported_by']} is not a participant in pair {case['pair_id']}")
        check_occurrence(event, reporter, cited, report)
        check_times(event, cited, report)
        for other in split(event["conflicts_with"]):
            if other == event["event_id"]:
                report.error(where, "an event cannot conflict with itself")
            elif other not in data["events"]:
                report.error(where, f"conflicts_with {other} is not in timeline.csv")
            elif data["events"][other]["case_id"] != event["case_id"]:
                report.error(where, f"conflicts_with {other} belongs to another case")
    for case_id, events in by_case.items():
        check_order(case_id, events, report)


def check_occurrence(event: dict, reporter: dict | None, cited: list[dict], report: Report) -> None:
    """Keep records, accounts, suspicions and independent corroboration apart."""
    where, occurrence, event_type = event["_where"], event["occurrence"], event["event_type"]
    basis = next((s for s in cited if s["source_id"] == event["basis_source_id"]), None)
    if event["basis_source_id"] and basis is None:
        report.error(where, "basis_source_id must also be listed in source_ids from this case")
    if occurrence in {"suspected", "corroborated"}:
        for column in ("basis_source_id", "basis_note"):
            if not event[column]:
                report.error(where, f"{occurrence} needs {column}")
    if event_type == "contact_unconfirmed" and occurrence != "unknown":
        report.error(where, "contact_unconfirmed must keep occurrence unknown; record any attributed concern separately")
    if occurrence == "recorded":
        if event_type in SENSITIVE:
            report.error(where, f"a phone or message record cannot show {event_type}; use self_reported, "
                                "reported_second_hand, suspected or corroborated")
        if event_type in REST_REPORTS:
            report.error(where, f"{event_type} needs a participant account; location or contact metadata "
                                "can only record a stop")
        if not any(source["timestamped_record"] == "yes" for source in cited):
            report.error(where, "occurrence recorded needs a cited timestamped record")
    elif occurrence == "self_reported":
        if not reporter:
            report.error(where, "self_reported needs the participant whose account it is in reported_by")
        elif event["actor"] not in ("driver", "contact"):
            report.error(where, "self_reported needs the driver or contact as actor; use reported_second_hand")
        elif reporter["role"] != event["actor"]:
            report.error(where, f"{reporter['participant_id']} is reporting the {event['actor']}'s experience; "
                                "use reported_second_hand")
        if not any(source["evidence_basis"] == "attributed_account" for source in cited):
            report.error(where, "self_reported needs a cited attributed account")
    elif occurrence == "reported_second_hand":
        if not reporter:
            report.error(where, "reported_second_hand needs the participant repeating the account in reported_by")
        elif reporter["role"] == event["actor"]:
            report.error(where, f"{reporter['participant_id']} is reporting their own experience; use self_reported")
        if not any(source["evidence_basis"] == "attributed_account" for source in cited):
            report.error(where, "reported_second_hand needs a cited attributed account")
    elif occurrence == "suspected":
        if not reporter:
            report.error(where, "a suspicion needs the participant who held it in reported_by")
        if not basis or basis["evidence_basis"] != "attributed_account" or basis["provided_by"] != event["reported_by"]:
            report.error(where, "suspicion needs a cited account supplied by the participant; no reply alone stays unknown")
    elif occurrence == "corroborated":
        if not any(source["kind"] == "independent_record" for source in cited):
            report.error(where, "occurrence corroborated needs a cited independent_record")
        if not basis or basis["kind"] != "independent_record" or basis["evidence_basis"] != "independent_observation":
            report.error(where, "corroboration needs independent observations supporting this event; "
                                "a filed complaint repeating an allegation is an attributed account")


def check_times(event: dict, cited: list[dict], report: Report) -> None:
    where, basis = event["_where"], event["time_basis"]
    observed = basis in ("observed", "both")
    recalled = basis in ("recalled", "both")
    must = "be given" if observed else "be empty"
    if bool(event["observed_time"]) != observed:
        report.error(where, f"observed_time must {must} when time_basis is {basis}")
    if bool(event["observed_source_id"]) != observed:
        report.error(where, f"observed_source_id must {must} when time_basis is {basis}")
    if recalled and not (event["recalled_earliest"] and event["recalled_latest"]):
        report.error(where, f"recalled_earliest and recalled_latest are required when time_basis is {basis} "
                            "(repeat the time for a single moment)")
    elif not recalled and (event["recalled_earliest"] or event["recalled_latest"]):
        report.error(where, f"recalled times must be empty when time_basis is {basis}")

    if observed and event["observed_source_id"]:
        source = next((s for s in cited if s["source_id"] == event["observed_source_id"]), None)
        if source is None:
            report.error(where, "observed_source_id must also be listed in source_ids")
        elif source["timestamped_record"] != "yes":
            report.error(where, f"observed times need a timestamped record; {source['source_id']} is an account")
        elif source["source_time_zone"] == "unknown":
            report.warn(where, f"observed time comes from {source['source_id']}, whose clock zone is unknown")
    if recalled:
        if event["reported_by"] == "record":
            report.error(where, "recalled times need the participant who recalled them in reported_by")
        if not any(source["timestamped_record"] == "no" and source["provided_by"] == event["reported_by"] and
                   source["evidence_basis"] == "attributed_account" for source in cited):
            report.error(where, "recalled times need the named participant's own attributed account "
                                "(an untimestamped source)")
        earliest, latest = parse_time(event["recalled_earliest"]), parse_time(event["recalled_latest"])
        if earliest and latest and earliest > latest:
            report.error(where, "recalled_earliest is after recalled_latest")

    given = [(column, parse_time(event[column]))
             for column in ("observed_time", "recalled_earliest", "recalled_latest") if event[column]]
    zone = event["time_zone"]
    if given and not zone:
        report.error(where, "time_zone is required when a time is given (IANA name or unknown)")
    elif given and zone in ZONES:
        for column, moment in given:
            if moment and moment.utcoffset() != moment.astimezone(ZoneInfo(zone)).utcoffset():
                expected = moment.astimezone(ZoneInfo(zone)).strftime("%z")
                report.error(where, f"{column} offset does not match {zone}, which was at "
                                    f"{expected[:3]}:{expected[3:]} at that moment")


def check_order(case_id: str, events: list[dict], report: Report) -> None:
    for seq, count in Counter(event["seq"] for event in events).items():
        if count > 1:
            report.error(f"case {case_id}", f"seq {seq} is used {count} times")
    latest = None
    for event in sorted(events, key=seq_key):
        moment = parse_time(event["observed_time"])
        if moment is None:
            continue
        if latest and moment < latest[1]:
            report.warn(event["_where"], f"observed_time is earlier than {latest[0]}, which comes first in seq "
                                         "(clock difference or ordering error?)")
        else:
            latest = (event["event_id"], moment)


def time_range(event: dict) -> tuple[datetime, datetime] | None:
    """Earliest and latest instant an event can have happened, if known."""
    if event["time_basis"] in ("observed", "both"):
        moment = parse_time(event["observed_time"])
        return (moment, moment) if moment else None
    if event["time_basis"] == "recalled":
        earliest, latest = parse_time(event["recalled_earliest"]), parse_time(event["recalled_latest"])
        return (earliest, latest) if earliest and latest else None
    return None


def check_cases(data: dict, report: Report) -> None:
    for case in data["cases"].values():
        where, start_id, end_id = case["_where"], case["window_start_event"], case["window_end_event"]
        if case["pair_id"] not in data["pairs"]:
            report.error(where, f"pair_id {case['pair_id']} has no enrolled participants")
        if "none" in split(case["concerns"]) and len(split(case["concerns"])) > 1:
            report.error(where, "concerns cannot combine none with other values")
        if bool(start_id) != bool(end_id):
            report.error(where, "give both window_start_event and window_end_event, or neither")
            continue
        if case["actionable_window"] == "yes" and not start_id:
            report.error(where, "actionable_window is yes, so window_start_event and window_end_event are required")
        if case["actionable_window"] == "no" and start_id:
            report.error(where, "a window is claimed but actionable_window is no")
        if not start_id:
            continue
        ends = []
        for event_id in (start_id, end_id):
            event = data["events"].get(event_id)
            if not event or event["case_id"] != case["case_id"]:
                report.error(where, f"window event {event_id} is not in this case's timeline")
            else:
                ends.append(event)
        if len(ends) < 2:
            continue
        start, end = ends
        if seq_key(start) >= seq_key(end):
            report.error(where, "window_start_event must come before window_end_event in seq")
        first, last = time_range(start), time_range(end)
        if first and last and last[1] < first[0]:
            report.error(where, "the window ends before it starts")


def check(folder) -> tuple[dict, Report]:
    """Validate one cohort folder. Returns the indexed tables and the report."""
    report = Report()
    if not ZONES:
        report.warn("time zones", "no time-zone database found, so zone names and offsets were not checked")
    tables = read_tables(Path(folder), report)
    data = {
        "people": index(tables["participants"], "participant_id", report),
        "cases": index(tables["cases"], "case_id", report),
        "sources": index(tables["sources"], "source_id", report),
        "events": index(tables["timeline"], "event_id", report),
    }
    data["pairs"] = check_people(data, report)
    check_sources(data, report)
    check_events(data, report)
    check_cases(data, report)
    return data, report


def export_blockers(case: dict, members: list[dict]) -> list[str]:
    reasons = []
    if case["redaction_status"] != "reviewed":
        reasons.append(f"redaction_status is {case['redaction_status']}")
    # Incomplete enrollment is allowed during collection, but cannot establish
    # consent from both people required for a redacted handoff.
    roles = {person["role"] for person in members}
    for role in ("driver", "contact"):
        if role not in roles:
            reasons.append(f"no {role} enrolled")
    for person in sorted(members, key=lambda p: p["participant_id"]):
        if person["consent_share_redacted"] != "yes":
            reasons.append(f"{person['participant_id']} consent_share_redacted is {person['consent_share_redacted']}")
    return reasons


def window_export(case: dict, events: dict[str, dict]) -> dict | None:
    if not case["window_start_event"]:
        return None
    start, end = events[case["window_start_event"]], events[case["window_end_event"]]
    first, last = time_range(start), time_range(end)
    duration = None
    if first and last:
        duration = {"min": max(0, minutes(last[0] - first[1])), "max": minutes(last[1] - first[0])}
    return {
        "start_event": start["event_id"],
        "end_event": end["event_id"],
        "start_basis": start["time_basis"],
        "end_basis": end["time_basis"],
        "duration_min": duration,
        "traceable_to_records": all(e["time_basis"] in ("observed", "both") for e in (start, end)),
    }


def recall_gap(observed: datetime, earliest: datetime, latest: datetime) -> int:
    """Minutes the record falls outside the recalled window: negative if earlier, 0 inside."""
    if observed < earliest:
        return -minutes(earliest - observed)
    if observed > latest:
        return minutes(observed - latest)
    return 0


def case_export(case: dict, data: dict) -> dict:
    events = sorted((e for e in data["events"].values() if e["case_id"] == case["case_id"]), key=seq_key)
    sources = sorted((s for s in data["sources"].values() if s["case_id"] == case["case_id"]),
                     key=lambda s: s["source_id"])
    times = [parse_time(e[column]) for e in events
             for column in ("observed_time", "recalled_earliest", "recalled_latest") if e[column]]
    anchor = min(times) if times else None

    def offset(value: str) -> int | None:
        return minutes(parse_time(value) - anchor) if value and anchor else None

    conflicts: dict[str, set] = defaultdict(set)
    for event in events:
        for other in split(event["conflicts_with"]):
            conflicts[event["event_id"]].add(other)
            conflicts[other].add(event["event_id"])

    exported_events = []
    for event in events:
        recalled = event["time_basis"] in ("recalled", "both")
        gap = None
        if event["time_basis"] == "both":
            gap = recall_gap(*(parse_time(event[c]) for c in ("observed_time", "recalled_earliest", "recalled_latest")))
        exported_events.append({
            "event_id": event["event_id"],
            "seq": int(event["seq"]),
            "event_type": event["event_type"],
            "actor": event["actor"],
            "reported_by": event["reported_by"],
            "occurrence": event["occurrence"],
            "source_ids": split(event["source_ids"]),
            "basis_source_id": event["basis_source_id"] or None,
            "basis_note": event["basis_note"] or None,
            "time_basis": event["time_basis"],
            "time_zone": event["time_zone"] or None,
            "observed_offset_min": offset(event["observed_time"]),
            "observed_source_id": event["observed_source_id"] or None,
            "recalled_offset_min": {
                "earliest": offset(event["recalled_earliest"]),
                "latest": offset(event["recalled_latest"]),
            } if recalled else None,
            "recall_gap_min": gap,
            "conflicts_with": sorted(conflicts[event["event_id"]]),
            "knew": event["knew"] or None,
            "note": event["note_redacted"] or None,
        })

    return {
        "case_id": case["case_id"],
        "pair_id": case["pair_id"],
        "synthetic": case["synthetic"] == "yes",
        "trip_kind": case["trip_kind"],
        "concerns": split(case["concerns"]),
        "trip_countries": split(case["trip_countries"]),
        "interview_language": case["interview_language"],
        "load_status": case["load_status"],
        "haul_type": case["haul_type"],
        "corridor_label": case["corridor_label"] or None,
        "connectivity": case["connectivity"],
        "arrangement": case["arrangement"] or None,
        "arrangement_channels": split(case["arrangement_channels"]),
        "actionable_window": case["actionable_window"],
        "someone_available_to_act": case["someone_available_to_act"],
        "unmet_problem": case["unmet_problem"],
        "reviews": {
            "driver": case["driver_review"],
            "contact": case["contact_review"],
            "trace": case["trace_review"],
        },
        "anchor_local_hour": anchor.hour if anchor else None,
        "window": window_export(case, data["events"]),
        "sources": [{
            "source_id": source["source_id"],
            "kind": source["kind"],
            "provided_by": source["provided_by"],
            "evidence_basis": source["evidence_basis"],
            "timestamped_record": source["timestamped_record"] == "yes",
            "source_time_zone": source["source_time_zone"] or None,
        } for source in sources],
        "events": exported_events,
    }


def coverage(people: list[dict], cases: list[dict]) -> dict:
    def count(rows: list[dict], column: str) -> dict[str, int]:
        return dict(sorted(Counter(row[column] for row in rows).items()))

    languages, platforms = count(people, "preferred_language"), count(people, "phone_platform")
    concerns = dict(sorted(Counter(c for case in cases for c in split(case["concerns"])).items()))
    gaps = []
    if not any(tag == "es" or tag.startswith("es-") for tag in languages):
        gaps.append("Spanish (es) not represented")
    if "pt-BR" not in languages:
        gaps.append("Brazilian Portuguese (pt-BR) not represented")
    for platform, label in (("iphone", "iPhone"), ("android", "Android")):
        if platform not in platforms:
            gaps.append(f"{label} not represented")
    for concern, label in (("security", "security or robbery"), ("fatigue", "fatigue")):
        if concern not in concerns:
            gaps.append(f"no {label} case")
    return {
        "participants": len(people),
        "countries": count(people, "country_of_residence"),
        "languages": languages,
        "phone_platforms": platforms,
        "trucks_operated": count([p for p in people if p["role"] == "driver"], "trucks_operated"),
        "concerns": concerns,
        "gaps": gaps,
    }


def export(folder) -> tuple[dict | None, Report]:
    """Build the redacted handoff. Returns None when the folder has errors."""
    data, report = check(folder)
    if report.errors:
        return None, report
    ready, excluded = [], []
    for case_id, case in sorted(data["cases"].items()):
        reasons = export_blockers(case, data["pairs"][case["pair_id"]])
        if reasons:
            excluded.append({"case_id": case_id, "reasons": reasons})
        else:
            ready.append(case)
    pair_ids = sorted({case["pair_id"] for case in ready})
    people = sorted((p for pair_id in pair_ids for p in data["pairs"][pair_id]), key=lambda p: p["participant_id"])
    return {
        "format": "andes-incident-export",
        "format_version": 1,
        "issue": 8,
        "caveat": CAVEAT,
        "coverage": {"pairs": len(pair_ids), "cases": len(ready), **coverage(people, ready)},
        "participants": [{
            column: p[column] for column in (
                "participant_id", "pair_id", "role", "country_of_residence", "preferred_language",
                "phone_platform", "work_arrangement", "trucks_operated", "relationship_to_driver",
            )
        } for p in people],
        "cases": [case_export(case, data) for case in ready],
        "excluded_cases": excluded,
    }, report


def summary(folder, data: dict, report: Report) -> str:
    lines = [
        f"ANDES #8 check: {folder}",
        f"{len(data['people'])} participants in {len(data['pairs'])} pairs, {len(data['cases'])} cases, "
        f"{len(data['sources'])} sources, {len(data['events'])} events",
        "",
        f"Errors: {len(report.errors)}",
        *("  " + line for line in report.errors),
        f"Warnings: {len(report.warnings)}",
        *("  " + line for line in report.warnings),
    ]
    if report.errors:
        lines += ["", "Fix the errors before reading coverage and windows or exporting."]
        return "\n".join(lines)
    cov = coverage(list(data["people"].values()), list(data["cases"].values()))

    def listed(counts: dict[str, int]) -> str:
        return ", ".join(f"{key}={value}" for key, value in counts.items()) or "none"

    lines += [
        "",
        "Coverage (exploratory; cannot show prevalence, regional demand or efficacy)",
        "  countries: " + listed(cov["countries"]),
        "  languages: " + listed(cov["languages"]),
        "  phone platforms: " + listed(cov["phone_platforms"]),
        "  trucks operated by drivers: " + listed(cov["trucks_operated"]),
        "  case concerns: " + listed(cov["concerns"]),
        "  gaps: " + ("; ".join(cov["gaps"]) or "none"),
        "",
        "Cases",
    ]
    for case_id, case in sorted(data["cases"].items()):
        window = window_export(case, data["events"])
        if window is None:
            claimed = "no window claimed"
        else:
            span = window["duration_min"]
            claimed = (f"window {span['min']}-{span['max']} min" if span else "window duration unknown") + (
                f" (start {window['start_basis']}, end {window['end_basis']}"
                + ("" if window["traceable_to_records"] else ", not fully traceable to records") + ")")
        blockers = export_blockers(case, data["pairs"][case["pair_id"]])
        lines.append(
            f"  {case_id} {case['trip_kind']}: {claimed}; reviews driver {case['driver_review']}, "
            f"contact {case['contact_review']}, trace {case['trace_review']}; export "
            + ("ready" if not blockers else "blocked: " + "; ".join(blockers)))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check or export ANDES issue #8 freight trip reconstructions.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="report errors, warnings, coverage and windows").add_argument("folder")
    export_command = commands.add_parser("export", help="write the redacted JSON handoff")
    export_command.add_argument("folder")
    export_command.add_argument("--out", required=True, help="JSON file to write")
    args = parser.parse_args(argv)

    if args.command == "check":
        data, report = check(args.folder)
        print(summary(args.folder, data, report))
        return 1 if report.errors else 0

    result, report = export(args.folder)
    if result is None:
        print("Export refused. Fix these errors first:", *report.errors, sep="\n  ", file=sys.stderr)
        return 1
    try:
        Path(args.out).write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except OSError as problem:
        print(f"Could not write {args.out}: {problem}", file=sys.stderr)
        return 1
    print(f"Wrote {len(result['cases'])} case(s) to {args.out}; excluded {len(result['excluded_cases'])}.")
    for item in result["excluded_cases"]:
        print(f"  excluded {item['case_id']}: {'; '.join(item['reasons'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
