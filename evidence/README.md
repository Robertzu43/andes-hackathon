# Interview materials for #8 · Reconstruct freight trip incidents

Spanish and Brazilian Portuguese interview/review guides, a cohort brief and four blank CSV sheets for authorised freight-trip research. No participants, interviews or records exist yet. Issue #8 remains open.

Use `cohort-brief.md` for eligibility, exploratory sampling, privacy decisions and stop criteria. Use `guides/interview.es.md` or `guides/interview.pt-BR.md` for separate driver/contact interviews, and the matching `guides/review.*.md` for each person to review their own account. `data-dictionary.md` explains every column in `templates/`.

1. Obtain recruitment authorisation, an approved consent form, and storage/access/retention/deletion decisions before contacting participants.
2. Complete the cohort brief and recruitment log. Interview only while the participant is safely stopped, outside an unresolved emergency.
3. Copy the blank sheets to `evidence/private/<cohort>/`. Keep originals and the code-to-person key in approved private storage outside Git.
4. Record the accounts, cited sources and time uncertainty using the dictionary. Record interviews collected separately from cases eligible for sharing; sharing needs both consents.
5. Have each participant review their own account. Have a reviewer outside implementation trace the claimed window to its sources and another person review redaction before any permitted handoff.

The manual workflow needs no app, database, dependency installation or provider account. The optional standard-library checker below uses these same sheets. No interview, participant, device, consent-validity, privacy-completeness or product-efficacy gate is accepted by publishing these materials. Android remains untested.

## Optional checker and redacted handoff

Python 3.9 or newer, with no third-party dependencies:

```sh
python3 -I evidence/incident_kit.py check evidence/private/<cohort>
python3 -I evidence/incident_kit.py export evidence/private/<cohort> --out /private/handoff.json
python3 -I -m unittest discover -s evidence
```

`check` reports collection coverage and private case-level diagnostics. Keep that output private. It rejects duplicate column names, malformed tables, identifier-like values in codes/text/zones, metadata promoted to sensitive or rest events, and accounts attributed to the wrong participant. Sensitive and rest events never use `recorded` or `unknown`. A corroborated rest event also needs a participant account: a tracker stop alone cannot establish rest.

`export` refuses a cohort with validation errors. It includes a case only after both enrolled participants consent to sharing, redaction is `reviewed`, both participant reviews are `confirmed` or `corrected`, and an independent trace review is `traced`. Pending, disputed, declined, inconclusive or untraceable reviews remain excluded. Declared review states are assertions for the independent reviewer to verify, not proof supplied by the tool. In particular, every cited message account is flagged for authorship tracing against `reported_by` in the original, regardless of who supplied the export.

Version 2 of the JSON handoff replaces per-case exclusions with `excluded_cases: {"count": N, "by_reason": {"consent": N, "redaction": N, "participant_review": N, "trace_review": N}}`. Only present reasons appear; a case can have several reasons, so reason counts need not sum to the excluded count. No excluded case/pair/person IDs or individual consent decisions leave in the JSON or successful export diagnostics. Detailed warnings remain available through private `check`; successful `export` reports their count and any missing time-zone database.

Calendar dates and private columns are removed; time offsets, uncertainty, conflicting accounts and evidence classifications remain. Identifier scans catch named common formats, not every possible name, link, place, date or plate. Without a time-zone database, zone text is still scanned and syntax checked, but actual zone names and UTC offsets cannot be verified. Human source, authorship, redaction and consent review remain necessary.

`fixtures/synthetic/` contains invented data only. Its checked handoff demonstrates this contract and accepts no real evidence gate.
