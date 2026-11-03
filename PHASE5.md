# Phase 5: semi-automatic rules (status)

57 of the 80 template items are now evaluated automatically (42 generic, 15 ministry) plus 3 extras from the manual. Phase 3 had 35; Phase 5 added 22.
(The Phase 3 note said 33; the correct number was 35.)

## New evidence collected (`dbim collect`)
| Evidence | How | Used by |
|---|---|---|
| Shape fingerprints of icons, logos, emblem, PM image (img files and inline SVG) | `src/imaging.ts` (sharp): 16x16 blurred ink-density grid, compared by correlation, colour- and size-independent | G05, G06, G19, G22, M07 |
| Toolkit reference index: 2,089 icons + the State Emblem | `scripts/build-reference-index.ts` -> `reference/icon-index.json`, `emblem.json`, `emblem.svg` | G06, G19 |
| Live search test (first page): 3 queries taken from the site's own menu words, typed into the search box | `src/collectors/search.ts` | G43, G44 |
| Videos (controls, muted, loop, captions track), personas, link targets, longer link/heading text | `inpage/page-data.js` | M20, M02, G35, M15, M19 |
| Network recording now stops before the search test | `network.ts` `stop()` removes the listener | G38 (no cross-page leakage) |

## Rules added
| Rule | What it does | Verdicts it can give |
|---|---|---|
| G05 icon style | line vs filled inferred from stroke/fill and ink coverage | Pending when mixed (inference too weak for a failure), Compliance, N/A |
| G06 icons from Toolkit | each icon vs 2,089 Toolkit icons, similarity >= 0.92 | Compliance (>=80% match), else Pending with the unmatched list. Never NC: the kit may not have an equivalent. |
| G19 emblem | shape vs Toolkit emblem (works for SVG or raster) | Compliance >= 0.90, NC < 0.75, Pending between or when no emblem found |
| G21 / G23 name and header | Ministry: "Government of India" + Ministry/Department in header; emblem, search, navigation present | NC / Compliance for Ministry orgType, Pending otherwise |
| G22 emblem colour | white on dark, black on light background | NC / Compliance, Pending for image backgrounds or mid-tones |
| G35 thumbnails for hi-res | large images shown small without a link to the original | NC / N/A |
| G37 headshots 1:1 | person-like images must be square | NC / N/A (face coverage and background are not checked) |
| G38 broken / placeholder content | HTTP errors, failed images/CSS/JS, "lorem ipsum", "coming soon" | NC when found, otherwise Pending (completeness needs a human) |
| G39 language | en-GB dictionary check + common Hinglish words | NC for Hinglish, Pending with the word list for spelling, Compliance if clean |
| G40 CCPS | data request to a CCPS endpoint | Compliance if seen, else Pending (department must confirm) |
| G43 / G44 search | queries typed into the real search box; results page checked | G43 NC/Compliance; G44 NC only when no query gives relevant results, else Pending |
| M02 personas, M06 social, M07 PM image transparency, M09 PM quote, M15 / M19 title lengths, M20 captions, M21 contact roles, M29 archive | see `src/rules/semi.ts` | each states what it could and could not verify |

Still manual (23): G10, G26, G36, G41, M01, M03-M05, M08, M10-M14, M16-M18, M22-M25, M30, M32.

## Verified
- 79 tests pass. The compliant fixture (real Toolkit search icon, Toolkit emblem rendered to PNG, working search, social + archive links) has zero Non-Compliance; the bad fixture is caught on G19, G37, G38, G39, G43, M06, M20, M29.
- Calibration: an icon re-rendered at 24/48 px matches its own Toolkit original with correlation median 0.98 (p10 0.93); the typical best wrong match is 0.82 but can reach 0.97 because the library has many similar shapes. That is why G06 can only confirm or ask for review.
- Real site (DBIM Toolkit, 5 pages): search tested live (3/3 and 2/2 queries returned results), emblem matched, a 404 image found (`assets/bg.png`), "organize" flagged as non-British, 16 decorative looping videos correctly ignored.

## Bugs found and fixed while building
Cross-page request leakage into the home page's resource list (search test); CCPS detection fooled by an image file named CCPS-*.svg; decorative background videos flagged for captions; the 196 KB emblem SVG failing the 100 KB logo rule (a true result, fixture changed to PNG).

## Known limits
1. Emblem "authorised source" cannot be proven from a page; only shape and colour are checked.
2. Icon-style (G05) and headshot (G37) checks are heuristics; both avoid hard failures where confidence is low.
3. Spelling: names, acronyms and transliterated words are reported for review, not failed; grammar is not checked.
4. Search relevance is judged only on three queries from the site's own menu words; PDFs and image metadata coverage is not tested.
5. M21 needs the Contact Us page in the crawl; with a small crawl it stays Pending.
6. Search test runs on the first page only, and navigates away from it (resources are frozen first).
