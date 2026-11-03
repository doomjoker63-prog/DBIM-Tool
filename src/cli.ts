#!/usr/bin/env node
import { Command } from 'commander';
import { DEFAULT_CONFIG, loadConfig, writeDefaultConfig } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from './audit.js';
import { buildReports } from './report/report.js';
import { runRetest } from './retest.js';
import { applyReviews } from './review/apply.js';
import { writeReviewHtml } from './review/html.js';
import { prepareReview } from './review/prepare.js';
import { collect, latestRun, singleUrlRun } from './collect.js';
import { crawl } from './crawler.js';
import { runDoctor } from './doctor.js';
import { login } from './login.js';
import { resolveLive } from './live.js';
import { scan } from './scan.js';
import { askOrgType, askReportDetails, canPrompt, runScanWizard, terminalPrompter, type ScanAnswers } from './wizard.js';
import { loadRules } from './rules.js';

/** Tell the person when a visible window is about to open, and how to hide it. */
function announceLive(cfg: { crawl: { headless: boolean } }, what: string) {
  if (!cfg.crawl.headless) console.log(`Live view: a Chromium window will open and ${what}. Watch it; add --headless to hide it.`);
}

const program = new Command();
program.name('dbim').description('Crawl a government website and test it against DBIM v3.0').version('1.0.0');

program
  .command('init [url]')
  .description('Create dbim.config.json in the current folder')
  .action((url?: string) => {
    console.log('Created', writeDefaultConfig('.', url));
  });

/** Latest run folder whose crawl stopped early and can be continued. */
function latestUnfinished(outDir: string): string | null {
  if (!fs.existsSync(outDir)) return null;
  for (const d of fs.readdirSync(outDir).sort().reverse()) {
    const f = path.join(outDir, d, 'crawl-state.json');
    if (fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).finished === false) return path.resolve(outDir, d);
  }
  return null;
}

program
  .command('crawl [url]')
  .description('Crawl the site and store per-page records. Safe to stop (Ctrl+C) and continue with --resume')
  .option('--max-pages <n>', 'maximum pages', Number)
  .option('--depth <n>', 'maximum link depth', Number)
  .option('--delay <ms>', 'pause between pages', Number)
  .option('--no-sitemap', 'do not seed from /sitemap.xml')
  .option('--live', 'watch it work: one visible Chromium window that crawls and scrolls (the default in a terminal)')
  .option('--headless', 'hide the browser (the default in CI)')
  .option('--headed', 'same as --live')
  .option('--auth <file>', 'Playwright storage-state file for logged-in pages (create it with: dbim login)')
  .option('--resume [run]', 'continue an interrupted crawl (default: the latest unfinished one); raise --max-pages to extend a crawl that hit the limit')
  .option('--ignore-robots', 'ignore robots.txt (only for sites you own or are explicitly authorised to test)')
  .option('--max-minutes <n>', 'stop after n minutes (resumable)', Number)
  .option('--user-agent <ua>', 'custom User-Agent string')
  .option('--retries <n>', 'retries per page on errors / rate limits', Number)
  .action(async (url: string | undefined, o) => {
    const cfg = loadConfig(undefined, { scope: url });
    if (!o.resume && cfg.scope[0] === DEFAULT_CONFIG.scope[0]) throw new Error('Tell me which site to crawl: dbim crawl https://www.your-site.gov.in/ (or set scope in dbim.config.json).');
    if (o.maxPages) cfg.crawl.maxPages = o.maxPages;
    if (o.depth !== undefined) cfg.crawl.maxDepth = o.depth;
    if (o.delay !== undefined) cfg.crawl.delayMs = o.delay;
    if (o.sitemap === false) cfg.crawl.useSitemap = false;
    cfg.crawl.headless = !resolveLive({ live: o.live || o.headed, headless: o.headless }, cfg);
    announceLive(cfg, 'visit and scroll each page');
    if (o.auth) cfg.crawl.storageState = o.auth;
    if (o.userAgent) cfg.crawl.userAgent = o.userAgent;
    if (o.retries !== undefined) cfg.crawl.retries = o.retries;
    let resumeDir: string | undefined;
    if (o.resume) {
      resumeDir = typeof o.resume === 'string' ? path.resolve(cfg.outDir, o.resume) : latestUnfinished(cfg.outDir) ?? undefined;
      if (!resumeDir) throw new Error('No unfinished crawl found to resume.');
    }
    console.log('Only test websites you are authorised to test. Pace: ' + cfg.crawl.delayMs + ' ms between pages' + (cfg.crawl.respectRobots && !o.ignoreRobots ? ', robots.txt respected.' : '.'));
    const r = await crawl(cfg, console.log, { resumeDir, ignoreRobots: !!o.ignoreRobots, maxMinutes: o.maxMinutes });
    const errs = r.pages.filter(p => p.error || (p.status ?? 0) >= 400).length;
    const blocked = r.pages.filter(p => p.blocked).length;
    console.log(`\nRun ${r.runId}: ${r.pages.length} pages, ${errs} with errors${blocked ? `, ${blocked} blocked` : ''}, ${r.assets.length} documents/media, ${r.external.length} external links, ${r.skipped.length} skipped`);
    if (!r.finished) console.log(`Stopped early (${r.stopReason}). Continue with: dbim crawl --resume${r.stopReason === 'max-pages' ? ' --max-pages <higher number>' : ''}`);
    console.log('Saved to', r.runDir);
  });

program
  .command('collect [run]')
  .description('Measure every crawled page and save snapshots; [run] = run folder name, default = latest run')
  .option('--url <url>', 'collect one URL without crawling first')
  .option('--only <n...>', 'only these page numbers from the crawl', (v, p: number[] = []) => [...p, Number(v)])
  .option('--no-axe', 'skip axe-core')
  .option('--no-screenshots', 'skip screenshots')
  .option('--no-search', 'skip the live search test')
  .option('--resume', 'skip pages that already have a snapshot (continue an interrupted collect)')
  .option('--retry-errors', 'with --resume: collect again the pages that failed last time')
  .option('--delay <ms>', 'pause between pages', Number)
  .option('--live', 'watch it work: one visible Chromium window that crawls and scrolls (the default in a terminal)')
  .option('--headless', 'hide the browser (the default in CI)')
  .option('--headed', 'same as --live')
  .action(async (run: string | undefined, o) => {
    const cfg = loadConfig(undefined, { scope: o.url });
    cfg.crawl.headless = !resolveLive({ live: o.live || o.headed, headless: o.headless }, cfg);
    announceLive(cfg, 'visit and scroll each page');
    let runDir: string | null;
    if (o.url) runDir = singleUrlRun(cfg.outDir, o.url);
    else runDir = run ? path.resolve(cfg.outDir, run) : latestRun(cfg.outDir);
    if (!runDir || !fs.existsSync(path.join(runDir, 'crawl.json'))) throw new Error('No crawl run found. Run `dbim crawl` first or pass --url.');
    const files = await collect(cfg, runDir, { axe: o.axe !== false, screenshots: o.screenshots !== false, search: o.search !== false, only: o.only, delayMs: o.delay ?? cfg.crawl.delayMs, resume: !!o.resume, retryErrors: !!o.retryErrors });
    console.log(`\nSaved ${files.length} snapshots to ${path.join(runDir, 'snapshots')}`);
  });

program
  .command('audit [run]')
  .description('Run the DBIM rules over collected snapshots and write results.json; default = latest run')
  .option('--checklist <names>', 'generic,ministry (default from config orgType)')
  .option('--org-type <type>', 'generic = Generic checklist only (PSUs, authorities, other bodies; the default) or ministry = also the 34 Ministry/Department items')
  .option('--all', 'also list items that are not automated yet')
  .option('-y, --yes', 'do not ask which kind of website this is: use --org-type or the config')
  .option('--no-prompt', 'same as --yes')
  .action(async (run: string | undefined, o) => {
    const cfg = loadConfig();
    const runDir = run ? path.resolve(cfg.outDir, run) : latestRun(cfg.outDir);
    if (!runDir) throw new Error('No run found.');
    if (o.orgType) { if (!['generic', 'ministry'].includes(o.orgType)) throw new Error('--org-type must be generic or ministry'); cfg.orgType = o.orgType; }
    else if (!o.checklist && canPrompt({ yes: o.yes, prompt: o.prompt })) {
      const io = terminalPrompter();
      try { cfg.orgType = await askOrgType(io); } finally { io.close(); }
    }
    const a = audit(cfg, runDir, o.checklist?.split(','));
    console.log(a.orgType === 'ministry' ? 'Checklists: Generic (46) + Ministry/Department (34).' : 'Checklists: Generic (46) only. For a Ministry, Department or attached office add --org-type ministry.');
    const mark: Record<string, string> = { Compliance: 'PASS', 'Non-Compliance': 'FAIL', 'N/A': 'N/A ', Pending: '... ' };
    for (const r of a.results.filter(r => o.all || r.automated))
      console.log(`${mark[r.verdict]} ${r.id.padEnd(4)} ${(r.confidence ?? '').padEnd(6)} ${r.text.slice(0, 60).padEnd(60)} ${r.remarks.slice(0, 110)}`);
    console.log('\n' + Object.entries(a.summary).map(([k, v]) => `${k}: ${v}`).join('   '));
    console.log('Saved', path.join(runDir, 'results.json'));
  });

program
  .command('report [run]')
  .description('Write the XLSX workbook and the Word report from results.json; default = latest run')
  .option('--format <list>', 'xlsx,docx', 'xlsx,docx')
  .option('--level <n>', 'report level 1 or 2', Number)
  .option('--org <name>', 'organisation name')
  .option('--app <name>', 'website/application name')
  .option('--report-no <no>', 'report number, e.g. LTPL/DBIM/MOF/01')
  .option('--no-proofs', 'skip red-box screenshots')
  .option('--live', 'show the browser while it captures the proof screenshots (default in a terminal)')
  .option('--headless', 'hide the browser')
  .option('--out <dir>', 'output folder (default: <run>/report)')
  .option('-y, --yes', 'do not ask questions: use the flags, the config and defaults')
  .option('--no-prompt', 'same as --yes')
  .action(async (run: string | undefined, o) => {
    const cfg = loadConfig();
    if (o.level) cfg.report.level = o.level === 2 ? 2 : 1;
    if (canPrompt({ yes: o.yes, prompt: o.prompt })) {
      const io = terminalPrompter();
      try {
        const k: ScanAnswers = { org: o.org, app: o.app, reportNo: o.reportNo };
        const site = cfg.scope[0] ?? '';
        await askReportDetails(io, k, { site, org: cfg.report.organisation, app: cfg.report.application, reportNo: cfg.report.reportNo });
        o.org = k.org; o.app = k.app; o.reportNo = k.reportNo;
      } finally { io.close(); }
    }
    if (o.org) cfg.report.organisation = o.org;
    if (o.app) cfg.report.application = o.app;
    if (o.reportNo) cfg.report.reportNo = o.reportNo;
    const runDir = run ? path.resolve(cfg.outDir, run) : latestRun(cfg.outDir);
    if (!runDir) throw new Error('No run found.');
    cfg.crawl.headless = !resolveLive({ live: o.live, headless: o.headless }, cfg);
    announceLive(cfg, 'capture the proof screenshots');
    const files = await buildReports(cfg, runDir, { formats: String(o.format).split(',') as ('xlsx' | 'docx')[], proofs: o.proofs !== false, outDir: o.out });
    for (const f of files) console.log('Wrote', f);
    console.log('Open the .docx in Word and accept the prompt to update fields so the table of contents refreshes.');
  });

program
  .command('retest [run]')
  .description('Level 2: compare a new run with the Level-1 baseline and mark each finding CLOSED / OPEN / NEW')
  .requiredOption('--baseline <run>', 'folder name of the Level-1 run (inside the runs folder)')
  .action((run: string | undefined, o) => {
    const cfg = loadConfig();
    const runDir = run ? path.resolve(cfg.outDir, run) : latestRun(cfg.outDir);
    if (!runDir) throw new Error('No run found.');
    const { file, warnings } = runRetest(runDir, path.resolve(cfg.outDir, o.baseline));
    for (const w of warnings) console.log('WARNING:', w);
    for (const e of file.entries) console.log(`${e.status.padEnd(10)} ${e.id.padEnd(4)} ${e.before.padEnd(14)} -> ${e.after.padEnd(14)} ${e.remark.slice(0, 110)}`);
    const c = file.counts;
    console.log(`\nClosed ${c.CLOSED}   Still open ${c.OPEN}   New ${c.NEW}   Needs manual re-check ${c.UNVERIFIED}`);
    if (c.UNVERIFIED) console.log('Next: dbim review prepare --retest, answer, dbim review apply reviews.json (the comparison refreshes itself).');
    console.log('Then: dbim report --level 2');
  });

const review = program.command('review').description('Manual review pack for the items the scan cannot decide');
review
  .command('prepare [run]')
  .description('Build runs/<run>/review/review.html with evidence for every item the scan could not decide')
  .option('--all', 'include every item, not only Pending ones')
  .option('--no-visit', 'do not visit About/Team/Vacancies/... pages')
  .option('--ids <list>', 'only these items, comma separated (e.g. M16,M25)')
  .option('--retest', 'only the items a retest could not verify (status UNVERIFIED)')
  .action(async (run: string | undefined, o) => {
    const cfg = loadConfig();
    const runDir = run ? path.resolve(cfg.outDir, run) : latestRun(cfg.outDir);
    if (!runDir) throw new Error('No run found.');
    let ids: string[] | undefined = o.ids ? String(o.ids).split(',').map(s => s.trim().toUpperCase()) : undefined;
    if (o.retest) {
      const a = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8')) as { results: { id: string; retest?: { status: string } }[] };
      ids = a.results.filter(r => r.retest?.status === 'UNVERIFIED').map(r => r.id);
      if (!ids.length) { console.log('Nothing to verify: no UNVERIFIED items in this run. Run `dbim retest` first.'); return; }
    }
    const { dir, pack } = await prepareReview(cfg, runDir, { all: !!o.all, visit: o.visit !== false, ids });
    const html = writeReviewHtml(dir, pack);
    console.log(`
${pack.items.length} item(s) prepared. Open ${html}`);
    console.log('Answer in the page, click "Export reviews.json", then run: dbim review apply <reviews.json>');
  });
review
  .command('apply <file> [run]')
  .description('Merge an exported reviews.json into results.json (kept for later audits)')
  .action((file: string, run: string | undefined) => {
    const cfg = loadConfig();
    const runDir = run ? path.resolve(cfg.outDir, run) : latestRun(cfg.outDir);
    if (!runDir) throw new Error('No run found.');
    const r = applyReviews(runDir, path.resolve(file));
    console.log(`Applied ${r.applied.length} review(s): ${r.applied.join(', ') || '-'}`);
    if (r.skipped.length) console.log(`Skipped: ${r.skipped.join(', ')}`);
    console.log(Object.entries(r.audit.summary).map(([k, v]) => `${k}: ${v}`).join('   '));
  });

const rules = program.command('rules').description('Inspect the DBIM rule catalogue');
rules
  .command('list')
  .option('--checklist <name>', 'generic | ministry')
  .action(o => {
    for (const r of loadRules().filter(r => !o.checklist || r.checklist === o.checklist))
      console.log(`${r.id}  ${r.severity.padEnd(6)} §${r.section.padEnd(8)} ${r.text.slice(0, 90)}`);
  });
rules.command('show <id>').action((id: string) => {
  const r = loadRules().find(x => x.id.toLowerCase() === id.toLowerCase());
  if (!r) return void console.error('No such rule');
  console.log(JSON.stringify(r, null, 2));
});

program
  .command('doctor')
  .description('Check that this machine can run an audit (Node, Chromium, Python/python-docx, data files, output folder)')
  .action(async () => {
    const checks = await runDoctor();
    for (const c of checks) console.log(`${c.ok ? 'OK  ' : c.level === 'error' ? 'FAIL' : 'WARN'}  ${c.name}: ${c.detail}`);
    console.log(`Rules in catalogue: ${loadRules().length}`);
    if (checks.some(c => !c.ok && c.level === 'error')) process.exitCode = 1;
  });

program
  .command('login <url>')
  .description('Open a browser, log in by hand, and save the session for crawling pages behind a login')
  .option('--out <file>', 'where to save the session', 'auth/state.json')
  .action(async (url: string, o) => {
    const file = await login(url, { out: o.out });
    console.log(`\nNext: dbim crawl ${url} --auth ${file}   (or set crawl.storageState in dbim.config.json)`);
  });

program
  .command('scan <url>')
  .description('Crawl, measure, audit and report in one go, then pass/fail for CI (exit 0 = pass, 1 = gate failed, 2 = tool error)')
  .option('--max-pages <n>', 'maximum pages', Number)
  .option('--depth <n>', 'maximum link depth', Number)
  .option('--delay <ms>', 'pause between pages', Number)
  .option('--auth <file>', 'storage-state file for logged-in pages')
  .option('--resume [run]', 'continue an interrupted scan')
  .option('--ignore-robots', 'ignore robots.txt (authorised sites only)')
  .option('--max-minutes <n>', 'stop crawling after n minutes', Number)
  .option('--format <list>', 'reports to write: xlsx,docx or none (default xlsx; the questions offer xlsx + docx)')
  .option('--no-proofs', 'skip red-box screenshots in the Word report')
  .option('--no-axe', 'skip axe-core')
  .option('--no-screenshots', 'skip page screenshots')
  .option('--no-search', 'skip the live search test')
  .option('-y, --yes', 'do not ask questions: use the flags, the config and defaults')
  .option('--no-prompt', 'same as --yes (questions are also skipped in CI and with --json)')
  .option('--fail-on <mode>', 'any | high | new | never', 'any')
  .option('--baseline <run>', 'earlier run folder to compare with (enables Level-2 retest output)')
  .option('--junit <file>', 'write JUnit XML for CI dashboards')
  .option('--live', 'watch it work: one visible Chromium window that crawls, scrolls and captures (the default in a terminal)')
  .option('--headless', 'hide the browser (the default in CI)')
  .option('--org-type <type>', 'generic (default) or ministry')
  .option('--org <name>', 'organisation name for the report')
  .option('--app <name>', 'website/application name for the report')
  .option('--report-no <no>', 'report number, e.g. LTPL/DBIM/NTPC/01')
  .option('--json', 'print a machine-readable summary on stdout (logs go to stderr)')
  .action(async (url: string, o) => {
    const cfg = loadConfig(undefined, { scope: url });
    if (o.maxPages) cfg.crawl.maxPages = o.maxPages;
    if (o.depth !== undefined) cfg.crawl.maxDepth = o.depth;
    if (o.delay !== undefined) cfg.crawl.delayMs = o.delay;
    if (o.auth) cfg.crawl.storageState = o.auth;
    cfg.crawl.headless = !resolveLive({ live: o.live, headless: o.headless }, cfg);
    if (o.orgType && !['generic', 'ministry'].includes(o.orgType)) throw new Error('--org-type must be generic or ministry');
    const parseFormats = (v: string) => v.split(',').map(x => x.trim()).filter(x => x && x !== 'none') as ('xlsx' | 'docx')[];
    let formats = parseFormats(String(o.format ?? 'xlsx'));
    // Ask only what was not given as a flag, and only when a person is at a terminal (never in CI or with --json).
    if (!o.resume && canPrompt({ json: o.json, yes: o.yes, prompt: o.prompt })) {
      const io = terminalPrompter();
      try {
        const known: ScanAnswers = { orgType: o.orgType, org: o.org, app: o.app, reportNo: o.reportNo, maxPages: o.maxPages, formats: o.format !== undefined ? formats : undefined };
        const a = await runScanWizard(io, known, { site: url, org: cfg.report.organisation, app: cfg.report.application, reportNo: cfg.report.reportNo, maxPages: cfg.crawl.maxPages });
        o.orgType = a.orgType; o.org = a.org; o.app = a.app; o.reportNo = a.reportNo; o.maxPages = a.maxPages; formats = a.formats;
      } finally { io.close(); }
    }
    if (o.maxPages) cfg.crawl.maxPages = o.maxPages;
    if (o.orgType) cfg.orgType = o.orgType;
    if (o.org) cfg.report.organisation = o.org;
    if (o.app) cfg.report.application = o.app;
    if (o.reportNo) cfg.report.reportNo = o.reportNo;
    announceLive(cfg, 'crawl, scroll, measure and capture the proof screenshots in the same window');
    if (!['any', 'high', 'new', 'never'].includes(o.failOn)) throw new Error('--fail-on must be any, high, new or never');
    const log = o.json ? (m: string) => console.error(m) : console.log;
    let resumeDir: string | undefined;
    if (o.resume) {
      resumeDir = typeof o.resume === 'string' ? path.resolve(cfg.outDir, o.resume) : latestUnfinished(cfg.outDir) ?? undefined;
      if (!resumeDir) throw new Error('No unfinished crawl found to resume.');
    }
    const r = await scan(cfg, {
      collect: { axe: o.axe !== false, screenshots: o.screenshots !== false, search: o.search !== false },
      crawl: { resumeDir, ignoreRobots: !!o.ignoreRobots, maxMinutes: o.maxMinutes },
      formats, proofs: o.proofs !== false, failOn: o.failOn, baseline: o.baseline, junit: o.junit,
    }, log);
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`\n${r.site}: ${r.pages} page(s) audited. ` + Object.entries(r.summary).map(([k, v]) => `${k} ${v}`).join(', '));
      for (const f of r.findings.slice(0, 25)) console.log(`  ${f.severity.padEnd(6)} ${f.id.padEnd(4)} ${f.title}`);
      if (r.findings.length > 25) console.log(`  ... and ${r.findings.length - 25} more (see results.json)`);
      if (r.retest) console.log(`Retest vs ${o.baseline}: closed ${r.retest.CLOSED}, open ${r.retest.OPEN}, new ${r.retest.NEW}, to re-check ${r.retest.UNVERIFIED}`);
      for (const f of r.files) console.log('Wrote', f);
      console.log(`Gate (${r.gate.mode}): ${r.gate.failed ? 'FAILED' : 'passed'} - ${r.gate.reason}`);
      if (r.incomplete) console.log(`Note: the crawl stopped early (${r.incomplete}); results cover only the pages reached.`);
    }
    process.exitCode = r.exitCode;
  });

program.parseAsync().catch(e => {
  // exit code 2 = the tool itself failed (exit code 1 is reserved for "the audit gate failed" in `scan`)
  console.error(process.env.DBIM_DEBUG ? e.stack : `Error: ${e.message}`);
  if (!process.env.DBIM_DEBUG) console.error('(set DBIM_DEBUG=1 for the full stack trace)');
  process.exit(2);
});
