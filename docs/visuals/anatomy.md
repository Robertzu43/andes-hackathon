# Anatomy alert explainer

Component 54 owns `web/src/visuals/anatomy/**`, its tests and this document.
This is an optional parked help figure, with synthetic examples only. It does
not accept a trip, account, incident, sensor, provider or API object.

## Contract and source

The approved foundation packet is the Brain's `andes-app-build/foundation`
packet and `docs/design/visual-addendum.md`, dated 2026-10-17. Its selected light
palette, system font, Spanish and Brazilian Portuguese copy and utility scope
govern this component. The source baseline is foundation prerequisite
`800205a4be2c94833234c852760b2eb09c6ed079`, with Robert's runtime contract at
`ebc8fb1d36f441ef012ca585201cefabf61383d6`. No live API is called.

The explanatory stages map to separate evidence, not a timed delivery pipeline:

| Example | Mechanical pose | Meaning |
| --- | --- | --- |
| Local | Dispatch at rest, carriage at origin, flag low | Pending locally, server acceptance absent |
| Server accepted | Dispatch raised, carriage advanced, flag low | Server accepted the request; delivery unconfirmed |
| Delivery unconfirmed | Exactly the accepted pose | Missing delivery evidence cannot advance the mechanism |
| Contact acknowledged | Accepted pose plus raised independent flag | Explicit synthetic contact acknowledgement; help and delivery remain unconfirmed |

`POST /v1/incidents/:id/acknowledgements` records an attributed acknowledgement
without resolving the incident. The runtime's durable dispatch and callback
sections distinguish queueing, acceptance, delivery and unknown outcomes.
Local queueing is illustrative of a client-side request pending submission;
it does not claim this component implements a persistent SOS queue.
There are no invented deadlines, latencies, safety values or provider results.

## Module interface

```js
import { mountVisual, renderRelay } from './index.mjs';

// Optional static output for SSR or a failed/unavailable module load.
const html = renderRelay('es');

const controller = new AbortController();
const relay = mountVisual(ownedHost, {
  locale: 'es', // 'es' | 'pt-BR'
  motion: 'still', // default; 'interactive' permits finite input-driven easing
  signal: controller.signal,
});
relay.setMotion('interactive');
controller.abort(); // same cleanup as relay.destroy()
```

`AnatomyRelay.tsx` is the React adapter, with `locale` and optional `motion`
props. The framework-neutral entry has an explicit TypeScript declaration.
The integration owner lazy-loads the module within existing help/setup
disclosures after primary actions. This lane adds no app route or scaffold.
The host must be dedicated to this component; mounting replaces its children.

The four native buttons select examples. Enter/Space work natively, arrows
cycle examples, and Home/End select the endpoints. Selected buttons expose
`aria-pressed`; a polite status announces only a deliberate selection. There
are no per-frame announcements. Captions and four separate fact rows are HTML.
With JavaScript disabled, the complete four-example explanation remains.

The module never starts a tour or changes examples on its own. Interactive
motion stops once settled, when the SVG is offscreen, when its tab is hidden,
or when reduced motion is requested. Still mode immediately paints the selected
meaningful pose. Abort disconnects the observer, removes listeners, cancels
frames and restores all static explanations. Multiple mounts have no shared
IDs, listeners or global animation state. Shared CSS variables `--canvas`,
`--surface`, `--ink`, `--muted`, `--primary`, `--on-primary`, `--border` and
`--font-ui` are consumed with exact foundation fallback values.

## Geometry and provenance

Figure tier: 68 purposeful solids. The deck rests on eight foot parts; the
mechanism includes relay laminations and mounts, two rails with stops, a
message carriage and bearing shoes, a guided dispatch paddle, an independent
receipt mast/flag and real fasteners. `geometry.mjs` records every actual drawn
solid. Painter order is solved from true projected overlap and re-sorted during
motion. The accepted/unconfirmed examples share the same geometry.

Anatomy is a source kit, not an npm dependency. Its relevant named exports were
verified against the upstream source before use. The vendored build-only files
match upstream revision `e9488296a44211c42701ff71705b7901470ec78f` byte-for-byte:
[Anatomy source](https://github.com/wheresryan22/anatomy/tree/e9488296a44211c42701ff71705b7901470ec78f).
Full hashes are in `evidence/provenance.json`; the MIT notice is retained at
`web/src/visuals/anatomy/vendor/LICENSE`. The installed skill was not modified.
There is no gallery publication or external deployment.

The browser imports only `index.mjs`, `render.mjs`, `model.mjs`, `styles.mjs`
and generated `art.mjs`. The geometry kit and audit code are build-only.
Combined unminified module source is approximately 162 kB raw, 27.6 kB gzip,
21.3 kB Brotli. These are measured source compression costs, excluding React
already owned by the foundation, and are not a production Vite chunk claim.
There are no new package dependencies, fonts, images, WebGL contexts or remote
requests. Source paths are outside the live journey and contain no private data.

## Reproduce and evidence

Use Node 24 for the complete app. The isolated Node-built-in-only figure tools
also run under Node 22; that does not change the backend's Node requirement.

```sh
node web/tests/visuals/anatomy/build.mjs --audit
node --test web/tests/visuals/anatomy/model.test.mjs
node web/tests/visuals/anatomy/serve.mjs
# In another terminal, with the installed Anatomy browser tools and Chrome:
node web/tests/visuals/anatomy/browser.mjs
node web/tests/visuals/anatomy/lifecycle.mjs
node web/tests/visuals/anatomy/typecheck.mjs /path/to/installed/foundation/web
```

`ANATOMY_DRIVER` and `CHROME_PATH` override local browser tool locations.
The preview server binds only `127.0.0.1:3054` and serves only these owned source
and test trees. It returns 404 for `.env` and all other repository paths.
The lane brief explicitly reserves localhost; no stable domain is configured.
Preview: `http://127.0.0.1:3054/web/tests/visuals/anatomy/preview-es.html`, with
`preview-pt-BR.html` alongside it.

Recorded checks:

- Five pure model/fallback assertions passed, including invariant unconfirmed
  delivery/help and identical accepted/unknown poses.
- Geometry audit passed with 68 true solids, 33 sampled depth/motion states,
  zero clearance/support/penetration/depth/coverage failures. No pipes or shaders
  exist, so pipe/shader-specific checks are inapplicable. Full explode is not
  a control; the audit samples the actual carriage, paddle and flag travel.
- Line-end check: zero floating ends among 50 ends on 27 checked lines in all
  four resting poses. This light-only product has no alternative theme control.
- Both locales at 360×800, 390×844, 430×932, 1440×900 and 1920×1080: no horizontal
  overflow, four visible named controls ≥44 px, working keyboard Home/End and
  correct flag selection. Source and fact rows remain legible below the figure.
- Runtime text contrast: 12.57:1; selected control text: 6.38:1.
- Real Chrome CDP touch input selected the acknowledged example. The native
  accessibility tree exposed four named buttons with the correct pressed state.
- Zero initial autoplay, settled, offscreen and native background-tab frames;
  abort restored static content and detached interaction. See `lifecycle.json`.
  A visible finite transition recorded 36 callbacks, with 0.70 ms p95 script
  cost and 1.10 ms maximum on the final local Chrome run; these are not phone timings.
- Actual script-disabled navigation retained all four static explanations.
  Reduced-motion selection retained a meaningful still flag. No console
  errors or external requests were observed.
- Strict React adapter typecheck passed using the foundation's TypeScript
  5.9.3/React 19 declarations without changing its package or lockfile.
- Resting and acknowledged mechanisms inspected at 4×, including the paddle
  guide, carriage/rail joints, fasteners, flag contact and lamination seams.

Raw PNGs, per-run logs and executable browser actions are under
`web/tests/visuals/anatomy/evidence/`. Browser emulation and CDP touch do not
establish physical iPhone behavior, human comprehension, screen-reader usability,
provider delivery or whole-app acceptance. Independent component56 review and
component55 hosting, then component52 integrated acceptance, remain separate.
Component49 owns the committed rendered foundation; its remote branch was
still at prerequisite `800205a` during this module's proof. Component44 alone
owns merge integration after all actionable reviews are resolved.
