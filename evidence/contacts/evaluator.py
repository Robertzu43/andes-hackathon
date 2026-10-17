"""Offline synthetic reference contract for #15; never releases data or sends messages."""

import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import sys


FIELDS = {"status_uncertainty", "last_observation", "observation_age", "truck_reference"}
CHANNELS = {"whatsapp", "sms", "voice"}
CONSENTS = {"missing", "granted", "revoked"}
ANSWERS = {"yes", "no", "unknown"}
ACTIONS = {"none", "planned", "attempted", "reported", "independently_corroborated"}


class RecordError(ValueError):
    """An incomplete or malformed synthetic record cannot be evaluated."""


def _object(value, keys, path):
    if not isinstance(value, dict) or set(value) != set(keys.split()):
        raise RecordError(f"{path}: expected exactly {keys}")


def _enum(value, choices, path):
    if not isinstance(value, str) or value not in choices:
        raise RecordError(f"{path}: unsupported value")


def _boolean(value, path):
    if type(value) is not bool:
        raise RecordError(f"{path}: expected boolean")


def _id(value, prefix, path):
    if not isinstance(value, str) or not re.fullmatch(prefix + r"-[A-Z0-9]{1,20}", value):
        raise RecordError(f"{path}: expected surrogate {prefix} ID")


def _list(value, choices, path):
    if not isinstance(value, list):
        raise RecordError(f"{path}: expected array")
    for item in value:
        _enum(item, choices, path)
    if len(value) != len(set(value)):
        raise RecordError(f"{path}: duplicate entries")


def _country(value, path):
    if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[A-Z]{2}", value)):
        raise RecordError(f"{path}: expected two-letter country label or null")


def _language(value, path):
    if value is not None and (
        not isinstance(value, str)
        or not re.fullmatch(r"[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", value)
    ):
        raise RecordError(f"{path}: expected language label or null")


def instant(value):
    if not isinstance(value, str):
        raise RecordError("timestamp: expected ISO 8601 string with timezone")
    # fromisoformat normalises offsets such as +00:99; reject them before parsing.
    if not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
        r"(?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])",
        value,
    ):
        raise RecordError("timestamp: expected YYYY-MM-DDTHH:MM:SS[.ffffff]Z or +/-HH:MM")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RecordError("timestamp: malformed ISO 8601 instant") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise RecordError("timestamp: timezone required")
    return parsed


def validate(record):
    """Validate this fixture format only; text and checked boxes are not human evidence."""
    _object(record, "version evidence_kind trip driver contacts escalation_order links", "record")
    if type(record["version"]) is not int or record["version"] != 1:
        raise RecordError("version: expected 1")
    if record["evidence_kind"] != "synthetic":
        raise RecordError("evidence_kind: this harness accepts synthetic fixtures only")
    trip, driver = record["trip"], record["driver"]
    _object(trip, "id country sharing_state shared_fields", "trip")
    _id(trip["id"], "TRIP", "trip.id")
    _country(trip["country"], "trip.country")
    _enum(trip["sharing_state"], CONSENTS, "trip.sharing_state")
    _list(trip["shared_fields"], FIELDS, "trip.shared_fields")
    _object(driver, "id country preferred_language", "driver")
    _id(driver["id"], "DRIVER", "driver.id")
    _country(driver["country"], "driver.country")
    _language(driver["preferred_language"], "driver.preferred_language")
    if not isinstance(record["contacts"], list):
        raise RecordError("contacts: expected array")
    ids = []
    for contact in record["contacts"]:
        _object(contact, "id state preferred_language phone_number_country channels trip_consent observations", "contact")
        _id(contact["id"], "CONTACT", "contact.id")
        ids.append(contact["id"])
        _enum(contact["state"], {"pending", "accepted", "rejected", "revoked"}, "contact.state")
        _language(contact["preferred_language"], "contact.preferred_language")
        _country(contact["phone_number_country"], "contact.phone_number_country")
        channels = contact["channels"]
        _object(channels, "current preferred verified_reachable", "contact.channels")
        _boolean(channels["current"], "contact.channels.current")
        _list(channels["preferred"], CHANNELS, "contact.channels.preferred")
        _list(channels["verified_reachable"], CHANNELS, "contact.channels.verified_reachable")
        consent = contact["trip_consent"]
        _object(consent, "trip_id driver_state contact_state fields", "contact.trip_consent")
        _id(consent["trip_id"], "TRIP", "consent.trip_id")
        for actor in ("driver_state", "contact_state"):
            _enum(consent[actor], CONSENTS, f"consent.{actor}")
        _list(consent["fields"], FIELDS, "consent.fields")
        obs = contact["observations"]
        _object(obs, "acknowledged response willingness availability role_understood handoff_understood mutual_understanding action_status action_note", "contact.observations")
        if obs["acknowledged"] is not None:
            _boolean(obs["acknowledged"], "observations.acknowledged")
        _enum(obs["response"], {"unknown", "acknowledged", "cannot_assist"}, "observations.response")
        _enum(obs["availability"], {"available", "unavailable", "unknown"}, "observations.availability")
        for key in ("willingness", "role_understood", "handoff_understood", "mutual_understanding"):
            _enum(obs[key], ANSWERS, f"observations.{key}")
        _enum(obs["action_status"], ACTIONS, "observations.action_status")
        note = obs["action_note"]
        if obs["action_status"] == "none":
            if note is not None:
                raise RecordError("action_note: must be null when action_status is none")
        elif not isinstance(note, str) or not note.strip():
            raise RecordError("action_note: a recorded action needs a description")
    if len(ids) != len(set(ids)):
        raise RecordError("contacts: duplicate surrogate IDs")
    _list(record["escalation_order"], set(ids), "escalation_order")
    if set(record["escalation_order"]) != set(ids):
        raise RecordError("escalation_order: must include every contact exactly once")
    if not isinstance(record["links"], list):
        raise RecordError("links: expected array")
    link_ids = []
    for link in record["links"]:
        _object(link, "id driver_id trip_id contact_id scope issued_at expires_at revoked", "link")
        for key, prefix in (("id", "LINK"), ("driver_id", "DRIVER"), ("trip_id", "TRIP"), ("contact_id", "CONTACT")):
            _id(link[key], prefix, f"link.{key}")
        link_ids.append(link["id"])
        _list(link["scope"], FIELDS, "link.scope")
        _boolean(link["revoked"], "link.revoked")
        if instant(link["expires_at"]) <= instant(link["issued_at"]):
            raise RecordError("link: expiry must be after issue time")
    if len(link_ids) != len(set(link_ids)):
        raise RecordError("links: duplicate surrogate IDs")


def _permission_reasons(record, contact):
    reasons = []
    if contact["state"] != "accepted":
        reasons.append("contact_not_accepted")
    if record["trip"]["sharing_state"] != "granted":
        reasons.append("trip_sharing_not_granted")
    consent = contact["trip_consent"]
    if consent["trip_id"] != record["trip"]["id"]:
        reasons.append("consent_for_different_trip")
    if consent["driver_state"] != "granted" or consent["contact_state"] != "granted":
        reasons.append("mutual_trip_consent_not_granted")
    if not set(consent["fields"]) & set(record["trip"]["shared_fields"]):
        reasons.append("no_consented_fields")
    return reasons


def evaluate(record, at):
    """Evaluate one synthetic snapshot at an explicit clock instant, without side effects."""
    validate(record)
    if not isinstance(at, datetime) or at.tzinfo is None or at.utcoffset() is None:
        raise RecordError("evaluation time: timezone-aware datetime required")
    contacts = {contact["id"]: contact for contact in record["contacts"]}
    candidates, authorised, results = [], [], []
    for contact_id in record["escalation_order"]:
        contact = contacts[contact_id]
        reasons = _permission_reasons(record, contact)
        if not reasons:
            authorised.append(contact)
        channels = contact["channels"]
        channel_order = [name for name in channels["preferred"] if name in channels["verified_reachable"]]
        if not channels["current"] or not channel_order:
            reasons.append("current_preferred_reachable_channel_unconfirmed")
        obs = contact["observations"]
        if obs["response"] == "cannot_assist":
            reasons.append("cannot_assist")
        if obs["willingness"] != "yes":
            reasons.append("willingness_unconfirmed_or_declined")
        if obs["availability"] != "available":
            reasons.append("availability_unconfirmed_or_unavailable")
        for key in ("role_understood", "handoff_understood", "mutual_understanding"):
            if obs[key] != "yes":
                reasons.append(key + "_unconfirmed")
        if record["driver"]["preferred_language"] is None:
            reasons.append("driver_language_unknown")
        if contact["preferred_language"] is None:
            reasons.append("contact_language_unknown")
        if obs["action_status"] == "none":
            reasons.append("useful_action_unrecorded")
        if not reasons:
            candidates.append(contact_id)
        results.append({
            "contact_id": contact_id,
            "model_qualified": not reasons,
            "reasons": reasons,
            "model_channel_order": channel_order if not reasons else [],
            "acknowledged": obs["acknowledged"],
            "recorded_action_status": obs["action_status"],
            "assistance_established": False,
        })
    if candidates:
        outcome = "action_candidates_recorded"
    elif not authorised:
        outcome = "no_authorised_contact"
    elif all(
        contact["observations"]["response"] == "cannot_assist"
        or contact["observations"]["availability"] == "unavailable"
        or contact["observations"]["willingness"] == "no"
        for contact in authorised
    ):
        outcome = "no_contact_can_act"
    else:
        outcome = "capacity_unconfirmed"
    links = []
    for link in record["links"]:
        contact = contacts.get(link["contact_id"])
        reasons = _permission_reasons(record, contact) if contact is not None else ["unknown_contact"]
        if link["driver_id"] != record["driver"]["id"] or link["trip_id"] != record["trip"]["id"]:
            reasons.append("link_binding_mismatch")
        if link["revoked"]:
            reasons.append("link_revoked")
        if at < instant(link["issued_at"]):
            reasons.append("not_yet_valid")
        if at >= instant(link["expires_at"]):
            reasons.append("link_expired")
        allowed = set(record["trip"]["shared_fields"])
        if contact is not None:
            allowed &= set(contact["trip_consent"]["fields"])
        if not link["scope"] or not set(link["scope"]) <= allowed:
            reasons.append("scope_not_consented")
        links.append({"link_id": link["id"], "model_contract_valid": not reasons, "reasons": reasons})
    return {
        "evidence_kind": "synthetic",
        "model_outcome": outcome,
        "model_escalation_candidates": candidates,
        "contacts": results,
        "links": links,
        "shared_trip_data_released": False,
        "product_eligibility": "untested",
        "enrolment_readiness": "untested",
        "assistance_established": False,
    }


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RecordError("JSON: duplicate object key")
        result[key] = value
    return result


def load_record(path):
    def reject_constant(_value):
        raise RecordError("JSON: non-finite number")

    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_unique_object,
                      parse_constant=reject_constant)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("record", type=Path)
    parser.add_argument("--at", required=True, help="Explicit ISO 8601 instant with timezone")
    args = parser.parse_args(argv)
    try:
        result = evaluate(load_record(args.record), instant(args.at))
    except (OSError, UnicodeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
