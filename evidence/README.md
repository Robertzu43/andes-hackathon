# Evidence kit for #8 · Reconstruct freight trip incidents

Tools for reconstructing real freight trips with independent truck drivers and their trusted contacts, once recruitment is authorised. Nothing in this folder is evidence. No participants, interviews or records exist yet, and issue #8 stays open until its review criteria are met.

| Path | Use |
|---|---|
| `cohort-brief.md` | Eligibility, sample, coverage record, data handling and stop criteria |
| `guides/interview.es.md`, `guides/interview.pt-BR.md` | Critical-incident interview for drivers and contacts |
| `guides/review.es.md`, `guides/review.pt-BR.md` | Each participant checks their own account |
| `templates/` | Blank participants, cases, sources and timeline sheets |
| `data-dictionary.md` | Every column, its allowed values and the export format |
| `incident_kit.py` | Checks a filled-in cohort and writes the redacted export (Python 3.9 or newer, standard library only) |
| `test_incident_kit.py` | Tests, run from the repository root with `python3 -m unittest discover -s evidence` |
| `fixtures/synthetic/` | An invented cohort and its expected export |

## Workflow

1. Get recruitment authorised and the consent form approved. The cohort brief lists the decisions that are still unset.
2. Fill in the cohort brief and the recruitment log.
3. Interview the driver and the contact separately, using the guide in their language.
4. Copy `templates/` into `evidence/private/<cohort>/` and enter the accounts there the same day. Git ignores that folder. Originals stay in private storage.
5. Run `python3 evidence/incident_kit.py check evidence/private/<cohort>` and fix every error.
6. Each participant reviews their own account with the review guide. Record the result in `cases.csv`.
7. A reviewer outside implementation traces each claimed window to its sources and records `trace_review`.
8. Someone other than the interviewer checks the redaction, then sets `redaction_status` to `reviewed`.
9. Run `python3 evidence/incident_kit.py export evidence/private/<cohort> --out evidence/private/<cohort>-export.json` and share the file through private storage. Committing a real export to this repository needs participant consent for that use and a privacy review.

## What `check` enforces

- Required columns and allowed values; IDs, country codes, language tags and IANA zones; times that carry an offset matching their zone.
- Every source and event belongs to a known case and pair, and every event cites evidence from its own case.
- Observed times come from timestamped records. Recalled times come from the participant's own attributed account, as a range.
- Every participant has a consent reference, and both people consent to sharing before a case exports. The tool checks that the reference exists; it does not judge consent validity.
- Robbery, security, fatigue and rest events are never treated as recorded by phone, location or contact metadata alone. Reports need a cited attributed account. No reply alone stays unknown, with contact status separate from incident verification. A suspicion needs the participant's cited account and stated basis; corroboration needs a specific independent observation supporting the claim. A filed complaint that repeats an allegation is still an attributed account.
- Contradicting accounts stay as linked rows, and unknown times stay unknown.
- Common calendar dates, email addresses, links, coordinates, phone numbers and vehicle plates in exported text or IDs are rejected. Every handoff still needs human redaction review; automated scanning is incomplete.

It checks the declared source classifications and required basis, but cannot verify the truth of a source or whether its observations actually support a claim. The independent trace reviewer does that. It cannot guarantee complete identifier detection or find names, places or cargo details in free text. The redaction review covers those limits. Exclusion reasons use generic `consent`/`redaction` codes; detailed refusal and review diagnostics remain in the private `check` output. Read export warnings on stderr, including when zone/offset validation was unavailable.

## Handoff to Robert

The export is the input for rules and replay fixtures in #12, #18, #23 and #29. It gives minutes between events, observed and recalled ranges, recall gaps, window ranges, conflicts, unknown times and how each event is known. Its coverage block carries the gaps, so the Spanish and Brazilian Portuguese needs survive a sample in one language; `pt-PT` does not satisfy the Brazilian Portuguese need. `fixtures/synthetic/expected-export.json` shows the shape now. Real exports come only after the gates below.

## Gates this kit does not pass

- #8: no authorised recruitment, interviews, participant reviews, independent trace review or reviewer disposition.
- #9 to #12: no physical-device traces (only an iPhone is available and Android is untested), no channel evidence, no frozen evidence contract and no architecture decision.
- No consent form, country data-protection review, retention or storage decision.
