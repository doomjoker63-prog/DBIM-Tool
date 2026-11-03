# Phase 7: retest / Level 2 (status)

Workflow after the department fixes issues:
```
dbim crawl <url>  ->  dbim collect  ->  dbim audit            # a NEW run of the same site
dbim retest --baseline <level-1-run-folder>                    # compare with the Level-1 run
dbim review prepare --retest  ->  answer  ->  dbim review apply reviews.json   # only if some items need a human re-check
dbim report --level 2                                          # Level-2 XLSX + Word
```
Keep both runs in the same `runs/` folder (the new run stores the baseline's folder name in `retest.json`).

## What `dbim retest` decides (per Level-1 finding, matched by rule id)
| Status | When | Report status |
|---|---|---|
| CLOSED | now Compliance or N/A | CLOSED |
| OPEN | still Non-Compliance (remark shows instance count 12 -> 5 "reduced, not fully fixed" or "increased") | OPEN |
| UNVERIFIED | now Pending: a manual item that needs a human re-check | OPEN until reviewed |
| NEW | Non-Compliance now but not in Level 1; "regression" if it was Compliance, "not applicable in the first test" if N/A | OPEN |

- Baseline is never modified. The comparison is repeatable and **refreshes itself** after `dbim audit` or `dbim review apply`, so a manual re-check turns UNVERIFIED into CLOSED/OPEN without re-running retest.
- Warnings: different site, different organisation type, baseline in another folder.

## Level-2 report
- Observations keep their Level-1 numbers (8.1, 8.2 ...), closed ones included, followed by new ones.
- DESCRIPTION = the original Level-1 observation; **RETEST REMARK** = retest outcome (date, instance change, current evidence); STATUS = OPEN or CLOSED; cover says LEVEL - 2.
- PROOF OF CONCEPT: open items show the current red-boxed element; closed items show the same place as it is now ("Retest, no longer observed ...").
- XLSX Findings sheet adds Retest status, Level 1 result, Retest remark (CLOSED green, OPEN red).
- `dbim review prepare --retest` builds a pack of only the UNVERIFIED items, each starting with "Level 1 finding to re-verify: ..." and the affected URLs.

## Verified
- 101 tests pass. Unit tests cover every status and the numbering/order; file tests cover retest.json, refresh after a rewrite and warnings; the end-to-end test audits the bad fixture as Level 1 and the compliant fixture as the fixed site, runs the retest, applies a manual re-check, and builds Level-2 XLSX + Word (statuses, RETEST REMARK rows, cover) plus a screenshot test for closed findings.
- Real run (two Toolkit runs): Level-2 Word report validates against the original template (schema check), 25 observations.

## Notes and limits
1. Matching is by checklist item, not by URL or element: if a defect moves to another page the item still counts as OPEN, which is the intended reading.
2. A different crawl scope between runs changes results (a one-page Level 1 vs a five-page retest produces "NEW" items that were simply not visible before). Use the same scope for both runs; the remark says when an item was N/A before.
3. Manual items are never closed automatically.
4. Windows: leftover node/Chromium processes from killed commands slow everything (tests ran 5x slower until they cleared). Let commands finish or stop them from the Task Manager.
