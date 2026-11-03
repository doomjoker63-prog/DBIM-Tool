import fs from 'node:fs';
import path from 'node:path';
import { loadReference } from './rules.js';

export type OrgType = 'ministry' | 'generic';

export interface ReportMeta {
  organisation: string;
  application: string;
  reportNo: string;
  version: string;
  /** 1 = first audit, 2 = retest. */
  level: 1 | 2;
  jobReceived: string;
  startDate: string;
  endDate: string;
  submittedTo: { name: string; address: string; email: string };
  /** Free text for section 3; empty = "no constraints" sentence. */
  constraints: string;
  /** Path to a .docx template; null = bundled Levithan DBIM template. */
  template: string | null;
  /** Word typography: "vapt" (Levithan VAPT report look, default) or "template" (keep the template's own formatting). */
  style: 'vapt' | 'template';
}

export interface DbimConfig {
  /** Start URL(s). Only same-origin pages of the first URL are crawled. */
  scope: string[];
  orgType: OrgType;
  /** Key of reference/palette.json primary groups, e.g. "Green". Null = detect in Phase 5. */
  colourGroup: string | null;
  crawl: {
    maxPages: number;
    maxDepth: number;
    /** Pause between page loads in ms. */
    delayMs: number;
    useSitemap: boolean;
    /** Path to a Playwright storage state file for pages behind login. */
    storageState: string | null;
    headless: boolean;
    /** Regex strings; matching URLs are not crawled. */
    exclude: string[];
    /** Visible browser window that crawls and scrolls where you can watch. "auto" = visible in a terminal, hidden in CI. */
    live: boolean | 'auto';
    /** Retries per page on network errors and 429/502/503/504 (with back-off). */
    retries: number;
    /** Follow robots.txt Disallow rules for the crawler. */
    respectRobots: boolean;
    /** Custom User-Agent string; null = the browser default. */
    userAgent: string | null;
    /** Stop (resumably) after this many minutes; null = no limit. */
    maxMinutes: number | null;
  };
  viewports: number[];
  outDir: string;
  report: ReportMeta;
}

export const DEFAULT_CONFIG: DbimConfig = {
  scope: ['https://www.example.gov.in/'],
  orgType: 'generic',
  colourGroup: null,
  crawl: {
    maxPages: 100,
    maxDepth: 3,
    delayMs: 800,
    useSitemap: true,
    storageState: null,
    headless: true,
    exclude: ['/logout', '/signout'],
    live: 'auto',
    retries: 2,
    respectRobots: true,
    userAgent: null,
    maxMinutes: null,
  },
  viewports: [1440, 768, 375],
  outDir: 'runs',
  report: {
    organisation: '[Organisation Name]',
    application: '[Website / Application Name]',
    reportNo: 'LTPL/DBIM/[ORG]/[NN]',
    version: '1.0',
    level: 1,
    jobReceived: '',
    startDate: '',
    endDate: '',
    submittedTo: { name: '', address: '', email: '' },
    constraints: '',
    template: null,
    style: 'vapt',
  },
};

export const CONFIG_FILE = 'dbim.config.json';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const KNOWN_TOP = new Set(['scope', 'orgType', 'colourGroup', 'crawl', 'viewports', 'outDir', 'report']);

/** Check a (merged) config. Errors stop the run; warnings are printed. */
export function validateConfig(cfg: DbimConfig, raw: unknown = cfg): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const int = (name: string, v: unknown, min: number, max: number) => { if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) errors.push(`${name} must be a whole number from ${min} to ${max} (got ${JSON.stringify(v)}).`); };
  if (isObj(raw)) for (const k of Object.keys(raw)) if (!KNOWN_TOP.has(k)) warnings.push(`Unknown setting "${k}" is ignored (known: ${[...KNOWN_TOP].join(', ')}).`);
  if (!Array.isArray(cfg.scope) || !cfg.scope.length) errors.push('scope must be a list with at least one URL.');
  else for (const u of cfg.scope) { try { if (!/^https?:$/.test(new URL(u).protocol)) throw new Error(); } catch { errors.push(`scope contains an invalid URL: ${JSON.stringify(u)} (use https://...).`); } }
  if (!['ministry', 'generic'].includes(cfg.orgType)) errors.push(`orgType must be "ministry" or "generic" (got ${JSON.stringify(cfg.orgType)}).`);
  if (cfg.colourGroup != null) {
    const groups = Object.keys(loadReference<{ primary: Record<string, string[]> }>('palette.json').primary);
    if (!groups.includes(cfg.colourGroup)) errors.push(`colourGroup must be one of ${groups.join(', ')} or null (got ${JSON.stringify(cfg.colourGroup)}).`);
  }
  const c = cfg.crawl;
  int('crawl.maxPages', c.maxPages, 1, 5000);
  int('crawl.maxDepth', c.maxDepth, 0, 10);
  int('crawl.delayMs', c.delayMs, 0, 60000);
  int('crawl.retries', c.retries, 0, 5);
  if (Number.isInteger(c.delayMs) && c.delayMs < 300) warnings.push(`crawl.delayMs is ${c.delayMs} ms; below 300 ms is likely to trip rate limits on government sites.`);
  if (c.maxMinutes != null) int('crawl.maxMinutes', c.maxMinutes, 1, 1440);
  if (c.live !== 'auto' && typeof c.live !== 'boolean') errors.push('crawl.live must be true, false or "auto".');
  if (typeof c.respectRobots !== 'boolean') errors.push('crawl.respectRobots must be true or false.');
  if (c.userAgent != null && (typeof c.userAgent !== 'string' || !c.userAgent.trim())) errors.push('crawl.userAgent must be a non-empty string or null.');
  if (c.storageState && !fs.existsSync(c.storageState)) errors.push(`crawl.storageState file not found: ${c.storageState} (create it with: dbim login <url>).`);
  for (const e of c.exclude ?? []) { try { new RegExp(e); } catch { errors.push(`crawl.exclude has an invalid pattern: ${JSON.stringify(e)}.`); } }
  if (!Array.isArray(cfg.viewports) || !cfg.viewports.length || cfg.viewports.some(v => !Number.isInteger(v) || v < 200 || v > 4000)) errors.push('viewports must be a list of widths between 200 and 4000 (e.g. [1440, 768, 375]); the first is used for style measurements.');
  if (![1, 2].includes(cfg.report.level)) errors.push(`report.level must be 1 or 2 (got ${JSON.stringify(cfg.report.level)}).`);
  if (!['vapt', 'template'].includes(cfg.report.style)) errors.push(`report.style must be "vapt" or "template" (got ${JSON.stringify(cfg.report.style)}).`);
  if (cfg.report.template && !fs.existsSync(cfg.report.template)) errors.push(`report.template not found: ${cfg.report.template}.`);
  return { errors, warnings };
}

/** Load dbim.config.json (or defaults), validate it, and print warnings. Throws one readable error listing every problem. */
export function loadConfig(file = CONFIG_FILE, opts: { warn?: boolean; scope?: string } = {}): DbimConfig {
  let user: Partial<DbimConfig> = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DbimConfig>; }
    catch (e) { throw new Error(`${file} is not valid JSON: ${(e as Error).message}`); }
  }
  const cfg: DbimConfig = { ...structuredClone(DEFAULT_CONFIG), ...user, crawl: { ...DEFAULT_CONFIG.crawl, ...user.crawl }, report: { ...DEFAULT_CONFIG.report, ...user.report, submittedTo: { ...DEFAULT_CONFIG.report.submittedTo, ...user.report?.submittedTo } } };
  if (opts.scope) cfg.scope = [opts.scope]; // a URL given on the command line replaces the configured scope before validation
  if (cfg.crawl.userAgent === undefined) cfg.crawl.userAgent = null;
  const { errors, warnings } = validateConfig(cfg, user);
  if (errors.length) throw new Error(`${file} has ${errors.length} problem(s):\n - ${errors.join('\n - ')}`);
  if (opts.warn !== false) for (const w of warnings) console.warn('WARNING:', w);
  return cfg;
}

export function writeDefaultConfig(dir = '.', scope?: string): string {
  const file = path.join(dir, CONFIG_FILE);
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  const cfg = structuredClone(DEFAULT_CONFIG);
  if (scope) cfg.scope = [scope];
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return file;
}
