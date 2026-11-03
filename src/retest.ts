import fs from 'node:fs';
import path from 'node:path';
import type { AuditFile } from './audit.js';
import type { RetestInfo, RetestStatus, RuleResult } from './rules/types.js';

export interface RetestEntry {
  id: string;
  status: RetestStatus;
  before: string;
  after: string;
  remark: string;
}

export interface RetestFile {
  /** Folder name of the baseline (Level-1) run, resolved against the same runs folder. */
  baselineRun: string;
  date: string;
  counts: Record<RetestStatus, number>;
  entries: RetestEntry[];
}

export const RETEST_FILE = (runDir: string) => path.join(runDir, 'retest.json');
const today = () => new Date().toISOString().slice(0, 10);

/** Level-1 observations are the Non-Compliance results, numbered 1..n in checklist order (matches 8.1, 8.2 ... in the Level-1 report). */
export function baselineFindings(base: AuditFile): RuleResult[] {
  return base.results.filter(r => r.verdict === 'Non-Compliance');
}

const clip = (s: string, n = 260) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Compare a new audit with the baseline and write the outcome into each result's `retest` field.
 *  CLOSED      baseline Non-Compliance, now Compliance or N/A
 *  OPEN        still Non-Compliance
 *  UNVERIFIED  now Pending: a manual item that still needs a human re-check
 *  NEW         Non-Compliance now, but not a Non-Compliance in the baseline (new defect or regression)
 */
export function attachRetest(cur: AuditFile, base: AuditFile, baselineRun: string): RetestFile {
  const date = today();
  const entries: RetestEntry[] = [];
  const counts: Record<RetestStatus, number> = { CLOSED: 0, OPEN: 0, NEW: 0, UNVERIFIED: 0 };
  for (const r of cur.results) delete r.retest;

  const set = (r: RuleResult, status: RetestStatus, remark: string, b?: RuleResult, no?: number) => {
    const info: RetestInfo = { status, remark, baselineRun };
    if (no) info.baselineNo = no;
    if (b) info.baseline = { verdict: b.verdict, remarks: b.remarks, evidence: (b.evidence ?? []).slice(0, 25), affectedUrls: b.affectedUrls, evidenceCount: b.evidenceCount };
    r.retest = info;
    counts[status]++;
    entries.push({ id: r.id, status, before: b?.verdict ?? 'n/a', after: r.verdict, remark });
  };

  baselineFindings(base).forEach((b, i) => {
    const r = cur.results.find(x => x.id === b.id);
    const no = i + 1;
    if (!r) return; // checklist not part of the new run: leave it out rather than invent a result
    const ev = r.evidenceCount;
    if (r.verdict === 'Compliance' || r.verdict === 'N/A') set(r, 'CLOSED', `Retested on ${date}: no longer observed. ${clip(r.remarks)}`, b, no);
    else if (r.verdict === 'Non-Compliance') {
      const delta = b.evidenceCount && ev ? ` Instances found: ${b.evidenceCount} in the first test, ${ev} now${ev < b.evidenceCount ? ' (reduced, not fully fixed)' : ev > b.evidenceCount ? ' (increased)' : ''}.` : '';
      set(r, 'OPEN', `Retested on ${date}: still present.${delta} ${clip(r.remarks)}`, b, no);
    } else set(r, 'UNVERIFIED', `Retest pending on ${date}: this item needs manual re-verification (run: dbim review prepare --retest).`, b, no);
  });

  const baseNC = new Set(baselineFindings(base).map(b => b.id));
  for (const r of cur.results) {
    if (r.verdict !== 'Non-Compliance' || baseNC.has(r.id)) continue;
    const was = base.results.find(x => x.id === r.id)?.verdict;
    const note = was === 'Compliance' ? ' (regression: it was Compliance in the first test)' : was === 'N/A' ? ' (not applicable or not testable in the first test)' : '';
    set(r, 'NEW', `Observed during the retest on ${date}${note}. ${clip(r.remarks)}`);
  }
  const order: Record<string, number> = { CLOSED: 0, OPEN: 1, UNVERIFIED: 2, NEW: 3 };
  entries.sort((a, b) => (cur.results.find(x => x.id === a.id)?.retest?.baselineNo ?? 999) - (cur.results.find(x => x.id === b.id)?.retest?.baselineNo ?? 999) || order[a.status] - order[b.status]);
  return { baselineRun, date, counts, entries };
}

/** Re-attach the retest comparison if this run has one (called after audit / review apply rewrite results.json). */
export function refreshRetest(runDir: string, cur: AuditFile): void {
  const f = RETEST_FILE(runDir);
  if (!fs.existsSync(f)) return;
  const prev = JSON.parse(fs.readFileSync(f, 'utf8')) as RetestFile;
  const baseFile = path.join(path.dirname(runDir), prev.baselineRun, 'results.json');
  if (!fs.existsSync(baseFile)) return;
  const rf = attachRetest(cur, JSON.parse(fs.readFileSync(baseFile, 'utf8')) as AuditFile, prev.baselineRun);
  fs.writeFileSync(f, JSON.stringify(rf, null, 1));
}

export function runRetest(runDir: string, baselineDir: string): { file: RetestFile; warnings: string[] } {
  const curFile = path.join(runDir, 'results.json');
  const baseFile = path.join(baselineDir, 'results.json');
  if (!fs.existsSync(curFile)) throw new Error(`No results.json in ${runDir}. Run collect and audit on the new run first.`);
  if (!fs.existsSync(baseFile)) throw new Error(`No results.json in the baseline ${baselineDir}.`);
  if (path.resolve(runDir) === path.resolve(baselineDir)) throw new Error('The baseline and the retest run are the same run.');
  const cur = JSON.parse(fs.readFileSync(curFile, 'utf8')) as AuditFile;
  const base = JSON.parse(fs.readFileSync(baseFile, 'utf8')) as AuditFile;
  const warnings: string[] = [];
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  if (host(cur.site) !== host(base.site)) warnings.push(`The baseline audited ${base.site} but this run audited ${cur.site}.`);
  if (path.dirname(path.resolve(runDir)) !== path.dirname(path.resolve(baselineDir))) warnings.push('The baseline is in a different runs folder; keep both runs in one folder so the link survives.');
  if (base.orgType !== cur.orgType) warnings.push(`Organisation type differs (${base.orgType} vs ${cur.orgType}); some items may not be comparable.`);
  const file = attachRetest(cur, base, path.basename(baselineDir));
  fs.writeFileSync(curFile, JSON.stringify(cur, null, 1));
  fs.writeFileSync(RETEST_FILE(runDir), JSON.stringify(file, null, 1));
  return { file, warnings };
}
