# Phase 8: hardening (status)

## Added
| Area | What |
|---|---|
| Crash / interrupt safety | Crawl saves `crawl-state.json` and `crawl.json` atomically after every page; `dbim crawl --resume` continues without re-fetching finished pages (also extends a crawl that hit `--max-pages`). `dbim collect --resume [--retry-errors]` skips pages that already have a snapshot. Snapshots and state are written write-then-rename, so a kill never leaves a half-written file. Ctrl+C stops after the current page and says how to resume. |
| Politeness | robots.txt (Allow/Disallow, longest match, `*` and `$`, per-agent groups, `Crawl-delay`) with `--ignore-robots` override; per-page retries with exponential back-off and `Retry-After`; the delay doubles after 429/503/block responses (cap 15 s); `--max-minutes` time limit; custom `--user-agent`. |
| Block detection | Short "access denied / captcha / checking your browser" pages and 403/406 are flagged `blocked`; three in a row stop the crawl with advice instead of hammering the site. |
| Logins | `dbim login <url>` opens a visible browser, the person logs in, the session is saved (file permission 0600 where supported, with a warning about its sensitivity). `--auth` uses it. |
| Config | `dbim.config.json` is validated: bad types/ranges, invalid URL/regex, missing session or template file, unknown colour group all stop the run with one list of problems; unknown keys and a very short delay warn. |
| Untrusted-site safety | Downloads and size probes taken from page content are refused for private / loopback / link-local / metadata addresses unless the audited site itself is that host (`src/net-guard.ts`). Review page and Word fill were already text-escaped. |
| CI | `dbim scan <url>`: crawl, collect, audit, optional retest and reports, then gate `--fail-on any|high|new|never`; exit 0 / 1 / 2; `--junit file.xml`; `--json` summary on stdout. |
| Operations | `dbim doctor` checks Node, Chromium, sharp, Python + python-docx, reference data, template, output folder, disk (exit 1 on a blocking problem). Errors print one clear line (`DBIM_DEBUG=1` for the stack) and exit 2. |
| Packaging and docs | `npm run build` verified: the compiled CLI finds data, template and in-page scripts from `dist/` and runs from any folder. Version 1.0.0. `docs/USER-GUIDE.md`, `docs/CI.md`, `docs/ci/github-actions.yml`, README rewritten. |

## Verified
- 128 tests pass (about 2.5 minutes), 23 of them new: config validation (every error and warning), robots parsing, the fetch guard, block detection, 429 retry with attempt count and robots skipping, `--ignore-robots`, stop after three blocks, resume without re-fetching (hit counts on the test server), collect resume and retry-errors, a real form login through `dbim login` then an authenticated crawl that reaches a members-only page the anonymous crawl cannot, JUnit mapping and escaping, and `scan` gates (compliant page passes, bad page fails with matching JUnit failures, `high`, `never`, `new` with a baseline in both directions, unreachable site).
- Built CLI (`node dist/cli.js`): `doctor`, error exit codes, and a real 3-page `scan` of the DBIM Toolkit with JUnit (exit 0 under `--fail-on high`).

## Not verified (be aware)
1. The Ctrl+C handler itself is not exercised automatically; the state it relies on is (resume test). Test it by pressing Ctrl+C during a crawl.
2. `dbim login` was tested headless with a scripted form; the interactive Enter-to-continue path and a visible window were not.
3. `docs/ci/github-actions.yml` is a template that has not been run on GitHub; no Dockerfile is provided.
4. Block detection is a text heuristic; unusual WAF pages may be missed (the crawl then continues and records the pages, with little useful content), and a legitimate short error page may be flagged.
5. robots.txt is applied to the crawler only; the collect step visits the pages the crawl already accepted, and review/report screenshots revisit pages from the audit.
6. No concurrency: large sites take time by design (about 20 s per page with all collectors on).
