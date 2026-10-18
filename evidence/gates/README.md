# Issue 11 decision-contract preparation kit

This kit prepares the evidence contract for ANDES, Team GOAT: independent Latin
American freight owner-operators with one or two trucks. It does not establish
pilot readiness. **T_action, Delta_action, B_false and B_attention are UNSET in the
real template.** There are no real observations, incident conclusions, provider
results or human review in this directory.

Authority checked on 17 October 2026: [#11](https://github.com/Bimbi-Dev/andes-hackathon/issues/11),
its parent [#1](https://github.com/Bimbi-Dev/andes-hackathon/issues/1), blocked-by
[#10](https://github.com/Bimbi-Dev/andes-hackathon/issues/10), and
[docs/PLAN.md](../../docs/PLAN.md) at `470209dabf4d9f6c52e545b8cbf3030b35beedf2`.
The template records the issue update timestamps. #8/#9 are upstream evidence
gaps; their parallel unmerged implementations are not imported. Sebastian remains
accountable for #11. Preparatory publication does not close any issue or lift its
blockers. No recruitment, real messaging, provider activation, hosting, spending,
real trip collection or production architecture is authorised by this kit.

| File | Purpose |
|---|---|
| [STPA.md](STPA.md) | Plan-derived bounded control diagram, losses and C01–C09 hazard/test proposals |
| [decision-contract.template.json](decision-contract.template.json) | Editable real declaration; deliberately incomplete |
| [check_contract.py](check_contract.py) | Local JSON shape/reference/consistency checker, Python standard library only |
| [fixtures/synthetic-complete.json](fixtures/synthetic-complete.json) | Fictional complete declaration; every threshold/reviewer/result is synthetic |
| [fixtures/synthetic-cases.json](fixtures/synthetic-cases.json) | Negative controls applied to the complete fixture by tests |
| [test_contract.py](test_contract.py) | Local checker and CLI tests, including failure controls |

Run from the repository root with Python 3.10+; no packages, services or installs:

```sh
python3 -B -m unittest discover -s evidence/gates -p 'test_*.py' -v
python3 -B evidence/gates/check_contract.py evidence/gates/decision-contract.template.json
python3 -B evidence/gates/check_contract.py evidence/gates/fixtures/synthetic-complete.json
```

The real template must exit **1**, with explicit gaps and `pilot_ready: false`.
The complete synthetic declaration exits **0**, with `evidence_mode: synthetic`,
`syntactically_complete: true`, `independent_acceptance: not_verified` and
`pilot_ready: false`. Exit **2** means unreadable/invalid/ambiguous JSON (or CLI
usage error). Exit 0 means only complete, internally consistent declarations under
these bounded rules. Do not use it as a pilot, safety, evidence-truth or issue-close
gate. The checker always returns `pilot_ready: false`, including for apparently
complete real inputs. It does not open referenced files or make network calls.

The synthetic numeral `1` exercises numeric fields only; it is not a recommended
limit. Synthetic reviewer names, pass declarations and references refer to no
person or observation. Tests create temporary local negative inputs and never
modify the real template. Do not copy synthetic values into a real contract.

Editing and interpretation:

1. Work in a separately named local copy. Preserve the schema version and record
   author, revision, preparation date, authority and input limitations. Do not put
   raw personal trip data or credentials in the repository. Source references are
   opaque locators to appropriately controlled evidence, not embedded evidence.
2. Define each bounded country, language, route and device condition. Device
   conditions should name model/OS/browser, installed state, permission/lifecycle,
   carrier/connectivity and relevant cab setup. Country means the evidence scope,
   not a default for all Latin America. State retests before enabling another
   combination. Add a separate baseline, all four thresholds, H1–H3 and G1–G4 for
   **each** scope ID. Never silently transfer timings or tolerances.
3. Register current contact practice and simplest fixed-policy baseline, variation
   method, and units: delivered prompt, eligible prompt, trip, covered driver-hour,
   contact action, independently labelled event and active trip-hour. Define an
   eligible prompt, delivery, useful contact action and each timing origin in the
   baseline/measurement descriptions before outcome inspection.
4. Overall unnecessary-escalation burden uses **all registered active trip-hours,
   including sensor/network gaps**. Define trip-end censoring before collection;
   do not discard an outage while counting its alert. Location-covered driver-hours
   need a separate qualification rule for road-segment rates. Preserve duration,
   uncertainty and cause of gaps. The checker checks these declarations, not actual
   arithmetic, logs, censoring compliance or location quality.
5. Fill thresholds only after reconstructed timelines, baseline variation, contact
   tolerance and independent human-factors review justify them. `null` means UNSET;
   empty fields, empty evidence lists and literal UNSET/TODO/TBD remain gaps. There
   are no numeric defaults. T_action and Delta_action are positive seconds;
   B_false is unnecessary escalations per active trip-hour. B_attention's unit,
   counting window and value require justification rather than a default here.
6. Preserve claim/source/test/result/criterion/review/disposition as separate fields.
   Register criteria before implementation and outcome inspection. Keep failed
   results, contradictions and `revise`, `stop` or `inconclusive` dispositions.
   `pending` and `not_run` denote work not yet performed. An apparent pass conflicts
   with failed/inconclusive/unrun tests or an adverse/pending criterion review.
   A revision change invalidates earlier review declarations until rereviewed.
7. Review fields declare identity, independence from implementation, revision,
   disposition, record locator and limitations. A different string and a boolean
   cannot prove genuine independence; no field is a verified acceptance. Plan-only
   references cannot satisfy evidence slots; real declarations cannot contain
   sources labelled synthetic. The checker cannot detect falsely labelled sources,
   forged reviews, meaningless prose, or a dishonest chronology.
8. `freeze.state: declared_frozen` records a proposed declaration only. It requires
   complete fields/evidence references, non-adverse dispositions, matching review
   and freeze revisions, a record reference and a before-implementation/outcomes
   declaration. The CLI verifies none of the actual history. A feature-branch SHA
   freeze for code review is separate from this evidence-contract freeze. The real
   template stays `draft`; the kit does not freeze Robert's event format or stack.

Schema version 1 is defined by the explicit `SCHEMA` and consistency rules in the
checker. Unknown fields/versions, duplicate JSON keys and IDs, non-finite/boolean
numeric thresholds, missing required rows, dangling or mismatched-scope references,
unsafe denominator declarations and contradictory pass/freeze declarations are
rejected or reported as blocking gaps. `schema_valid` includes these consistency
rules. Complete declarations remain unverified, even if no errors or gaps appear.
The checker checks required IDs and reference coverage; it cannot determine whether
prose actually implements the case, whether a referenced result is authentic, or
whether thresholds are sufficient. Every reported limitation survives a complete
fixture. A human must evaluate source quality, policy, independence and applicable
capability/privacy limits outside this tool.

Reviewer48 owns independent **tooling** review at the frozen commit; this is separate
from independent acceptance of real product evidence, including human factors.
Q44 may integrate accepted work later. No merge or independent pass is claimed by
the author. Local check results and publication coordinates belong in the draft PR
handoff; future evidence, permissions and acceptance decisions remain open.
