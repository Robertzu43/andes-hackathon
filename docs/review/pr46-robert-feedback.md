# PR46 · Robert feedback disposition

Current product head checked: `01519d8275b28caf88091feca07247622eace973`.
Robert's [replacement review 5560599283](https://github.com/Bimbi-Dev/andes-hackathon/pull/46#pullrequestreview-5560599283) requests changes against `0bf0dc2` and replaces his earlier approval. The complete paginated formal reviews, inline comments and discussion were refreshed before this receipt; no inline comments were present. The author's response to the earlier approval does not close the replacement review.

The [independent Q48 disposition](https://github.com/Bimbi-Dev/andes-hackathon/pull/46#issuecomment-6243193208) is FIX on this current product head. Q58 reproduced it from a fresh `git archive` using the unchanged [40-control driver at e88bdf1](https://github.com/Bimbi-Dev/andes-hackathon/blob/e88bdf1705b03accfc1a46144d70501858c2a8ad/review-probes/incident-kit-followups.py). Author suite: 58 passed. Independent controls: 11 expected outcomes, 29 failed expectations. Those counts include multiple variants and are not counts of distinct defects. The adjacent JSON records per-control exits and outcomes; the original immutable reviewer receipt also includes complete synthetic logs.

| Feedback | Disposition at product SHA 01519d8 | Reproducer/proof |
| --- | --- | --- |
| Unknown occurrence labels sensitive/rest events using metadata | Open blocker | All eight `metadata-unknown-*` controls export when they must reject; `contact_unconfirmed` control passes |
| Consent refusal and redaction status leak in exclusions | Open blocker | `consent-refusal-private`, `redaction-status-private` |
| Reporter lacks own attributed account | Earlier contact-interview example fixed; non-message variant open blocker | Both contact-interview controls reject; contact-supplied `independent_record` account still exports; own-provider and driver-message controls pass |
| Common redaction formats | Open | Decimal-comma/DMS coordinates, short/Portuguese dates, lowercase/Argentine/Mexican plates and bare map/short links export. The exact decimal-space pair and https controls reject |
| IDs can carry plates, phones and dates | Open | `id-plate`, `id-phone`, `id-date` |
| Invalid ID diagnostic echoes private value | Open | `invalid-id-diagnostic-private` |
| Filing time used as incident time | Open | `complaint-filing-clock`, retaining separate valid corroboration |
| cp1252 / csv.Error handling | cp1252 fixed; oversized-cell csv.Error open | `cp1252-diagnostic` passes; `oversized-csv-diagnostic` fails |
| Export timezone warning / portable baseline | Open | Explicitly simulated empty zone database: two named controls fail; no claim the test host lacks zone data |
| es-419 | Fixed | `es-419-coverage` passes; earlier pt-PT/pt-BR separation remains intact |
| none;whatsapp | Open | `exclusive-none-channel` |
| Driver-only check vs export | Intentional collection/share distinction | Check counts collected accounts; sharing requires both consents |
| Standalone interview materials | Prepared and handed to Q44 for publication/review | Bilingual guides and four blank sheets remain byte-exact from 01519d8; README/cohort/dictionary adapted for manual use |

Reproduce the frozen controls against a disposable archive (the output folder must be new):

```sh
git archive 01519d8275b28caf88091feca07247622eace973 | tar -x -C /path/to/archive
git show e88bdf1705b03accfc1a46144d70501858c2a8ad:review-probes/incident-kit-followups.py > /path/to/incident-kit-followups.py
/usr/bin/python3 -I /path/to/incident-kit-followups.py /path/to/archive /path/to/new-results
```

The driver exits 1 on this uncorrected head. Preserved original probes/fixtures were not changed. Disposable correction work is preparatory until the existing author hands off source ownership and tested fixes are committed and applied to retained PR46. Q41 retains that PR's publishing ownership. This receipt does not claim an integrated fix or reviewer acceptance.

Every correction needs an exact final SHA and a fresh independent Q48 disposition, followed by Robert's original-reviewer/human confirmation. No review is dismissed, no author merges, and issue #8 stays open. No participant outreach, real interviews, consent-validity, redaction-completeness, device/provider evidence or product efficacy is established. Automated identifier matching cannot guarantee complete PII detection.

Refs #8.
