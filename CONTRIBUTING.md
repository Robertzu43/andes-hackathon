# Working on Andes

1. Choose an open task after its blockers and section gates are satisfied.
2. Keep scope, raw evidence, constraints and acceptance criteria from the issue.
3. Work on a branch and reference issues with `Refs #N`; do not use automatic closing keywords in PR descriptions or commits. Close an issue separately only after its own evidence gates and independent disposition are satisfied.
4. Attach verification evidence and an independent review disposition before closing. Unknown or failed evidence stays explicit.
5. Record new scope decisions in the plan and affected issues. Do not treat research, a mock or a small pilot as proof of reduced crashes or robberies.

Never commit credentials, raw personal trip data or unrelated project material. Live pilots, participant contact, provider activation, hosting deployment and new spending require their stated authorisations.

## Review before merge

This rule applies to all contributors and their agents.

- The author never merges their own PR; the non-author reviewer merges. Identity follows the GitHub account and the person represented: another agent acting for the author is still the author.
- Author and reviewer must read the complete PR discussion, inline threads and formal reviews, including actionable findings in `COMMENTED` or `APPROVED` reviews. `reviewDecision` and an older AI ACCEPT do not clear findings.
- Resolve every actionable finding before merge. Reply in its original review thread or discussion with its fix commit, regression and valid-input evidence. Keep the disposition there, rather than duplicating it in the PR description. A no-change disposition needs the reviewer's explicit agreement. An informational classification needs the reviewer's explicit rationale.
- Only agents review and merge. A blocker or requested change needs explicit confirmation from the original review agent acting for the other side, on the exact proposed head. Label every agent-written review as AI-assisted and name the agent, represented contributor and posting account. Approval is that other side's independent agent review recorded on the PR for the exact head; relayed or verbal approvals do not count. Silence, CI, outdated/resolved threads and author resolution do not clear a blocker.
- If unavailable, the original review agent may explicitly name another independent non-author review agent from the other side on the PR, with the findings and decision authority delegated, or explicitly reclassify findings as informational with a rationale. The named stand-in must confirm the specified fixes on the exact proposed head. Without that designation or reclassification, hold; neither the author nor an agent acting for the author can appoint a substitute or waive a deadline hold.
- Immediately before merge, author and reviewer refresh all new commits, feedback and applicable inbox messages since their last complete read; first-time reviewers read everything. Recheck dispositions, required checks and independent review for the current proposed head. Any unresolved question, finding or missing required evidence means **hold**.
- The non-author reviewer merges using `gh pr merge <n> --match-head-commit <reviewed-sha>` (plus the agreed merge method), so a changed head is rejected atomically. A mismatch requires renewed verification and review; never retry with an unreviewed SHA. This command guards the head, while the feedback and exact-head review-agent confirmation checks above still apply.
- Merge through a reviewed PR. Never push directly to `main`, bypass review with admin overrides, dismiss reviews, or force-push any branch under review. Append corrective commits and retain review history.
- Repair misses already on `main` through a transparent corrective PR with reviewer confirmation, preserving unrelated history.

For this workflow:

- **Required checks** are configured GitHub merge checks and the scope-relevant repository validation agreed with the independent reviewer. Record names/commands, runtime, exact SHA, results and limits in the PR. If no remote checks are configured, say so; their absence is not a passing CI result or a waiver of local validation. Missing or failed required evidence holds the PR.
- **Project/agent inbox** means pending messages about this PR in the author/reviewer's active project handoff channels, including Codus `check_inbox` when used. Drain and disposition those messages before merge; contributors without an agent report relevant pending handoffs in the PR discussion. Do not require access to unrelated or private inboxes.
- **AI ACCEPT** is a labelled independent review agent's technical verdict for a named scope and exact SHA, supported by reproducible evidence. When recorded directly on the PR by the other side's review agent, it can confirm the specified blockers and supply review/merge authority for that exact head under the rules above. It does not supply real-world evidence or product-gate acceptance. An author-side agent verdict, relayed approval or stale-head verdict supplies no blocker confirmation or merge authority.

The branch-protection API returned HTTP 403 for this private repository under its current plan. Until protection is available and verified, these are explicit collaboration rules, not server enforcement. Repository visibility, including submission requirements, needs an explicit team decision and must never bypass review; billing changes also need explicit team authorization. If the team later makes the repository public, an authorized administrator must enable and verify protection for `main` before further merges: require PR review and conversation resolution, dismiss stale approvals, restrict pushes, and forbid force-pushes and bypasses. This is a future prerequisite, not authorization to change visibility, billing or repository settings.
