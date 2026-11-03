# Running DBIM Auditor in CI

`dbim scan` is built for unattended runs: one command, a pass/fail exit code, JUnit XML and a JSON summary.

```
dbim scan https://www.example.gov.in/ --max-pages 60 --fail-on high --junit results/junit.xml --format xlsx
```

| Exit code | Meaning |
|---|---|
| 0 | Gate passed |
| 1 | Gate failed (see `--fail-on`) |
| 2 | The tool failed (bad config, site unreachable, block page, missing dependency) |

## Gates (`--fail-on`)

| Mode | Fails when |
|---|---|
| `any` (default) | any Non-Compliance item |
| `high` | any High-severity Non-Compliance item |
| `new` | an item became Non-Compliance compared with `--baseline <run>` (regressions only; known open problems do not fail) |
| `never` | never; use it to just collect reports |

`--baseline` also switches the report to Level-2 form (CLOSED / OPEN / NEW). The baseline run folder must be inside the same `runs/` folder (keep it as a build artifact or commit it under a `baselines/` folder and copy it into `runs/` before the scan).

## Machine-readable output

`--json` prints one JSON document to stdout (logs go to stderr): site, pages, verdict counts, findings (id, severity, title, remarks), retest counts, gate result, files written.
`--junit file.xml` writes JUnit: one suite per checklist, Non-Compliance = failure, Pending/N/A = skipped.

## Example: GitHub Actions (not run here; adapt before use)

`docs/ci/github-actions.yml` is a template. It installs Node and Chromium, builds the tool, scans weekly and on demand, publishes JUnit results and uploads the whole `runs/` folder as an artifact.

## Good practice

* Get written permission and tell the site owner the scan's source IP and User-Agent (`--user-agent "LTPL-DBIM-Audit/1.0 (+contact)"`); many government sites rate-limit unknown clients.
* Keep `--delay` at 800 ms or more, and `--max-pages` modest in CI. Use `--max-minutes` so a slow site cannot hang the job (the crawl stops resumably).
* For logged-in sites store the `auth/state.json` content as a CI secret and write it to a file at job start; use a dedicated read-only account.
* Pin the tool version and the Playwright version together; a Chromium update can change measured values slightly.
* Treat `Pending` as "needs a human", not as a pass: the gate looks only at Non-Compliance.
