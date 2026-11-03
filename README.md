# dbim-auditor

Command-line tool that opens a government website in Chromium, crawls it, and tests it against the **DBIM v3.0** checklists
(46 generic + 34 Ministry/Department items). It decides 57 of the 80 items itself, prepares a review page for the rest, and writes
the Levithan XLSX workbook and Word report, including a Level-2 retest.

```
npm install
npx playwright install chromium
pip install python-docx                 # only for Word reports
npm run build
node dist/cli.js doctor                 # checks the machine
node dist/cli.js scan https://www.example.gov.in/ --max-pages 60 --format xlsx
```

* **User guide** (workflows, every setting and command, troubleshooting, limits): [docs/USER-GUIDE.md](docs/USER-GUIDE.md)
* **CI** (exit codes, gates, JUnit, workflow template): [docs/CI.md](docs/CI.md)
* How each stage was built and verified: [PHASE0.md](PHASE0.md), [PHASE2.md](PHASE2.md) ... [PHASE9.md](PHASE9.md) (PHASE9: proof screenshots and live view)

Only audit sites you are authorised to test.

## Status

All eight phases are built: reference data from the official manual, crawler (resumable, robots-aware, rate-limit and block aware),
measurement collectors, 57 automatic rules, manual review pack, XLSX + Word reports, Level-2 retest, and the CI `scan` command.
The test suite (`npm test`) drives real Chromium against compliant and deliberately broken fixture pages.
