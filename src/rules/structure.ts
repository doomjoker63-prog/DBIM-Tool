import type { Evidence, RuleFn } from './types.js';
import { ev, judge, listed, pagesOf, pending } from './util.js';

const FOOTER_ITEMS: [string, string][] = [
  ['websitePolicies', 'Website Policies'], ['sitemap', 'Sitemap'], ['relatedLinks', 'Related Links'], ['help', 'Help'],
  ['feedback', 'Feedback'], ['contactUs', 'Contact Us'], ['lastUpdated', 'Last Updated On'],
];

const G24: RuleFn = s => {
  const pages = pagesOf(s).filter(p => p.data!.header?.found);
  if (!pages.length) return pending('No <header>/banner landmark found; header not verified.');
  const checks: [string, (h: any) => boolean][] = [['search', h => h.hasSearch], ['language selection', h => h.hasLanguage], ['skip to main content', h => h.hasSkipLink], ['accessibility controls', h => h.hasA11yControls], ['navigation menu', h => h.hasNav]];
  const fails: Evidence[] = [];
  for (const p of pages) { const miss = checks.filter(([, f]) => !f(p.data!.header)).map(([n]) => n); if (miss.length) fails.push(ev(p.url, `missing in header: ${miss.join(', ')}`, 'header', { region: 'header', panel: 'facts', facts: checks.map(([n, f]) => (f(p.data!.header) ? `present: ${n}` : `!MISSING: ${n}`)) })); }
  return judge(pages.length, fails, 'Header has search, language selection, skip link, accessibility controls and navigation.', `Header sub-components not detected: ${listed(fails.map(f => f.detail.replace('missing in header: ', '')))}. Detection is text/attribute based; confirm visually.`, '', 'medium');
};

const G25: RuleFn = s => {
  const pages = pagesOf(s);
  const withFooter = pages.filter(p => p.data!.footer?.found);
  if (!withFooter.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: 'No <footer>/contentinfo element found on any audited page.', evidence: pages.slice(0, 5).map(p => ev(p.url, 'no footer element')) };
  const fails: Evidence[] = [];
  for (const p of withFooter) {
    const pr = p.data!.footer.present;
    const miss = FOOTER_ITEMS.filter(([k]) => !pr[k]).map(([, n]) => n);
    if (!pr.lineage) miss.push('ownership/lineage statement');
    if (miss.length) fails.push(ev(p.url, `footer missing: ${miss.join(', ')}`, 'footer', { region: 'footer', panel: 'facts', facts: [...FOOTER_ITEMS.map(([k, n]) => (pr[k] ? `present: ${n}` : `!MISSING: ${n}`)), pr.lineage ? 'present: ownership / lineage statement' : '!MISSING: ownership / lineage statement'] }));
  }
  return judge(withFooter.length, fails, 'Footer shows all mandatory elements and the lineage statement. Sitemap depth (2 levels) is not checked.', `Footer elements not found: ${listed(fails.map(f => f.detail.replace('footer missing: ', '')))}.`, '', 'medium');
};

const G42: RuleFn = s => {
  const p = pagesOf(s)[0];
  if (!p) return pending('No page collected.');
  const c = p.data!.cookie;
  if (!c.found) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: 'No cookie consent banner detected on first visit (fixed element containing "cookie"). Check the site does not use another consent mechanism.', evidence: [ev(p.url, 'no banner on first load in a fresh browser context', undefined, { region: 'bottom', panel: 'search', needle: 'cookie', facts: ['!No cookie / consent banner on first load', 'Expected at the bottom of the page (section 7.6.1): Accept, Reject, Customise'] })] };
  const miss = [!c.atBottom && 'not at bottom of page', !c.hasAccept && 'no Accept', !c.hasReject && 'no Reject', !c.hasCustomise && 'no Customise'].filter(Boolean) as string[];
  if (miss.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Cookie banner found but: ${miss.join(', ')}. Buttons seen: ${c.buttons.join(' | ')}.`, evidence: [ev(p.url, c.text, c.path)] };
  return { verdict: 'Compliance', confidence: 'medium', remarks: 'Bottom cookie banner with Accept, Reject and Customise options.' };
};

const G45: RuleFn = s => {
  const fails: Evidence[] = [];
  const pages = pagesOf(s);
  for (const p of pages) {
    const m = p.data!.meta;
    const miss = [!m.title && 'title', !m.description && 'meta description', !m.lang && 'html lang', !m.keywords && 'meta keywords'].filter(Boolean);
    if (miss.length) fails.push(ev(p.url, `missing: ${miss.join(', ')}`, undefined, { panel: 'head', facts: miss.map(m => `!MISSING: ${m}`) }));
  }
  return judge(pages.length, fails, 'Title, description, language and keywords present on all pages. Persona tags need manual review.', `Metadata missing on ${fails.length} of ${pages.length} page(s): ${listed(fails.map(f => f.detail.replace('missing: ', '')))}.`, '', 'medium');
};

const G46: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s)) {
    if (!p.responsive.length) continue;
    checked++;
    for (const r of p.responsive as any[]) if (r.horizontalOverflow) fails.push(ev(p.url, `${r.width}px: page scrolls sideways (content ${r.scrollWidth}px); e.g. ${r.offenders?.[0]?.path ?? '?'}`, r.offenders?.[0]?.path, { viewport: r.width, panel: 'facts', facts: [`!Page content is ${r.scrollWidth}px wide in a ${r.width}px window (horizontal scroll)`, 'Expected: no sideways scrolling at any width (section 10.2)'] }));
    if (!p.data!.meta.viewport) fails.push(ev(p.url, 'missing <meta name="viewport">'));
  }
  return judge(checked, fails, 'No horizontal overflow at the tested widths and viewport meta present. Visual layout still needs a look at the screenshots.', `${fails.length} responsive issue(s): ${listed(fails.map(f => f.detail), 3)}.`, 'No responsive data.', 'medium');
};

// ---- Ministry / content rules that are machine-checkable
const EDITABLE = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'zip', 'rar', 'odt', 'ods'];
const M26: RuleFn = s => {
  const fails: Evidence[] = [];
  const seen = new Set<string>();
  let docs = 0;
  for (const p of pagesOf(s)) for (const d of p.data!.docs as any[]) { if (seen.has(d.href)) continue; seen.add(d.href); docs++; if (EDITABLE.includes(String(d.ext).toLowerCase())) fails.push(ev(p.url, `${d.href} (${d.ext})`, `a[href="${d.href.replace(/"/g, '')}"]`)); }
  return judge(docs, fails, `${docs} linked document(s), all PDF. PDF accessibility (tags, text layer) is not checked.`, `${fails.length} document(s) in an editable/non-PDF format.`, 'No document links found.', 'high');
};

const MONTH_FIRST = /\b(0?[1-9]|1[0-2])[\/-](1[3-9]|2\d|3[01])[\/-](19|20)\d\d\b/;
const ISO = /\b(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
const M27: RuleFn = s => {
  const fails: Evidence[] = [];
  const pages = pagesOf(s);
  for (const p of pages) { const t = p.data!.bodyText as string; const m = MONTH_FIRST.exec(t) ?? ISO.exec(t); if (m) fails.push(ev(p.url, `date "${m[0]}" is not day-month-year`)); }
  return judge(pages.length, fails, 'No month-first or year-first dates found in visible text (ambiguous dates like 03/04/2025 cannot be judged).', `${fails.length} page(s) contain dates not in day-month-year order.`, '', 'medium');
};

const M28: RuleFn = s => {
  const fails: Evidence[] = [];
  const seen = new Set<string>();
  let ext = 0;
  for (const p of pagesOf(s)) for (const l of p.data!.links as any[]) { if (!l.external) continue; ext++; if (l.insecure && !seen.has(l.href)) { seen.add(l.href); fails.push(ev(p.url, `${l.href} (http)`, `a[href="${l.href.replace(/"/g, '')}"]`)); } }
  return judge(ext, fails, `${ext} external link(s), all HTTPS. Link validity is checked in a later phase.`, `${fails.length} external link(s) use http://.`, 'No external links found.', 'high');
};

const formFields = (s: Parameters<RuleFn>[0]) => pagesOf(s).flatMap(p => (p.data!.forms as any[]).filter(f => !f.isSearch).map(f => ({ p, f })));

const M31: RuleFn = s => {
  const forms = formFields(s).filter(x => x.f.fieldCount >= 3);
  const fails = forms.filter(x => !x.f.instructionsBeforeFields).map(x => ev(x.p.url, `form ${x.f.path}: no text before first field`, x.f.path));
  return judge(forms.length, fails, `${forms.length} form(s) start with instructions.`, `${fails.length} form(s) have no instruction text before the first field.`, 'No forms with 3+ fields.', 'medium');
};

const M33: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const { p, f } of formFields(s)) for (const x of f.fields) { if (!x.required) continue; checked++; if (!x.asterisk) fails.push(ev(p.url, `required field "${x.label ?? x.name}" has no * / Required marker`, x.path)); }
  return judge(checked, fails, `${checked} required field(s) are marked.`, `${fails.length} required field(s) not visibly marked.`, 'No required fields found.', 'medium');
};

const M34: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const { p, f } of formFields(s)) for (const x of f.fields) { if (x.type === 'file') continue; checked++; if (!x.labelClickable) fails.push(ev(p.url, `field "${x.name ?? x.id ?? x.type}" has no clickable <label>${x.placeholderOnly ? ' (placeholder only)' : ''}`, x.path)); }
  return judge(checked, fails, `${checked} field(s) have clickable labels.`, `${fails.length} of ${checked} field(s) lack a clickable label.`, 'No form fields found.', 'high');
};

export const structureRules: Record<string, RuleFn> = { G24, G25, G42, G45, G46, M26, M27, M28, M31, M33, M34 };
