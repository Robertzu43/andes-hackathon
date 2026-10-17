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
- A blocker or requested change needs explicit human confirmation on the fix from the original reviewer. Label every agent-written review as AI-assisted, name the agent and posting account, and distinguish its technical verdict from human confirmation, including when posted from the reviewer's account. Silence, CI, outdated/resolved threads and author resolution do not clear a blocker.
- If unavailable, the original reviewer may explicitly name a non-author human stand-in on the PR, with the findings and decision authority delegated, or explicitly reclassify findings as informational with a rationale. The named stand-in must confirm the specified fixes. Without that designation or reclassification, hold; neither author nor agent can appoint a substitute or waive a deadline hold.
- Immediately before merge, author and reviewer refresh all new commits, feedback and applicable inbox messages since their last complete read; first-time reviewers read everything. Recheck dispositions, required checks and independent review for the current proposed head. Any unresolved question, finding or missing required evidence means **hold**.
- The non-author reviewer merges using `gh pr merge <n> --match-head-commit <reviewed-sha>` (plus the agreed merge method), so a changed head is rejected atomically. A mismatch requires renewed verification and review; never retry with an unreviewed SHA. This command guards the head, while the feedback and human-confirmation checks above still apply.
- Merge through a reviewed PR. Never push directly to `main`, bypass review with admin overrides, dismiss reviews, or force-push any branch under review. Append corrective commits and retain review history.
- Repair misses already on `main` through a transparent corrective PR with reviewer confirmation, preserving unrelated history.

For this workflow:

- **Required checks** are configured GitHub merge checks and the scope-relevant repository validation agreed with the independent reviewer. Record names/commands, runtime, exact SHA, results and limits in the PR. If no remote checks are configured, say so; their absence is not a passing CI result or a waiver of local validation. Missing or failed required evidence holds the PR.
- **Project/agent inbox** means pending messages about this PR in the author/reviewer's active project handoff channels, including Codus `check_inbox` when used. Drain and disposition those messages before merge; contributors without an agent report relevant pending handoffs in the PR discussion. Do not require access to unrelated or private inboxes.
- **AI ACCEPT** is a labelled agent's technical verdict for a named scope and exact SHA, supported by reproducible evidence. It supplies no human blocker confirmation, real-world evidence, product-gate acceptance or merge authority. A human confirmation requirement attaches to an actual blocker/requested change; an agent verdict does not create a new blanket human-approval requirement for unrelated PRs.

The branch-protection API returned HTTP 403 for this private repository under its current plan. Until protection is available and verified, these are explicit collaboration rules, not server enforcement. Repository visibility, including submission requirements, needs an explicit team decision and must never bypass review; billing changes also need explicit team authorization. If the team later makes the repository public, an authorized administrator must enable and verify protection for `main` before further merges: require PR review and conversation resolution, dismiss stale approvals, restrict pushes, and forbid force-pushes and bypasses. This is a future prerequisite, not authorization to change visibility, billing or repository settings.
