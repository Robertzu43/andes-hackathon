# Independent receipt checker review

Candidate: `e3ed9720ad1490a1797adbb3ed1a8c76eadffe50`,
[PR60](https://github.com/Bimbi-Dev/andes-hackathon/pull/60).
Verdict: **FIX** for two fail-closed predicate gaps. Production/backend source
was not changed, and no database or real runtime journey was executed.

## P2: missing snapshot trip aliases pass equality

In `evidence/app-acceptance/oracle.mjs:76`, the aging control compares
`stale.tripId` with `fresh.tripId` using plain equality. Delete `tripId` from
both otherwise valid snapshot responses: both are undefined, so the comparison
passes. The `stale-snapshot` case is reported pass and the CLI exits 0 with
`backend-receipt-checks-pass`, although the source relationship is missing.

Require valid, nonempty matching trip aliases (for example the existing `same`
predicate). Preserve the equal-valid-ID positive control and changed-ID rejection.

## P2: the second SOS response bypasses state/capability checks

At lines 91–95, `sos-acceptance` checks `status=active` and
`groupCapability=unavailable` only on the first response. Independently change
the second response to `status=resolved`, or change its group capability to
`available`, while retaining the same incident ID. Each contradictory receipt
still passes the case and exits 0. The pinned backend returns an active episode
and unavailable group capability for both SOS observations.

Apply those state/capability invariants to both responses. Preserve the unchanged
valid duplicate episode and the existing invented-delivery negative controls.

These are backend-receipt false acceptances; `wholeAppAccepted` remains false in
every result. They do not constitute a false whole-app or live-delivery result.

## Independent controls

Node 24.17.0, no installs and no HTTP/database/device/provider execution.
`receipt-checker-probes.mjs` constructs only clearly labelled simulated unit
controls from the public synthetic format. Changing the kind for an output-
category test does not create observed backend evidence. No actual runtime
receipt is committed or reproduced.

```sh
node --test --test-reporter=tap evidence/app-acceptance/oracle.test.mjs
node review-probes/receipt-checker-probes.mjs
```

The author's suite passes **30/30**. The independent command deliberately exits
**1** at this candidate: **17/20** outcomes match their oracle; the three false
acceptances above remain red. No assertion was weakened or skipped.

Passing controls verify labelled synthetic evidence stays inconclusive, backend
category remains backend-only, input flags cannot promote whole-app acceptance,
missing cases remain pending, changed source age/key aliases/delivery/revision
and duplicate case IDs fail, different snapshot IDs fail, canonical and file-
symlink commands emit parseable nonempty JSON, imports remain inert, and malformed
or oversized input fails without echoing its marker. The existing directory-
alias regressions also pass in the author suite. Q46's original reporter
confirmation of the entrypoint correction remains valid within its stated scope.

[Author TAP](results/e3ed972/author.tap),
[raw independent result lines](results/e3ed972/independent.jsonl), and
[command/result summary](results/e3ed972/checks.json) retain exact outcomes.

## Current twelve-route matrix

Compared all twelve route rows with the coordinating Brain's current foundation
`docs/seo/site.config.json`: route paths, sections, primary hooks and local events
match. The Design Contract and route-map SHA-256 values exactly match the matrix:

- Contract: `2148eba873c75ba5714247259bc37a25f2e542bb7a978ce11a803e5cbc2660cf`.
- Route map: `e576c4db008837f993b6826281058297d4ee36ecb2bd8e0ad3c075224b370ea2`.

The matrix correctly leaves browser states unrun and identifies locale,
viewport, keyboard, contrast, source truth and privacy obligations. Its own
placeholder origin is not a running preview. [Static comparison receipt](results/e3ed972/matrix-checks.json).
This is no rendered UI, browser interaction, accessibility measurement or
whole-app acceptance. The checker hard-pins backend `ebc8fb1`; later revisions
require source review and explicit rebinding.

Author52 and receipt producer46 were notified of the precise controls. The
producer already selects tripId, status and groupCapability, so these narrow
checker corrections should preserve its legitimate existing fields. Q48 must
re-run the unchanged independent probes against the corrected immutable head.
All required reviewer confirmations remain before merge; no source fix, merge,
repository setting change or issue closure was performed here.
