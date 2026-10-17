#!/usr/bin/env python3
"""Offline consistency checks for #10. No network, provider SDK, or truth certification."""

import argparse
from datetime import datetime
import json
import math
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "schema.json").read_text(encoding="utf-8"))
LIMITATION = "Consistency only: evidence authenticity, availability and safety are not verified."


def timestamp(value):
    """Require an explicit offset; retain the original value in the input."""
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value
    ):
        raise ValueError("expected an offset-aware timestamp")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def shape(value, rule, path="$", errors=None):
    """Validate only the JSON Schema keywords used by the bundled schema."""
    if errors is None:
        errors = []
    if "$ref" in rule:
        rule = SCHEMA["$defs"][rule["$ref"].split("/")[-1]]
    kinds = {"null": value is None, "object": isinstance(value, dict),
             "array": isinstance(value, list), "string": isinstance(value, str),
             "number": type(value) is int or (type(value) is float and math.isfinite(value)),
             "integer": type(value) is int}
    allowed = rule.get("type", list(kinds))
    if isinstance(allowed, str):
        allowed = [allowed]
    if not any(kinds[kind] for kind in allowed):
        errors.append(f"{path}: invalid type")
        return errors
    if "enum" in rule and value not in rule["enum"]:
        errors.append(f"{path}: invalid value")
    if isinstance(value, dict):
        for key in rule.get("required", []):
            if key not in value:
                errors.append(f"{path}.{key}: missing field (use null/unknown for gaps)")
        props = rule.get("properties", {})
        for key, item in value.items():
            if key in props:
                shape(item, props[key], f"{path}.{key}", errors)
            elif rule.get("additionalProperties") is False:
                errors.append(f"{path}: unknown field")
    elif isinstance(value, list):
        if len(value) < rule.get("minItems", 0):
            errors.append(f"{path}: too few items")
        if rule.get("uniqueItems") and len({json.dumps(x, sort_keys=True) for x in value}) != len(value):
            errors.append(f"{path}: duplicate items")
        for i, item in enumerate(value):
            shape(item, rule["items"], f"{path}[{i}]", errors)
    elif isinstance(value, str):
        if len(value.strip()) < rule.get("minLength", 0):
            errors.append(f"{path}: empty text")
        if "pattern" in rule and not re.fullmatch(rule["pattern"], value):
            errors.append(f"{path}: invalid format")
        if rule.get("format") == "date-time":
            try:
                timestamp(value)
            except ValueError:
                errors.append(f"{path}: invalid offset-aware timestamp")
    elif type(value) in (int, float) and value < rule.get("minimum", -math.inf):
        errors.append(f"{path}: below minimum")
    return errors


def check(document):
    errors = shape(document, SCHEMA)
    gaps = []
    if errors:
        return {"consistent": False, "errors": errors, "gaps": gaps, "limitation": LIMITATION}
    row_ids = set()
    attempt_ids = set()
    for index, row in enumerate(document["rows"]):
        prefix = f"rows[{index}]"

        def fail(message):
            errors.append(f"{prefix}: {message}")

        if row["id"] in row_ids:
            fail("duplicate row id")
        row_ids.add(row["id"])
        evidence = {}
        for item in row["evidence"]:
            if item["id"] in evidence:
                fail("duplicate evidence id")
            evidence[item["id"]] = item
            if timestamp(item["observed_at"]) > timestamp(item["recorded_at"]):
                fail("evidence recorded before its observation")
            if item["kind"] == "official_document":
                try:
                    parsed = urlsplit(item["locator"])
                    valid_url = parsed.scheme == "https" and bool(parsed.hostname)
                except ValueError:
                    valid_url = False
                if item["mode"] != "documentation" or not valid_url:
                    fail("official document needs documentation mode and HTTPS source")
            else:
                if item["mode"] == "documentation":
                    fail("observational evidence cannot use documentation mode")
                if item["scope"] != row["scope"]:
                    fail("evidence scope differs from this row; do not transfer coverage")
            if item["kind"] == "provider_receipt" and item["provider_id"] is None:
                fail("provider receipt needs a traceable provider id")
            if document["record_kind"] == "synthetic" and item["mode"] not in ("synthetic", "documentation"):
                fail("synthetic documents must label observations synthetic")

        def refs(ids, kinds=None, required=False, live=False, attempt=False):
            if required and not ids:
                fail("claimed fact has no evidence references")
            found = []
            for eid in ids:
                item = evidence.get(eid)
                if item is None:
                    fail("dangling evidence reference")
                    continue
                found.append(item)
                if kinds and item["kind"] not in kinds:
                    fail("evidence kind cannot support this fact")
                if live and item["mode"] != "live":
                    fail("supported requires live observations, not docs, sandbox or synthetic records")
                if live and item["kind"] == "provider_receipt" and item["verification"] != "verified":
                    fail("supported requires a verified provider receipt with retained verification provenance")
                if live and item["kind"] == "provider_receipt" and not item["verification_ref"]:
                    fail("supported provider receipts require a separate verification record reference")
                if attempt and (item["provider_id"] != row["attempt"]["provider_id"] or
                                item["mode"] != row["attempt"]["environment"]):
                    fail("observation provider id/environment differs from this attempt")
            return found

        supported = row["state"] == "supported"
        if supported and document["record_kind"] != "evidence":
            fail("blank/synthetic documents cannot claim supported coverage")
        if row["state"] in ("conditional", "unavailable") and not row["conditions"]:
            fail("conditional/unavailable requires explicit conditions or reason")
        if supported and row["conditions"]:
            fail("unresolved conditions require conditional state")
        if not supported:
            gaps.append(f"{prefix}: {row['state']} — no supported-coverage claim")

        scope = row["scope"]
        for name, value in scope.items():
            if name != "group_ref" and value is None:
                gaps.append(f"{prefix}: scope.{name} unknown")
                if supported:
                    fail(f"supported requires scope.{name}")
        if scope["audience"] == "existing_group":
            if scope["channel"] != "whatsapp":
                fail("existing_group is scoped to WhatsApp; other group modes are not modelled")
            if supported and scope["group_ref"] is None:
                fail("existing-group support requires the actual group reference")
        elif scope["group_ref"] is not None:
            fail("group reference requires existing_group audience")

        required_values = {"account": ("eligible",), "opt_in": ("confirmed",),
                           "number_format": ("verified",), "template": ("approved", "not_required"),
                           "comprehension": ("observed",), "existing_group": ("verified",)}
        kinds = {"account": ("account_record",), "opt_in": ("consent_record",),
                 "number_format": ("number_record",), "template": ("template_record",),
                 "comprehension": ("comprehension_observation",), "existing_group": ("group_record",)}
        for name, fact in row["checks"].items():
            applicable = name != "existing_group" or scope["audience"] == "existing_group"
            claimed = fact["value"] not in ("unknown", "not_applicable")
            refs(fact["evidence_ids"], kinds[name], required=claimed,
                 live=supported and applicable)
            if supported and applicable and fact["value"] not in required_values[name]:
                fail(f"supported requires qualified {name} evidence")
            if fact["value"] == "unknown" and applicable:
                gaps.append(f"{prefix}: {name} unknown")
            if name == "existing_group" and fact["value"] == "not_applicable" and applicable:
                fail("actual existing-group eligibility is unresolved, not inapplicable")
            if name == "existing_group" and fact["value"] == "verified" and not scope["group_ref"]:
                fail("verified group eligibility needs the actual group reference")

        # Terms and costs stay dated and source-linked; null cost is not zero/free.
        for name in ("terms", "cost"):
            field = row[name]
            populated = field["evidence_id"] is not None or field["checked_at"] is not None
            if name == "cost":
                populated = populated or any(field[k] is not None for k in ("amount", "currency", "unit"))
                price_parts = [field[k] is not None for k in ("amount", "currency", "unit")]
                if any(price_parts) and not all(price_parts):
                    fail("cost needs amount, currency and unit together")
                if field["amount"] is None:
                    gaps.append(f"{prefix}: cost unknown; no free/zero-cost inference")
            if populated or (supported and name == "terms"):
                if field["evidence_id"] is None or field["checked_at"] is None:
                    fail(f"{name} requires a source and check timestamp")
                else:
                    sources = refs([field["evidence_id"]], ("official_document",), required=True)
                    if sources and timestamp(field["checked_at"]) < timestamp(sources[0]["observed_at"]):
                        fail(f"{name} checked before its source was observed")

        attempt = row["attempt"]
        if attempt["provider_id"] is not None:
            identity = (scope["provider"], scope["account_ref"], attempt["environment"], attempt["provider_id"])
            if identity in attempt_ids:
                fail("one provider attempt cannot be reused in multiple coverage rows")
            attempt_ids.add(identity)
        if supported and (attempt["environment"] != "live" or attempt["provider_id"] is None):
            fail("supported requires a live, traceable message/call attempt")
        fact_kinds = {"acceptance": ("provider_receipt",), "delivery": ("provider_receipt",),
                      "recipient_observation": ("recipient_observation",),
                      "acknowledgement": ("acknowledgement_observation",),
                      "useful_action": ("action_report", "independent_action_observation")}
        facts = {}
        for name, allowed in fact_kinds.items():
            fact = attempt[name]
            claimed = fact["value"] != "unknown"
            facts[name] = refs(fact["evidence_ids"], allowed, required=claimed,
                               live=supported, attempt=True)
            if claimed and (attempt["provider_id"] is None or attempt["environment"] is None):
                fail("observed attempt stages require provider id and environment")
            if claimed and row["state"] == "untested":
                fail("untested conflicts with recorded attempt observations; use conditional until qualified")
        has_receipt = bool(facts["acceptance"] or facts["delivery"])
        if has_receipt:
            if not attempt["receipt_status"] or not attempt["receipt_meaning"] or not attempt["receipt_source_id"]:
                fail("provider receipts need raw status, bounded meaning and official meaning source")
        if attempt["receipt_source_id"]:
            refs([attempt["receipt_source_id"]], ("official_document",))
        if attempt["acceptance"]["value"] == "rejected" and any(
            attempt[k]["value"] == v for k, v in
            (("delivery", "delivered"), ("recipient_observation", "arrived"), ("acknowledgement", "acknowledged"))
        ):
            fail("rejected attempt conflicts with arrival/delivery/acknowledgement; preserve as conditional separate records")
        if attempt["delivery"]["value"] == "failed" and attempt["recipient_observation"]["value"] == "arrived":
            fail("failed receipt conflicts with recipient arrival; reconcile before support claim")
        ack = attempt["acknowledgement"]
        if ack["value"] == "acknowledged":
            if not ack["path"] or attempt["recipient_observation"]["value"] != "arrived":
                fail("acknowledgement requires an explicit path and separate arrival observation")
        if supported:
            for name, value in (("acceptance", "accepted"), ("delivery", "delivered"),
                                ("recipient_observation", "arrived"), ("acknowledgement", "acknowledged")):
                if attempt[name]["value"] != value:
                    fail(f"supported requires {name}={value}")
        # A bounded mapping for the documented statuses; other providers need review,
        # not a guessed automatic translation from a new status to delivery.
        if attempt["delivery"]["value"] == "delivered":
            allowed_statuses = ("completed",) if scope["channel"] == "voice" else ("delivered", "read")
            if scope["channel"] == "sms":
                allowed_statuses = ("delivered",)
            if attempt["receipt_status"] not in allowed_statuses:
                fail("receipt status does not establish delivered coverage for this channel")
        action = attempt["useful_action"]
        if action["value"] == "corroborated":
            observers = {e["attributed_to"] for e in facts["useful_action"]
                         if e["kind"] == "independent_action_observation"}
            reporters = {e["attributed_to"] for e in facts["recipient_observation"] + facts["acknowledgement"]}
            if not observers or not observers.difference(reporters):
                fail("corroborated action needs a distinct independent observer")
        if action["value"] == "unknown":
            gaps.append(f"{prefix}: useful action unknown; acknowledgement is not action or incident proof")
        # Compare observations, not callback ingestion: callbacks can arrive out of order.
        chain = ("acceptance", "recipient_observation", "acknowledgement")
        prior = None
        for name in chain:
            times = [timestamp(e["observed_at"]) for e in facts[name]]
            if times:
                if prior is not None and min(times) < prior:
                    fail("observation chronology conflicts across attempt stages")
                prior = max(times)
        basis = refs(row["state_evidence_ids"])
        if row["state"] == "unavailable":
            if not basis or not any(e["mode"] in ("documentation", "live") for e in basis):
                fail("unavailable requires a dated restriction/failure basis, not synthetic or sandbox-only evidence")
        if document["record_kind"] == "blank" and (row["evidence"] or row["state"] != "untested"):
            fail("blank matrix cannot contain evidence or coverage claims")
    return {"consistent": not errors, "errors": errors, "gaps": gaps, "limitation": LIMITATION}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("matrix", type=Path)
    args = parser.parse_args(argv)
    try:
        document = json.loads(args.matrix.read_text(encoding="utf-8"), object_pairs_hook=unique_object,
                              parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non-finite JSON number")))
        result = check(document)
    except (OSError, UnicodeError, ValueError, RecursionError):
        # Avoid reflecting private input or local filesystem details into shared logs.
        print(json.dumps({"consistent": False, "errors": ["Cannot read a valid UTF-8 JSON matrix"],
                          "gaps": [], "limitation": LIMITATION}))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["consistent"] else 1


if __name__ == "__main__":
    sys.exit(main())
