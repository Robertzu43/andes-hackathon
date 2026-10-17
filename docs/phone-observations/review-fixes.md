# PR52 feedback disposition

All four P2 findings in the [published lane52 review](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560327744)
are accepted as real defects in `cc4dc5d2dcb1354e4a223fc02946ae7c42f1c961`.
The live review, inline comments and issue comments were read before changes;
there were no other published comments. No review was dismissed or rewritten.

| Finding | Author fix | Regression and positive control |
| --- | --- | --- |
| F1 — GPS request continues after sink `stopLocation` | Revalidate session, token identity, visibility and elapsed time after request delivery and after passive-query setup, before native acquisition or a request timer. | Both sample and watch cancellation produce zero native calls/queries; full stop leaves zero timers. An uncancelled replacement session still returns a useful fix. |
| F2 — delayed motion grant subscribes past its deadline | Share session/request-token validation with callbacks; check pending request elapsed time before applying the answer and after permission-event sink delivery. | Inclusive session and request deadlines, delayed timers, hidden page, invalid/backward clock and sink-induced time/visibility changes are rejected. Grants just inside either limit still emit motion data. |
| F3 — stale passive grant overrides newer denial | Preserve denied/revoked permission and its source for the entire session. Later conflicting answers remain unapplied observations. | Both initially unknown/denied and previously granted/revoked cases remain terminal through delayed grants and prompt/unknown/granted change events. A new session can explicitly acquire and emit again. |
| F4 — GPS failures lose request options on buffer eviction | Include original `watch` and `options` on GPS errors, local timeout and platform failure events. | One-event buffers retain settings for sample/watch errors 1/2/3/unknown; copies remain detached and messages redacted. Nonterminal watch errors still allow useful success callbacks with the same settings. |

The follow-up commit SHA is recorded in the PR description and the author reply
to the original review, outside the commit containing this report.

## Reproduced results

Runtime: preinstalled **Node 22.22.3**, no dependencies or physical APIs.

| Check | Original frozen head | Revised source |
| --- | --- | --- |
| Original author suite | 60 pass (historical) | Original 60 plus 7 new checks: **67 pass, 0 fail** |
| Seven new author regression tests | **0 pass, 7 fail**, exit 1 | Included in the 67 passing checks |
| Exact preserved reviewer 22 probes | **18 pass, 4 fail**, exit 1 | **22 pass, 0 fail**, exit 0 |
| Exact preserved reviewer `reproduce.mjs` | Four mismatches, exit 1 | **F1–F4 all match expectations**, exit 0 |

Commands from this author worktree; the reviewer directory is the pre-existing,
read-only evidence location, not an author-edited copy:

```sh
node --test tests/phone-observations/adapter.test.mjs tests/phone-capability/recorder.test.mjs
node --test --test-name-pattern='^F[1-4] ' tests/phone-observations/adapter.test.mjs
ANDES_CANDIDATE_DIR="$PWD" node --test /Users/sebasbimbi/.codus/workspaces/andes-checkin-review/.codex/reviews/cc4dc5d2dcb1354e4a223fc02946ae7c42f1c961/probes.test.mjs
ANDES_CANDIDATE_DIR="$PWD" node /Users/sebasbimbi/.codus/workspaces/andes-checkin-review/.codex/reviews/cc4dc5d2dcb1354e4a223fc02946ae7c42f1c961/reproduce.mjs
```

Raw before/after author-run outputs are preserved locally under
`/private/tmp/andes-pr52-author-feedback/`: `reviewer-before.tap`,
`reproduce-before.json`, `author-regressions-before.tap`, `author-after.tap`,
`reviewer-after.tap`, `reproduce-after.json`. The original reviewer archive,
tests, review and failed runs remain untouched in the reviewer evidence directory.

SHA-256 of reviewer files, identical before and after the author fix:

| File | SHA-256 |
| --- | --- |
| `review.md` | `a861d833e1684cbec09375fad46e86f1dae604e89ce0fededf3c140ee99da2c0` |
| `probes.test.mjs` | `0da135e3c2aa6dc9364d955b948e35e6d75fa57f8d36aa14b5a567e92321f756` |
| `reproduce.mjs` | `abc8294f928c03f838d03016df051634d47b8f20c73a416dbd87954504db5a85` |

This is an author disposition and rerun of preserved reviewer probes, not a new
independent review verdict. Brain is asked to route reviewer52 an independent
re-review of the exact new head. No merge or issue closure is authorized here.
Real streams remain disabled by default; physical qualification and resource
measurements stay not-run/inconclusive. Robert retains #18/#21 ownership, and the
local boundary remains provisional with no backend integration claim.
