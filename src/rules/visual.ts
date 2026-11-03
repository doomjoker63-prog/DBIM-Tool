import type { Evidence, Outcome, RuleFn, Site } from './types.js';
import { detectGroup, ev, isNeutral, judge, listed, pagesOf, pending, sameHex } from './util.js';

const NOTO = (f: string) => f.toLowerCase().startsWith('noto sans');
const ICON_FONT = /icon|symbol|awesome|glyph|material|emoji|dingbat/i;

type Tally = [string, number][];
const tallies = (s: Site, kind: string) => {
  const m = new Map<string, number>();
  for (const p of pagesOf(s)) for (const [hex, n] of (p.data!.colours?.[kind] ?? []) as Tally) m.set(hex.toUpperCase(), (m.get(hex.toUpperCase()) ?? 0) + n);
  return m;
};
const groupOfHex = (s: Site, hex: string) => Object.keys(s.palette.primary).find(g => s.palette.primary[g].some(c => sameHex(c, hex))) ?? null;
const functionalSet = (s: Site) => new Set(Object.values(s.palette.functional).map(h => h.toUpperCase()));

// G01: one primary colour group
const G01: RuleFn = s => {
  const used = new Map<string, number>();
  for (const kind of ['text', 'background']) for (const [hex, n] of tallies(s, kind)) { const g = groupOfHex(s, hex); if (g) used.set(g, (used.get(g) ?? 0) + n); }
  const info = detectGroup(s);
  const colourful = [...tallies(s, 'background'), ...tallies(s, 'text')].filter(([h]) => !isNeutral(h) && !functionalSet(s).has(h));
  if (used.size === 0) {
    const deep = (tallies(s, 'background').get('#1D0A69') ?? 0) + (tallies(s, 'text').get('#1D0A69') ?? 0);
    if (deep >= 3) return pending('Site is branded with Deep Blue #1D0A69, which DBIM reserves for the root Gov.In website. Confirm this exemption applies; otherwise select a primary colour group.');
    if (colourful.length === 0) return pending('Only neutral colours found; no primary colour group in use to verify.');
    const off = (kind: string) => [...tallies(s, kind)].filter(([h]) => !isNeutral(h) && !functionalSet(s).has(h)).sort((a, b) => b[1] - a[1]);
    const url = s.pages[0].url;
    const evidence = [
      ...off('background').slice(0, 3).map(([h, n]) => ev(url, `background ${h} used ${n} times; not in the DBIM primary palette`, undefined, { bg: h, facts: [`!background-color: ${h} (${n} elements)`, 'Not one of the 30 DBIM primary-palette colours (section 2.1)'] })),
      ...off('text').slice(0, 2).map(([h, n]) => ev(url, `text colour ${h} used ${n} times; not in the DBIM primary palette`, undefined, { color: h, facts: [`!color: ${h} (${n} elements)`, 'Not one of the 30 DBIM primary-palette colours (section 2.1)'] })),
    ];
    return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `No colour from the DBIM primary palette was found. Non-palette colours in use: ${listed(colourful.slice(0, 5).map(([h, n]) => `${h} (${n})`))}.`, evidence };
  }
  const extra = [...used.entries()].filter(([g, n]) => g !== info.group && n >= 3);
  if (extra.length) return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Selected group ${info.group} (${info.source}); colours of other primary groups also used: ${extra.map(([g, n]) => `${g} (${n} uses)`).join(', ')}.` };
  return { verdict: 'Compliance', confidence: 'medium', remarks: `Single primary colour group in use: ${info.group} (detected from ${info.source}).` };
};

// G02: other colours come from the functional palette
const G02: RuleFn = s => {
  const info = detectGroup(s);
  const ok = functionalSet(s);
  if (info.group) for (const c of s.palette.primary[info.group]) ok.add(c.toUpperCase());
  const off = [...tallies(s, 'background')].filter(([h, n]) => !ok.has(h) && n >= 2);
  const evd: Evidence[] = off.slice(0, 20).map(([h, n]) => ev(s.pages[0].url, `background ${h} used ${n} times`, undefined, { bg: h, facts: [`!background-color: ${h} (${n} elements)`, 'Not in the DBIM functional palette (Table 1) or the selected colour group'] }));
  return judge(tallies(s, 'background').size, evd, 'All frequently used background colours are functional-palette or selected-group colours.', `Background colours outside the functional palette / selected group: ${listed(off.map(([h, n]) => `${h} (${n})`), 6)}.`, 'No background colours measured.', 'medium');
};

// G04: footer background is the key colour of the selected group
const G04: RuleFn = s => {
  const info = detectGroup(s);
  const withFooter = pagesOf(s).filter(p => p.data!.footer?.found);
  if (!withFooter.length) return pending('No <footer> element found; footer colour not verified.');
  if (withFooter.some(p => p.data!.footer.hasBgImage && !groupOfHex(s, p.data!.footer.bgEffective))) return pending('Footer background is drawn with an image or SVG, so its colour cannot be read from CSS. Check the colour visually against the key colour of the selected group.');
  if (!info.group) {
    const p = withFooter[0];
    return { verdict: 'Non-Compliance', confidence: 'medium', remarks: `Footer background ${p.data!.footer.bgEffective} is not a key colour of any DBIM primary group.`, evidence: [ev(p.url, `footer background ${p.data!.footer.bgEffective}`, 'footer', { panel: 'computed', props: ['background-color'], facts: [`!background-color: ${p.data!.footer.bgEffective}`, 'Expected: the key (darkest) colour of the selected primary colour group (section 5.6)'] })] };
  }
  const key = s.palette.primary[info.group][0];
  const bad = withFooter.filter(p => !sameHex(p.data!.footer.bgEffective, key));
  return judge(withFooter.length, bad.map(p => ev(p.url, `footer background ${p.data!.footer.bgEffective}, expected ${key}`, 'footer', { panel: 'computed', props: ['background-color'], facts: [`!background-color: ${p.data!.footer.bgEffective}`, `Expected: ${key}, the key colour of ${info.group}`] })), `Footer background is ${key}, the key colour of ${info.group}.`, `Footer background differs from the key colour ${key} of ${info.group} on ${bad.length} page(s): ${listed(bad.map(p => p.data!.footer.bgEffective))}.`, 'No footer.', info.source === 'config' ? 'high' : 'medium');
};

// G11: Noto Sans is the typeface
const G11: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  const seen = new Map<string, number>();
  for (const p of pagesOf(s)) {
    if (!p.fonts) continue;
    checked++;
    let total = 0, other = 0;
    const others = new Map<string, number>();
    for (const uses of Object.values(p.fonts.rendered))
      for (const f of uses) {
        if (ICON_FONT.test(f.family)) continue;
        total += f.glyphs;
        if (!NOTO(f.family)) { other += f.glyphs; others.set(f.family, (others.get(f.family) ?? 0) + f.glyphs); }
      }
    for (const [f, n] of others) seen.set(f, (seen.get(f) ?? 0) + n);
    if (total && other / total > 0.02) {
      const bad = (Object.values(p.data!.textStyles) as any[][]).flat().find(t => !/noto sans/i.test(String(t.fontFamily).split(',')[0].replace(/["']/g, '')));
      fails.push(ev(p.url, `${((other / total) * 100).toFixed(0)}% of text not Noto Sans: ${listed([...others].map(([f, n]) => `${f} (${n} glyphs)`))}`, bad?.path, { panel: 'computed', props: ['font-family', 'font-size', 'font-weight'], facts: [`!Rendered font: ${[...others.keys()][0]}`, 'Expected: Noto Sans (section 4.1)'] }));
    }
  }
  if (!checked) return pending('Rendered-font data not available.');
  return judge(checked, fails, 'Text is rendered in Noto Sans (icon fonts excluded).', `Typeface other than Noto Sans is rendered: ${listed([...seen].map(([f, n]) => `${f} (${n} glyphs)`))} on ${fails.length} page(s).`, '', 'high');
};

// G12: body text left-aligned
const G12: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s))
    for (const t of [...p.data!.textStyles.paragraph, ...p.data!.textStyles.listItem]) {
      if (t.text.length < 50) continue;
      checked++;
      if (!['left', 'start'].includes(t.textAlign)) fails.push(ev(p.url, `${t.path}: text-align ${t.textAlign}`, t.path));
    }
  return judge(checked, fails, `${checked} body-text blocks sampled, all left-aligned.`, `${fails.length} body-text block(s) are not left-aligned (${listed(fails.map(f => f.detail.split(': ')[1]))}).`, 'No long body text sampled.');
};

// G13: no all-caps sentences (Hinglish cannot be detected automatically)
const G13: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s)) for (const g of Object.values(p.data!.textStyles) as any[][]) for (const t of g) { checked++; if (t.allCapsLong || (t.textTransform === 'uppercase' && t.text.length > 60)) fails.push(ev(p.url, `${t.path}: "${t.text}"`, t.path)); }
  const o = judge(checked, fails, 'No long all-capital text found. Hinglish is not machine-checked; review content manually.', `${fails.length} long text item(s) in capital case.`, 'No text sampled.');
  return o;
};

// G14: type scale (desktop)
const SCALE = [12, 14, 16, 20, 24, 36];
const HEAD: Record<string, number> = { h1: 36, h2: 24, h3: 20 };
const G14: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s)) {
    const t = p.data!.textStyles;
    for (const h of t.heading) { const want = HEAD[h.tag]; if (!want) continue; checked++; if (Math.abs(h.fontSize - want) > 0.5) fails.push(ev(p.url, `${h.tag} "${h.text.slice(0, 30)}" is ${h.fontSize}px, DBIM ${want}px`, h.path)); }
    for (const g of ['paragraph', 'listItem', 'small', 'label', 'button', 'tableCell'])
      for (const x of t[g]) { checked++; if (!SCALE.some(v => Math.abs(v - x.fontSize) <= 0.5)) fails.push(ev(p.url, `${x.tag} ${x.path}: ${x.fontSize}px not in scale ${SCALE.join('/')}`, x.path)); }
  }
  const sizes = fails.map(f => (/(\d+(?:\.\d+)?)px/.exec(f.detail) ?? [])[1]);
  return judge(checked, fails, `All ${checked} sampled desktop text styles match the DBIM type scale (36/24/20/16/14/12 px).`, `${fails.length} of ${checked} sampled items depart from the DBIM desktop type scale. Sizes seen: ${listed(sizes.map(x => x + 'px'), 6)}. Mobile scale not checked.`, 'No text sampled.', 'medium');
};

// G15: contrast (axe)
const G15: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s)) {
    if (!p.axe || p.axe.error) continue;
    checked++;
    const v = p.axe.violations.find(x => x.id === 'color-contrast');
    if (v) fails.push(ev(p.url, `${v.nodeCount} element(s); e.g. ratio ${(v.nodes[0]?.data as any)?.contrastRatio ?? '?'} (needs ${(v.nodes[0]?.data as any)?.expectedContrastRatio ?? '4.5:1'}) at ${v.nodes[0]?.target}`, v.nodes[0]?.target));
  }
  if (!checked) return pending('axe-core results not available (collect without --no-axe).');
  return judge(checked, fails, 'axe-core found no colour-contrast failures on the audited pages. Text colour choice vs DBIM palette is a separate manual check.', `Colour-contrast failures on ${fails.length} of ${checked} page(s).`, '');
};

// G16: button size / padding consistency
const G16: RuleFn = s => {
  const pad = new Map<string, number>();
  const example = new Map<string, { url: string; path: string }>();
  let n = 0;
  for (const p of pagesOf(s)) for (const c of p.data!.controls) { if (!c.text || c.tag === 'a' && c.region !== 'main') continue; n++; pad.set(c.padding, (pad.get(c.padding) ?? 0) + 1); if (!example.has(c.padding)) example.set(c.padding, { url: p.url, path: c.path }); }
  const kinds = [...pad].sort((a, b) => b[1] - a[1]);
  const evd = kinds.slice(1).map(([k, c]) => { const ex = example.get(k)!; return ev(ex.url, `padding "${k}" on ${c} button(s)`, ex.path, { panel: 'computed', props: ['padding', 'font-size', 'width', 'height'], facts: [`!padding: ${k}`, `${kinds.length} different paddings are used for buttons (section 4.5: uniform padding)`] }); });
  return judge(n, kinds.length > 2 ? evd : [], `${n} buttons share ${kinds.length} padding style(s).`, `${kinds.length} different button paddings in use (${listed(kinds.map(([k, c]) => `${k} x${c}`))}).`, 'No buttons found.', 'medium');
};

// G17: states (focus or hover must be visibly different) for real buttons
const G17: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s)) for (const h of p.hover) { if (h.tag !== 'button' || h.error) continue; checked++; if (!h.hoverChanged.length && !h.focusChanged.length) fails.push(ev(p.url, `button "${h.text}" shows no hover or focus change`, h.path)); }
  return judge(checked, fails, `${checked} buttons tested; each shows a hover or focus change.`, `${fails.length} button(s) show no visible hover or focus state.`, 'No <button> elements sampled.', 'medium');
};

// G18: hover change on simple links/buttons
const G18: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s))
    for (const h of p.hover) {
      if (h.error || !h.text || h.text.includes('\n') || h.text.length > 40) continue; // card-style links are unreliable
      checked++;
      if (!h.hoverChanged.length) fails.push(ev(p.url, `${h.tag} "${h.text}" (${h.region}): no change on hover`, h.path));
      else if (h.cursor !== 'pointer') fails.push(ev(p.url, `${h.tag} "${h.text}": cursor is ${h.cursor}`, h.path));
    }
  return judge(checked, fails, `${checked} links/buttons tested; each changes on hover.`, `${fails.length} of ${checked} tested items show no hover change or lack a pointer cursor.`, 'No simple links/buttons sampled.', 'medium');
};

// X02: line height 1.2-1.5 (DBIM 4.5 iii)
const X02: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s)) for (const t of p.data!.textStyles.paragraph) { if (t.lineHeightRatio == null) continue; checked++; if (t.lineHeightRatio < 1.2 || t.lineHeightRatio > 1.5) fails.push(ev(p.url, `${t.path}: line-height ${t.lineHeightRatio}`, t.path)); }
  return judge(checked, fails, 'Paragraph line height is 1.2-1.5x the type size.', `${fails.length} paragraph(s) outside 1.2-1.5 line height.`, 'No explicit line heights measured.', 'medium');
};

// X03: CTA button text max 3 words
const X03: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s)) for (const c of p.data!.controls) { if (!c.text) continue; const label = String(c.text).split(/\s+/).filter((w: string) => !w.includes('_')); if (!label.length) continue; checked++; if (label.length > 3) fails.push(ev(p.url, `"${label.join(' ')}" has ${label.length} words`, c.path)); }
  return judge(checked, fails, 'All button labels are three words or fewer.', `${fails.length} button label(s) exceed 3 words.`, 'No buttons found.');
};

export const visualRules: Record<string, RuleFn> = { G01, G02, G04, G11, G12, G13, G14, G15, G16, G17, G18, X02, X03 };
export type { Outcome };
void pending;
