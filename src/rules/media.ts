import type { Evidence, RuleFn, Site } from './types.js';
import { detectGroup, ev, fileType, imgSel, fmtBytes, imageRole, judge, KB, listed, MB, pagesOf, pending, resourceFor, sameHex, type ImageRole } from './util.js';

const IMG_OK = ['jpg', 'png', 'webp'];
const LOGO_OK = ['jpg', 'png', 'svg', 'webp'];
const ICON_OK = ['png', 'svg', 'webp'];

interface Img {
  page: string;
  src: string;
  role: ImageRole;
  type: string;
  bytes: number | null;
  w: number;
  h: number;
  aspectDelta: number | null;
  objectFit: string;
  alt: string | null;
  altLen: number;
  sel: string;
}

function images(s: Site): Img[] {
  const out: Img[] = [];
  for (const p of pagesOf(s))
    for (const i of p.data!.images as any[]) {
      if (!i.visible || !i.src || i.renderedW <= 0) continue;
      const r = resourceFor(p, i.src);
      out.push({ page: p.url, src: i.src, role: imageRole(i), type: fileType(i.src, r?.contentType), bytes: r?.bytes ?? null, w: i.renderedW, h: i.renderedH, aspectDelta: i.aspectDelta, objectFit: i.objectFit, alt: i.alt, altLen: i.altLen, sel: imgSel(i.src) });
    }
  return out;
}
const short = (u: string) => (u.length > 70 ? '...' + u.slice(-67) : u);

function sizeRule(roles: ImageRole[], limit: number, label: string, unit: 'KB' | 'MB'): RuleFn {
  return s => {
    const list = images(s).filter(i => roles.includes(i.role));
    const seen = new Set<string>();
    const fails: Evidence[] = [];
    let unknown = 0, checked = 0;
    for (const i of list) {
      if (seen.has(i.src)) continue;
      seen.add(i.src);
      if (i.bytes == null) { unknown++; continue; }
      checked++;
      if (i.bytes > limit) fails.push(ev(i.page, `${short(i.src)} is ${fmtBytes(i.bytes)} (limit ${unit === 'KB' ? limit / KB + ' KB' : limit / MB + ' MB'})`, i.sel, { panel: 'network', needle: i.src }));
    }
    const note = unknown ? ` ${unknown} file(s) had no measurable size.` : '';
    return judge(checked, fails, `${checked} ${label} within ${unit === 'KB' ? limit / KB + ' KB' : limit / MB + ' MB'} (KB = 1024 bytes).${note}`, `${fails.length} of ${checked} ${label} exceed the limit.${note}`, `No ${label} identified.${note}`, 'medium');
  };
}

const G07: RuleFn = s => {
  const icons = images(s).filter(i => i.role === 'icon');
  const fails: Evidence[] = icons.filter(i => !ICON_OK.includes(i.type)).map(i => ev(i.page, `${short(i.src)} is ${i.type}`, i.sel, { panel: 'network', needle: i.src }));
  // Only elements whose font really is an icon font (Material Symbols, Font Awesome ...) count; a class name containing "icon" is not enough.
  const fonts = new Map<string, string>();
  for (const p of pagesOf(s)) for (const ic of p.data!.icons as any[]) {
    if (ic.kind !== 'font') continue;
    const fam = String(ic.fontFamily).split(',')[0].replace(/["']/g, '').trim();
    if (/icon|symbol|awesome|glyph|material|bootstrap|ionicons/i.test(fam) && !fonts.has(fam)) fonts.set(fam, ic.path);
  }
  for (const [f, sel] of fonts) fails.push(ev(s.pages[0].url, `icon font "${f}" used (icons must be PNG, SVG or WEBP files)`, sel));
  return judge(icons.length + fonts.size, fails, `${icons.length} icon image(s) are PNG/SVG/WEBP.`, `Icons not in PNG/SVG/WEBP: ${listed(fails.map(f => f.detail))}.`, 'No icon images or icon fonts identified.', 'medium');
};

const G08: RuleFn = s => {
  const allowed = [24, 32, 48, 64];
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s))
    for (const ic of p.data!.icons as any[]) {
      if (ic.kind !== 'svg' || ic.w < 12 || ic.w > 80 || /emblem|logo/i.test(ic.path)) continue;
      checked++;
      if (!allowed.some(a => Math.abs(a - ic.w) <= 1) || Math.abs(ic.w - ic.h) > 1) fails.push(ev(p.url, `${ic.path}: ${ic.w}x${ic.h}px`, ic.path));
    }
  return judge(checked, fails, `${checked} inline icons match DBIM sizes (24/32/48/64 px).`, `${fails.length} of ${checked} icons are not 24/32/48/64 px square (e.g. ${listed(fails.map(f => f.detail.split(': ')[1]), 4)}). Icon identification is heuristic.`, 'No inline icons identified.', 'medium');
};

const G09: RuleFn = s => {
  const fails = images(s).filter(i => i.role === 'icon' && i.aspectDelta != null && i.aspectDelta > 0.05 && !['contain', 'cover'].includes(i.objectFit)).map(i => ev(i.page, `${short(i.src)} distorted by ${(i.aspectDelta! * 100).toFixed(0)}%`, i.sel));
  const n = images(s).filter(i => i.role === 'icon').length;
  return judge(n, fails, `${n} icon image(s) keep their proportions.`, `${fails.length} icon(s) are stretched or compressed.`, 'No icon images identified.', 'medium');
};

const distorted = (role: ImageRole): RuleFn => s => {
  const list = images(s).filter(i => i.role === role);
  const fails = list.filter(i => i.aspectDelta != null && i.aspectDelta > 0.03 && !['contain', 'cover'].includes(i.objectFit)).map(i => ev(i.page, `${short(i.src)} drawn at ${i.w}x${i.h}, distorted by ${(i.aspectDelta! * 100).toFixed(0)}%`, i.sel));
  const label = role === 'emblem' ? 'emblem' : 'logo';
  return judge(list.length, fails, `${list.length} ${label} image(s) keep their aspect ratio.`, `${fails.length} ${label} image(s) are scaled disproportionately.`, `No ${label} image identified (SVG logos are not measured).`, 'medium');
};

const G28: RuleFn = s => {
  const list = images(s).filter(i => i.role === 'logo' || i.role === 'emblem');
  const fails = list.filter(i => !LOGO_OK.includes(i.type)).map(i => ev(i.page, `${short(i.src)} is ${i.type}`, i.sel, { panel: 'network', needle: i.src }));
  return judge(list.length, fails, `${list.length} logo/emblem image(s) are JPEG/PNG/SVG/WEBP.`, `${fails.length} logo(s) in a disallowed format.`, 'No logo images identified.', 'medium');
};

const G34: RuleFn = s => {
  const list = images(s).filter(i => ['banner', 'thumbnail', 'content'].includes(i.role));
  const fails: Evidence[] = list.filter(i => !IMG_OK.includes(i.type)).map(i => ev(i.page, `${short(i.src)} is ${i.type}`, i.sel, { panel: 'network', needle: i.src }));
  for (const p of pagesOf(s)) for (const b of p.data!.backgrounds as any[]) { const t = fileType(b.src, resourceFor(p, b.src)?.contentType); if (!IMG_OK.includes(t) && t !== 'svg') fails.push(ev(p.url, `background ${short(b.src)} is ${t}`, b.path, { panel: 'network', needle: b.src })); }
  return judge(list.length, fails, `${list.length} content image(s) are JPEG/PNG/WEBP.`, `Images in other formats: ${listed(fails.map(f => f.detail), 4)}.`, 'No content images identified.', 'medium');
};

const G30: RuleFn = s => {
  const fails: Evidence[] = [];
  const seen = new Set<string>();
  let checked = 0, unknown = 0;
  for (const p of pagesOf(s))
    for (const b of p.data!.backgrounds as any[]) {
      if (seen.has(b.src)) continue;
      seen.add(b.src);
      const r = resourceFor(p, b.src);
      if (r?.bytes == null) { unknown++; continue; }
      checked++;
      if (r.bytes > 500 * KB) fails.push(ev(p.url, `${short(b.src)} is ${fmtBytes(r.bytes)}`, b.path, { panel: 'network', needle: b.src }));
    }
  return judge(checked, fails, `${checked} CSS background image(s) within 500 KB.`, `${fails.length} background image(s) exceed 500 KB.`, `No CSS background images measured${unknown ? ` (${unknown} unsized)` : ''}.`, 'medium');
};

// X01: alt text (DBIM 6.1.2) - not in the Level-1 template but defined in the manual
const X01: RuleFn = s => {
  const fails: Evidence[] = [];
  let checked = 0;
  for (const i of images(s)) {
    if (i.alt == null || i.alt === '') continue; // missing/empty alt is handled by axe
    checked++;
    if (i.altLen > 140) fails.push(ev(i.page, `${short(i.src)}: alt is ${i.altLen} characters`, i.sel));
    if (/^(image|picture|photo|graphic)( of)?\b/i.test(i.alt)) fails.push(ev(i.page, `${short(i.src)}: alt starts with "${i.alt.split(' ').slice(0, 2).join(' ')}"`, i.sel));
  }
  return judge(checked, fails, 'Alt texts are within 140 characters and avoid "image of".', `${fails.length} alt text issue(s).`, 'No alt text found.', 'high');
};

// G03: icon colours
const G03: RuleFn = s => {
  const info = detectGroup(s);
  if (!info.group) return pending('Primary colour group could not be determined; set colourGroup in dbim.config.json.');
  const key = s.palette.primary[info.group][0];
  const fails: Evidence[] = [];
  let checked = 0;
  for (const p of pagesOf(s))
    for (const ic of p.data!.icons as any[]) {
      if (ic.kind !== 'svg' || /emblem|logo/i.test(ic.path)) continue;
      const c = ic.fill ?? ic.stroke ?? ic.color;
      if (!c) continue;
      checked++;
      if (!sameHex(c, key) && !sameHex(c, '#FFFFFF')) fails.push(ev(p.url, `${ic.path}: ${c} on ${ic.onBg} (expected ${key} or #FFFFFF)`, ic.path));
    }
  return judge(checked, fails, `${checked} inline icons use ${key} or white.`, `${fails.length} of ${checked} inline icons use colours other than ${key} or #FFFFFF.`, 'No inline SVG icons found.', 'medium');
};

export const mediaRules: Record<string, RuleFn> = {
  G03, G07, G08, G09,
  G20: distorted('emblem'), G27: distorted('logo'), G28,
  G29: sizeRule(['logo', 'emblem'], 100 * KB, 'logo image(s)', 'KB'),
  G30,
  G31: sizeRule(['banner'], 500 * KB, 'banner image(s)', 'KB'),
  G32: sizeRule(['thumbnail'], 100 * KB, 'thumbnail image(s)', 'KB'),
  G33: sizeRule(['banner', 'thumbnail', 'content'], 5 * MB, 'photograph(s)', 'MB'),
  G34, X01,
};
