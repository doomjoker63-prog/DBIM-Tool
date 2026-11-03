# Phase 9: proof screenshots and live view (status)

Triggered by comparing the tool's NTPC report with the manual auditor's IGMRI report (`IGMRI DBIM Report.pdf`) and the DBIM manual.

## What was wrong (measured, not guessed)
| # | Problem | Evidence |
|---|---|---|
| 1 | Screenshot taken while the page was still scrolling | NTPC sets `scroll-behavior: smooth`; `scrollY` went 0 -> 1107 -> 4619 -> 5523 -> 5890 over 1.3 s, the old code waited 0.25 s: blank or wrong-place images |
| 2 | 9 of 24 findings had nothing to draw a box around | G01, G02, G16, G38, G42, G44, G45 ... carried no element |
| 3 | Box invisible on big elements | an edge-to-edge footer/header put the outline on the screen edge |
| 4 | Image wider than the Word cell | inserted at 6.0 in into a 5.39 in cell |
| 5 | Responsive findings shot at the wrong width | taken at 1440 px when the failure is at 375 px |
| 6 | Content that only appears on scroll was not yet drawn | white bands at the top of several proofs |
Found by the same comparison: G24 false positive (language/text-size controls in a bar above `<header>`), Ministry-only items applied to a PSU (default org type was `ministry`), and G43/G44 judged on noise (a page saying "0 live tenders" was counted as having 2 results).

## What was built
* `src/proof/` (new engine): `plan.ts` (what to box and show per finding), `engine.ts` (steady page: smooth scroll and animations off, reveal-by-scrolling, instant scroll below any sticky header, overlay boxes inset from the screen edge, re-measure after scroll), `panel.ts` + `compose.ts` (browser frame with the real URL + DevTools-style panel with real computed style / Network row / `<head>` tags / DOM search / facts, key line boxed), `verify.ts` (looks for the red border in the finished image).
* Evidence hints (`proof:` on evidence in the rules): colour to find, region (header/footer links, bottom strip), failing viewport, URL override (search results page), panel kind, measured facts.
* Retry with a second scroll strategy if the box is not found; honest captions when it cannot be (`panel` / `view`).
* Live view: `src/session.ts` (one Chromium; one shared tab when visible), `src/live.ts` (progress badge removed before measuring, followable scroll, `resolveLive`), `--live` / `--headless`, default visible in a terminal and hidden in CI, `scan` shares one window across crawl, collect and proofs.
* Fixes found on the way: header controls above `<header>`, default `orgType: generic` with `--org-type`, `scan --org/--app/--report-no`, search rules (works = executes; relevance only when results are shown), compact `<head>` panel boxing only the missing tags.

## Verified
* 150 tests pass (22 new): planning rules; a fixture that reproduces smooth scroll + sticky header + reveal-on-scroll and checks the green target block is on screen with a red box around it (the old method photographed it mid-scroll); full-width footer boxed on all four sides; colour-based boxing; responsive width; absence proofs; missing target does not pretend; live helpers (badge removed, scroll reaches the bottom and returns, one tab in live mode, clean data); header-controls fix; search rule semantics; org-type default.
* NTPC re-run (same 3 pages): 18 findings, 16 with a pixel-verified red box on the page, 2 proven in the panel (an image that is not displayed, missing metadata); Word file passes the schema validator; images 3.9 to 5.2 in wide (cell 5.39 in). Output copies: `R:\DBIM\DBIM-L1-ntpctender_ntpc_co_in_NEW-PROOFS.docx` / `.xlsx`.
* A real headed run (`--live`) of crawl and collect on the DBIM Toolkit launched the window and finished; I could not watch the window myself, so the visual experience is for you to judge.

## Still different from the manual auditor (not built)
The IGMRI report has findings the tool does not produce: heading hierarchy H1>H2>H3 (8.8), utility/embedded pages without header and footer (8.11), table cell alignment rules (8.14), missing form placeholders (8.13), footer-link hover (partly: G18 samples a few links), text colour vs the DBIM text colours (we check contrast only). Their reports also describe impact and recommendations in more specific prose; ours come from templates plus measured values.

## Known limits
1. The address bar and panel are drawn by the tool, not captured from a real DevTools window; the page area is real. The caption and the guide say so.
2. Heuristic boxes: "region" boxes the links/headings of a header or footer; a finding about a whole region (for example, footer colour) boxes the element itself.
3. Elements inside iframes or closed shadow DOM cannot be located by selector.
4. Live mode is slower (about 6 s of scrolling per page).
5. If a site shows a modal or cookie overlay on first visit, proofs show the page as a first-time visitor sees it.
