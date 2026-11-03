import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditFile } from '../audit.js';
import { loadSnapshots } from '../audit.js';
import type { DbimConfig } from '../config.js';
import { loadRules } from '../rules.js';
import type { RuleResult } from '../rules/types.js';
import type { Session } from '../session.js';
import { captureProofs, type Proof } from './proof.js';
import { TITLES } from './titles.js';
import { findingIndex, observationsOf, statusOf, writeXlsx } from './xlsx.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const clip = (s: string, n = 380) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });

export interface ReportOptions {
  formats: ('xlsx' | 'docx')[];
  proofs: boolean;
  outDir?: string;
  /** Share one browser window with the crawl and collect steps. */
  session?: Session;
}

export function loadAudit(runDir: string): AuditFile {
  const f = path.join(runDir, 'results.json');
  if (!fs.existsSync(f)) throw new Error(`No results.json in ${runDir}. Run \`dbim audit\` first.`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

const compliance = (r: RuleResult, idx: Map<string, number>) => {
  if (!r.automated && !r.manual) return { remarks: 'Manual verification required (not covered by the automated scan).', compliance: 'Pending' };
  const ref = idx.get(r.id) ? ` (see 8.${idx.get(r.id)})` : '';
  return { remarks: clip(r.remarks) + ref, compliance: r.verdict };
};

export async function buildReports(cfg: DbimConfig, runDir: string, opt: ReportOptions, log: (m: string) => void = console.log) {
  const a = loadAudit(runDir);
  const outDir = path.resolve(opt.outDir ?? path.join(runDir, 'report'));
  fs.mkdirSync(outDir, { recursive: true });
  const base = `DBIM-L${cfg.report.level}-${new URL(a.site).hostname.replace(/[^a-z0-9]+/gi, '_')}`;
  const written: string[] = [];

  if (opt.formats.includes('xlsx')) {
    const f = path.join(outDir, base + '.xlsx');
    await writeXlsx(cfg, a, f);
    written.push(f);
  }

  if (opt.formats.includes('docx')) {
    const level = cfg.report.level;
    const findings = observationsOf(a.results, level);
    // Closed findings: show the same place as it is now (the original evidence points at where the defect was)
    const forProof = findings.map(f => f.retest?.status === 'CLOSED' && f.retest.baseline
      ? { ...f, manual: undefined, affectedUrls: f.retest.baseline.affectedUrls, evidence: f.retest.baseline.evidence.slice(0, 1).map(e => ({ ...e, detail: `Retest, no longer observed (was: ${clip(e.detail, 100)})` })) }
      : f);
    const proofs: Map<string, Proof> = opt.proofs ? await captureProofs(cfg, runDir, forProof, log, opt.session) : new Map();
    for (const f of findings) if (f.manual?.proof && f.retest?.status !== 'CLOSED') proofs.set(f.id, { file: f.manual.proof, highlighted: false, kind: 'view', caption: `Figure: ${TITLES[f.id] ?? f.text} – supplied by manual review (${f.manual.reviewer})` });
    const idx = findingIndex(a.results, level);
    const rules = new Map(loadRules().map(r => [r.id, r]));
    const rowsOf = (key: string) => Object.fromEntries(a.results.filter(r => r.checklist === key).map(r => [String(r.no), compliance(r, idx)]));
    const axeVersion = loadSnapshots(runDir).find(s => s.axe?.version)?.axe?.version;
    const ministry = a.orgType === 'ministry';

    const payload = {
      template: cfg.report.template ? path.resolve(cfg.report.template) : path.join(root, 'templates', 'dbim-report-template.docx'),
      out: path.join(outDir, base + '.docx'),
      meta: cfg.report,
      style: cfg.report.style === 'template' ? null : path.join(root, 'templates', `style-${cfg.report.style}.json`),
      today: today(),
      site: a.site,
      ministry,
      axeVersion,
      constraints: [
        cfg.report.constraints || 'There were no assessment constraints in our audit.',
        `Automated measurements cover ${a.pagesAudited} crawled page(s) of the website. Items marked Pending were not covered by the automated scan and require manual verification, CMS access or a declaration from the department.`,
      ].join(' '),
      generic: rowsOf('generic'),
      ministryRows: rowsOf('ministry'),
      findings: findings.map((r, i) => {
        const def = rules.get(r.id);
        // Level 2 describes the original observation; the retest outcome goes in the RETEST REMARK row.
        const b = level === 2 ? r.retest?.baseline : undefined;
        const evList = (b ? b.evidence : r.evidence) ?? [];
        const total = b ? b.evidenceCount : r.evidenceCount;
        const ev = evList.slice(0, 8).map(e => '• ' + clip(e.detail, 260));
        const more = total > ev.length ? [`… and ${total - ev.length} more instance(s) (see results.json).`] : [];
        const now = r.retest && r.retest.status !== 'CLOSED' ? (r.evidence ?? []).slice(0, 5).map(e => '• ' + clip(e.detail, 220)) : [];
        const urls = b?.affectedUrls.length ? b.affectedUrls : r.affectedUrls;
        return {
          title: TITLES[r.id] ?? r.text,
          status: statusOf(r, level),
          retest: level === 2 ? [r.retest?.remark ?? 'Not retested: no baseline is attached to this run (run dbim retest).', ...now] : [],
          reference: r.checklist === 'extra' ? `DBIM v3 – Section ${r.section} (additional check from the manual)` : `DBIM v3 – Section ${r.section}, ${r.checklist === 'generic' ? 'Generic' : 'Ministry'} Checklist #${r.no}`,
          description: [b ? b.remarks : r.remarks, ...ev, ...more],
          impact: def?.impact ?? '',
          urls: urls.length ? urls : [a.site],
          recommendation: 'Levithan Recommends: ' + (def?.recommendation ?? ''),
          proof: proofs.get(r.id) ?? null,
          n: i + 1,
        };
      }),
    };
    const pf = path.join(outDir, 'payload.json');
    fs.writeFileSync(pf, JSON.stringify(payload, null, 1));
    const py = process.env.DBIM_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    const res = execFileSync(py, [path.join(root, 'python', 'fill_template.py'), pf], { encoding: 'utf8' });
    const info = JSON.parse(res.trim().split('\n').pop()!);
    written.push(info.saved);
    if (info.placeholdersLeft.length) log(`Placeholders still in the report (set report.* in dbim.config.json): ${[...new Set(info.placeholdersLeft)].join(', ')}`);
  }
  return written;
}
