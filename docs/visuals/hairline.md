# Hairline Phone module

Owned by component53. Supporting parked setup/help artwork; component55 owns the
host, captions and motion button. This standalone candidate does not establish
whole-app acceptance, phone sensing qualification or message delivery.

## Approved inputs

Foundation prerequisite: `800205a4be2c94833234c852760b2eb09c6ed079`.
Read the Brain's verified `andes-app-build/foundation/PRODUCT.md`, `docs/DIRECTION.md`,
`docs/design-contract.json`, `docs/CONTENT-BIBLE.md`, `docs/brand/identity.md`,
session/home blueprints and `docs/design/visual-addendum.md`. Contract1.0.0
`andes-operate-v1` passed the installed validator before implementation. Extend the
approved light palette/system font and existing Phone concept. No new visual world.

The live primary session metadata was `gpt-6.1-sol`, effort `xhigh`, OpenAI/Codex.
No auxiliary coding agents were used. Read Hairline-create, its actual rules,
kernel API index and look reference; Impeccable/product/craft floor; Codus UX build,
UI proof, copy, testing, site SEO/implementation and brand identity/furniture;
commit and PR-writer. The context loader ran against the supplied foundation,
where PRODUCT.md exists. Shared foundation/brand assets remain component49's
ownership; the committed dependency confirmation is recorded below.

`IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=not_required image_gate=skipped:approved existing upstream Phone, no new generated imagery mutation=open`

## Public interfaces

React/Vite applications can import `PhoneIllustration` and its props from
`web/src/visuals/hairline/index.ts`. Props: translated `label`, optional `caption`
ReactNode, `motion: 'still' | 'interactive'` (default still), `spread`0..1
(default0.5), optional `className`. The component has no task controls or state
callbacks. Do not derive any driver, permission, delivery or safety fact from it.

For component55, `web/src/visuals/hairline/index.mjs` exports:

```ts
mountVisual(host: HTMLElement, {
  locale: 'es' | 'pt-BR',
  motion: 'still' | 'interactive',
  signal: AbortSignal,
}): { setMotion(motion: 'still' | 'interactive'): void; destroy(): void }
```

This is a bundler entry with a TSX implementation. The bridge uses ReactDOM's
createRoot, supplies es/pt-BR figure labels and a labelled native range. It owns
only its appended child. Abort and repeated destroy are safe and preserve host
siblings/captions. A pre-aborted signal creates no root. The host owns its explicit
parked-use motion button and all factual text; it must keep those outside the SVG.

The range selects three pre-rendered rest poses at0/0.5/1 without loading the
animation engine. Keyboard Home/End/arrow input and touch remain useful in still
and reduced-motion contexts. In interactive mode, it controls upstream intensity;
the pointer/touch opens the existing Phone layers. No raw onRead values are exposed.

## Lifecycle and failure behaviour

Static SVG is the default. No idle tour or autoplay: upstream `play={false}`.
The React engine chunk loads only when motion is explicitly interactive, the
figure intersects the viewport, the document is visible and reduced motion is off.
The latest observation for this figure governs visibility; empty or unrelated
batches preserve the previous observation. Offscreen/hidden/reduced state unmounts the upstream component and runs its
destroy path. React and observer/media/document listeners clean up on teardown.
Missing IntersectionObserver/matchMedia leaves a useful still image. A failed
optional chunk/render leaves the static image and caption; no trip action depends
on illustration load. Caption/figure descriptions remain translated HTML.

Use after primary trip/SOS/check-in content or in an owner-controlled help
disclosure. The preview is an isolated synthetic fixture, not an added app route.
No account, environment, backend, database, permission prompt or external request
is used by this module. A phone background event in automation is simulated and
is not physical iPhone evidence.

## Upstream and licence

Verified2026-10-17 against the [official repository](https://github.com/lucasmarkes/hairline)
and npm registry. Exact requested shared dependency: `@lucasmarkes/hairline@0.5.1`.
Its `./react` export declares named `Phone`, with React>=18 optional peer. The
published React wrapper mounts the official phone engine. No installed skill or
upstream engine was edited; no gallery was published. Full MIT copyright/permission
notice is retained beside the derived static SVGs as `LICENSE.hairline`.

Tarball SHA256: `70d525d31d2f98895aa8e6e2e14484790e53471b0f232eaab8098acc6987ce93`.
Published React JS SHA256: `a97c436b6df80c8dfe6f6b755f1312f6f6dbab96e49fca19b1dbc83a085bff38`.
Published engine JS SHA256: `16fdfec136dc99cf3f65730989364797f0bbb228b7bca60c4d422e0e12ce3b7d`.

`capture-rest.mjs` captures unchanged upstream geometry and resolved neutral
strokes. It never traces/recreates the engine. Only the three resulting still
SVGs are committed. They remain meaningful without animation/JavaScript.

## Reproduction and measured cost

Component49 alone owns the shared package/lock/tokens/router. The original candidate
used disposable tools under `/tmp/andes53-tools` before a rendered foundation was
available. The actual package/lock at `3283fe675ebeee04bb2be8a62f42ab5c475b4b0e`
now confirms the exact Hairline/React/Vite pins below; foundation follow-up
`6f8dc52a566d3880cf1f10bbfd5282a888725ca1` retains those dependencies/exports.
The module consumes actual `--ink`, `--surface` and `--primary` tokens. Shared
integration still needs55/52 route acceptance. Tool versions tested: Node24.17.0, React/ReactDOM19.3.1,
types19.3.0, Vite8.3.4, TypeScript5.9.3, playwright-core1.64.1,
@axe-core/playwright4.14.0 and system Google Chrome. No second app package was added.

With shared web dependencies installed, omit ANDES_VISUAL_TOOLS. For this fixture:

```sh
source ~/.nvm/nvm.sh && nvm use 24
ANDES_VISUAL_TOOLS=/tmp/andes53-tools node web/src/visuals/hairline/preview/serve.mjs
ANDES_VISUAL_TOOLS=/tmp/andes53-tools node web/src/visuals/hairline/preview/serve.mjs --build
ANDES_VISUAL_TOOLS=/tmp/andes53-tools node web/tests/visuals/hairline/browser.mjs
ANDES_VISUAL_TOOLS=/tmp/andes53-tools node web/tests/visuals/hairline/visibility-batches.mjs
```

Codus supervises the running preview in its dev slot. URL `http://127.0.0.1:3053/`;
no stable project frontend hostname is configured in the supplied packet/worktree.
Port registry matched3053 and lsof proved this worktree's process with one listener.
Output/evidence defaults are disposable `/tmp/andes53-build` and
`/tmp/andes53-evidence`; ANDES_VISUAL_URL/EVIDENCE/BUILD and CHROME_PATH override them.

Measured production output: each still16.8kB raw/~4.1kB gzip, one image requested
for the default state. Optional PhoneCanvas121.91kB raw/49.28kB gzip. The published
React entry retains the other figure constructors in this bundler, so this is
the measured cost, not an assumed single-figure budget. The preview's initial
JS226.09kB/71.04kB gzip includes ReactDOM plus fixture/adapter; CSS2.86kB/0.98kB gzip.
These are standalone totals, not incremental whole-app cost. Vite reports the
upstream `use client` directive warning; this client-only preview still builds.

## Builder evidence and remaining gates

14 browser checks passed: no engine request at rest; both locales at390x844,
1440x900,1920x1080,360x800,430x932; no horizontal overflow; still keyboard range;
explicit keyboard enable; pointer response settling without flicker; offscreen
and simulated hidden cleanup; reduced-motion still; stop/reload; axe WCAG2.1A/AA
with zero violations in both locales; no-JS image/HTML; emulated touch/pan;
bridge language/abort/idempotent teardown/sibling preservation; failed optional
chunk fallback; clean primary page errors/network and no external requests.
The grouped check count is14; it is not a whole-app test count.

All ten bilingual width captures, material still/interactive/focus/reduced/failure
states and4x detail were inspected. Phone silhouette, single board highlight,
opaque layers, rounded outlines, camera/button details and frame bounds remain
readable. Screenshots are browser emulation, not a physical iPhone qualification.
Source anti-pattern detector returned[] and detected a planted side-tab control.
The installed CLI's default URL mode lacks Puppeteer and prints an error then[];
that output is not a pass. The revised proof passes a disposable
puppeteer-core25.14.0/system-Chrome browser through the unchanged bundled detector's
supported external-browser API. It detected the rendered side-tab negative control
and returned zero findings at all five actual viewport sizes. No installed skill
or engine was edited. Component56 owns independent final acceptance.

Reviewers55/56 found a P2 batched-observation bug in the first candidate. The
new controlled browser regression fails on that code: [visible,offscreen] wrongly
kept the engine, [offscreen,visible] wrongly stopped it, and an empty batch threw.
The fix selects the latest entry for the observed node and guards absent entries.
All six cases pass, including empty and foreign-target batches. The original14
browser groups, strict typecheck and build also pass. Sixty additional combinations
capture compact/open/interactive/reduced/failure/no-JS states across both browser
locales and all five widths, with zero primary runtime errors or overflow.

TypeScript strict check and Vite production build passed. Root `npm test` compiled
the backend, then reported11 passed/36 failed out of47 because TEST_DATABASE_URL
is required. This visual lane has no disposable backend DB and does not claim the
backend suite passed. No real backend was needed or started for this fixture.

The UI contract/manifest schema is1.0.0. The narrowed review contract preserves
the exact approved packet direction and bounds proof to the Phone module/bridge.
Evidence and the formal manifest stay outside tracked source under
`/tmp/andes53-evidence-r2`. The manifest stays red until component56 independently
approves the revised immutable SHA; the builder does not fill its review verdict.
Builder evidence is provisional: component56 must independently
review the exact SHA and seal the Git-bound receipt. Component55 must adapt the
host,52 must verify full app routes,
and44 alone integrates after all actionable Robert/reviewer findings are resolved.
