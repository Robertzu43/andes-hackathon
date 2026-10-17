# Independent shared-foundation review

**FIX** author `6f8dc52a566d3880cf1f10bbfd5282a888725ca1`, PR56.
Scope: shell, router, session UI, fields, facts/feedback and brand assets.
All165 source blobs in the isolated checkout match the frozen Git tree.
Fingerprint: `ad9d881b33a77485efe29c3aeaa31f683225edf222a2532f2ca1c03b5ead1b0a`.
No author source, existing branch, collaborator dependency directory or integration
contract was changed by reviewer52. All live paginated issue comments, formal
reviews, inline comments and review threads were empty at the final capture.

## Findings

1. **P2 — invalid identifiers retain a valid-route tab title.**
   `web/src/foundation/app.tsx:42–47` sets the route title even when returning
   `NotFound`. The parent effect overwrites the child's not-found title.
   `/trips/invalid` renders `No encontramos esta página` but the document title
   is `Viaje en curso | ANDES`; an invalid invitation similarly retains its
   invitation title. Reproduces in development and production at all five
   viewports in both locales. Unknown paths and valid UUIDs are positive
   controls. Make one validated route identity own the final title, keeping the
   not-found heading/title consistent after locale changes too.
2. **P2 — brand home link misses the approved44px target.**
   `web/src/styles/foundation.css:19` and `app.tsx:27`. The interactive anchor is
  124.453125×38.796875 CSS pixels in the native390px run; its height stays
  38.796875 at every tested viewport/locale. Other navigation targets pass.
   The approved contract requires44px targets; this finding is against that
   requirement, not a claim that WCAG's smaller target criterion is44px.
   Enlarge the actual anchor hit box while keeping the mark size/layout intact.
3. **P2 — API-root queries escape the unconfigured boundary.**
   `web/src/app/unconfigured-api.ts:3` matches the raw URL, where `?` is neither
   slash nor end-of-string. Without a configured API target, `GET /v1?probe=1`
   returns200 `text/html` SPA markup in both dev and production preview.
   `/v1` and `/v1/me?probe=1` correctly return503 JSON
   `{code:'api_unconfigured'}`. Match the parsed pathname and retain queries
   when forwarding an actually configured API. The namespace must not turn
   missing API configuration into successful HTML.

## Reproduce the immutable failures

Use Node24.17.0 and an installed Google Chrome on macOS. The helper launches an
owned headless browser with a new temporary profile, uses native CDP input and
cleans up that child/profile. No installs, credentials, backend, DB, physical
sensor, provider or external send is required by these probes.

Create a disposable Git checkout of the exact author commit, make its locked
web dependencies available, build and run `npm --prefix web run preview` from
that checkout with no API target. Its port0 default prints the owned origin.
From this reviewer checkout, run:

```sh
node review-probes/foundation-6f8dc52/regressions.mjs \
  http://127.0.0.1:OWNED_PREVIEW_PORT /ABS/FROZEN_AUTHOR_CHECKOUT
```

`results.json` records the actual frozen run: **9 pass /4 fail**, exit1,
grouped into the three findings above. The source checkout path is explicit;
the program records its Git head and refuses modified tracked web files.
All HTTP requests target the supplied owned loopback origin. The four red
assertions must remain intact during repair/re-review.

Positive controls cover truthful disabled/unconfigured access, valid UUID and
unknown-path titles, large navigation targets, both ordinary API503 paths,
absence of production hooks/component fixtures, and generic noindex metadata.

## Independent browser and build evidence

Node24.17.0 strict production build and all **9 native foundation tests pass**,
including real loopback production-preview API statuses and idempotency-header
preservation. Rebuilding with `ANDES_ENABLE_TEST_HOOKS=1` produces the same13
artifact files byte-for-byte. Production exposes neither the mount hook nor
fixture controls/private contract/seed markers. Six served PNGs have the
expected16/32/48/180/512 and1200×630 dimensions.

The independent native Chromium run retained **153 development captures and30
production captures**, covering390×844,1440×900,1920×1080,360×800 and430×932;
Spanish/pt-BR; reduced motion; six control/fact states, six token-free session
states, unavailable access, invalid IDs and unknown routes. All183 PNG widths
were checked against their actual viewport widths and sealed in a hash ledger.
No measured overflow, horizontally clipped control, sampled text-contrast
failure or runtime exception occurred; minimum sampled opaque text contrast
was5.912. These measurements do not clear the three findings.

**15 native interaction assertions pass**: empty-field Enter validation with
linked descriptions, retained controlled input, Space consent, Enter save,
disabled action, rapid-save deduplication, pointer/keyboard retry, skip-to-main,
keyboard locale choice and reload persistence, pointer session deduplication,
pointer sign-out, Enter begin and Space sign-out. These use labelled local
fixtures. They establish no server authentication, live sending or human/device
qualification. The earlier embedded-Enter uncertainty does not reproduce with
native input: one Enter produces exactly one fixture attempt.

Representative whole-page images were independently inspected for the small
Portuguese header, long unknown-location copy, validation/focus, error/retry,
expired demo access and brand assets. Portuguese text is readable and the
source/receipt/unknown distinctions are retained. Complete interaction/state
coverage and assistive-technology testing remain pending in the UI manifest.

Two evidence limitations are preserved explicitly. The embedded browser loaded
the DOM but repeatedly returned a zero viewport and no screenshot after recovery;
the isolated Chromium fallback supplied actual images. The initial desktop PNG
helper clipped the native scrollbar gutter; those originals remain preserved.
Only the60 development and12 production desktop rasters were repeated with full
`innerWidth` and a PNG-width assertion. Source, predicates, mobile images and
positive interaction outputs were unchanged.

Vendored source detector: exit0, no findings. A planted source control produces
the expected side-tab finding and exit2. URL mode prints a missing-Puppeteer
error yet exits0; **the URL scan did not run**. No unpinned tool was fetched, and
that zero exit is not reported as a passing URL/layout/copy check.

## Evidence boundary and next action

Raw screenshots, native/HTTP observations, hash ledger, source manifest, embedded
tool failure, original rasters and a version1.0.0 pending UI Evidence Manifest
remain outside source in the shared private review bundle. The original full
`andes-operate-v1` contract is retained without exemptions or narrowed modules.
Its validator remains **RED**, including these findings, missing aggregate
feature/interaction coverage and an unperformed complete-receipt sensitivity
proof. A red partial manifest cannot establish that removing an item from a
complete passing receipt would be rejected.

Author49 should publish the three corrections and regression evidence on an
immutable follow-up. Reviewer52 will rerun these unchanged controls. Runtime46
and feature owners45/50/51 still supply real session/API and combined production
journeys for whole-app acceptance. Physical/provider/human evidence remains open.
No full-app/UI-proof acceptance, merge, issue closure or human-feedback override
is granted by this scoped FIX review.
