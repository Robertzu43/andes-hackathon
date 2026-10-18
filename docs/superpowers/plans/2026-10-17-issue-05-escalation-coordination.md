# Issue 5 Escalation coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Architecture decision:** [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects AWS and supersedes incompatible coordination/closure assumptions. This plan remains subject to its evidence gates.
**Goal:** Integrate and review #29, #30, #31, #32, #33, #34, #35, #36 without duplicating their implementation or claiming unsupported completion.

**Architecture:** This is a section coordination issue, not another application component. Child plans own code; the coordinator owns handoffs, same-revision evidence and the closure decision.

**Tech Stack:** Markdown/JSON evidence and the child issues' accepted stack; no new runtime or dependency.

**Spec:** `docs/PLAN.md` section #5; `docs/OWNERSHIP.md`; `docs/superpowers/specs/2026-10-17-robert-backend-contracts.md`.

## Global Constraints

- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.

## Review Focus

1. Accept then timeout: Keep ambiguity visible and reconcile before duplicate-prone retry. Evidence in `tests/issue-33.test.mjs` and the owning issue record; audited in Task 1.
2. Resolution versus queued send: Prove shared cancellation/dispatch ordering on the same revision. Evidence in `tests/issue-30.test.mjs` and the owning issue record; audited in Task 1.
3. Forged or reordered callback: Authenticate raw callbacks and avoid state regression. Evidence in `tests/issue-32.test.mjs` and the owning issue record; audited in Task 1.
4. Acknowledged but cannot help: Preserve action pending/unavailable; never assert driver safety. Evidence in `tests/issue-29.test.mjs` and the owning issue record; audited in Task 1.
5. Unverified group or country support: Disable that path and retain verified individual delivery. Evidence in `tests/issue-34.test.mjs` and the owning issue record; audited in Task 1.

---

**Existing blocker:** #4. Section completion additionally requires the applicable child evidence, not just the upstream section state. Robert coordinates #29–34. Sebastian supplies #10 provider eligibility, #35 contact-action UX and #36 recipient-observed channel evidence. Group unavailability does not require building unofficial automation.

### Task 1: Assemble a reproducible section acceptance record

**Files:** Create `docs/evidence/section-05.json`, `docs/evidence/section-05.md`; read each child's `docs/evidence/issue-XX.md`. Modify no application files in this coordination task.

**Interfaces:** Consumes child revision, command/result, capability/channel/user evidence and reviewer disposition. Produces JSON `{"section":5,"revision":"<actual revision>","children":[{"issue":18,"status":"missing|failed|passed","evidenceRefs":[],"reviewerRef":null}],"decision":"blocked|ready"}`; use the actual child numbers [29, 30, 31, 32, 33, 34, 35, 36], not the example 18 unless it belongs. Evidence references name actual files/receipts and cannot be fabricated to pass a shape check.

- [ ] Read the upstream blocker and child records. List each missing handoff with its owner and next concrete evidence action; do not close or reassign issues automatically.
- [ ] Collect child test results and independent acceptance evidence for the same integrated revision. Walk each Review Focus case to its owning test and real evidence source; fix missing coverage in that child issue rather than introducing duplicate section-level product code.
- [ ] Record `decision: blocked` whenever any required evidence is absent, failed or from an incompatible revision. A clean code suite with missing physical/provider/user evidence remains blocked.
- [ ] Run the following inline self-check against the populated record:

```python
import json
m = json.load(open('docs/evidence/section-05.json'))
assert sorted(c['issue'] for c in m['children']) == [29, 30, 31, 32, 33, 34, 35, 36]
assert all(c['status'] in {'missing','failed','passed'} for c in m['children'])
assert m['decision'] in {'blocked','ready'}
ready = all(c['status'] == 'passed' and c['evidenceRefs'] and c['reviewerRef'] for c in m['children'])
assert m['decision'] != 'ready' or ready
print('PASS: record consistency; source acceptance requires independent review')
```

- [ ] Re-run only the child tests affected by integration or a new failure. Use the owning plan's exact command and preserve its outputs; do not claim code or device tests ran during planning.
- [ ] Have the required independent reviewer inspect the complete section evidence; record actual disposition and limitations. If ready, propose issue closure with evidence; closure remains a separate recorded action.
- [ ] Commit only these records with `docs(#5): record section acceptance and handoffs`.

**Acceptance:** All applicable child evidence and review passes on the integrated revision; unsupported modes are explicitly excluded through the original evidence process, not silently passed. No new runtime tests for this documentation task; the manifest self-check verifies consistency only.

**Subagent boundary:** One coordinator gathers independent child results; reviewers may read separate artifacts in parallel. No concurrent modifications to child shared contracts. A fresh code reviewer supplements, rather than replaces, the independent evidence gate.
