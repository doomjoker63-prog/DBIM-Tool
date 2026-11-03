import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { loadAudit } from '../report/report.js';
import { loadSnapshots } from '../audit.js';
import type { PageSnapshot } from '../collect.js';
import type { DbimConfig } from '../config.js';
import { inpage } from '../collectors/inpage.js';
import { settle } from '../crawler.js';
import { similarity } from '../imaging.js';
import { loadReference, loadRules } from '../rules.js';
import type { RuleResult } from '../rules/types.js';
import { findCandidates, type Candidate, type Role } from './candidates.js';
import { daysBetween, firstDate, fmt, parseDate } from './dates.js';
import type { Hint, ReviewItem, ReviewPack } from './types.js';

export interface PrepareOptions {
  /** Include every item, not only the Pending ones. */
  all: boolean;
  /** Visit candidate pages (About, Team, Vacancies ...) to capture evidence. */
  visit: boolean;
  /** Only these item ids (e.g. the ones a retest could not verify). */
  ids?: string[];
}

interface Shot { file: string; caption: string }
interface Capture { cand: Candidate; data: any; shot: string | null; status: number | null; extra?: Shot[] }
interface Keyboard { url: string; fields: number; reached: number; visibleFocus: number; trapped: boolean; order: string[] }

interface Ctx {
  site: string;
  home: string;
  today: Date;
  snaps: PageSnapshot[];
  results: Map<string, RuleResult>;
  homeData: any | null;
  homeShot: string | null;
  shots: { cookie: Shot[]; pm: Shot[]; logos: Shot[]; images: Shot[]; iconsOnImage: Shot[] };
  evidenceShots: Map<string, Shot[]>;
  cands: Partial<Record<Role, Candidate>>;
  caps: Partial<Record<Role, Capture>>;
  keyboard: Keyboard | null;
  logoIdx: { title: string; hash: string }[];
}

const ok = (text: string): Hint => ({ level: 'ok', text });
const warn = (text: string): Hint => ({ level: 'warn', text });
const info = (text: string): Hint => ({ level: 'info', text });

// ------------------------------------------------------------------ browser helpers
async function open(ctx: BrowserContext, url: string): Promise<{ page: Page; status: number | null }> {
  const page = await ctx.newPage();
  let status: number | null = null;
  try {
    const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = r?.status() ?? null;
    await settle(page);
  } catch {
    /* leave the page as it is */
  }
  return { page, status };
}

async function fullShot(page: Page, file: string): Promise<boolean> {
  try {
    const h = (await page.evaluate('document.documentElement.scrollHeight')) as number;
    await page.screenshot({ path: file, type: 'jpeg', quality: 55, fullPage: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(h, 6000) }, timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

async function elementShot(page: Page, selector: string, file: string): Promise<boolean> {
  try {
    const loc = page.locator(selector).first();
    if (!(await loc.count())) return false;
    await loc.scrollIntoViewIfNeeded({ timeout: 2500 });
    await loc.screenshot({ path: file, type: 'jpeg', quality: 70, timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

const FOCUS = `(() => { const e = document.activeElement; if (!e || e === document.body) return null; if (!e.__kb) e.__kb = (window.__kbN = (window.__kbN || 0) + 1); const s = getComputedStyle(e); const lab = (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label') || e.name || e.id || e.innerText || e.value || e.tagName; return { uid: e.__kb, tag: e.tagName.toLowerCase(), type: e.type || '', label: String(lab).trim().replace(/\\s+/g, ' ').slice(0, 40), inForm: !!e.closest('form'), visible: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' }; })()`;

/** Press Tab through the page and record which controls of the first real form receive focus, in what order, with a visible focus ring. */
async function keyboardProbe(page: Page, url: string, fields: number): Promise<Keyboard> {
  const seen: { label: string; visible: boolean; tag: string }[] = [];
  let same = 0, last = '', trapped = false;
  await page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()');
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab');
    const f = (await page.evaluate(FOCUS)) as any;
    if (!f) { if (seen.length && i > 5 && !last) break; last = ''; continue; }
    const key = String(f.uid);
    same = key === last ? same + 1 : 0;
    if (same >= 3) { trapped = true; break; }
    last = key;
    if (f.inForm && ['input', 'select', 'textarea'].includes(f.tag) && !['hidden', 'submit', 'button'].includes(f.type) && !seen.some(s => s.label === f.label && s.tag === f.tag)) seen.push({ label: f.label, visible: f.visible, tag: f.tag });
  }
  return { url, fields, reached: Math.min(seen.length, fields), visibleFocus: seen.filter(s => s.visible).length, trapped, order: seen.map(s => s.label) };
}

// ------------------------------------------------------------------ table analysis
const CLOSING = /last date|closing|end date|deadline|due|valid|submission/i;
function dateStats(tables: any[], today: Date) {
  let rows = 0, dated = 0, past = 0;
  const examples: string[] = [];
  for (const t of tables) {
    const col = (t.header as string[]).findIndex(h => CLOSING.test(h));
    for (const r of t.rows as string[][]) {
      rows++;
      const cell = col >= 0 ? r[col] : r.join(' ');
      const d = firstDate(cell ?? '');
      if (!d) continue;
      dated++;
      if (d < today) { past++; if (examples.length < 3) examples.push(`${fmt(d)} (${daysBetween(d, today)} days ago): ${r[0]?.slice(0, 50)}`); }
    }
  }
  return { rows, dated, past, examples };
}

// ------------------------------------------------------------------ providers
type Provider = (c: Ctx, it: ReviewItem) => void;

function rolePage(c: Ctx, it: ReviewItem, role: Role, label: string): Capture | null {
  const cap = c.caps[role];
  const cand = c.cands[role];
  if (!cand) { it.hints.push(warn(`No "${label}" page was found in the menus or footer of the crawled pages. Locate it manually.`)); return null; }
  it.links.push({ label: `${label} page (${cand.label})`, url: cand.url });
  if (!cap) { it.hints.push(info(`"${label}" page found (${cand.source === 'crawled' ? 'crawled' : 'menu link'}) but not visited; re-run without --no-visit to capture it.`)); return null; }
  if (cap.shot) it.images.push({ file: cap.shot, caption: `${label} page` });
  if ((cap.status ?? 200) >= 400) it.hints.push(warn(`The ${label} page returns HTTP ${cap.status}.`));
  return cap;
}

const stockHint = /shutterstock|gettyimages|istock|alamy|depositphotos|adobestock|123rf|dreamstime|pexels|unsplash|pixabay|freepik/i;
const COMPONENTS: [string, string][] = [
  ['headerSticky', 'Homepage header stays at the top while scrolling (sticky)'], ['topBannerCarousel', 'Top banner carousel (first slide = full-width CCPS banner)'],
  ['announcementsTicker', 'Announcements ticker'], ['pmQuote', 'PM quote section'], ['ministerSection', 'Ministry/Department section with Minister/MoS headshots'],
  ['keyOfferings', 'Key offerings (schemes, vacancies, tenders; five latest + View More)'], ['whatsNew', "What's New"], ['recentDocuments', 'Recent documents'],
  ['userPersonas', 'User personas'], ['importantLinks', 'Important links'], ['citizenEngagement', 'Citizen engagement (social feeds)'], ['centralPostsCcps', 'Central posts from CCPS (3 grids, 960x244 px)'],
  ['infographics', 'Infographics'], ['footerCarousel', 'Footer carousel (logos of initiatives and portals)'], ['footerPresent', 'Footer on the page'],
];

const P: Record<string, Provider> = {
  G10: (c, it) => {
    it.images.push(...c.shots.iconsOnImage);
    it.hints.push(c.shots.iconsOnImage.length ? info(`${c.shots.iconsOnImage.length} icon(s) sit on an image or gradient (screenshots below). Judge whether each stays clearly visible; DBIM suggests an 80% black overlay with a white icon.`) : info('The scan found no icons placed directly over an image background on the home page. Check banners and cards by eye.'));
  },
  G26: (c, it) => {
    it.images.push(...c.shots.logos);
    const logos = (c.snaps[0]?.assets ?? []).filter(a => a.role === 'logo' && a.info?.hash);
    for (const a of logos.slice(0, 8)) {
      let best = -1, title = '';
      for (const l of c.logoIdx) { const s = similarity(a.info!.hash!, l.hash); if (s > best) { best = s; title = l.title; } }
      // Logos are text-heavy; a coarse shape fingerprint cannot prove identity, so only a very high score is called a match.
      it.hints.push(best >= 0.98 ? ok(`${a.path}: very close to the Toolkit logo "${title}" (${best.toFixed(2)}); still compare by eye.`) : best >= 0.9 ? info(`${a.path}: only resembles the Toolkit logo "${title}" (${best.toFixed(2)}); shape matching cannot confirm identity. Compare by eye.`) : warn(`${a.path}: no close match in the Toolkit logo library (best "${title}" ${best.toFixed(2)}). Confirm this is the organisation's current official logo.`));
    }
    it.links.push({ label: 'DBIM Toolkit logo library', url: 'https://dbimtoolkit.digifootprint.gov.in/visual-library' });
  },
  G36: (c, it) => {
    it.images.push(...c.shots.images);
    const imgs: any[] = c.homeData?.contentImgs ?? [];
    const stock = imgs.filter(i => stockHint.test(i.src));
    it.hints.push(stock.length ? warn(`${stock.length} image(s) are served from or named after a stock-photo source: ${stock.slice(0, 3).map(i => i.src.slice(0, 70)).join('; ')}.`) : info(`${imgs.length} content image(s) captured below. Look for visible watermarks and confirm source and licence for each.`));
  },
  G41: (c, it) => {
    it.images.push(...c.shots.cookie);
    const langs: string[] = c.homeData?.langOptions ?? [];
    it.hints.push(c.shots.cookie.length ? info('Cookie/consent banner captured below in the default language.') : warn('No cookie/consent banner appeared on first load.'));
    it.hints.push(langs.length ? info(`Language options offered: ${[...new Set(langs)].slice(0, 12).join(', ')}. Switch language and check the consent text follows it.`) : warn('No language switcher options were detected.'));
  },
  M01: (c, it) => {
    const nav: any[] = c.homeData?.nav ?? [];
    it.lists.push({ title: 'Navigation menu (two levels)', items: nav.map(n => n.text + (n.children.length ? `  >  ${n.children.map((k: any) => k.text).join(' | ')}` : '')) });
    const texts = nav.flatMap(n => [n.text, ...n.children.map((k: any) => k.text)]).join(' | ');
    const exp: [string, RegExp][] = [['About Us', /about/i], ['Offerings (schemes/services/tenders/vacancies)', /offering|scheme|service|tender|vacanc/i], ['Documents', /document|report|publication|polic/i], ['Media', /media|press|photo|video|gallery/i], ['Connect (contact, grievance, RTI)', /contact|connect|grievance|rti/i]];
    for (const [n, re] of exp) it.hints.push(re.test(texts) ? ok(`Menu covers "${n}".`) : warn(`Menu text does not mention "${n}" (DBIM A.1 main section).`));
  },
  M02: (c, it) => {
    const p: string[] = c.snaps[0]?.data?.personas ?? [];
    it.hints.push(p.length ? info(`Persona-style words found: ${p.join(', ')}.`) : warn('No persona choices detected on the home page.'));
    if (c.homeShot) it.images.push({ file: c.homeShot, caption: 'Home page' });
  },
  M03: (c, it) => { P.M02(c, it); it.hints.push(info('Click each persona and confirm the page shows content for that persona only (DBIM A.2).')); },
  M04: (c, it) => { it.hints.push(info('Look for persona tags/filters on listing pages (schemes, documents, tenders) and in the CMS content records.')); },
  M05: (c, it) => {
    const comp = c.homeData?.components ?? {};
    it.tables.push({ title: 'Homepage components (DBIM A.4), detected from headings, class names and layout', header: ['Component', 'Detected'], rows: COMPONENTS.map(([k, label]) => [label, comp[k] ? 'yes' : 'not detected']) });
    const miss = COMPONENTS.filter(([k]) => !comp[k]).length;
    it.hints.push(miss ? warn(`${miss} of ${COMPONENTS.length} expected homepage components were not detected (detection is heuristic; verify on the screenshot).`) : ok('All expected homepage components were detected.'));
    if (c.homeShot) it.images.push({ file: c.homeShot, caption: 'Home page (full)' });
  },
  M08: (c, it) => {
    it.images.push(...c.shots.pm);
    it.links.push({ label: 'DBIM Toolkit visual library (PM images)', url: 'https://dbimtoolkit.digifootprint.gov.in/visual-library' });
    it.hints.push(c.shots.pm.length ? info('PM section captured below. Compare the photo and quote with the Toolkit image bank / PM official website.') : warn('No PM image/quote section was found on the home page.'));
  },
  M10: (c, it) => {
    P.M08(c, it);
    const t = c.homeData?.dates?.find((d: any) => /prime minister|modi|quote|said|speech/i.test(d.context));
    if (t) { const d = parseDate(t.text); if (d) it.hints.push(daysBetween(d, c.today) > 365 ? warn(`The quote's date (${fmt(d)}) is more than a year old; DBIM prefers within 1 year.`) : ok(`Quote date ${fmt(d)} is within a year.`)); }
    it.hints.push(info('Check: quote in the darkest shade of the selected group, event and date cited, hyperlink to the source (DBIM A.4 iv).'));
  },
  M11: (c, it) => {
    const cap = rolePage(c, it, 'about', 'About Us');
    if (!cap) return;
    const lists = (cap.data.lists as any[]).filter(l => /objective|function|mandate|role/i.test(l.heading ?? ''));
    for (const l of lists) it.lists.push({ title: l.heading, items: l.items });
    it.hints.push(lists.length ? ok(`${lists.length} list(s) under objectives/functions headings found.`) : warn('No bulleted list under an "objectives" or "functions" heading was found; DBIM A.5.1.1 wants a list.'));
  },
  M12: (c, it) => {
    const cap = rolePage(c, it, 'team', 'Our Team');
    if (!cap) return;
    const names: string[] = cap.data.titled;
    if (names.length) it.lists.push({ title: 'Names with honorifics found on the page', items: [...new Set(names)].slice(0, 40) });
    it.hints.push(info('Compare each name and portfolio with the official Ministry website / Government directory.'));
  },
  M13: (c, it) => { rolePage(c, it, 'team', 'Our Team / organisation chart'); it.hints.push(info('Compare the hierarchy shown with the current official order.')); },
  M14: (c, it) => {
    const cap = rolePage(c, it, 'organisation', 'Our Organizations');
    if (!cap) return;
    for (const l of (cap.data.lists as any[]).slice(0, 3)) it.lists.push({ title: l.heading ?? 'List', items: l.items });
    for (const t of (cap.data.tables as any[]).slice(0, 2)) it.tables.push({ title: t.caption || 'Table', header: t.header, rows: t.rows });
    it.hints.push(info('Check each department, organisation and attached office name against the official list.'));
  },
  M16: (c, it) => {
    const cap = rolePage(c, it, 'vacancies', 'Vacancies');
    if (!cap) return;
    for (const t of (cap.data.tables as any[]).slice(0, 2)) it.tables.push({ title: t.caption || `Table (${t.total} rows)`, header: t.header, rows: t.rows.slice(0, 12) });
    const st = dateStats(cap.data.tables, c.today);
    if (st.dated) it.hints.push(st.past ? warn(`${st.past} of ${st.dated} dated vacancy row(s) have a date before today (${fmt(c.today)}): ${st.examples.join('; ')}.`) : ok(`All ${st.dated} dated row(s) are in the future.`));
    else it.hints.push(info('No dates could be read from the vacancy tables; check closing dates manually.'));
    if (st.dated >= 2 && st.past === st.dated) it.suggested = { verdict: 'Non-Compliance', reason: 'Every dated vacancy entry is already closed; the page is not updated.' };
  },
  M17: (c, it) => {
    const cap = rolePage(c, it, 'tenders', 'Tenders');
    if (!cap) return;
    for (const t of (cap.data.tables as any[]).slice(0, 2)) it.tables.push({ title: t.caption || `Table (${t.total} rows)`, header: t.header, rows: t.rows.slice(0, 12) });
    const idCol = (cap.data.tables as any[]).map(t => ({ t, i: (t.header as string[]).findIndex(h => /tender (id|no|number)|ref/i.test(h)) })).find(x => x.i >= 0);
    if (idCol) { const long = idCol.t.rows.filter((r: string[]) => (r[idCol.i] ?? '').length > 50); it.hints.push(long.length ? warn(`${long.length} tender ID(s) are longer than 50 characters.`) : ok('Tender IDs are within 50 characters.')); }
    const st = dateStats(cap.data.tables, c.today);
    if (st.dated) it.hints.push(st.past ? warn(`${st.past} of ${st.dated} tender row(s) show a date before today: ${st.examples.join('; ')}.`) : ok('All dated tender rows are in the future.'));
    it.hints.push(info('DBIM A.5.2.3: link to the tender portal must be valid; corrigenda attach to the main tender ID.'));
    if (st.dated >= 2 && st.past === st.dated) it.suggested = { verdict: 'Non-Compliance', reason: 'Every dated tender is past its date; expired tenders are still listed.' };
  },
  M18: (c, it) => {
    const cap = rolePage(c, it, 'documents', 'Documents');
    if (!cap) return;
    const rows = [...(cap.data.tables as any[]).flatMap(t => t.rows.map((r: string[]) => r.join(' '))), ...(cap.data.lists as any[]).flatMap(l => l.items)];
    const dated = rows.filter(r => firstDate(r)).length, ver = rows.filter(r => /\bv(ersion)?\s?\d|\brev(ision)?\b/i.test(r)).length;
    it.hints.push(rows.length ? (dated / rows.length >= 0.8 ? ok : warn)(`${dated} of ${rows.length} listed documents show a release date; ${ver} show a version.`) : info('No document rows could be extracted.'));
  },
  M21: (c, it) => { contactEvidence(c, it); },
  M22: (c, it) => { contactEvidence(c, it); },
  M23: (c, it) => { stalenessEvidence(c, it); },
  G38: (c, it) => { stalenessEvidence(c, it); },
  M24: (c, it) => { it.hints.push(info('Not visible on the website. Obtain a written declaration or a CMS screenshot showing at least two approval levels (maker, checker) before publishing.')); },
  M25: (c, it) => {
    const all: string[] = [...Object.values(c.caps).flatMap(x => x?.data?.titled ?? []), ...c.snaps.flatMap(s => (s.data?.bodyText ?? '').match(/\b(Dr\.?|Shri|Smt\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?)\s+[A-Z]\w+/g) ?? [])];
    const counts = new Map<string, number>();
    for (const n of all) { const t = n.split(/\s+/)[0]; counts.set(t, (counts.get(t) ?? 0) + 1); }
    if (!counts.size) { it.hints.push(info('No names with honorifics were found on the captured pages.')); return; }
    it.tables.push({ title: 'Honorific styles in use', header: ['Style', 'Count'], rows: [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]) });
    const base = new Map<string, Set<string>>();
    for (const k of counts.keys()) { const b = k.replace(/\.$/, '').toLowerCase(); (base.get(b) ?? base.set(b, new Set()).get(b)!).add(k); }
    const mixed = [...base].filter(([, v]) => v.size > 1);
    if (mixed.length) { it.hints.push(warn(`Inconsistent punctuation: ${mixed.map(([, v]) => [...v].join(' vs ')).join('; ')}.`)); it.suggested = { verdict: 'Non-Compliance', reason: 'The same honorific is written in more than one style.' }; }
    else it.hints.push(ok('Each honorific is written in one style. Check by eye that the right honorific is used for each person.'));
  },
  M30: (c, it) => { const cap = rolePage(c, it, 'team', 'Our Team'); if (cap) { it.hints.push(info('Check that Minister, MoS, Secretary and officers are listed in order of seniority.')); if (cap.data.titled.length) it.lists.push({ title: 'Names in page order', items: [...new Set<string>(cap.data.titled)].slice(0, 30) }); } },
  M32: (c, it) => {
    const k = c.keyboard;
    if (!k) { it.hints.push(info('No form with two or more fields was found to test.')); return; }
    it.links.push({ label: 'Form tested', url: k.url });
    it.lists.push({ title: 'Tab order of form fields', items: k.order });
    const good = k.reached >= k.fields && !k.trapped;
    it.hints.push(good ? ok(`All ${k.fields} field(s) were reached with the Tab key in page order.`) : warn(`Only ${k.reached} of ${k.fields} field(s) were reached with Tab${k.trapped ? '; focus got stuck (keyboard trap)' : ''}.`));
    it.hints.push(k.visibleFocus >= k.reached && k.reached ? ok('A visible focus indicator was present on every reached field.') : warn(`A visible focus indicator was seen on ${k.visibleFocus} of ${k.reached} fields.`));
    if (good && k.visibleFocus >= k.reached) it.suggested = { verdict: 'Compliance', reason: 'Every field is reachable by keyboard in order with a visible focus ring. Also check that Enter submits and errors are announced.' };
  },
};

function contactEvidence(c: Ctx, it: ReviewItem) {
  const cap = rolePage(c, it, 'contact', 'Contact Us');
  if (!cap) return;
  const text = String(cap.data.mainText ?? '') + ' ' + JSON.stringify(cap.data.headings) + ' ' + cap.data.lists.map((l: any) => l.items.join(' ')).join(' ') + ' ' + cap.data.tables.map((t: any) => t.rows.flat().join(' ')).join(' ');
  const roles: [string, RegExp][] = [['CIO', /chief information officer|\bCIO\b/i], ['Web Information Manager', /web information manager|\bWIM\b/i], ['Appellate Authority', /appellate authority/i], ['PIO', /public information officer|\bPIO\b/i]];
  for (const [n, re] of roles) it.hints.push(re.test(text) || re.test(cap.data.titled.join(' ')) ? ok(`"${n}" is mentioned.`) : warn(`"${n}" is not mentioned in the page's headings, lists or tables.`));
  if (cap.data.emails.length) it.lists.push({ title: 'E-mail addresses on the page', items: cap.data.emails });
  if (cap.data.phones.length) it.lists.push({ title: 'Phone numbers on the page', items: cap.data.phones });
  it.hints.push(cap.data.maps.length ? info(`Map found (${cap.data.maps[0].src.slice(0, 80)}). Open it and confirm the pin is at the office address.`) : warn('No embedded map or map link found on the Contact page.'));
  if (cap.extra?.length) it.images.push(...cap.extra);
}

function stalenessEvidence(c: Ctx, it: ReviewItem) {
  const rows: string[][] = [];
  const seen = new Set<string>();
  for (const s of c.snaps) {
    const m = /last (?:updated|reviewed|modified)(?: on)?\s*:?\s*([^\n|]{4,40})/i.exec(s.data?.footer?.text ?? '') ?? /last (?:updated|reviewed|modified)(?: on)?\s*:?\s*([^\n|]{4,40})/i.exec(s.data?.bodyText ?? '');
    if (!m || seen.has(s.finalUrl)) continue;
    seen.add(s.finalUrl);
    const d = firstDate(m[1]);
    rows.push([s.finalUrl.slice(0, 70), m[1].trim().slice(0, 30), d ? String(daysBetween(d, c.today)) : '?']);
  }
  if (rows.length) it.tables.push({ title: 'Per-page "Last updated" dates', header: ['Page', 'Shown date', 'Days old'], rows });
  const old = rows.filter(r => Number(r[2]) > 365);
  it.hints.push(rows.length ? (old.length ? warn(`${old.length} of ${rows.length} page(s) show a last-updated date more than a year old.`) : ok('Every page that shows a last-updated date shows one within the past year.')) : warn('No page shows a "Last updated" date, which DBIM requires in the footer.'));
}

// ------------------------------------------------------------------ main
export async function prepareReview(cfg: DbimConfig, runDir: string, opt: PrepareOptions, log: (m: string) => void = console.log): Promise<{ dir: string; pack: ReviewPack }> {
  const audit = loadAudit(runDir);
  const snaps = loadSnapshots(runDir).filter(s => s.data && !s.error);
  if (!snaps.length) throw new Error('No usable snapshots; run `dbim collect` first.');
  const dir = path.join(runDir, 'review');
  const evDir = path.join(dir, 'evidence');
  fs.mkdirSync(evDir, { recursive: true });
  const rel = (f: string) => path.relative(dir, f).split(path.sep).join('/');

  const results = new Map(audit.results.map(r => [r.id, r]));
  const wanted = audit.results.filter(r => (opt.ids ? opt.ids.includes(r.id) : r.checklist !== 'extra' && (opt.all || r.verdict === 'Pending')));
  const home = snaps[0].finalUrl;
  const cands = findCandidates(snaps, audit.site);
  const c: Ctx = {
    site: audit.site, home, today: new Date(), snaps, results, homeData: null, homeShot: null,
    shots: { cookie: [], pm: [], logos: [], images: [], iconsOnImage: [] }, evidenceShots: new Map(), cands, caps: {}, keyboard: null,
    logoIdx: loadReference<{ title: string; hash: string }[]>('logo-index.json'),
  };

  const browser = await chromium.launch({ headless: cfg.crawl.headless });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true, ...(cfg.crawl.storageState ? { storageState: cfg.crawl.storageState } : {}) });
  try {
    // ---- home page
    {
      const { page } = await open(ctx, home);
      c.homeData = await page.evaluate(inpage('review-data'));
      const hf = path.join(evDir, 'home.jpg');
      if (await fullShot(page, hf)) c.homeShot = rel(hf);
      const d = c.homeData;
      const take = async (sel: string | null | undefined, name: string, caption: string, bucket: Shot[]) => {
        if (!sel) return;
        const f = path.join(evDir, name + '.jpg');
        if (await elementShot(page, sel, f)) bucket.push({ file: rel(f), caption });
      };
      await take(d.cookiePath, 'cookie', 'Cookie / consent banner on first load', c.shots.cookie);
      await take(d.pmPath, 'pm', 'PM image and quote section', c.shots.pm);
      for (const [i, l] of (d.logos as any[]).slice(0, 8).entries()) await take(l.path, `logo_${i}`, `${l.region} logo: ${String(l.src).split('/').pop()} (${l.w}x${l.h})`, c.shots.logos);
      for (const [i, im] of (d.contentImgs as any[]).slice(0, 8).entries()) await take(im.path, `img_${i}`, `${String(im.src).split('/').pop()} ${im.alt ? '- alt: ' + im.alt.slice(0, 60) : ''}`, c.shots.images);
      const onImg = (snaps[0].data!.icons as any[]).filter(ic => ic.onBg === 'image').slice(0, 6);
      for (const [i, ic] of onImg.entries()) await take(ic.path, `iconimg_${i}`, `Icon ${ic.path} over an image`, c.shots.iconsOnImage);
      // generic: element screenshots for the first selectors in each pending item's own evidence (home page only)
      for (const r of wanted) {
        const list: Shot[] = [];
        for (const e of (r.evidence ?? []).filter(x => x.selector && x.url === home).slice(0, 3)) {
          const f = path.join(evDir, `${r.id}_${list.length}.jpg`);
          if (await elementShot(page, e.selector!, f)) list.push({ file: rel(f), caption: e.detail.slice(0, 140) });
        }
        if (list.length) c.evidenceShots.set(r.id, list);
      }
      await page.close();
    }

    // ---- candidate role pages
    if (opt.visit) {
      for (const [role, cand] of Object.entries(cands) as [Role, Candidate][]) {
        const { page, status } = await open(ctx, cand.url);
        const data = (await page.evaluate(inpage('review-data'))) as any;
        const f = path.join(evDir, `${role}.jpg`);
        const shot = (await fullShot(page, f)) ? rel(f) : null;
        const cap: Capture = { cand, data, shot, status };
        if (role === 'contact' && data.maps[0]?.path) {
          const mf = path.join(evDir, 'contact_map.jpg');
          if (await elementShot(page, data.maps[0].path, mf)) cap.extra = [{ file: rel(mf), caption: 'Map on the Contact page' }];
        }
        c.caps[role] = cap;
        await page.close();
        log(`visited ${role}: ${cand.url}`);
      }
      // keyboard test on the first real form we know about
      const fp = snaps.find(s => (s.data!.forms as any[]).some(f => !f.isSearch && f.fieldCount >= 2));
      if (fp) {
        const form = (fp.data!.forms as any[]).find(f => !f.isSearch && f.fieldCount >= 2);
        const { page } = await open(ctx, fp.finalUrl);
        c.keyboard = await keyboardProbe(page, fp.finalUrl, form.fieldCount);
        await page.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  // ---- assemble items
  const defs = new Map(loadRules().map(r => [r.id, r]));
  const items: ReviewItem[] = wanted.map(r => {
    const it: ReviewItem = {
      id: r.id, checklist: r.checklist, no: r.no, text: r.text, section: r.section, severity: r.severity, howToTest: defs.get(r.id)?.howToTest ?? '',
      machine: { verdict: r.verdict, remarks: r.automated ? r.remarks : '', confidence: r.confidence, automated: r.automated, evidence: (r.evidence ?? []).slice(0, 12).map(e => ({ url: e.url, detail: e.detail })) },
      hints: [], links: [{ label: 'Home page', url: home }], images: [], tables: [], lists: [],
    };
    P[r.id]?.(c, it);
    if (r.retest?.baseline) {
      // Retest: tell the tester exactly what was reported in Level 1 so they check that, not the item in general.
      it.hints.unshift(warn(`Level 1 finding to re-verify: ${r.retest.baseline.remarks}`));
      for (const u of r.retest.baseline.affectedUrls.slice(0, 3)) if (!it.links.some(l => l.url === u)) it.links.push({ label: 'Affected in Level 1', url: u });
    }
    for (const s of c.evidenceShots.get(r.id) ?? []) if (!it.images.some(i => i.file === s.file)) it.images.push(s);
    if (!it.images.length && c.homeShot && !P[r.id]) it.images.push({ file: c.homeShot, caption: 'Home page (full)' });
    return it;
  });

  const pack: ReviewPack = { run: path.basename(runDir), site: audit.site, generatedAt: new Date().toISOString(), items };
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(pack, null, 1));
  return { dir, pack };
}
