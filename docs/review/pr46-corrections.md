# PR46 · Published correction candidate

Correction source SHA: [`fc5aebba0bfb1eb0c5cd47ad28f36c96cc99b76c`](https://github.com/Bimbi-Dev/andes-hackathon/commit/fc5aebba0bfb1eb0c5cd47ad28f36c96cc99b76c), pushed on `sebasbimbi/test/andes-robert-evidence`. It follows correction `3827e91` and the historical baseline receipt `caba955`. The retained PR46 was independently advanced to `5f42256997f15626500795b1fcf4c1c4efef59e7`; this candidate has not been applied there. Q41 retains integration ownership and must reconcile the existing changes without overwriting or force-pushing them.

The complete paginated formal reviews, inline comments and discussion were refreshed before publication. Robert's latest [CHANGES_REQUESTED review 5560681899](https://github.com/Bimbi-Dev/andes-hackathon/pull/46#pullrequestreview-5560681899), against `01519d8`, adds second-hand account attribution, cp1252 stdout, late decoding recovery and ASCII numeric locale findings to [review 5560599283](https://github.com/Bimbi-Dev/andes-hackathon/pull/46#pullrequestreview-5560599283). Both reviews remain intact. There were no inline comments at the refresh.

## Local disposition at fc5aebb

| Finding | Candidate behavior and proof |
| --- | --- |
| Sensitive/rest labels on unknown metadata | All eight named metadata controls reject; legitimate unknown contact status still exports |
| Exclusion privacy | JSON reasons are generic `consent`/`redaction` codes, with no excluded participant ID, refusal value or private column name; collection diagnostics stay private |
| Self-report and second-hand attribution | An own attributed account is required for the named reporter. Non-message sources supplied by the other participant reject. Valid own accounts and contact-supplied driver messages remain accepted |
| Regional redaction formats and ID leakage | The reported decimal-comma/DMS coordinates, short/month dates, plates, bare links and plate/phone/date IDs reject; malformed cells are not echoed in diagnostics |
| Filing clock vs incident time | A separate valid corroboration source does not make a complaint filing timestamp an incident time. The preserved filing-clock control rejects |
| CSV decoding, parsing and console recovery | Invalid UTF-8 and malformed/oversized CSV reject with controlled diagnostics. A late decode or parse failure clears the entire affected table. The UTF-8 instruction prints on strict cp1252 stdout |
| Numeric language region | `es-419` remains valid; `es-٤١٩` rejects. The pt-PT/pt-BR coverage distinction remains intact |
| Zone validation warning | Export prints warnings on stderr, including explicitly simulated missing zone data; the baseline test is portable to that condition |
| Exclusive none channel | `none;whatsapp` rejects and `none` alone remains valid |
| Collected vs shareable cases | Check counts collected accounts. Export requires both participants' sharing consents; missing enrollment does not establish consent |

The six new regression tests fail against the preceding correction `3827e91` and pass at `fc5aebb`. They cover second-hand borrowed interview/non-message accounts, strict cp1252 stdout, late UTF-8 decoding, late CSV parsing and non-ASCII locale digits. The sensitivity run used a disposable archive, with no production-code or fixture mutation in the working branch.

## Verification and current product comparison

Fresh `git archive` of exact `fc5aebb`, on both Python 3.9.6 and Python 3.14.7:

- `python -I -m unittest discover -s evidence -p 'test_*.py'`: **75 passed** per runtime.
- Unchanged [40-control reviewer driver at e88bdf1](https://github.com/Bimbi-Dev/andes-hackathon/blob/e88bdf1705b03accfc1a46144d70501858c2a8ad/review-probes/incident-kit-followups.py): **40/40** per runtime. Driver SHA256: `2206fc807c6237b5a6a27b4a22e7d824ba669301921620cb7d6983d0f5a53878`.
- Original 13 occurrence/locale controls plus two recall-source controls: **15/15** per runtime. Only each runner's hardcoded candidate archive path was adapted; expectations and fixtures were preserved.
- Whitespace check passed. The adjacent [machine-readable receipt](pr46-fc5aebb-results.json) records exact source hashes, commands/outcomes and per-control exits.

A fresh archive of retained product head `5f42256`, on both Python 3.9.6 and Python 3.14.7, passed **63 native tests** and **15/15 earlier controls**, but only **25/40** preserved follow-up expectations. The 15 failures still cover non-message self-report attribution, identifier formats/IDs/diagnostics and filing-clock provenance. All six newest regression tests also fail against that source on both runtimes. These are variant counts, not counts of distinct defects. This comparison is author-side reproduction, not independent acceptance.

## Standalone materials and remaining gates

Q44 published the separate [interview-materials PR79](https://github.com/Bimbi-Dev/andes-hackathon/pull/79) at `975e48b74173245dc02e5c20f553021203d1649a`, based on main `3d7e724`. It contains the exact-source four bilingual guides and four blank sheets from `01519d8`, with manual-use README/cohort/dictionary adaptations and the private-folder ignore rule. Q44 verified all 12 delivered hashes and blank sheet headers. The PR is draft and Robert's review is requested; no merge or participant outreach is claimed. Q41/Q44 own reconciliation of its overlap with retained PR46.

Q48 independent review is requested against exact candidate `fc5aebb`; its outcome is pending. After integration, the exact retained PR46 head needs fresh independent review and Robert's original-reviewer/human confirmation. No author merge, review dismissal or issue closure is authorised by these local results.

Message-source declarations still require a human trace reviewer to verify the reporter's actual words; the supplier can differ from the author. A message timestamp dates the report, not necessarily the underlying incident. Common identifier matching remains incomplete and may have false positives. Passing it cannot establish anonymity or complete redaction. Human privacy review, actual consent validity, real participant/device/provider validation and product efficacy remain unproven. Issue #8 and downstream evidence gates stay open.

Refs #8.
