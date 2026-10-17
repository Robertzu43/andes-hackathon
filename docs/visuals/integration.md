# Optional visual hosting adapter

Component 55 owns `web/src/visuals/integration/**`, its fixture checks and this
handoff. It adds no app package, router, backend call, stored identity or live
notification. The approved foundation packet and visual addendum are inputs;
`800205a4be2c94833234c852760b2eb09c6ed079` is the prerequisite, not a rendered app.

The current slice is the common host and an intentionally synthetic lifecycle
probe. It is **not** acceptance of the finished Hairline Phone, Anatomy relay or
full app. Component 49 owns the package, tokens, global locale and router;
50/51 own placement; 56 reviews visuals independently; 52 accepts the integrated
app; 44 alone merges after actionable reviews are resolved.

The framework-neutral host at `646daafc75ee16dd0a90ef7322ed4e9ba1045af8`
received independent adapter-only technical PASS from component 56, sealed at
review receipt `4afff24704a0605b4f6da32754c9b6ac8bc3363c`. That receipt does
not cover later React binding changes. The rendered foundation dependency is now
`6f8dc52a566d3880cf1f10bbfd5282a888725ca1`, including the narrow Portuguese
language-selector fix. Its package/router/shared files are consumed unchanged.

## Shared interface

The two illustration owners agreed to this framework-neutral module boundary:

```ts
mountVisual(host: HTMLElement, context: {
  locale: 'es' | 'pt-BR';
  motion: 'still' | 'interactive';
  signal: AbortSignal;
}): VisualInstance | Promise<VisualInstance>

interface VisualInstance {
  setMotion(motion: 'still' | 'interactive'): void;
  destroy(): void;
}
```

`still` means no animation, timers or continuously running frames. Native
keyboard/touch choices still work, updating directly to a meaningful static
pose. `interactive` permits response to explicit user input; it does not request
a tour or idle autoplay. Motion never represents a driver, delivery or help
state. Mount at rest; never derive product status from a geometry callback.

Mount only inside the supplied node. Release listeners, timers, frames and React
roots when the signal aborts, including before a pending mount settles. `destroy`
must be idempotent: cancellation and a late result can both ask for teardown.
A throwing/rejected mount must use its signal to clean any resources it already
allocated. The host isolates partial markup in a disposable child node.

53's announced bridge is `visuals/hairline/index.mjs`; 54's is
`visuals/anatomy/index.mjs`. Their immutable source and exported types must be
reviewed before adding literal imports. No upstream engine is copied, installed
or imported by this host. Library licence/provenance stays with those modules.

## Placement and enhancement

Render `visualShell({ id, locale, kind, copy? })` before enhancement. `kind` is
`phone` or `relay`; `id` must be a unique identifier starting with a letter and
containing only letters, digits, underscores or hyphens. It generates a figure
with an H3, so place it in a section with an H2. Captions and facts are outside
the stage and remain in the HTML without JavaScript or SVG. All supplied text
is escaped; an optional `VisualCopy` lets the feature's locale owner supply the
same semantic keys. Use the same copy and locale for the shell and host.

Import `visual.css` once within the owning feature. It consumes the actual
49-owned `--ink`, `--surface`, `--canvas`, `--muted`, `--border`, `--primary`
and `--font-ui` tokens, with the approved palette as a standalone fallback.
No global selector or token is modified. Controls have at least 44px targets.

```ts
import { mountVisualHost, visualShell } from './visuals/integration/index.ts';
import './visuals/integration/visual.css';

// Supply a reviewed module using a literal dynamic import at the mount site.
const load = () => import('./visuals/hairline/index.mjs');
container.innerHTML = visualShell({ id: 'phone-help', locale, kind: 'phone' });
const host = mountVisualHost(container.firstElementChild as HTMLElement, {
  locale, kind: 'phone', load,
});
// Call on route disposal, disclosure removal, locale change or React effect cleanup.
host.destroy();
```

In React, render the deterministic shell through a small wrapper and run
`mountVisualHost` in an effect using the figure ref. Return `host.destroy` as the
effect cleanup, and recreate the shell/host when the explicit locale changes.
Keep the import callback stable. Do not re-render geometry every frame.
`visualShell` supports prerendered HTML; it does not make a client-rendered app
work with JavaScript disabled. That app-level fallback remains the feature and
foundation owners' responsibility.

The supplied React adapter implements that lifecycle in `react.ts`:

```tsx
import { useI18n } from './foundation/index.ts';
import { OptionalVisual } from './visuals/integration/react.ts';

const loadPhone = () => import('./visuals/hairline/index.mjs');
function PhoneHelp() {
  const { locale } = useI18n();
  return <OptionalVisual locale={locale} kind="phone" load={loadPhone} />;
}
```

Use a reviewed module at that import path. `OptionalVisual` accepts the same
locale/kind/copy/load/timeout inputs and an optional unique ID. It renders the
caption first, imports its scoped stylesheet and cleans up through an effect.
Its HTML prop is memoized so an unrelated parent update cannot replace artwork
that the module mounted imperatively. StrictMode cleanup, explicit locale
changes and route disposal are exercised in the fixture. The framework-neutral
`index.ts` does not import React; callers opt in through `react.ts`.

Place this below the primary trip/action content in parked setup or help. Never
put trip, check-in or SOS controls inside its root or gate them on an import.
Feature owners decide their existing disclosure placement. No new app route is
needed. All meaning and required actions stay outside the illustration.

## Host lifecycle

- Import starts only after the newest intersection entry reports visible content
  and the document is visible. An explicit Explore action also permits loading.
- The default mount is still. Only the named motion button can enable movement.
- Leaving the viewport, hiding the document or requesting reduced motion calls
  `setMotion('still')` and clears motion intent. Return never restarts animation.
- Reduced motion hides the motion button while retaining static module controls.
  Missing observation or media-query support uses an explicit, static-only path.
- Import, mount, timeout and motion errors restore readable text and a translated
  Retry action. There is no automatic retry loop or raw diagnostic in product UI.
- A load/mount timeout defaults to 12 seconds and is configurable for tests. It is
  only a resource timeout, unrelated to trip or emergency deadlines.
- Destroy disconnects observation, removes all event subscriptions, aborts pending
  work, destroys the instance and restores text. Re-enhancement disposes an older
  host on the same root. Late promises cannot mount into the new host.

The host calls module code only after a valid shell exists. A malformed shell is
an integration error; the feature boundary should keep its primary action usable.
The module itself is responsible for honoring stillness and abort. The fixture's
frame counter tests that contract without claiming other modules comply yet.

## Reproducible checks and preview

Use Node 24 (the repository requires `>=24 <27`). No package installation is
needed for the fixture or pure shell tests:

```sh
node --test web/tests/visuals/integration/shell.test.mjs
node web/tests/visuals/integration/fixture-server.mjs
```

In Codus start the server through `aux_start` in `dev`. The owned port is **3055**,
bound to `127.0.0.1`; preview at `http://localhost:3055/`. No project-specific stable
app domain or frontend environment URL is available in this prerequisite checkout.
The root Compose stack is backend infrastructure and is unnecessary for this
client-only fixture. The listening PID's cwd and port-registry assignment are
checked before treating the preview as this lane's service.

Preview variants: `/?locale=pt-BR&kind=relay`, `/?failure`, and `/?offscreen`.
`#primary-action` is a labelled local example anchor, never a real trip action.
The fixture uses `noindex,nofollow`, labels its demonstration and exposes no
backend or other lane's session. The probe's plain phone icon is testing markup,
not the approved finished illustration. The fixture server serves only owned
integration TypeScript/CSS paths and strips types using Node's built-in API.

Use the embedded browser for interactive inspection. For the exact viewport
matrix and repeatable lifecycle/input evidence, the installed Codus SEO skill's
dependency-free Chrome client supplies the automation harness:

```sh
node web/tests/visuals/integration/browser-check.mjs http://localhost:3055 /tmp/andes-visual-integration-evidence
```

The helper defaults to `~/.claude/skills/codus-site-seo/scripts/browser.mjs`;
override its path with `CODUS_BROWSER_HELPER`. It opens an isolated temporary
Chrome profile and closes it, leaving the embedded/user browser intact. It
downloads no browser. The runner records source SHA and working-tree state so
dirty evidence cannot be mistaken for a frozen source capture.

Coverage: Spanish/pt-BR × phone/relay × 390×844, 1440×900, 1920×1080, 360×800,
430×932; viewport and full-height captures; readable no-JS fallback; import
failure; 4× close-up; source-sized gzip; console/network exceptions; text
contrast; named targets and heading order. Fifteen browser DOM cases check
batched intersection order, cancellation/races, timeout, retry, missing browser
capabilities, remount, failure focus recovery and complete disposal. Trusted browser Enter/touch input,
real intersection and actual reduced-motion emulation supplement those cases.
Tab visibility races are deterministic DOM tests, not an actual phone background
qualification. PNGs still require visual inspection and independent review.

## Remaining integration evidence

The owned `foundation.html` fixture mounts one actual `FoundationRoot`, its
approved home/contact routes, shared `useI18n`, tokens, `PrimaryAction` and
demo banner. Its gateway is explicitly unconfigured/demo, never authenticated.
The synthetic primary control sends nothing. Native help disclosure mounts the
React adapter below that control. No app entry, feature registry or global
stylesheet was edited. This fixture is excluded from the default app build.

```sh
node web/node_modules/typescript/bin/tsc --noEmit -p web/tests/visuals/integration/tsconfig.json
node web/tests/visuals/integration/serve-foundation.mjs --build
node web/tests/visuals/integration/serve-foundation.mjs --preview
node web/tests/visuals/integration/foundation-check.mjs http://localhost:3055 /tmp/andes55-foundation-evidence
```

Run the preview through Codus `aux_start dev`, replacing the earlier standalone
fixture on the same owned port 3055. It consumes the actual shared Vite config
and adds only an owned fixture-entry middleware. `--build` writes to
`/tmp/andes55-foundation-build`, leaving the default `web/dist` intact. The
check uses production output and records twenty locale/kind/viewport cases,
closed/open captures and these integration behaviors: unchanged artwork after
an unrelated primary-action render; old module disposed on locale change;
native background-tab stop with no automatic restart; reduced-motion static
keyboard action; StrictMode and disclosure/remove/remount cleanup; actual
shared-router disposal/return; and an independent primary action after import
failure. The optional synthetic probe is a manifest-declared dynamic chunk.

The build report measures the synthetic production fixture, not an actual
driver/contact feature with finished artwork. The regular foundation build
remains free of visual imports. Whole-app routing/session/no-JS acceptance and
actual artwork bundle cost remain with the next reviewed integration slice.

First publish this adapter with fixture evidence. Next bind reviewed immutable
53/54 modules and 49's rendered foundation, then measure actual production chunk
sizes, initial route imports, browser errors and runtime cleanup on the existing
app paths. Standalone stripped-module gzip does not establish production bundle
cost. The library export/version/licence, figure craft, true no-JS app behavior,
full-app accessibility and physical iPhone behavior remain separate checks.
