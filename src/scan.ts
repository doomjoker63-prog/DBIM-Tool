import path from 'node:path';
import { audit, type AuditFile } from './audit.js';
import { collect, type CollectOptions } from './collect.js';
import type { DbimConfig } from './config.js';
import { crawl, type CrawlOptions } from './crawler.js';
import { buildReports } from './report/report.js';
import { writeJunit } from './report/junit.js';
import { TITLES } from './report/titles.js';
import { runRetest, type RetestFile } from './retest.js';
import { openSession } from './session.js';

export type FailOn = 'any' | 'high' | 'new' | 'never';

export interface ScanOptions {
  collect: Pick<CollectOptions, 'axe' | 'screenshots' | 'search'>;
  crawl?: CrawlOptions;
  formats: ('xlsx' | 'docx')[];
  proofs: boolean;
  failOn: FailOn;
  /** Run folder name of an earlier scan; required for failOn "new" (and adds the retest comparison to the report). */
  baseline?: string;
  junit?: string;
}

export interface ScanResult {
  runDir: string;
  site: string;
  pages: number;
  summary: Record<string, number>;
  findings: { id: string; severity: string; title: string; remarks: string }[];
  retest?: RetestFile['counts'];
  gate: { mode: FailOn; failed: boolean; reason: string };
  /** 0 = gate passed, 1 = gate failed. Tool errors throw and are exit code 2 in the CLI. */
  exitCode: 0 | 1;
  files: string[];
  incomplete?: string;
}

/** crawl -> collect -> audit -> (retest) -> reports, then decide pass/fail for CI. */
export async function scan(cfg: DbimConfig, opt: ScanOptions, log: (m: string) => void = console.log): Promise<ScanResult> {
  if (opt.failOn === 'new' && !opt.baseline) throw new Error('--fail-on new needs --baseline <run>: it fails only on problems that are new compared with that run.');
  // one Chromium for the whole job: in a visible window the person watches the same window crawl, scroll, measure and capture proofs
  const session = await openSession(cfg, { bypassCSP: true, viewport: { width: cfg.viewports[0] ?? 1440, height: 900 } });
  try {
  const cr = await crawl(cfg, log, { ...opt.crawl, session });
  const usable = cr.pages.filter(p => !p.error && !p.blocked && (p.status ?? 0) < 400);
  if (!usable.length) throw new Error(`No page could be loaded${cr.stopReason === 'blocked' ? ' (the site blocked the crawler)' : ''}; nothing to audit. Check the URL, network access and --auth.`);
  log(`Crawled ${cr.pages.length} page(s)${cr.finished ? '' : ` (stopped early: ${cr.stopReason}; resume with --resume)`}.`);

  await collect(cfg, cr.runDir, { ...opt.collect, delayMs: cfg.crawl.delayMs, resume: !!opt.crawl?.resumeDir, retryErrors: true, session }, log);
  const a: AuditFile = audit(cfg, cr.runDir);

  let retest: RetestFile['counts'] | undefined;
  if (opt.baseline) {
    const r = runRetest(cr.runDir, path.resolve(cfg.outDir, opt.baseline));
    for (const w of r.warnings) log('WARNING: ' + w);
    retest = r.file.counts;
  }

  const files: string[] = [];
  if (opt.formats.length) {
    const level = opt.baseline ? 2 : cfg.report.level;
    files.push(...(await buildReports({ ...cfg, report: { ...cfg.report, level } }, cr.runDir, { formats: opt.formats, proofs: opt.proofs, session }, log)));
  }
  if (opt.junit) { writeJunit(a, opt.junit); files.push(path.resolve(opt.junit)); }

  const nc = a.results.filter(r => r.verdict === 'Non-Compliance');
  const high = nc.filter(r => r.severity === 'High');
  let failed = false, reason = 'gate disabled';
  switch (opt.failOn) {
    case 'any': failed = nc.length > 0; reason = `${nc.length} Non-Compliance item(s)`; break;
    case 'high': failed = high.length > 0; reason = `${high.length} High-severity Non-Compliance item(s)`; break;
    case 'new': failed = (retest?.NEW ?? 0) > 0; reason = `${retest?.NEW ?? 0} new Non-Compliance item(s) compared with ${opt.baseline}`; break;
  }
  return {
    runDir: cr.runDir, site: a.site, pages: a.pagesAudited, summary: a.summary,
    findings: nc.map(r => ({ id: r.id, severity: r.severity, title: TITLES[r.id] ?? r.text, remarks: r.remarks })),
    retest, gate: { mode: opt.failOn, failed, reason }, exitCode: failed ? 1 : 0, files,
    incomplete: cr.finished ? undefined : cr.stopReason,
  };
  } finally {
    await session.close();
  }
}
