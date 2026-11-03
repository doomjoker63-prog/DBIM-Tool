# DBIM Auditor: user guide

A command-line tool that opens a government website in Chromium, crawls it, measures what it finds and checks it against the
DBIM v3.0 checklists (46 generic + 34 Ministry/Department items). It writes the Levithan XLSX workbook and Word report, supports a
Level-2 retest, and can run unattended in CI.

## 1. What it does and does not do

| It does | It does not |
|---|---|
| Measure fonts, colours, sizes, file weights, icons, header/footer parts, forms, links, contrast, responsiveness | Judge whether names, hierarchy, quotes, licences or contact details are *correct* |
| Decide **57 of the 80** checklist items on its own, each with evidence and a confidence level | Decide the other 23 (CCPS, CMS workflow, accuracy of content ...); it prepares a review pack for them instead |
| Say `Pending` when it cannot prove a result | Guess. A `Compliance` always rests on a measurement |
| Test search by typing real queries; test a form with the Tab key | Test everything behind CAPTCHAs or one-time passwords |

Only audit sites you are authorised to test. Keep the delay at 800 ms or more on government sites.

## 2. Install

Requirements: Node.js 20+, Chromium (installed by Playwright), and for Word reports Python 3 with `python-docx`.

```
npm install
npx playwright install chromium
pip install python-docx
npm run build            # creates dist/ (optional; `npx tsx src/cli.ts` runs without building)
node dist/cli.js doctor  # checks everything below and says how to fix what is missing
```
In this guide `dbim` means `node dist/cli.js` (or `npx tsx src/cli.ts`, or run `npm link` once to get a real `dbim` command).

## 3. Quick start (one command)

```
dbim scan https://www.example.gov.in/ --max-pages 60 --format xlsx,docx --org "Name of Organisation" --app "Portal name" --report-no LTPL/DBIM/ORG/01 --org-type generic
```
Crawls, measures, audits and writes `runs/<time>/report/*.xlsx`. Exit code 0 = gate passed, 1 = gate failed, 2 = the tool itself failed.
`--format xlsx,docx` also writes the Word report. `--fail-on any|high|new|never` chooses what fails the gate.

## 4. Full Level-1 workflow (what a tester normally does)

1. `dbim init https://www.example.gov.in/` creates `dbim.config.json`. Fill the `report` section (organisation, application, report number, dates, who it is submitted to) and set `orgType` to `ministry` (adds the 34 Ministry items) or `generic`.
2. `dbim crawl` finds the pages (Ctrl+C is safe; continue with `dbim crawl --resume`).
3. `dbim collect` measures every page and saves a snapshot; adds screenshots, axe-core, a search test and a hover/focus probe.
4. `dbim audit` applies the rules and writes `results.json`.
5. `dbim review prepare`, open `runs/<run>/review/review.html`, answer the items the scan could not decide, click **Export reviews.json**, then `dbim review apply reviews.json`.
6. `dbim report --format xlsx,docx` writes the workbook and the Word report, with red-box screenshots for every finding.
7. Open the Word file and accept the prompt to update fields, so the table of contents fills in its page numbers.

## 5. Level 2 (retest after fixes)

```
dbim crawl <url>   ->  dbim collect  ->  dbim audit          # a NEW run
dbim retest --baseline <level-1-run-folder>
dbim review prepare --retest   (only if some items need a human re-check)  ->  answer  ->  dbim review apply reviews.json
dbim report --level 2
```
Each Level-1 finding becomes CLOSED, OPEN, UNVERIFIED (needs a human re-check) or the retest reports it as NEW. Keep both runs in the same `runs/` folder and use the same crawl scope both times.

## 5a. Watching it work (live view)

When you start `crawl`, `collect`, `scan` or `report` from a terminal, **one Chromium window opens and stays open**. You watch it load each page, scroll down and back up at a followable pace (this also loads lazy images), run the hover and keyboard tests, and later capture the proof screenshots. A small dark badge in the corner of the page says what it is doing ("Crawling page 12 of up to 100") and is removed before anything is measured.

* `scan` uses the **same window for the whole job**; separate commands each open their own.
* `--headless` hides the window (the default in CI and when output is piped); `--live` forces it. Live mode is slower (about 6 s of scrolling per page); use `--headless` for big overnight runs.
* Close nothing manually: the tool closes the window when it finishes. Ctrl+C stops after the current page and the crawl can be resumed.

## 5b. Proof screenshots (what the report shows)

Each finding gets one **proof of concept** image made the way a careful tester would take it:

1. a **browser frame with the real URL** at the top;
2. the live page **scrolled to the offending place** (smooth-scroll and entrance animations are switched off first, the sticky header stays in view), with a **red box on the exact element(s)**: the footer links that are missing an item, every tile that uses the off-palette colour, the heading that is 20 px instead of 24 px, the image that is 1.9 MB;
3. a **measurement panel** underneath in DevTools style, filled with the real values read from the page: the computed style, the Network row (status and size), the `<head>` tags with the missing ones boxed, the DOM text search for "cookie", or the facts for the finding, with the key line boxed.

The red box is **checked in the finished picture** (the tool looks for red pixels along the box border); if it cannot be found it says so in the caption instead of pretending. Captions tell you which kind of proof you have:

* *(no suffix)*: a red box on the page was found and verified.
* *"the finding is boxed in the measurement panel below the page"*: nothing visible can be boxed (missing metadata, a missing banner, a file that is not shown on the page); the proof is the measured values.
* *"the element could not be located on the live page"*: the page changed since the crawl; re-run the scan.

Responsive findings are captured at the failing browser width. The address bar and panel text on the image are drawn by the tool (they are not a real DevTools window); the page area is the real site.

## 6. Reading the results

* **Verdicts**: `Compliance`, `Non-Compliance`, `N/A` (does not apply or nothing to test), `Pending` (the scan cannot decide: manual check or department declaration).
* **Confidence** (`high`/`medium`/`low`): how much the measurement proves. `low` results never fail an item on their own.
* **Evidence**: each Non-Compliance lists the page, the measured value and the element, up to 25 lines (`results.json` has them all).
* **Severity** is the default for the rule; edit it in the Word report if your practice differs.
* `KB` means 1024 bytes everywhere.

## 7. Settings (`dbim.config.json`)

All keys are optional; missing ones use the defaults. Unknown keys produce a warning, wrong values stop the run with a list of what to fix.

| Key | Default | Meaning |
|---|---|---|
| `scope` | example URL | Site to audit; only same-site pages are crawled. A URL on the command line replaces it. |
| `orgType` | `generic` | `generic` = the 46 Generic items only (PSUs, authorities, boards, companies: section 6.2 is dropped from the report). `ministry` = also the 34 Ministry/Department items, for Ministries, Departments and attached offices. Set it per audit with `--org-type`. |
| `colourGroup` | `null` | One of Burgundy, Purple, Blue, Green, Chrome Yellow, Cinnamon Red; `null` = detect from the footer. |
| `crawl.maxPages` / `maxDepth` | 100 / 3 | Limits. |
| `crawl.delayMs` | 800 | Pause between pages. Doubles automatically after rate-limit or block responses. |
| `crawl.retries` | 2 | Retries per page on network errors and HTTP 429/502/503/504, with back-off and `Retry-After`. |
| `crawl.respectRobots` | true | Follow robots.txt (`--ignore-robots` overrides for sites you own). |
| `crawl.userAgent` | `null` | Custom User-Agent. |
| `crawl.maxMinutes` | `null` | Stop (resumably) after this long. |
| `crawl.useSitemap` | true | Seed the crawl from `/sitemap.xml`. |
| `crawl.storageState` | `null` | Session file for pages behind a login (see section 9). |
| `crawl.exclude` | logout paths | Regular expressions of URLs never to open. |
| `crawl.live` | `"auto"` | Visible Chromium window that crawls and scrolls where you can watch. `auto` = visible when you run from a terminal, hidden in CI; `true` / `false` force it. `--live` and `--headless` override per run. |
| `crawl.headless` | true | Set by `crawl.live` and the flags at run time; you normally do not edit it. |
| `viewports` | `[1440, 768, 375]` | Widths for screenshots/overflow checks; the first is used for style measurements. |
| `outDir` | `runs` | Where runs are written. |
| `report.*` | placeholders | organisation, application, reportNo, version, level (1 or 2), jobReceived, startDate, endDate, submittedTo {name,address,email}, constraints, template. Anything left empty stays as a placeholder in the Word file; the command lists which. |

## 8. Commands

| Command | Purpose |
|---|---|
| `doctor` | Check Node, Chromium, Python/python-docx, data files, output folder, disk. |
| `init [url]` | Create `dbim.config.json`. |
| `scan <url>` | Everything in one go + pass/fail for CI. Also `--live` / `--headless`, `--org-type`, `--org`, `--app`, `--report-no`. |
| `crawl [url]` | Find pages. `--live` / `--headless`, `--resume [run]`, `--max-pages`, `--depth`, `--delay`, `--auth`, `--max-minutes`, `--ignore-robots`, `--user-agent`, `--retries`, `--headed`. |
| `collect [run]` | Measure pages. `--url <u>` (one page, no crawl), `--resume`, `--retry-errors`, `--only 1 3`, `--no-axe`, `--no-screenshots`, `--no-search`. |
| `audit [run]` | Apply rules; keeps manual reviews and the retest comparison. `--org-type generic|ministry`, `--all` also lists items not automated. |
| `review prepare [run]` | Build the review page. `--ids M16,M25`, `--retest`, `--all`, `--no-visit`. |
| `review apply <file> [run]` | Merge the exported answers. |
| `retest --baseline <run> [run]` | Compare with Level 1. |
| `report [run]` | `--format xlsx,docx`, `--level 1|2`, `--org`, `--app`, `--report-no`, `--no-proofs`, `--out`. |
| `login <url>` | Log in once by hand and save the session. |
| `rules list|show <id>` | Browse the rule catalogue. |

`[run]` is a folder name inside `runs/`; the default is the latest run. Exit codes: 0 ok, 1 gate failed (`scan`) or doctor found a blocking problem, 2 error (set `DBIM_DEBUG=1` for the stack trace).

## 9. Politeness, blocking and logins

* The crawler is single-threaded, pauses `delayMs` between pages, honours `robots.txt` (including `Crawl-delay`), backs off on 429/503 and doubles its delay.
* If **three pages in a row** look like a captcha / "access denied" screen, it stops instead of hammering the site. Fix: ask the site owner to allow-list the scan, use `--headed`, increase `--delay`, or use a logged-in session.
* **Pages behind a login**: run `dbim login <url>`, log in in the window that opens, press Enter. The session is saved to `auth/state.json`; use `dbim crawl <url> --auth auth/state.json`. Use a read-only account. The file lets anyone act as that user: keep it out of git and delete it after the audit.
* The tool never submits forms or logs in by itself. The only things it does on a page are: type a few menu words into the search box and press Enter (opening a search icon first if needed), hover and focus a dozen links/buttons, and press Tab through the first form. `dbim login` is the only step where a person types credentials, in a visible browser window.
* The tool downloads images and probes file sizes only from public addresses (or from the audited host itself), so a hostile page cannot point it at internal services.

## 10. What is stored

`runs/<time>/`: `crawl.json` + `pages/` (crawl records), `snapshots/` (measurements, including each page's visible text), `shots/` and `proof/` (screenshots), `results.json`, `review/`, `report/`. Nothing is sent to any service of ours or a third party's: the tool only talks to the audited site (and the third-party files its pages load, such as fonts and CDN images), and, when you rebuild the reference data, to the DBIM Toolkit. Delete a run folder to delete its data.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| `doctor` says Chromium cannot start | `npx playwright install chromium` |
| Word report: "python-docx not found" | `pip install python-docx`, or set `DBIM_PYTHON` to the right interpreter. XLSX reports work without it. |
| "Three pages in a row look like a block" | See section 9. |
| Crawl stopped early (`max-pages`, `time-limit`, `interrupted`) | `dbim crawl --resume` (add `--max-pages <higher>` after `max-pages`). |
| Everything is `Pending` for a page | The snapshot has an error; `dbim collect --resume --retry-errors`. |
| Results differ between Level 1 and Level 2 | The crawl scope changed; use the same URL, depth and page limit. |
| Everything is slow and Chromium/node processes pile up | A command was killed mid-run and left child processes; close the leftovers in Task Manager. |
| A proof image has no red box on the page | Read its caption. "Boxed in the measurement panel" is intended for findings with nothing visible to box. "Could not be located" means the page changed; run `scan` again. |
| The report lists Ministry-only findings for a PSU | The audit ran with `--org-type ministry`; run `dbim audit --org-type generic` (the default) and `dbim report` again. |
| Word table of contents has no page numbers | Open in Word and accept "update fields" (or right-click the table > Update field). |
| `dbim.config.json has N problem(s)` | The message lists each one; fix and rerun. |

## 12. Limits you should tell the client about

1. Only the pages crawled are tested; a 100-page limit on a 5,000-page site is a sample.
2. Measurements come from a 1440 px desktop view (type scale), with overflow checks at the other widths.
3. Header, footer, cookie banner, personas and homepage components are recognised heuristically (by landmarks, text and class names); the review pack shows what was found so a human can confirm.
4. Icon, logo and emblem matching is by shape; it can confirm "looks like" but cannot prove authenticity or licence.
5. Spelling uses a British English dictionary and flags names and acronyms for review; grammar is not checked.
6. Accessibility checks come from axe-core, which finds roughly a third of WCAG problems; this is not a GIGW/WCAG certification.
7. The DBIM manual gives no numeric thresholds for performance, so none are enforced.

## 13. For maintainers

* Reference data (palette, type scale, sizes) is in `reference/*.json`, extracted from DBIM v3.0; the Toolkit icon/logo/emblem fingerprints are rebuilt with `scripts/fetch-toolkit.mjs` then `scripts/build-reference-index.ts`.
* Rules live in `src/rules/*.ts` (one function per checklist item, registered in `src/rules/index.ts`). The catalogue text (how to test, finding, impact, recommendation) is in `rules.json`.
* In-page measuring code is plain JavaScript in `inpage/` so the TypeScript build cannot rewrite it.
* `npm test` runs the whole suite (about 2-3 minutes; it drives real Chromium). Compliant and non-compliant fixture pages are in `tests/fixtures/`.

## Word report style

`report.style` in `dbim.config.json` selects the Word typography: `"vapt"` (default) copies the look of Levithan's VAPT report (Cambria cover, Times New Roman headings, Calibri body and tables, 155F82 header bands, BBD4EC label cells, colour-coded verdicts, page border except on the cover, watermark on the cover only); `"template"` keeps the template's own formatting. The profile is `templates/style-vapt.json` (sizes in half-points, widths in twips) and is applied by `python/style_profile.py` after the report is filled, so only formatting changes, never content.

## Guided questions (`dbim scan`)

Run `dbim scan <url>` in a terminal and it asks, in order: website type (1 Generic: the 46 Generic items; 2 Ministry/Department: Generic 46 + Ministry 34), organisation name, website name, report number, maximum pages and which reports to write, then shows a summary and asks to confirm. Press Enter to accept a suggestion (organisation and report number are guessed from the address, e.g. ntpctender.ntpc.co.in gives NTPC and LTPL/DBIM/NTPC/01).

Anything you already gave as a flag (`--org-type`, `--org`, `--app`, `--report-no`, `--max-pages`, `--format`) is not asked again. No questions are asked with `-y/--yes` or `--no-prompt`, with `--json`, with `--resume`, in CI, or when the input is not a terminal, so scripts and pipelines behave exactly as before.

The same questions are used by two other commands, each asking only what it needs: `dbim audit` asks the website type (unless `--org-type` or `--checklist` is given), and `dbim report` asks organisation, website name and report number (unless `--org`, `--app`, `--report-no` are given). Both accept `-y` / `--no-prompt` and stay silent in CI or when not run in a terminal.
