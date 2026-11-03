# Phase 2: collectors (status)

`dbim collect [run] [--url <url>] [--only N] [--no-axe] [--no-screenshots]` visits each crawled page once at 1440 px and writes
`runs/<run>/snapshots/NNN_<slug>.json` (+ `shots/*.jpg` at 1440 / 768 / 375). Rules (Phase 3+) read only snapshots.

## Snapshot fields (`PageSnapshot`, src/collect.ts)
| Field | From | Used by (examples) |
|---|---|---|
| `fonts.rendered[group]` | CDP `CSS.getPlatformFontsForNode` (heading, body, link, button, header, footer) | G11 Noto Sans |
| `fonts.declared` | `document.fonts` | G11 supporting evidence |
| `data.textStyles[group]` | computed style: size, weight, line-height ratio, colour, effective background, align, text-transform, all-caps flag | G12-G15 |
| `data.colours` | usage counts of text/background/border hex | G01-G04 |
| `data.images`, `data.backgrounds` | natural vs rendered size, alt, region, logo/emblem hint, aspect delta | G07-G09, G20, G26-G37 |
| `data.icons` | inline SVG + icon-font size/colour/background | G03-G10 |
| `data.controls`, `hover[]` | button size/padding/words; hover and focus style changes | G16-G18 |
| `data.header`, `data.footer`, `data.cookie`, `data.search` | structure + keyword presence | G19-G25, G40-G45 |
| `data.forms`, `data.links`, `data.docs`, `data.bodyText`, `data.meta` | forms, links, documents, text, headings, meta | G38-G45, M-checklist |
| `axe` | axe-core (wcag2a/2aa/21a/21aa/best-practice) | G15, G10 contrast |
| `resources[]` | every response: type, status, bytes (+ source of size) | G07, G28-G34 |
| `responsive[]` | per viewport: overflow, offenders, min font, menu toggle, screenshot | G46 |

## Verified
- 13 tests pass (fixture page with deliberate violations: Arial font, justified/centred text, all-caps heading, 600 KB image drawn 300x50,
  insecure link, .docx link, unlabeled form fields, no header/footer parts, axe colour-contrast failure, horizontal overflow).
- Real page (DBIM Toolkit home): Noto Sans detected as rendered font, 15 images, 31 icons, header emblem, footer keywords, 95/95 resources with byte sizes, 3 screenshots, axe run, hover/focus probe. ~19 s per page.

## Known limitations (rules must respect these)
1. **Rendered font names include the weight** ("Noto Sans SemiBold"): match by prefix `Noto Sans`.
2. **Hover on card-style links** can be reported as "no change" when the effect is on a parent/sibling (e.g. image swap on card hover). Treat "no change" on large links as Pending, not Non-Compliance. Plain text links and buttons are reliable.
3. **Detection by heuristics**: header/footer use `<header>/<footer>` or ARIA roles; cookie banner needs a fixed/sticky element containing "cookie"; emblem by name/alt/id hints. Sites without landmarks produce `found:false` -> Pending.
4. **One viewport for style data** (1440). Mobile type-scale checks need a 375 px style pass (not yet collected; only overflow/min-font are).
5. Images in CSS `srcset`/`picture` use the browser's chosen `currentSrc` only.
6. Page-load time (~10 s on the Toolkit) is dominated by `networkidle` + lazy-scroll; reduce for bulk runs with `--no-axe --no-screenshots`.
7. Logged-in pages need `--auth` storage state (crawl) / `storageState` in config (collect).
