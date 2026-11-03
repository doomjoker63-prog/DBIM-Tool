import ExcelJS from 'exceljs';
import type { AuditFile } from '../audit.js';
import type { DbimConfig } from '../config.js';
import { loadRules } from '../rules.js';
import type { RuleResult } from '../rules/types.js';
import { TITLES } from './titles.js';

const YELLOW = 'FFFFFF00';
const VERDICT_FILL: Record<string, string> = { Compliance: 'FFC6E0B4', 'Non-Compliance': 'FFF8CBAD', 'N/A': 'FFD9D9D9', Pending: 'FFFFE699' };
const SEV_FILL: Record<string, string> = { High: 'FFF8CBAD', Medium: 'FFFFE699', Low: 'FFC6E0B4' };
const thin = { style: 'thin' as const };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function style(ws: ExcelJS.Worksheet, widths: number[], centre: number[] = []) {
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.eachRow(row => {
    row.eachCell(c => {
      c.border = BORDER;
      c.font = { name: 'Calibri', size: 11, bold: row.number === 1 };
      c.alignment = { wrapText: true, vertical: 'middle', horizontal: row.number === 1 || centre.includes(c.fullAddress.col) ? 'center' : 'left' };
      if (row.number === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    });
  });
  ws.getRow(1).height = 36.75;
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
}

const fill = (c: ExcelJS.Cell, argb: string) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } });

/** Human sentence for how the result was produced. */
const how = (r: RuleResult) => (r.manual ? `Manual review (${r.manual.reviewer}, ${r.manual.date})` : r.automated ? `Automated (${r.confidence ?? 'n/a'} confidence)` : 'Manual - not automated');

export async function writeXlsx(cfg: DbimConfig, a: AuditFile, file: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'dbim-auditor';
  const meta = cfg.report;

  // ---- Summary
  const sum = wb.addWorksheet('Summary');
  const rows: [string, string | number][] = [
    ['Organisation', meta.organisation], ['Application', meta.application], ['URL', a.site], ['Report No.', meta.reportNo], ['Level', `Level ${meta.level}`],
    ['Run', a.run], ['Generated', a.generatedAt], ['Pages audited', a.pagesAudited], ['Checklists', a.orgType === 'ministry' ? 'Generic (46) + Ministry/Department (34)' : 'Generic (46)'],
    ['', ''], ['Compliance', a.summary['Compliance'] ?? 0], ['Non-Compliance', a.summary['Non-Compliance'] ?? 0], ['N/A', a.summary['N/A'] ?? 0], ['Pending (manual / declaration)', a.summary['Pending'] ?? 0],
    ['', ''], ['Automated checks', a.results.filter(r => r.automated && r.checklist !== 'extra').length], ['Manual checks', a.results.filter(r => !r.automated).length],
    ['', ''], ['Note', 'Automated verdicts are measurements of the crawled pages only. Items marked Pending must be verified manually or by department declaration. KB = 1024 bytes.'],
  ];
  rows.forEach(r => sum.addRow(r));
  sum.getColumn(1).width = 34; sum.getColumn(2).width = 90;
  sum.eachRow(row => row.eachCell(c => { c.alignment = { wrapText: true, vertical: 'top' }; c.font = { name: 'Calibri', size: 11, bold: c.fullAddress.col === 1 }; }));
  for (const [i, k] of [[11, 'Compliance'], [12, 'Non-Compliance'], [13, 'N/A'], [14, 'Pending']] as const) fill(sum.getCell(i, 1), VERDICT_FILL[k]);

  // ---- checklists (same column logic as the report tables)
  const sec = [['Generic Checklist', 'generic'], ['Ministry Checklist', 'ministry']] as const;
  const level = cfg.report.level;
  const findingNo = findingIndex(a.results, level);
  for (const [name, key] of sec) {
    const list = a.results.filter(r => r.checklist === key);
    if (!list.length) continue;
    const ws = wb.addWorksheet(name);
    ws.addRow(['S. No.', 'Checklist', 'Category', 'DBIM Section', 'Severity', 'Compliance', 'Remarks', 'Confidence', 'How checked', 'Finding ref']);
    const cat = new Map(loadRules().map(r => [r.id, r.category]));
    for (const r of list) {
      const row = ws.addRow([r.no, r.text, cat.get(r.id) ?? '', r.section, r.severity, r.verdict, r.automated || r.manual ? r.remarks : 'Manual verification required.', r.automated || r.manual ? r.confidence ?? '' : '', how(r), findingNo.get(r.id) ? `8.${findingNo.get(r.id)}` : '']);
      fill(row.getCell(6), VERDICT_FILL[r.verdict]);
      if (SEV_FILL[r.severity]) fill(row.getCell(5), SEV_FILL[r.severity]);
    }
    style(ws, [8, 55, 22, 12, 11, 17, 70, 12, 22, 11], [1, 4, 5, 6, 8, 10]);
  }

  // ---- Findings (vulnerability-DB style)
  const f = wb.addWorksheet('Findings');
  f.addRow(['SI NO', 'Observation', 'Checklist ref', 'Severity', 'Status', 'Finding', 'Risk / Impact', 'Recommendation', 'Affected URLs', 'Evidence (sample)', ...(level === 2 ? ['Retest status', 'Level 1 result', 'Retest remark'] : [])]);
  const rulesById = new Map(loadRules().map(r => [r.id, r]));
  let n = 0;
  for (const r of observationsOf(a.results, level)) {
    const def = rulesById.get(r.id);
    const b = level === 2 ? r.retest?.baseline : undefined;
    n++;
    const row = f.addRow([
      n, TITLES[r.id] ?? r.text, r.checklist === 'extra' ? `DBIM v3 - Section ${r.section}` : `DBIM v3 - Section ${r.section}, ${r.checklist === 'generic' ? 'Generic' : 'Ministry'} Checklist #${r.no}`,
      r.severity, statusOf(r, level), b ? b.remarks : r.remarks, def?.impact ?? '', 'Levithan Recommends: ' + (def?.recommendation ?? ''),
      (b?.affectedUrls.length ? b.affectedUrls : r.affectedUrls).join('\n'), ((b ? b.evidence : r.evidence) ?? []).slice(0, 8).map(e => e.detail).join('\n'),
      ...(level === 2 ? [r.retest?.status ?? 'NOT RETESTED', b?.verdict ?? 'not a finding in Level 1', r.retest?.remark ?? ''] : []),
    ]);
    if (SEV_FILL[r.severity]) fill(row.getCell(4), SEV_FILL[r.severity]);
  }
  style(f, [8, 40, 34, 11, 9, 70, 40, 50, 45, 70, ...(level === 2 ? [14, 20, 70] : [])], [1, 4, 5, ...(level === 2 ? [11] : [])]);
  if (level === 2) f.eachRow((row, i) => { if (i > 1) fill(row.getCell(5), row.getCell(5).value === 'CLOSED' ? VERDICT_FILL.Compliance : VERDICT_FILL['Non-Compliance']); });

  await wb.xlsx.writeFile(file);
}

/** Findings get numbers 8.1, 8.2 ... in the order they appear in the report (Non-Compliance only). */
export function findingIndex(results: RuleResult[], level: 1 | 2 = 1): Map<string, number> {
  const m = new Map<string, number>();
  observationsOf(results, level).forEach((r, i) => m.set(r.id, i + 1));
  return m;
}

/**
 * Observations in the report. Level 1: every Non-Compliance. Level 2: every Level-1 finding (open or closed, in its
 * original order) followed by anything new, so numbering 8.1, 8.2 ... stays the same between the two reports.
 */
export function observationsOf(results: RuleResult[], level: 1 | 2 = 1): RuleResult[] {
  if (level === 2) {
    const tracked = results.filter(r => r.retest);
    if (tracked.length) return [...tracked].sort((a, b) => (a.retest!.baselineNo ?? 1e6) - (b.retest!.baselineNo ?? 1e6));
  }
  return results.filter(r => r.verdict === 'Non-Compliance');
}

/** OPEN / CLOSED as shown in the report. UNVERIFIED and NEW items are still open. */
export const statusOf = (r: RuleResult, level: 1 | 2 = 1): 'OPEN' | 'CLOSED' => (level === 2 && r.retest?.status === 'CLOSED' ? 'CLOSED' : 'OPEN');
