# Tándem · Design system v1.0

Design delivery, 2026-10-17. This version completes the identity assets, reusable visual component library and six reference screens requested after the initial direction. It is ready for review and implementation handoff; it is not a claim of a shipped mobile application or physical-device validation.

## Identity

The mark combines two adjacent paths into a T: driver and trusted contact moving together. The name retains the accent in display copy. Use the supplied outlined SVG wordmarks, not a retyped approximation. The wordmark is based on Manrope Bold. The icon is custom vector geometry, not a third-party security badge.

Use the ink version on light backgrounds and the white version on ink or action backgrounds. Keep at least one stem width of clear space on every side; avoid placing the mark over maps or photographs. Minimum proposed symbol size: 24 logical pixels; full lockup: 144 logical pixels wide. Keep proportions and the central gap. The 512 × 512 app-icon source includes a rounded presentation tile; native app packaging should apply the platform's required mask and export sizes without a second inset mask.

Assets: [ink wordmark](assets/tandem-logo-ink.svg), [white wordmark](assets/tandem-logo-white.svg), [ink symbol](assets/tandem-mark-ink.svg), [white symbol](assets/tandem-mark-white.svg), [app icon](assets/tandem-app-icon.svg). These are deterministic vectors. No generated bitmap is the source of truth.

## Foundations

[tokens.json](tokens.json) is the canonical, framework-neutral token source. It is a simple project schema, not a claim of compatibility with a Figma token-import plugin. [tokens.css](tokens.css) is generated from it. Figma colors are currently literal fills matching these values; there is no automatic sync service or published variable collection.

The base palette keeps the earlier ink, ivory and petrol direction. Primary action petrol is darkened to `#086F79` to give white text more contrast. `#087F8C` remains the brand accent. Emergency red is exclusive to SOS/incident meaning. Semantic confirmation, uncertainty and urgency use words and icons alongside color; green never means the driver is proven safe.

Manrope is bundled locally under [SIL OFL](assets/fonts/OFL.txt), sourced from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/manrope). Body 18/28, support 16/24, heading 22/30, title 28/36; bold labels 18/24. The action examples use 20-pixel bold text. System clock and demonstration captions in the screen mockups may be smaller; they must not carry operational information. Preserve accents, Portuguese glyphs and dynamic type. Do not rasterize body copy in the implemented app.

Spacing uses 4, 8, 12, 16, 24, 32, 48 and 64 logical pixels. Interactive targets are at least 48 high/wide, ordinary primary buttons 64 high, in-route actions 80 high with 16 between actions. These are design choices, not a demonstrated safe interaction while driving. Controls can grow vertically with text. Radius: controls 12, grouped surfaces 16. Focus uses an ink outer outline with a white gap. Feedback is brief and optional under reduced motion; no critical information relies on animation.

Contrast goals: at least 4.5:1 for normal text and 3:1 for component boundaries. See [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). The calculated token pairs are recorded in [contrast.json](evidence/contrast.json). Passing those pairs is not a complete WCAG audit.

## Reusable component contract

The [component inventory](components.json) names 20 UI samples, imported into Figma and converted into separate native components. Three additional native brand components bring the Figma Assets count to 23. Slash names organise the Assets panel. The state samples are separate components, not a fully configured variant-property API or auto-layout library. This is a usable first visual library with explicit implementation constraints.

| Family | States / behavior |
| --- | --- |
| Action / Primary | Default, pressed, focus, pending, unavailable. Submit once; pending is not server acceptance. Keep focus visible. |
| Action / Secondary | Pause. The label states an action; pausing does not silently revoke map sharing. |
| Action / Emergency | Default, pressed, pending. Use explicit SOS language; block repeated submission of the same pending action without hiding current status. |
| Status / Location | Recent and stale with captured time and accuracy where available. Never infer movement from an old point. |
| Status / Connection | Offline with explicit pending delivery, without a success checkmark. |
| Status / Delivery | Unknown outcome. Do not turn an ambiguous provider result into delivery success. |
| Contact / Consent | Accepted versus invitation pending; pending contacts have no implied access. |
| Field / Destination | Default and error; persistent visible label, associated error text, editable value. |
| Check-in / Context | Deferred prompt. “Responde cuando sea seguro”; missing response does not establish fatigue. |
| Incident / Summary | Driver-reported SOS, time, location availability and open incident status. |
| Delivery / Evidence | Illustrative per-channel evidence. Acceptance, delivery and human acknowledgement remain different facts. |

Map UI must preserve attribution and actual provider terms when integrated. The curved line in the screens is explicitly illustrative; it is not map data or a navigable route. The `Delivery/Evidence/mixed` sample illustrates target semantics and does not assert that a public per-channel evidence endpoint already exists. Connect only to available authenticated data, using [the runtime contract](../contracts/runtime.md).

## Six reference screens

[Prepare](screens/prepare.svg) → [Review](screens/review.svg) → [Active](screens/active.svg), with [Offline](screens/offline.svg), [Deferred check-in](screens/deferred.svg) and [Contact incident](screens/incident.svg). These are editable SVG compositions at 390 × 844. Voice capture, contextual prompting and delivery displays are design requirements; the mockups do not establish their runtime availability.

Voice/text intake and review happen while stationary. Accepted sharing is visible before start. Active trip preserves fixed action order: OK, pause, SOS. Offline keeps the same order. The contact can acknowledge an incident separately from a call or resolution. Arrival does not resolve an open SOS. Additional per-trip contact selection, consent withdrawal and arrival settings should reuse these components when the full client flow is integrated; these six reference screens are not an exhaustive app screen inventory.

Spanish and Brazilian Portuguese action examples are provided in the HTML gallery. Complete Portuguese screen copy, human translation review, night theme, native platform packaging and full application navigation remain integration work; they are not silently represented by this design delivery.

## Preview and maintenance

```sh
node docs/design/build.mjs
node docs/design/check.mjs
python3 -m http.server 8767 --bind 127.0.0.1 --directory docs/design
```

Open `http://127.0.0.1:8767`. The gallery includes an explicit component-text enlargement control for a 200% layout check. Its action buttons only announce demonstration feedback. They do not call an API, send messages, track a phone or persist input. Inputs are examples with accessible labels and errors. SVG screen images are static references; the HTML controls are the surface used for text-resize and keyboard checks.

To regenerate outlined wordmarks only, run `uv run --with fonttools python docs/design/generate-logo.py`. This tooling is outside runtime dependencies. The bundled TTF is the logo source; WOFF2 is the web font. Keep its license with all redistributions. `build.mjs` regenerates SVG boards/screens/icons, CSS tokens and the gallery from the canonical tokens, the outlined logo and documented compositions.

Figma handoff: import `figma/components.svg`, select its 20 direct children and use **Create multiple components**. Keep the outer frame for organisation. Import foundations and flow boards separately, preserving editable text and vectors. If Figma prompts for missing Manrope, choose its available Manrope family and replace; check weights and wrapping. Geometry is fixed reference layout, so implement responsive sizing and platform accessibility rather than scaling screen images into an app.
