import nspell from 'nspell';
import dictionary from 'dictionary-en-gb';
import type { AssetInfo } from '../collectors/assets.js';
import type { PageSnapshot } from '../collect.js';
import { similarity } from '../imaging.js';
import { loadReference } from '../rules.js';
import type { Evidence, Outcome, RuleFn, Site } from './types.js';
import { ev, fmtBytes, hexLum, imgSel, judge, listed, MB, pagesOf, pending, resourceFor } from './util.js';

// ------------------------------------------------------------------ reference data (loaded once)
interface IconRef { id: number; title: string; style: string; hash: string }
let _icons: IconRef[] | null = null;
const iconIndex = () => (_icons ??= loadReference<IconRef[]>('icon-index.json'));
let _emblem: string | null = null;
const emblemHash = () => (_emblem ??= loadReference<{ hash: string }>('emblem.json').hash);

const MATCH = 0.92;

const assetsOf = (s: Site, role: string) => {
  const seen = new Set<string>();
  const out: { p: PageSnapshot; a: AssetInfo }[] = [];
  for (const p of pagesOf(s)) for (const a of p.assets ?? []) if (a.role === role && !seen.has(a.key)) { seen.add(a.key); out.push({ p, a }); }
  return out;
};
const firstPage = (s: Site) => pagesOf(s)[0];

// ------------------------------------------------------------------ icons
const G06: RuleFn = s => {
  const icons = assetsOf(s, 'icon').filter(x => x.a.info?.hash);
  if (!icons.length) return { verdict: 'N/A', remarks: 'No icons could be fingerprinted (icon fonts and unrenderable SVG sprites are not measured).', confidence: 'low' };
  const idx = iconIndex();
  const unmatched: Evidence[] = [];
  let matched = 0;
  for (const { p, a } of icons) {
    let best = -1, ref: IconRef | null = null;
    for (const r of idx) { const d = similarity(a.info!.hash!, r.hash); if (d > best) { best = d; ref = r; } }
    if (best >= MATCH) matched++;
    else unmatched.push(ev(p.url, `${a.path}: closest Toolkit icon "${ref?.title}" (${ref?.style}) similarity ${best.toFixed(2)}`, a.path));
  }
  const share = matched / icons.length;
  const base = `${matched} of ${icons.length} icons match the shape of an icon in the DBIM Toolkit icon bank (similarity >= ${MATCH}).`;
  if (share >= 0.8) return { verdict: 'Compliance', confidence: 'medium', remarks: base };
  return { verdict: 'Pending', confidence: 'low', remarks: `${base} The rest may be custom icons, which DBIM allows only when the kit has no equivalent - check them against the Visual Components Library.`, evidence: unmatched };
};

const G05: RuleFn = s => {
  let line = 0, fill = 0;
  const evd: Evidence[] = [];
  for (const { p, a } of assetsOf(s, 'icon')) {
    let style: 'line' | 'fill' | null = null;
    if (a.kind === 'svg') {
      if (!a.fill && a.stroke) style = 'line';
      else if (a.fill && !a.stroke) style = 'fill';
      else if (a.info) style = a.info.inkRatio < 0.4 ? 'line' : 'fill';
    } else if (a.info) style = a.info.inkRatio < 0.35 ? 'line' : a.info.inkRatio > 0.5 ? 'fill' : null;
    if (style === 'line') line++; else if (style === 'fill') fill++; else continue;
    evd.push(ev(p.url, `${a.path}: ${style} icon`, a.path));
  }
  const total = line + fill;
  if (total < 3) return { verdict: 'N/A', remarks: 'Fewer than 3 classifiable icons.', confidence: 'low' };
  if (Math.min(line, fill) >= Math.max(2, total * 0.25)) return { verdict: 'Pending', confidence: 'low', remarks: `Both line-style icons (${line}) and filled-style icons (${fill}) were inferred; DBIM allows one style only. Style is guessed from stroke/fill and ink coverage (hover-state image variants can skew it), so confirm visually.`, evidence: evd.slice(0, 12) };
  return { verdict: 'Compliance', confidence: 'low', remarks: `${Math.max(line, fill)} of ${total} classifiable icons are ${line > fill ? 'line' : 'filled'} style.` };
};

// ------------------------------------------------------------------ emblem / header
const G19: RuleFn = s => {
  const em = assetsOf(s, 'emblem').filter(x => x.a.info?.hash);
  if (!em.length) return pending('No State Emblem image or inline SVG was identified (looked for "emblem"/"ashok"/"satyamev" in names, ids and alt text).');
  const ref = emblemHash();
  const bad: Evidence[] = [];
  let weak = 0;
  for (const { p, a } of em) {
    const sc = similarity(a.info!.hash!, ref);
    if (sc < 0.75) bad.push(ev(p.url, `${a.path}: shape similarity to the Toolkit emblem is ${sc.toFixed(2)}`, a.path));
    else if (sc < 0.9) weak++;
  }
  if (bad.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `${bad.length} emblem graphic(s) do not look like the State Emblem published in the DBIM Toolkit.`, evidence: bad };
  if (weak) return { verdict: 'Pending', confidence: 'low', remarks: `${weak} emblem graphic(s) are similar but not identical to the Toolkit emblem (0.75-0.9); compare visually.` };
  return { verdict: 'Compliance', confidence: 'medium', remarks: `${em.length} emblem graphic(s) match the Toolkit State Emblem by shape. Authorised download source cannot be proven from the page.` };
};

const G22: RuleFn = s => {
  const em = assetsOf(s, 'emblem');
  if (!em.length) return pending('No emblem found to check the lockup colour.');
  const fails: Evidence[] = [];
  let checked = 0, unsure = 0;
  for (const { p, a } of em) {
    const h = p.data!.header;
    const bgHex = (a.kind === 'svg' ? a.onBg : h?.bgEffective) as string | undefined;
    const bg = bgHex && bgHex !== 'image' ? hexLum(bgHex) : null;
    const fg = a.kind === 'svg' ? hexLum(a.fill ?? a.color ?? '') : a.info?.hasAlpha ? a.info.lum : null;
    if (bg == null || fg == null) { unsure++; continue; }
    if (bg > 0.25 && bg < 0.6) { unsure++; continue; }
    checked++;
    const dark = bg <= 0.25;
    if (dark && fg < 0.85) fails.push(ev(p.url, `${a.path}: emblem luminance ${fg.toFixed(2)} on dark background ${bgHex} (needs white)`, a.path));
    if (!dark && fg > 0.12) fails.push(ev(p.url, `${a.path}: emblem luminance ${fg.toFixed(2)} on light background ${bgHex} (needs black)`, a.path));
  }
  if (!checked) return pending('Emblem or background colour could not be read (image background, opaque emblem image, or mid-tone background).');
  return judge(checked, fails, 'The emblem is white on a dark background / black on a white background.', `${fails.length} emblem(s) use the wrong colour for their background.`, '', 'medium');
};

const hdrText = (s: Site) => String(firstPage(s)?.data?.header?.text ?? '');
const G21: RuleFn = s => {
  const h = firstPage(s)?.data?.header;
  if (!h?.found) return pending('No header found to read the website name from.');
  if (s.cfg.orgType !== 'ministry') return pending('Organisation type is not Ministry/Department; check the lockup name (3A / 3B) manually.');
  const t = hdrText(s);
  const goi = /government of india|भारत सरकार/i.test(t), unit = /ministry|department|मंत्रालय|विभाग/i.test(t);
  if (goi && unit) return { verdict: 'Compliance', confidence: 'medium', remarks: 'Header shows "Government of India" with a Ministry/Department name (Lockup 2). Exact wording needs a manual check.' };
  return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Header text does not show "Government of India" plus the Ministry/Department name (Lockup 2). Header text: "${t.slice(0, 120)}"`, evidence: [ev(firstPage(s).url, `header text: ${t.slice(0, 160)}`, 'header')] };
};
const G23: RuleFn = s => {
  const h = firstPage(s)?.data?.header;
  if (!h?.found) return pending('No header found.');
  if (s.cfg.orgType !== 'ministry') return pending('Organisation type is not Ministry/Department; the header variant (Header 2 / 3) must be checked manually.');
  const miss = [!h.emblem && 'State Emblem', !/government of india|भारत सरकार/i.test(hdrText(s)) && '"Government of India" lockup text', !h.hasSearch && 'search bar', !h.hasNav && 'navigation menu'].filter(Boolean) as string[];
  if (miss.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Header 1 (central Ministries and Departments) expects emblem lockup, search and navigation; not found: ${miss.join(', ')}.`, evidence: [ev(firstPage(s).url, `header lacks ${miss.join(', ')}`, 'header')] };
  return { verdict: 'Compliance', confidence: 'medium', remarks: 'Header has the emblem lockup, search bar and navigation expected of Header 1.' };
};

// ------------------------------------------------------------------ images
const IMGFILE = /\.(jpe?g|png|webp|tiff?|bmp)(\?|#|$)|download|original|full/i;
const G35: RuleFn = s => {
  const fails: Evidence[] = [];
  const seen = new Set<string>();
  let checked = 0;
  for (const p of pagesOf(s))
    for (const i of p.data!.images as any[]) {
      if (!i.visible || i.renderedW <= 0 || seen.has(i.src)) continue;
      const bytes = resourceFor(p, i.src)?.bytes ?? 0;
      if (!(i.naturalW >= 2000 || bytes > MB) || i.renderedW > 700) continue;
      seen.add(i.src);
      checked++;
      if (!i.linkHref || !IMGFILE.test(i.linkHref)) fails.push(ev(p.url, `${i.src.split('/').pop()} (${i.naturalW}px, ${fmtBytes(bytes)}) shown at ${i.renderedW}px with no link to a high-resolution file`, imgSel(i.src)));
    }
  return judge(checked, fails, `${checked} large image(s) shown as thumbnails each link to the full version.`, `${fails.length} of ${checked} large image(s) are scaled down in the page without a view/download link for the original.`, 'No high-resolution images shown as thumbnails.', 'medium');
};

const WHO = /minister|officer|team|profile|headshot|secretary|director|member|leader|portrait|speaker/i;
const G37: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s))
    for (const i of p.data!.images as any[]) {
      if (!i.visible || i.renderedW < 60 || i.renderedW > 420 || !WHO.test(`${i.cls} ${i.src} ${i.alt ?? ''} ${i.path}`)) continue;
      checked++;
      const ratio = i.renderedW / i.renderedH;
      if (Math.abs(ratio - 1) > 0.03) fails.push(ev(p.url, `${i.src.split('/').pop()} is ${i.renderedW}x${i.renderedH} (ratio ${ratio.toFixed(2)}, DBIM needs 1:1)`, imgSel(i.src)));
    }
  return judge(checked, fails, `${checked} headshot-like image(s) are square (1:1). Background colour and face coverage are not checked.`, `${fails.length} headshot-like image(s) are not 1:1.`, 'No headshot-like images identified.', 'low');
};

// ------------------------------------------------------------------ content health
const PLACEHOLDER = /lorem ipsum|coming soon|under construction|page not found|will be updated soon|to be updated|\bTBD\b|test page|dummy text/i;
const G38: RuleFn = s => {
  const fails: Evidence[] = [];
  for (const p of pagesOf(s)) {
    if ((p.status ?? 200) >= 400) fails.push(ev(p.url, `page returns HTTP ${p.status}`));
    const m = PLACEHOLDER.exec(p.data!.bodyText);
    if (m) fails.push(ev(p.url, `placeholder text "${m[0]}"`));
    const broken = p.resources.filter(r => r.status >= 400 && ['image', 'stylesheet', 'script', 'document', 'font', 'media'].includes(r.type));
    for (const r of broken.filter((x, i, a) => a.findIndex(y => y.url === x.url) === i).slice(0, 3)) fails.push(ev(p.url, `${r.type} ${r.url.slice(-70)} returns HTTP ${r.status}`, r.type === 'image' ? imgSel(r.url) : undefined, { panel: 'network', needle: r.url }));
  }
  for (const p of s.pages.filter(p => p.error)) fails.push(ev(p.url, `page could not be loaded: ${p.error}`));
  if (fails.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `${fails.length} broken or placeholder item(s) found (${listed(fails.map(f => f.detail), 3)}).`, evidence: fails };
  return pending('No broken pages, failed resources or placeholder text found on the audited pages. Completeness and whether content is up to date need a manual review.');
};

const spell = nspell({ aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic) });
for (const w of ['login', 'logout', 'sitemap', 'webpage', 'webpages', 'website', 'websites', 'online', 'email', 'username', 'download', 'downloads', 'upload', 'homepage', 'whatsapp', 'youtube', 'facebook', 'instagram', 'linkedin', 'covid', 'wifi', 'tooltip', 'checkbox', 'html', 'pdf', 'cms', 'url', 'blog', 'webinar', 'portal', 'portals', 'dropdown', 'navbar', 'metadata', 'cyber', 'lakh', 'lakhs', 'crore', 'crores', 'panchayat', 'aadhaar', 'digilocker', 'umang']) spell.add(w);

const HINGLISH = /\b(kripya|dhanyavad|shukriya|hamare|humare|aapka|aapke|apka|jankari|sampark|suchna|vigyapan|naukri|karein|kijiye|dekhen|yahan|yahaan)\b/;
const G39: RuleFn = s => {
  const hing: Evidence[] = [];
  const miss = new Map<string, { n: number; url: string }>();
  for (const p of pagesOf(s)) {
    const text = String(p.data!.bodyText).replace(/https?:\/\/\S+|\S+@\S+/g, ' ');
    const h = HINGLISH.exec(text);
    if (h) hing.push(ev(p.url, `Hinglish word "${h[0]}"`));
    const caps = new Set((text.match(/\b[A-Z][a-z]{3,}\b/g) ?? []).map(w => w.toLowerCase()));
    for (const w of text.match(/\b[a-z]{4,}\b/g) ?? []) {
      if (caps.has(w) || spell.correct(w)) continue;
      const cur = miss.get(w) ?? { n: 0, url: p.url };
      cur.n++;
      miss.set(w, cur);
    }
  }
  const top = [...miss].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  if (hing.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Hinglish found on ${hing.length} page(s): ${listed(hing.map(h => h.detail))}.`, evidence: hing };
  if (top.length) return { verdict: 'Pending', confidence: 'low', remarks: `${miss.size} word(s) not in the British English dictionary (may be names, acronyms or real errors): ${listed(top.map(([w, v]) => `${w} x${v.n}`), 8)}. Grammar is not checked; review manually.`, evidence: top.map(([w, v]) => ev(v.url, `"${w}" x${v.n}`)) };
  return { verdict: 'Compliance', confidence: 'low', remarks: 'No words outside the British English dictionary and no Hinglish found. Grammar and tone are not checked.' };
};

const G40: RuleFn = s => {
  const hit = pagesOf(s).flatMap(p => p.resources.filter(r => /ccps/i.test(r.url) && ['xhr', 'fetch', 'script', 'document'].includes(r.type)).map(r => ({ p, r })));
  if (hit.length) return { verdict: 'Compliance', confidence: 'medium', remarks: `A data request to a CCPS endpoint was detected: ${hit[0].r.url.slice(0, 100)}. Banner position and size still need a visual check.` };
  return pending('No request to a CCPS endpoint was detected on the audited pages. Ask the department to confirm CCPS API subscription and the first full-width CCPS banner.');
};

// ------------------------------------------------------------------ search (live probe)
const G43: RuleFn = s => {
  const probe = firstPage(s)?.searchProbe;
  if (!probe) return pending('Search was not tested (collect with the search test enabled).');
  if (!probe.inputFound) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `No visible search input was found on the first page${probe.queries[0]?.error ? ` (${probe.queries[0].error})` : ''}. DBIM requires a search bar in the header.`, evidence: [ev(firstPage(s).url, 'no search input', 'header', { region: 'header', panel: 'facts', facts: ['!No search box was found in the header', 'DBIM 5.4: the header carries the search bar'] })] };
  const ran = probe.queries.filter(q => !q.error);
  if (!ran.length) return pending('Search box found but the test could not run: ' + (probe.queries[0]?.error ?? 'unknown error'));
  // "works" = the search runs and answers with a results page or a "no results" page; an error page or no reaction means it does not
  const worked = ran.filter(q => !q.errorPage && q.urlChanged);
  const detail = (q: (typeof ran)[number]) => `"${q.query}" -> ${q.errorPage ? 'error page' : !q.urlChanged ? 'no reaction' : q.noResultsMessage ? 'results page saying there are no results' : 'results page'} (${q.urlAfter.slice(0, 80)})`;
  if (worked.length >= Math.ceil(ran.length * 0.67)) return { verdict: 'Compliance', confidence: 'medium', remarks: `Search answered ${worked.length} of ${ran.length} test queries with a results page: ${listed(ran.map(detail), 3)}. Relevance is judged separately (G44).` };
  return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Search answered only ${worked.length} of ${ran.length} test queries with a results page (queries came from the site's own menu words): ${listed(ran.map(detail), 3)}.`, evidence: ran.filter(q => !worked.includes(q)).map(q => ev(firstPage(s).url, detail(q), undefined, { url: q.urlAfter || undefined, panel: 'facts', facts: [`Search for "${q.query}"`, q.errorPage ? '!The results page is an error page' : '!Nothing happened after pressing Enter'] })) };
};
const G44: RuleFn = s => {
  const probe = firstPage(s)?.searchProbe;
  const ran = probe?.queries.filter(q => !q.error) ?? [];
  if (!ran.length) return pending('Search relevance could not be tested.');
  const empty = ran.filter(q => q.noResultsMessage);
  const withResults = ran.filter(q => !q.noResultsMessage && !q.errorPage);
  if (!withResults.length)
    return pending(`All ${ran.length} test searches (${ran.map(q => q.query).join(', ')}) returned a page saying there are no results. The words came from the site's own menus, so this is inconclusive: search for terms you know exist (a scheme, a tender number, a PDF title) and check they are found, including inside documents.`);
  const rel = withResults.filter(q => q.occurrences >= 2 && q.resultLinks >= 3);
  const txt = `${rel.length} of ${withResults.length} test queries that returned results (${withResults.map(q => q.query).join(', ')}) gave a results list that mentions the term${empty.length ? `; ${empty.length} query/queries returned no results` : ''}.`;
  if (!rel.length)
    return { verdict: 'Non-Compliance', confidence: 'low', remarks: txt + ' Relevance across all content (PDFs, images) still needs manual testing.', evidence: withResults.map(q => ev(firstPage(s).url, `"${q.query}": ${q.resultLinks} result link(s), ${q.occurrences} mention(s)`, undefined, { url: q.urlAfter || undefined, panel: 'facts', facts: [`Search for "${q.query}"`, `!${q.resultLinks} result link(s), ${q.occurrences} mention(s) of the term`, 'DBIM section 9: results must be relevant across the site content'] })) };
  return { verdict: 'Pending', confidence: 'low', remarks: txt + ' Whether results cover the whole site (HTML, PDFs, image metadata) must be tested manually.' };
};

// ------------------------------------------------------------------ Ministry / content
const SOCIAL = /facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|linkedin\.com|whatsapp|t\.me|koo/i;
const M06: RuleFn = s => {
  const hits = new Set<string>();
  for (const p of pagesOf(s)) for (const l of p.data!.links as any[]) if (SOCIAL.test(l.href)) hits.add(new URL(l.href).hostname.replace(/^www\./, ''));
  if (hits.size) return { verdict: 'Compliance', confidence: 'medium', remarks: `Links to ${hits.size} social platform(s): ${[...hits].join(', ')}. Whether they are the official handles needs a manual check.` };
  return { verdict: 'Non-Compliance', confidence: 'medium', remarks: 'No links to social media platforms were found on the audited pages.', evidence: [ev(firstPage(s).url, 'no social media links', 'footer')] };
};

const M02: RuleFn = s => {
  const p = firstPage(s)?.data?.personas as string[] | undefined;
  if (!p?.length) return pending('No persona selector (e.g. Citizen / Business / Student) was detected on the first page.');
  if (p.length >= 3) return { verdict: 'Compliance', confidence: 'low', remarks: `Persona-style choices found on the first page: ${p.join(', ')}. Relevance to the Ministry needs a manual check.` };
  return pending(`Only ${p.length} persona-style choice(s) detected (${p.join(', ')}); confirm the persona set manually.`);
};

const PMQ = /prime minister|narendra modi|\bPM\b/i;
const M07: RuleFn = s => {
  const pm = assetsOf(s, 'pm').filter(x => x.a.info);
  if (!pm.length) return pending('No Prime Minister image was identified (looked for "modi", "prime minister", "pm-quote" in names and alt text).');
  const bad = pm.filter(x => !x.a.info!.cornerTransparent).map(x => ev(x.p.url, `${x.a.key.split('/').pop()}: not a cut-out (corners are not transparent)`, imgSel(x.a.key)));
  return judge(pm.length, bad, `${pm.length} PM image(s) have a transparent background.`, `${bad.length} PM image(s) do not have a transparent background.`, '', 'medium');
};
const M09: RuleFn = s => {
  const p = firstPage(s);
  if (!p) return pending('No page collected.');
  const t = p.data!.bodyText as string;
  const q = /[“"][^”"]{25,300}[”"]/.test(t) && PMQ.test(t);
  if (q) return { verdict: 'Compliance', confidence: 'low', remarks: 'A quotation attributed to the Prime Minister appears on the first page. Relevance and format must be checked against DBIM A.4.' };
  return pending('No quotation attributed to the Prime Minister was detected on the first page.');
};

const M15: RuleFn = s => {
  const fails: Evidence[] = [];
  for (const p of pagesOf(s)) {
    for (const l of p.data!.links as any[]) if (l.region === 'main' && l.text.length > 150) fails.push(ev(p.url, `link title is ${l.text.length} characters: "${l.text.slice(0, 60)}..."`, `a[href="${String(l.href).replace(/"/g, '')}"]`));
    for (const h of p.data!.meta.headings as any[]) if (h.level >= 2 && h.text.length > 150) fails.push(ev(p.url, `heading is ${h.text.length} characters: "${h.text.slice(0, 60)}..."`));
  }
  return judge(pagesOf(s).length, fails, 'Link and heading titles are within 150 characters.', `${fails.length} title(s) exceed 150 characters.`, '', 'medium');
};
const M19: RuleFn = s => {
  const fails: Evidence[] = [];
  let n = 0;
  for (const p of pagesOf(s)) for (const d of p.data!.docs as any[]) { n++; if (d.text.length > 250) fails.push(ev(p.url, `document title is ${d.text.length} characters`, `a[href="${String(d.href).replace(/"/g, '')}"]`)); }
  return judge(n, fails, `${n} document title(s) are within 250 characters.`, `${fails.length} document title(s) exceed 250 characters.`, 'No document links found.', 'high');
};

const M20: RuleFn = s => {
  const fails: Evidence[] = [], embeds: Evidence[] = [];
  let n = 0, decor = 0;
  for (const p of pagesOf(s)) for (const v of p.data!.videos as any[]) {
    if (!v.embed && !v.controls && v.muted && (v.loop || v.autoplay)) { decor++; continue; }
    n++;
    if (v.embed) embeds.push(ev(p.url, `embedded video "${v.title || v.src.slice(0, 60)}" - captions cannot be verified from the page`, v.path));
    else if (!v.hasCaptions) fails.push(ev(p.url, `video ${v.src.split('/').pop() || ''} has no captions/subtitles track`, v.path));
  }
  const dn = decor ? ` (${decor} muted looping background video(s) without controls were treated as decorative)` : '';
  if (!n) return { verdict: 'N/A', remarks: `No content videos found on the audited pages${dn}.`, confidence: 'medium' };
  if (fails.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `${fails.length} video(s) have no captions or subtitles track${dn}.`, evidence: fails.concat(embeds) };
  if (embeds.length) return { verdict: 'Pending', confidence: 'low', remarks: `${embeds.length} embedded video(s) (YouTube/Vimeo): check captions and the publication date on the player.`, evidence: embeds };
  return { verdict: 'Compliance', confidence: 'medium', remarks: `${n} video(s) have a captions/subtitles track${dn}. Publication date is not checked.` };
};

const ROLES: [string, RegExp][] = [['CIO', /chief information officer|\bCIO\b/i], ['Web Information Manager', /web information manager|\bWIM\b/i], ['Appellate Authority', /appellate authority/i], ['PIO', /public information officer|\bPIO\b/i]];
const M21: RuleFn = s => {
  const pages = pagesOf(s).filter(p => /contact/i.test(p.finalUrl) || /contact/i.test(p.data!.meta.title));
  if (!pages.length) return pending('No Contact Us page was among the crawled pages; crawl deeper or check manually.');
  const text = pages.map(p => p.data!.bodyText).join('\n');
  const miss = ROLES.filter(([, re]) => !re.test(text)).map(([n]) => n);
  if (miss.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Contact page does not mention: ${miss.join(', ')}. Accuracy of the listed contacts still needs a manual check.`, evidence: pages.map(p => ev(p.url, `missing roles: ${miss.join(', ')}`)) };
  return { verdict: 'Compliance', confidence: 'low', remarks: 'Contact page lists CIO, Web Information Manager, Appellate Authority and PIO. Names, phone numbers and e-mails must be verified manually.' };
};

const M29: RuleFn = s => {
  const hit = pagesOf(s).flatMap(p => (p.data!.links as any[]).filter(l => /archive/i.test(l.text) || /archive/i.test(new URL(l.href).pathname)).map(l => ({ p, l })));
  if (hit.length) return { verdict: 'Compliance', confidence: 'medium', remarks: `Archive link found: "${hit[0].l.text || hit[0].l.href}". Whether outdated content is actually archived needs a manual check.` };
  return { verdict: 'Non-Compliance', confidence: 'medium', remarks: 'No archive section link was found on the audited pages.', evidence: [ev(firstPage(s).url, 'no link to an archive section', 'footer')] };
};

export const semiRules: Record<string, RuleFn> = { G05, G06, G19, G21, G22, G23, G35, G37, G38, G39, G40, G43, G44, M02, M06, M07, M09, M15, M19, M20, M21, M29 };
export type { Outcome };
