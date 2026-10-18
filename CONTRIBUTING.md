# Working on Andes

1. Choose an open task after its blockers and section gates are satisfied.
2. Keep scope, raw evidence, constraints and acceptance criteria from the issue.
3. Work on a branch and reference issues with `Refs #N`; do not use automatic closing keywords in PR descriptions or commits. Close an issue separately only after its own evidence gates and independent disposition are satisfied.
4. Attach verification evidence and an independent review disposition before closing. Unknown or failed evidence stays explicit.
5. Record new scope decisions in the plan and affected issues. Do not treat research, a mock or a small pilot as proof of reduced crashes or robberies.

Never commit credentials, raw personal trip data or unrelated project material. Live pilots, participant contact, provider activation, hosting deployment and new spending require their stated authorisations.

For branding, design-system and UI work, follow the [Tándem design guide](docs/design/README.md), based on `Leonxlnx/taste-skill` and the product's driving, accessibility and truthful-status requirements.

## Review before merge

This rule applies to all contributors and their agents.

- Robert (`Robertzu43`) is the merge authority for every PR, including his own. Only Robert, or an agent acting on his explicit instruction for that PR, merges. Other contributors and their agents review but do not merge.
- Before merge, read the complete PR discussion, inline threads and formal reviews, including actionable findings in `COMMENTED` or `APPROVED` reviews. `reviewDecision` and an older AI ACCEPT do not clear findings.
- Resolve every actionable finding before merge. Reply in its original review thread or discussion with its fix commit, regression and valid-input evidence. Keep the disposition there, rather than duplicating it in the PR description. A no-change or informational disposition needs Robert's explicit rationale in that thread.
- Anyone may review. Label every agent-written review as AI-assisted and name the agent, represented contributor and posting account. Robert decides, in the thread, whether a blocker is resolved; silence, CI and outdated/resolved threads do not clear one on their own.
- Immediately before merge, refresh all new commits, feedback and applicable inbox messages since the last complete read. Recheck dispositions and required checks for the current proposed head. Any unresolved question, finding or missing required evidence means **hold**.
- Merge using `gh pr merge <n> --match-head-commit <reviewed-sha>` (plus the agreed merge method), so a changed head is rejected atomically. A mismatch requires renewed verification; never retry with an unreviewed SHA.
- Merge through a PR. Never push directly to `main`, dismiss reviews, or force-push any branch under review. Append corrective commits and retain review history.
- Repair misses already on `main` through a transparent corrective PR, preserving unrelated history.

**Required checks** are the GitHub Actions jobs in `.github/workflows/ci.yml` plus any scope-relevant local validation recorded in the PR (command, SHA, result). Missing or failed required evidence holds the PR. An AI review is a labelled technical verdict for one exact SHA; it informs Robert's merge decision and grants no merge authority.

