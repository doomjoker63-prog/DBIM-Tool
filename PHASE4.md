# Phase 4: reports (status)

`dbim report [run] [--format xlsx,docx] [--level 1|2] [--org ..] [--app ..] [--report-no ..] [--no-proofs] [--out dir]`
writes into `runs/<run>/report/`:

| File | Content |
|---|---|
| `DBIM-L<level>-<host>.xlsx` | Summary, Generic Checklist, Ministry Checklist, Findings (vulnerability-DB style columns: observation, ref, severity, status OPEN, finding, impact, recommendation, affected URLs, evidence). Same look as `vulnerabity db.xlsx` (yellow header, borders, wrapped text, filters, frozen row). |
| `DBIM-L<level>-<host>.docx` | The Levithan template filled in: cover, document/contact/scope/scan tables, constraints, tools (axe version), standard followed, both checklists (remarks + verdict per item), summary table (section 7), one detailed table per finding (section 8) with red-box screenshot and caption, TOC entries rewritten. Section 6.2 is removed when `orgType` is `generic`. Level-1 reports drop the RETEST row. |
| `proof/<rule>.jpg` | Screenshots with the offending element outlined in red (no text on the image). Tall elements get a taller viewport. Findings without an element selector get an unmarked page view and say so in the caption. |
| `payload.json` | Exactly what was sent to the Word filler (for debugging). |

Metadata comes from `dbim.config.json` -> `report` (organisation, application, reportNo, version, level, jobReceived, startDate, endDate, submittedTo, constraints, template).
Anything left empty stays as the template's placeholder, and the CLI lists which ones.

## How it works
- XLSX: exceljs (TypeScript). DOCX: `python/fill_template.py` (python-docx) edits the template in place, so styles/headers/tables are exactly yours. Needs Python 3 + `pip install python-docx` (override interpreter with `DBIM_PYTHON`).
- Unautomated items are written as `Pending` with "Manual verification required", never as Compliance.
- Findings are numbered 8.1, 8.2 ... in checklist order; the checklist remark carries "(see 8.n)".

## Verified
- 61 tests pass, including an end-to-end test (collect -> audit -> report) that opens the generated XLSX (sheets, row counts, header colour) and DOCX (no leftover "[Observation", no unfilled verdict placeholders, one table + one image per finding, organisation filled, reference format).
- Word file passes the docx skill's schema validator against the original template.
- Real run on the DBIM Toolkit page: 12 findings, 12 screenshots, 13 images, TOC rewritten.
- Defects found and fixed while building: TOC entries matched instead of headings; duplicate bookmark ids from cloned headings; stale TOC entries; icon-font false positive (class name "icon" on a Noto Sans element); tall elements cut off in screenshots.

## Known limits
1. **Not rendered visually here** (no Word/LibreOffice on this machine): checked structurally and by reading the file back. Open one report in Word and look before sending to a client.
2. **Table of contents page numbers are blank until Word updates fields.** The file asks Word to update on open (answer Yes). Other viewers show titles without page numbers.
3. Finding descriptions are measurement text plus up to 8 evidence lines, not hand-written prose. Edit in Word if you want to rephrase.
4. Severity is the workbook default per rule; status is always OPEN at Level 1. `dbim retest` (Phase 7) will set CLOSED.
5. One screenshot per finding (first evidence item). Page-wide findings (fonts, metadata, cookie banner) use a page view.
6. `Job Received Date`, submitted-to details and scan dates must be supplied in the config.
