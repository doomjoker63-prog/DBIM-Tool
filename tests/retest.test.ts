import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, type AuditFile } from '../src/audit.js';
import { collect, singleUrlRun } from '../src/collect.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildReports } from '../src/report/report.js';
import { findingIndex, observationsOf, statusOf } from '../src/report/xlsx.js';
import { applyReviews } from '../src/review/apply.js';
import { attachRetest, refreshRetest, runRetest, RETEST_FILE, type RetestFile } from '../src/retest.js';
import type { RuleResult, Verdict } from '../src/rules/types.js';
import { startServer } from './helpers.js';

const mk = (id: string, verdict: Verdict, extra: Partial<RuleResult> = {}): RuleResult => ({
  id, checklist: id.startsWith('M') ? 'ministry' : 'generic', no: Number(id.slice(1)), text: `item ${id}`, section: '1', severity: 'Medium', verdict, remarks: `${id} is ${verdict}`,
  automated: true, evidenceCount: 0, affectedUrls: [], ...extra,
});
const file = (results: RuleResult[], site = 'https://www.example.gov.in/'): AuditFile => ({ run: 'r', generatedAt: '', site, pagesAudited: 1, orgType: 'ministry', summary: {}, results });
const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://www.example.gov.in/p${i}`, detail: `instance ${i}` }));

describe('retest comparison', () => {
  const base = file([
    mk('G11', 'Non-Compliance', { evidence: ev(3), evidenceCount: 3, affectedUrls: ['https://www.example.gov.in/p0'] }),
    mk('G12', 'Non-Compliance', { evidence: ev(12), evidenceCount: 12 }),
    mk('G18', 'Compliance'),
    mk('G26', 'Pending'),
    mk('M16', 'Non-Compliance', { automated: false, manual: { reviewer: 'A', date: '2026-01-01' } }),
    mk('M26', 'Non-Compliance', { evidence: ev(1), evidenceCount: 1 }),
    mk('M27', 'Non-Compliance', { evidence: ev(1), evidenceCount: 1 }),
  ]);
  const cur = file([
    mk('G11', 'Compliance'),
    mk('G12', 'Non-Compliance', { evidence: ev(5), evidenceCount: 5 }),
    mk('G18', 'Non-Compliance', { evidence: ev(2), evidenceCount: 2 }), // regression
    mk('G26', 'Non-Compliance', { evidence: ev(1), evidenceCount: 1 }), // new (was Pending)
    mk('M16', 'Pending', { automated: false }),
    mk('M26', 'N/A'),
    mk('M27', 'Non-Compliance', { evidence: ev(1), evidenceCount: 1 }),
  ]);
  const rf = attachRetest(cur, base, 'run-L1');
  const by = (id: string) => cur.results.find(r => r.id === id)!;

  it('classifies each finding', () => {
    expect(by('G11').retest?.status).toBe('CLOSED');
    expect(by('M26').retest?.status).toBe('CLOSED'); // N/A counts as closed
    expect(by('G12').retest?.status).toBe('OPEN');
    expect(by('M27').retest?.status).toBe('OPEN');
    expect(by('M16').retest?.status).toBe('UNVERIFIED');
    expect(by('G18').retest?.status).toBe('NEW');
    expect(by('G26').retest?.status).toBe('NEW');
    expect(rf.counts).toEqual({ CLOSED: 2, OPEN: 2, NEW: 2, UNVERIFIED: 1 });
  });

  it('keeps Level-1 numbering and the original finding text', () => {
    // baseline order: G11=1, G12=2, M16=3, M26=4, M27=5
    expect([by('G11'), by('G12'), by('M16'), by('M26'), by('M27')].map(r => r.retest!.baselineNo)).toEqual([1, 2, 3, 4, 5]);
    expect(by('G11').retest!.baseline!.remarks).toBe('G11 is Non-Compliance');
    expect(by('G11').retest!.baseline!.evidence.length).toBe(3);
    expect(by('G18').retest!.baseline).toBeUndefined();
  });

  it('describes progress and regressions in the retest remark', () => {
    expect(by('G12').retest!.remark).toMatch(/12 in the first test, 5 now \(reduced, not fully fixed\)/);
    expect(by('G18').retest!.remark).toMatch(/regression: it was Compliance/);
    expect(by('G26').retest!.remark).not.toMatch(/regression/);
    expect(by('M16').retest!.remark).toMatch(/dbim review prepare --retest/);
  });

  it('Level-2 observations = all Level-1 findings in order, then new ones; closed ones stay numbered', () => {
    const obs = observationsOf(cur.results, 2).map(r => r.id);
    expect(obs.slice(0, 5)).toEqual(['G11', 'G12', 'M16', 'M26', 'M27']);
    expect(new Set(obs.slice(5))).toEqual(new Set(['G18', 'G26']));
    expect(findingIndex(cur.results, 2).get('G11')).toBe(1);
    expect(findingIndex(cur.results, 1).has('G11')).toBe(false); // Level 1 lists only current Non-Compliance
    expect(statusOf(by('G11'), 2)).toBe('CLOSED');
    expect(statusOf(by('M16'), 2)).toBe('OPEN');
    expect(statusOf(by('G18'), 2)).toBe('OPEN');
  });

  it('is repeatable: re-attaching gives the same result and never mutates the baseline', () => {
    const again = attachRetest(cur, base, 'run-L1');
    expect(again.counts).toEqual(rf.counts);
    expect(base.results.every(r => !r.retest)).toBe(true);
  });
});

describe('retest files', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-rt-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes retest.json, updates results.json, refreshes after a rewrite, and warns on a different site', () => {
    const a = path.join(dir, 'run-a'), b = path.join(dir, 'run-b');
    fs.mkdirSync(a); fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, 'results.json'), JSON.stringify(file([mk('G11', 'Non-Compliance', { evidence: ev(2), evidenceCount: 2 })])));
    fs.writeFileSync(path.join(b, 'results.json'), JSON.stringify(file([mk('G11', 'Compliance')], 'https://other.gov.in/')));
    const { file: rf, warnings } = runRetest(b, a);
    expect(rf.counts.CLOSED).toBe(1);
    expect(warnings.join(' ')).toMatch(/baseline audited/);
    expect(JSON.parse(fs.readFileSync(RETEST_FILE(b), 'utf8')).baselineRun).toBe('run-a');
    // simulate `dbim audit` rewriting results.json without retest info
    const fresh = JSON.parse(fs.readFileSync(path.join(b, 'results.json'), 'utf8')) as AuditFile;
    for (const r of fresh.results) delete r.retest;
    refreshRetest(b, fresh);
    expect(fresh.results[0].retest?.status).toBe('CLOSED');
    expect(() => runRetest(b, b)).toThrow(/same run/);
  });
});

describe('Level 2 end to end (bad page fixed to the good page)', () => {
  let srv: { base: string; close: () => void };
  let outDir: string, runA: string, runB: string;
  const cfg = (level: 1 | 2) => ({ ...DEFAULT_CONFIG, outDir, orgType: 'ministry' as const, viewports: [1440], report: { ...DEFAULT_CONFIG.report, organisation: 'Test Ministry', application: 'Test Site', level } });

  beforeAll(async () => {
    srv = await startServer();
    outDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-l2-'));
    runA = singleUrlRun(outDir, srv.base + '/');
    await collect(cfg(1), runA, { axe: true, screenshots: false, search: true, delayMs: 0 }, () => {});
    audit(cfg(1), runA);
    await new Promise(r => setTimeout(r, 1100)); // run folders are named by second
    runB = singleUrlRun(outDir, srv.base + '/good');
    await collect(cfg(2), runB, { axe: true, screenshots: false, search: true, delayMs: 0 }, () => {});
    audit(cfg(2), runB);
  }, 300000);
  afterAll(() => { srv.close(); fs.rmSync(outDir, { recursive: true, force: true }); });

  let rf: RetestFile;
  it('closes what the fix addressed, flags what needs a manual re-check, finds nothing new', () => {
    rf = runRetest(runB, runA).file;
    expect(rf.counts.CLOSED).toBeGreaterThan(10);
    expect(rf.counts.OPEN).toBe(0);
    expect(rf.counts.NEW).toBe(0);
    const closed = rf.entries.filter(e => e.status === 'CLOSED').map(e => e.id);
    for (const id of ['G11', 'G12', 'G13', 'G15', 'M26']) expect(closed, id).toContain(id);
  });

  it('a manual finding becomes CLOSED only after the re-check is applied', () => {
    const tester = path.join(outDir, 'reviews.json');
    // pick any baseline finding the retest could not verify
    const open = rf.entries.find(e => e.status === 'UNVERIFIED');
    if (!open) return; // everything verified automatically: nothing to apply
    fs.writeFileSync(tester, JSON.stringify({ run: 'x', reviewer: 'Retester', date: '2026-11-02', reviews: { [open.id]: { verdict: 'Compliance', remarks: 'Checked again; fixed.' } } }));
    const r = applyReviews(runB, tester);
    expect(r.applied).toEqual([open.id]);
    const res = r.audit.results.find(x => x.id === open.id)!;
    expect(res.retest?.status).toBe('CLOSED'); // comparison refreshed itself
    expect(res.remarks).toContain('Manual review (Retester');
  });

  it('writes Level-2 workbook and Word report with statuses and RETEST REMARK rows', async () => {
    const files = await buildReports(cfg(2), runB, { formats: ['xlsx', 'docx'], proofs: false }, () => {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files.find(f => f.endsWith('.xlsx'))!);
    const sheet = wb.getWorksheet('Findings')!;
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(expect.arrayContaining(['Retest status', 'Level 1 result', 'Retest remark']));
    const statusCol = header.indexOf('Status') + 1, retestCol = header.indexOf('Retest status') + 1;
    const statuses = new Set<string>();
    sheet.eachRow((row, i) => { if (i > 1) statuses.add(`${row.getCell(statusCol).value}/${row.getCell(retestCol).value}`); });
    expect(statuses.has('CLOSED/CLOSED')).toBe(true);

    const docx = files.find(f => f.endsWith('.docx'))!;
    const script = `
import docx, json, sys
d = docx.Document(sys.argv[1])
fin = [t for t in d.tables if t.rows[0].cells[0].text.strip() == "STATUS"]
rows = lambda t: {r.cells[0].text.strip(): r.cells[1].text for r in t.rows}
print(json.dumps({"n": len(fin), "status": [rows(t)["STATUS"] for t in fin], "retest": [rows(t).get("RETEST REMARK", "") for t in fin],
  "cover": [p.text for p in d.paragraphs[:8] if p.text.startswith("LEVEL")], "images": len(d.inline_shapes)}))`;
    const out = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script, docx], { encoding: 'utf8' }));
    expect(out.cover[0]).toContain('LEVEL – 2');
    expect(out.n).toBe(rf.entries.length);
    expect(out.status).toContain('CLOSED');
    expect(out.retest.every((t: string) => /^(Retested on|Retest pending|Observed during)/.test(t))).toBe(true);
  }, 120000);

  it('gives a closed finding a screenshot of the same place as it is now', async () => {
    // a trimmed copy of run B with only two tracked observations keeps this fast
    const runC = path.join(outDir, 'run-trimmed');
    fs.cpSync(runB, runC, { recursive: true });
    const res = JSON.parse(fs.readFileSync(path.join(runC, 'results.json'), 'utf8')) as AuditFile;
    let kept = 0;
    for (const r of res.results) if (r.retest) { if (r.retest.status === 'CLOSED' && r.retest.baseline?.evidence.some(e => e.selector) && kept < 2) kept++; else delete r.retest; }
    fs.writeFileSync(path.join(runC, 'results.json'), JSON.stringify(res));
    const files = await buildReports(cfg(2), runC, { formats: ['docx'], proofs: true }, () => {});
    const script = `
import docx, json, sys
d = docx.Document(sys.argv[1])
fin = [t for t in d.tables if t.rows[0].cells[0].text.strip() == "STATUS"]
rows = lambda t: {r.cells[0].text.strip(): r.cells[1].text for r in t.rows}
print(json.dumps({"n": len(fin), "poc": [rows(t)["PROOF OF CONCEPT"] for t in fin], "images": len(d.inline_shapes)}))`;
    const out = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script, files[0]], { encoding: 'utf8' }));
    expect(out.n).toBe(2);
    expect(out.poc.every((t: string) => /Retest, no longer observed/.test(t))).toBe(true);
    expect(out.images).toBeGreaterThanOrEqual(2);
  }, 120000);
});
