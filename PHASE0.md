# Phase 0: reference data (status)

Source: official DBIM v3.0 (January 2025), 176 pages, read from the Toolkit flipbook
(`https://dbimtoolkit.digifootprint.gov.in/dbim-flipbook/text.json` and `pages/p-NNN.jpg`).
Printed page = flipbook page - 20.

## Files
| File | Contents | Confidence |
|---|---|---|
| `reference/palette.json` | 6 primary groups x 5 shades, 12 functional colours | Functional: text (high). Primary: read from Figure 1 image (high, re-verify once). |
| `reference/typography.json` | Noto Sans, desktop + mobile type scale, alignment, CTA, line-height | High. Mobile weights not transcribed. |
| `reference/icons.json` | styles, sizes 24/32/48/64 px (incl. 2 px padding), formats, colours | High (sizes read from Figure 9). |
| `reference/imagery.json` | KB/MB limits, formats, alt text 140 chars, headshot 1:1 | High (text). |
| `reference/header-footer-logo.json` | lockups, header parts, footer mandatory items, lineage text | High. |
| `reference/content-cookie-search-perf.json` | language, 150/250/50 char limits, cookie banner, CCPS, banners, search | High. No numeric performance thresholds in manual. |
| `reference/manual-text.json` | full manual text, 176 pages | Source of truth for rule authors |
| `reference/manual-pages/` | page images for figure-only values (26, 33, 41, 42) | Evidence |
| `rules.json` | 80 rules (id G01-G46, M01-M34) generated from the workbook; `automation` field empty | To be filled in Phase 1 |

## Open items (Phase 0b)
1. ~~Icon bank + logos~~ DONE (Phase 0b): `scripts/fetch-toolkit.mjs` pulled 1,393 icon entries (1,063 line / 1,028 filled SVG files, 22 MB) and 236 logos (8.8 MB) via the Toolkit's JSON API into `reference/icons/` and `reference/logos/`, with SHA-256 + whitespace-normalised hashes in `reference/toolkit-index.json`. TODO: the State Emblem and lockup templates are not in this set (they are drawn in manual figures 20-33); perceptual hashes for raster matches come in Phase 5.
2. **Table 1 usage mapping** (which functional colour for which role, pages 27-28): extraction order is ambiguous; confirm from the page image.
3. **Mobile type weights** (Table 4, page 42) and **line-height** exceptions.
4. **Header/footer exact pixel specs** (Figures 29-33): measure from page images if pixel-level checks are wanted.
5. **KB definition**: manual says "KB/MB"; decide 1000 vs 1024 and state it in reports.
6. **Annexure A** (pages ~100-176) tender/vacancy/PM-quote format details for the Ministry rules.
7. Tag each rule in `rules.json` with automation bucket A/B/C.

## Corrections vs earlier workbook
- Workbook "contrast 3:1" for icons on images is my assumption; the manual only says "sufficient contrast".
- Alt text rules (140 chars, no "image of") exist in the manual but are not in the Level-1 template; consider adding as extra checks.
