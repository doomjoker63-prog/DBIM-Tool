# Phase 6: manual-review support (status)

`dbim review prepare [run] [--all] [--no-visit]` builds `runs/<run>/review/review.html` (+ `review.json`, `evidence/*.jpg`) for every item
the automated scan left Pending (23 never-automated items plus automated-but-Pending ones such as G06, G38, G39, G40, G44, M02, M09, M21).
`dbim review apply <reviews.json> [run]` merges the tester's answers into `results.json`; `dbim report` then uses them.

## What the tester gets, per item
- what the scan found (verdict, remarks, evidence lines) and the how-to-test steps from the workbook
- **facts extracted** (ok / warn / info), screenshots, extracted tables and lists, links to the exact pages to open
- a **suggested verdict** only when the facts are clear-cut (the tester still decides)
- verdict buttons, remarks box, and "use as proof of concept" on any screenshot

## Evidence providers
| Item | Evidence |
|---|---|
| G10 icons on images | element screenshots of icons sitting on images |
| G26 logos | logo screenshots + closest official Toolkit logo for each (236-logo index) |
| G36 watermarks/licences | contact sheet of content images, stock-photo source hints |
| G41 consent language | banner screenshot, language options offered |
| M01 information architecture | two-level menu tree, checked against DBIM's five main sections |
| M02-M04 personas | persona words found, home screenshot |
| M05 homepage | table of the 15 DBIM A.4 components (detected / not detected) + full home screenshot |
| M07-M10 PM image and quote | PM section screenshot, quote date age (> 1 year warns), link to Toolkit PM images |
| M11 About | objectives/functions lists found |
| M12, M13, M30 team | page screenshot, names with honorifics in page order |
| M14 organisations | lists/tables of entities |
| M16 vacancies | table rows; rows dated before today flagged; suggests NC when every dated row is closed |
| M17 tenders | rows; IDs > 50 characters; expired dates; suggests NC when all expired |
| M18 documents | share of documents with dates / versions |
| M21, M22 contact | officer roles present/missing, e-mails, phones, map found + map screenshot |
| M23, G38 freshness | per-page "Last updated" dates and age in days |
| M24 CMS workflow | what declaration or CMS screenshot to ask for |
| M25 honorifics | counts per style; suggests NC when the same honorific is written two ways (Dr vs Dr.) |
| M32 keyboard | real Tab-key test of the first form: fields reached, order, visible focus, keyboard trap; suggests Compliance when all pass |
| any item | element screenshots of its own automated evidence on the home page |

Candidate pages (About, Team, Organisations, Vacancies, Tenders, Documents, Contact) are chosen from the site's own menus/footer/crawled pages; the tool visits each (about 9 page loads in total).

## How answers flow back
1. Tester opens `review.html` (works offline; answers kept in the browser), enters a name, answers, clicks **Export reviews.json**.
2. `dbim review apply reviews.json` replaces the verdict with the human one (`Manual review (<name>, <date>): <remarks>`, confidence high), keeps the machine result under `machine`, stores the reviews with the run.
3. Re-running `dbim audit` keeps those manual verdicts. A Non-Compliance without remarks is refused.
4. `dbim report`: reviewed items appear as normal checklist rows ("Manual review (...)" in the workbook), Non-Compliance becomes a numbered finding, and the screenshot chosen as proof is used in the Word report.

## Verified
- 91 tests pass. New end-to-end test: a fixture Ministry site (expired vacancies, 60-char tender ID, "Dr" vs "Dr.", contact page missing officers, stale footer date) -> pack content assertions -> the real review.html opened in Chromium: answer three items, pick a proof image, export -> apply -> re-audit keeps verdicts -> workbook shows them. Also a test that item text containing `</script>` or markup cannot break or inject into the page.
- Real run on the DBIM Toolkit: 33 items prepared, 8 candidate pages visited, review page screenshot checked.

## Bugs found and fixed
Keyboard probe called three different links a "trap" (all labelled "A"; now identity-based); contact roles missed when written in paragraphs (now reads main text); script-escape helper silently did nothing (shell collapsed the backslash) - replaced with code free of backslash literals and covered by the injection test.

## Known limits
1. Extraction is heuristic: pages are found by menu/URL words, tables/lists by structure. The hint text always says what was looked at; wrong page = locate manually.
2. The tool never decides on accuracy of names, hierarchy, quotes, licences or contact details; it shows them next to what to compare with.
3. Candidate pages not linked from the crawled pages are not found. Widen the crawl or add the page to the crawl.
4. Only the first form is keyboard-tested; Enter-to-submit and error announcements are not tested.
5. `review.html` stores answers in the browser; export before clearing site data. Re-importing a saved reviews.json is supported.
