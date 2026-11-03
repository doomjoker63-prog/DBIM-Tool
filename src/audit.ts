import fs from 'node:fs';
import path from 'node:path';
import type { PageSnapshot } from './collect.js';
import type { DbimConfig } from './config.js';
import { mergeReviews, STORED } from './review/apply.js';
import { refreshRetest } from './retest.js';
import { loadPalette, runRules } from './rules/index.js';
import type { RuleResult } from './rules/types.js';

export interface AuditFile {
  run: string;
  generatedAt: string;
  site: string;
  pagesAudited: number;
  orgType: string;
  summary: Record<string, number>;
  results: RuleResult[];
}

export function loadSnapshots(runDir: string): PageSnapshot[] {
  const dir = path.join(runDir, 'snapshots');
  if (!fs.existsSync(dir)) throw new Error(`No snapshots in ${runDir}. Run \`dbim collect\` first.`);
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as PageSnapshot);
}

export function audit(cfg: DbimConfig, runDir: string, checklists?: string[]): AuditFile {
  const pages = loadSnapshots(runDir);
  const lists = checklists ?? (cfg.orgType === 'ministry' ? ['generic', 'ministry'] : ['generic']);
  const results = runRules({ pages, cfg, palette: loadPalette() }, lists);
  const summary: Record<string, number> = {};
  for (const r of results) summary[r.verdict] = (summary[r.verdict] ?? 0) + 1;
  const file: AuditFile = { run: path.basename(runDir), generatedAt: new Date().toISOString(), site: pages[0] ? new URL(pages[0].url).origin + '/' : cfg.scope[0], pagesAudited: pages.filter(p => p.data && !p.error).length, orgType: cfg.orgType, summary, results };
  // keep earlier manual reviews when the audit is re-run
  if (fs.existsSync(STORED(runDir))) mergeReviews(file, JSON.parse(fs.readFileSync(STORED(runDir), 'utf8')), runDir);
  refreshRetest(runDir, file);
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(file, null, 1));
  return file;
}
