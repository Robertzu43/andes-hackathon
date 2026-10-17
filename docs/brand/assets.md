# Foundation brand assets

Source geometry: `web/public/brand/mark.svg`, shared `Brand` component, and private `docs/brand/mark-render.html`. Two exact open brackets express a bounded shared view. The ANDES name uses actual platform system UI type; no generated lettering, downloaded font, private participant data or proof badge is used.

No scaffold favicon existed in the inspected backend or newly authored web package before rendering. The original absence is recorded in `docs/seo/site.config.json`; no existing logo was overwritten.

The same source SVG was rasterized in the owned Chromium preview, with `document.fonts.ready` awaited. All PNGs have RGBA color type 6. The shipped `codus-site-seo/scripts/pack-ico.mjs` validated and packed the three exact favicon sizes.

| Public asset | Dimensions |
| --- | --- |
| `favicon.ico` | 16/32/48 PNG entries |
| `brand/mark-16.png`, `brand/mark-32.png`, `brand/mark-48.png` | 16/32/48 |
| `brand/icon.png` | 512×512 |
| `brand/apple-touch-icon.png` | 180×180 |
| `brand/share.png` | 1200×630, generic Spanish/Portuguese identity |

The author visually inspected the actual 16px mark and share PNG, plus shared header/footer renders. This is builder evidence; independent visual/UI acceptance remains pending. No live-domain brand/SEO check is claimed. Metadata stays generic/noindex and does not expose trip or contact details. The optional Hairline/Anatomy addendum supplies future illustrations independently of these identity assets.
