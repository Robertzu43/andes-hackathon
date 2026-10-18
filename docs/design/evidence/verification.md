# Design verification · 2026-10-17

## Delivered

- Five SVG brand assets; outlined wordmarks do not require an installed font.
- Local Manrope TTF/WOFF2 plus SIL OFL license.
- Semantic JSON/CSS tokens; 20 UI component samples and six 390 × 844 SVG screen references.
- HTML gallery with keyboard-accessible controls, explicit demo-only feedback, Spanish and Brazilian Portuguese action samples, and a 200% component-text test mode.
- Figma: **23 native components** (20 UI + three brand assets), visible in “Created in this file”; identity and flow boards preserve editable text and vectors. File reload retained the new pages and boards. Existing AWS architecture page is retained.

## Checks performed

`node docs/design/build.mjs` regenerated the boards, screens, tokens and preview. `node docs/design/check.mjs` passed 14 contrast pairs, nominal target-size assertions, component-name uniqueness, screen count and local HTML asset links. It also checks that the small demonstration script has no network API calls.

Chrome browser inspection through the computer-use tools:

- 320, 768 and 1440 CSS-pixel widths: no document horizontal overflow, loaded Manrope, all gallery action targets at least 80 high.
- 390 × 844: Spanish controls measured 310 × 80, 20-pixel labels. Tab moved focus from OK to pause with a visible 3-pixel outline. Clicking OK announced “Demostración: no se envió ningún aviso.”
- Component text mode at 200% and 390 pixels: action labels measured 40 pixels, buttons grew to 90–202 pixels without clipped content or horizontal document overflow. Portuguese demo feedback was observed. This is the gallery's explicit CSS text-enlargement mode, not iOS/Android Dynamic Type or a physical-device test.
- Six screen SVGs inspected at 390 pixels. The active screen had no text outside the viewport; the remaining five had no text crossing the right 24-pixel margin.
- Figma Assets displayed “Created in this file 23 components”. The identity/flow page remained after reload.

## Scope of evidence

This validates design artifacts and the isolated preview, not the backend/client integration. No runtime dependencies or product endpoints changed, so backend database tests were not rerun. No independent accessibility audit, screen-reader session, physical phone, road use, sunlight/night glare, native text scaling, trademark review or real emergency delivery test was performed.

Figma components are reusable local masters with separate state names. They do not yet provide a published cross-file library, variable bindings, full auto-layout behavior or an exhaustive screen flow. Screen boards use the same generated component geometry but are reference compositions, not linked Figma instances or an executable app prototype. These boundaries are explicit in the handoff rather than implied by the screenshots.
