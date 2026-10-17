PR46 independent Q48 re-review: **FIX** at exact head
`01519d8275b28caf88091feca07247622eace973`.

Robert's [replacement CHANGES_REQUESTED review](https://github.com/Bimbi-Dev/andes-hackathon/pull/46#pullrequestreview-5560599283)
supersedes his earlier approval of `0bf0dc2`. The author's latest response maps
the earlier approval's follow-ups, so it does not close the replacement review.
The guide/template split Robert requested remains an author/integrator follow-up.

All tests used fresh, disposable copies of the synthetic fixture. No author source
was changed. On Python 3.14.7 and Python 3.9.6, isolated `-I` runs each passed
58 author tests and all 15 earlier independent controls. Every earlier export CLI
exit was checked against its expected result. The new 40-control CLI review had
11 expected outcomes and 29 failed expectations on each runtime; these counts
include multiple variants of individual findings, not 29 distinct defects.
Whitespace checks from `470209d` to the exact head passed.

Three P2 findings prevent acceptance:

1. **Unknown occurrence bypasses incident-label restrictions**, `incident_kit.py:408`.
   Append E99 to SYN-A-W with seq99, event_type=robbery, actor=driver,
   reported_by=record, occurrence=unknown, source_ids=SYN-A-W-S4,
   time_basis=unknown, blank time fields. Export exits0 and writes the robbery row,
   even though its only source is unanswered-call metadata. All eight sensitive/rest
   event types behave the same way. The contact_unconfirmed/unknown control passes.
   Apply the allowed occurrence rule to the event type, including unknown.
2. **Exclusion reasons disclose private consent/redaction data**, `incident_kit.py:582`
   and `:745`. Set SYN-B-C.consent_share_redacted=no. The case content is excluded,
   but exported excluded_cases contains
   `SYN-B-C consent_share_redacted is no`. Even the baseline exports
   `redaction_status is in_progress`. Export generic reason codes; keep detailed
   collection diagnostics private.
3. **Own-account enforcement defaults non-interview sources to the reporter's role**,
   `incident_kit.py:427`. The exact E03/E98 contact-interview examples now reject,
   but append source S5 to SYN-A-W with kind=independent_record,
   provided_by=SYN-A-C, evidence_basis=attributed_account, timestamped_record=no.
   Cite only S5 in a driver self_reported dozed_off_report by SYN-A-D, with unknown
   time. Export exits0. The source is the contact's non-message account, not the
   driver's interview or own message. Changing only provided_by to SYN-A-D is the
   valid control. Require explicit attribution for non-interview accounts too,
   preserving the valid driver message supplied by the contact.

Replacement-review follow-ups independently checked:

| Item | Result on exact head |
| --- | --- |
| cp1252 accent | Fixed: exit1, CSV UTF-8 instruction, no traceback |
| es-419 | Fixed: accepted and counts toward Spanish coverage |
| pt-PT vs pt-BR | Earlier regression still passes; pt-PT leaves the pt-BR gap |
| Redaction scan | Comma-decimal/DMS coordinates, short/Portuguese dates, lowercase/Argentine/Mexican plates, bare Maps/bit.ly links export unchanged |
| Space-separated coordinate example | Tested `-23.550520 -46.633308` rejects; no reproduction for this exact example |
| https link control | Correctly rejects |
| ID privacy | ABC1D23, D-5511987654321, C-2026-09-14 all export as participant IDs |
| Invalid ID diagnostic | Rejects, but echoes the synthetic private name in location and error text |
| Complaint filing clock | A separate attributed-account source can supply the robbery attempt's observed_source_id, despite separate valid corroboration |
| csv.Error | A 131073-character private CSV cell raises a traceback instead of a controlled diagnostic |
| Missing zone database | With zoneinfo.available_timezones forced empty, export silently loses its warning; the named author baseline warning test fails |
| Exclusive channel | none;whatsapp exports unchanged |

Run the independent follow-up driver with a writable evidence output directory
that does not already contain its case folders:

```sh
python3 -I review-probes/incident-kit-followups.py /path/to/exact-archive /tmp/q48-followups-new
```

It reads the candidate archive, mutates synthetic fixture copies under the output,
runs each export in an isolated Python child process, checks JSON and diagnostics,
and writes results.json. Exit1 means a review expectation failed. The timezone
controls explicitly simulate a missing database; they do not claim this machine
lacks one. Results for both supported runtimes are in `results/pr46-01519d8/`.
This standalone review driver is intentionally outside the product test runner.

The prior tooling acceptance was bounded to `0bf0dc2` and the then-known cases.
This review accepts no real evidence, consent validity, redaction completeness,
participant/human/device/provider validation, or product gate. Nothing was merged
or closed. Refs #8.
