import fs from 'node:fs';
import path from 'node:path';
import type { AuditFile } from '../audit.js';
import { loadAudit } from '../report/report.js';
import { refreshRetest } from '../retest.js';
import type { ReviewFile } from './types.js';

const FINAL = new Set(['Compliance', 'Non-Compliance', 'N/A']);

/** Merge reviewer verdicts into an audit in memory. Machine verdicts are kept under `machine`; Pending answers are ignored. */
export function mergeReviews(audit: AuditFile, rf: ReviewFile, runDir: string): { applied: string[]; skipped: string[] } {
  const applied: string[] = [], skipped: string[] = [];
  for (const [id, r] of Object.entries(rf.reviews ?? {})) {
    const res = audit.results.find(x => x.id === id);
    if (!res || !FINAL.has(r.verdict)) { skipped.push(id); continue; }
    if (r.verdict === 'Non-Compliance' && !r.remarks?.trim()) { skipped.push(id + ' (Non-Compliance needs remarks)'); continue; }
    if (!res.machine) res.machine = { verdict: res.verdict, remarks: res.remarks };
    res.verdict = r.verdict;
    const who = r.reviewer ?? rf.reviewer, when = r.date ?? rf.date;
    res.remarks = `Manual review (${who}, ${when}): ${r.remarks?.trim() || 'verified.'}`;
    res.confidence = 'high';
    const proof = r.proof ? path.resolve(runDir, 'review', r.proof) : undefined;
    res.manual = { reviewer: who, date: when, proof: proof && fs.existsSync(proof) ? proof : undefined };
    if (r.url && !res.affectedUrls.includes(r.url)) res.affectedUrls = [r.url, ...res.affectedUrls].slice(0, 20);
    applied.push(id);
  }
  audit.summary = {};
  for (const r of audit.results) audit.summary[r.verdict] = (audit.summary[r.verdict] ?? 0) + 1;
  return { applied, skipped };
}

export const STORED = (runDir: string) => path.join(runDir, 'review', 'reviews.json');

/** Apply a reviews.json to results.json and keep a copy with the run so later `dbim audit` runs re-apply it. */
export function applyReviews(runDir: string, file: string): { applied: string[]; skipped: string[]; audit: AuditFile } {
  const rf = JSON.parse(fs.readFileSync(file, 'utf8')) as ReviewFile;
  const audit = loadAudit(runDir);
  const r = mergeReviews(audit, rf, runDir);
  fs.mkdirSync(path.join(runDir, 'review'), { recursive: true });
  // later files add to / override earlier ones
  const prev = fs.existsSync(STORED(runDir)) ? (JSON.parse(fs.readFileSync(STORED(runDir), 'utf8')) as ReviewFile) : null;
  const merged: ReviewFile = { ...rf, reviews: { ...(prev?.reviews ?? {}), ...Object.fromEntries(Object.entries(rf.reviews).filter(([id]) => r.applied.includes(id)).map(([id, v]) => [id, { ...v, reviewer: v.reviewer ?? rf.reviewer, date: v.date ?? rf.date }])) } };
  fs.writeFileSync(STORED(runDir), JSON.stringify(merged, null, 2));
  refreshRetest(runDir, audit);
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(audit, null, 1));
  return { ...r, audit };
}
