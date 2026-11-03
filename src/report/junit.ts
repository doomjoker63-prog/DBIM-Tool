import fs from 'node:fs';
import path from 'node:path';
import type { AuditFile } from '../audit.js';

const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/**
 * JUnit XML for CI dashboards: one suite per checklist, one test case per DBIM item.
 * Non-Compliance = failure, Pending / N/A = skipped, Compliance = pass.
 */
export function writeJunit(a: AuditFile, file: string): void {
  const suites = new Map<string, typeof a.results>();
  for (const r of a.results) (suites.get(r.checklist) ?? suites.set(r.checklist, []).get(r.checklist)!).push(r);
  const names: Record<string, string> = { generic: 'DBIM Generic checklist', ministry: 'DBIM Ministry/Department checklist', extra: 'DBIM additional checks' };
  let total = 0, failures = 0, skipped = 0;
  const body = [...suites].map(([k, list]) => {
    const f = list.filter(r => r.verdict === 'Non-Compliance').length, s = list.filter(r => r.verdict === 'Pending' || r.verdict === 'N/A').length;
    total += list.length; failures += f; skipped += s;
    const cases = list.map(r => {
      const head = `<testcase classname="${esc(names[k] ?? k)}" name="${esc(`${r.id} ${r.text}`)}">`;
      if (r.verdict === 'Non-Compliance') {
        const detail = [r.remarks, ...(r.evidence ?? []).slice(0, 10).map(e => `- ${e.url}: ${e.detail}`)].join('\n');
        return `${head}<failure message="${esc(r.remarks.slice(0, 300))}" type="${esc(r.severity)}">${esc(detail)}</failure></testcase>`;
      }
      if (r.verdict === 'Pending' || r.verdict === 'N/A') return `${head}<skipped message="${esc(r.verdict + (r.automated ? '' : ': manual verification required'))}"/></testcase>`;
      return `${head}</testcase>`;
    });
    return `<testsuite name="${esc(names[k] ?? k)}" tests="${list.length}" failures="${f}" skipped="${s}">\n${cases.join('\n')}\n</testsuite>`;
  });
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${esc(a.site)}" tests="${total}" failures="${failures}" skipped="${skipped}">\n${body.join('\n')}\n</testsuites>\n`);
}
