# Foundation brand assets

Source geometry: the Tándem T-mark and outlined Manrope wordmark from `docs/design/assets/` (`generate-logo.py`). `web/public/brand/mark.svg` is `tandem-mark-ink.svg`; the header `Brand` component inlines `tandem-logo-ink.svg` with coordinates rounded to 0.1 units; `brand/share.svg` is the share-image source. Manrope (SIL OFL 1.1) is self-hosted at `web/public/fonts/manrope.woff2` with its `OFL.txt`; it is the same file the pitch deck embeds.

The PNGs were rasterized from those SVGs in an owned headless Chrome through `web/tests/foundation/cdp.mjs`, with the font loaded; `brand/icon.png` is `tandem-app-icon.png`. `favicon.ico` packs the 16/32/48 PNGs as PNG entries. The earlier ANDES bracket mark is retired from the web app; ANDES remains the repository and hackathon identifier.

| Public asset | Dimensions |
| --- | --- |
| `favicon.ico` | 16/32/48 PNG entries |
| `brand/mark-16.png`, `brand/mark-32.png`, `brand/mark-48.png` | 16/32/48 |
| `brand/icon.png` | 512×512 |
| `brand/apple-touch-icon.png` | 180×180 |
| `brand/share.png` | 1200×630, Tándem logo with the Spanish and Portuguese tagline |

The author visually inspected the actual 16px mark and share PNG, plus shared header/footer renders. This is builder evidence; independent visual/UI acceptance remains pending. No live-domain brand/SEO check is claimed. Metadata stays generic/noindex and does not expose trip or contact details. The user-supplied Tándem identity and optional visual modules have separate source contracts; this file records the existing public asset provenance.
