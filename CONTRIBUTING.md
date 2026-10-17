# Working on Andes

1. Choose an open task after its blockers and section gates are satisfied.
2. Keep scope, raw evidence, constraints and acceptance criteria from the issue.
3. Work on a branch and reference the task in the pull request.
4. Attach verification evidence and an independent review disposition before closing. Unknown or failed evidence stays explicit.
5. Record new scope decisions in the plan and affected issues. Do not treat research, a mock or a small pilot as proof of reduced crashes or robberies.

Never commit credentials, raw personal trip data or unrelated project material. Live pilots, participant contact, provider activation, hosting deployment and new spending require their stated authorisations.

## Review before merge

This rule applies equally to Sebastian (`sebasbimbi`), Robert (`Robertzu43`) and their agents, including when reviewing each other's PRs.

- Both author and merger must read all PR discussion comments, inline review threads and formal reviews, including actionable findings in `COMMENTED` reviews. GitHub's `reviewDecision` and an older AI ACCEPT are insufficient.
- Resolve every actionable finding before merge. Reply in its original thread or discussion with the fix commit and relevant regression and valid-input evidence. Identify informational notes separately. If no code change is appropriate, explain why and obtain the reviewer's agreement; no unilateral deferral or dismissal.
- For blocking findings or requested changes, obtain the original reviewer's re-review or explicit confirmation on the fix. Outdated/resolved threads, silence, passing CI and an author marking a thread resolved are not clearance. AI review posted by the author account is useful evidence, not another human approval.
- Immediately before merge, both author and merger must re-read current feedback and pending project/agent inbox messages. Verify that the proposed PR head is the exact reviewed SHA and that required checks and independent review cover it. New commits or comments require rechecking. Any unresolved question or actionable finding means **hold**.
- Merge through a reviewed PR. Never push directly to `main`, use admin overrides, force-push or dismiss reviews to bypass feedback.
- Repair misses already on `main` through a transparent corrective PR with reviewer confirmation, preserving unrelated history.

The branch-protection API currently returns HTTP 403 for this private repository under its current plan. This is an explicit collaboration rule, not a claim of server enforcement. Changing repository visibility, including for submission requirements, is an explicit team decision; it must never bypass review. Any billing change also requires explicit team authorization.

Preparatory tooling still needs its stated evidence gates. This policy change closes no issue and supplies no missing human/device evidence.
