# Phase 3: rule engine + automatic rules (status)

`dbim audit [run] [--checklist generic,ministry] [--all]` runs the rules over `snapshots/` and writes `runs/<run>/results.json`.
Every catalogue item gets a result: implemented rules give Compliance / Non-Compliance / N/A / Pending with remarks, a confidence
(high/medium/low) and up to 25 evidence lines (URL + measured value); the rest are `Pending: Not automated yet` with the manual how-to-test text.

## Implemented (36 = 33 template items + 3 extras from the manual)
| Area | Rules |
|---|---|
| Colour | G01 one primary group, G02 functional palette, G03 icon colours, G04 footer key colour |
| Icons | G07 formats (icon fonts count as non-compliant), G08 sizes 24/32/48/64, G09 proportion |
| Typography | G11 Noto Sans (rendered), G12 left-aligned, G13 no long all-caps, G14 desktop type scale, G15 contrast (axe), G16 button padding, G17 states, G18 hover |
| Logo / emblem | G20, G27 proportion; G28 format; G29 < 100 KB |
| Imagery | G30 background < 500 KB, G31 banner < 500 KB, G32 thumbnail < 100 KB, G33 < 5 MB, G34 formats |
| Header/footer/consent | G24 header parts, G25 footer parts + lineage, G42 cookie banner |
| Metadata / layout | G45 title, description, lang, keywords; G46 responsive (overflow, viewport meta) |
| Ministry / content | M26 PDF-only documents, M27 date order, M28 HTTPS external links, M31 form instructions, M33 required marker, M34 clickable labels |
| Extras (manual, not in template) | X01 alt text <= 140 chars / no "image of", X02 line-height 1.2-1.5, X03 button text <= 3 words |

## Verification
- 59 tests pass. A compliant fixture page (Noto Sans, Green group, full header/footer, cookie banner, labelled form) yields **zero Non-Compliance**; a deliberately bad page is caught on all 16 asserted rules.
- Building the compliant page exposed two defects, both fixed: footer keywords were matched on flattened text ("Related LinksHelp"), and a header that really overflowed at 375 px (rule was right, fixture was wrong).
- Real-site review of the DBIM Toolkit home page exposed four false results, fixed before release: accessibility controls missed (HTML truncated), footer colour read from CSS when it is an image, Deep Blue root-site colour reported as non-palette, icon-ligature words counted in button labels.

## Known limits (remarks already say so)
1. KB = 1024 bytes. Roles of images (logo / icon / banner / thumbnail) are heuristic: name hints and rendered size.
2. SVG and CSS-drawn logos/emblems are not measured for proportion or size (G20, G27, G29 return N/A).
3. G14 covers desktop only; mobile scale needs a 375 px style pass.
4. G13 cannot detect Hinglish; G15 checks contrast, not whether the colour is the DBIM text colour.
5. Header parts (G24) and cookie banner (G42) are detected from text/attributes; flagged as medium confidence, confirm from screenshots.
6. Icon-font ligature names (e.g. "computer") can leak into button labels (X03).
7. Rules look at the pages that were crawled; a small crawl gives a small sample.
8. Severity comes from the workbook defaults.

## Not yet automated (Phase 5+)
Palette-matched emblem/icon/logo identity (G05, G06, G19, G22, G23, G26), headshots (G37), content accuracy (G38, G39), CCPS (G40), consent language (G41), search behaviour (G43-G44), image-on-banner contrast (G10), watermarks (G36), thumbnail+download pattern (G35), and most Ministry content rules (M01-M25, M29-M30, M32).
