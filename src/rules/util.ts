import type { PageSnapshot } from '../collect.js';
import type { Evidence, Outcome, ProofHint, Site } from './types.js';

export const KB = 1024;
export const MB = 1024 * 1024;

export const fmtBytes = (b: number) => (b >= MB ? (b / MB).toFixed(2) + ' MB' : (b / KB).toFixed(0) + ' KB');

/** Short, de-duplicated list for a remark line. */
export function listed(items: string[], max = 4): string {
  const u = [...new Set(items)];
  return u.slice(0, max).join('; ') + (u.length > max ? `; +${u.length - max} more` : '');
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
};

/** File type from the server's Content-Type when known, else from the URL extension. */
export function fileType(src: string, contentType?: string | null): string {
  if (contentType) {
    const m = MIME_EXT[contentType.split(';')[0].trim().toLowerCase()];
    if (m) return m;
  }
  if (src.startsWith('data:')) return MIME_EXT[src.slice(5).split(/[;,]/)[0].toLowerCase()] ?? 'data';
  try {
    const e = /\.([a-z0-9]+)$/i.exec(new URL(src).pathname);
    const x = e ? e[1].toLowerCase() : 'unknown';
    return x === 'jpeg' ? 'jpg' : x;
  } catch {
    return 'unknown';
  }
}

export function resourceFor(p: PageSnapshot, src: string) {
  const noQuery = (u: string) => u.split('#')[0].split('?')[0];
  return p.resources.find(r => r.url === src) ?? p.resources.find(r => noQuery(r.url) === noQuery(src));
}

export type ImageRole = 'emblem' | 'logo' | 'icon' | 'banner' | 'thumbnail' | 'content';

/** Heuristic role of an <img>. Rules state this in their remarks; ambiguous cases stay conservative. */
export function imageRole(i: Record<string, any>, vw = 1440): ImageRole {
  if (i.nameHint === 'emblem') return 'emblem';
  if (i.nameHint === 'logo') return 'logo';
  if (i.renderedW > 0 && i.renderedW <= 64 && i.renderedH <= 64) return 'icon';
  if (i.renderedW >= Math.min(900, vw * 0.6) && i.renderedH >= 120 && i.region !== 'header' && i.region !== 'footer') return 'banner';
  if (i.renderedW > 0 && i.renderedW <= 400) return 'thumbnail';
  return 'content';
}

export const pagesOf = (s: Site) => s.pages.filter(p => p.data && !p.error);

export const ev = (url: string, detail: string, selector?: string, proof?: ProofHint): Evidence => {
  const e: Evidence = { url, detail };
  if (selector) e.selector = selector;
  if (proof) e.proof = proof;
  return e;
};

/** Selector for an <img> from its URL (attribute may be relative, so match the file name). */
export const imgSel = (src: string): string => {
  try {
    const f = new URL(src).pathname.split('/').pop() ?? '';
    return f ? `img[src*="${f.replace(/"/g, '')}"]` : 'img';
  } catch {
    return 'img';
  }
};

/** Standard verdict builder: nothing checked -> N/A, any failure -> NC, else Compliance. */
export function judge(checked: number, fails: Evidence[], okRemark: string, failRemark: string, naRemark: string, confidence: Outcome['confidence'] = 'high'): Outcome {
  if (checked === 0) return { verdict: 'N/A', remarks: naRemark, confidence };
  if (fails.length) return { verdict: 'Non-Compliance', remarks: failRemark, confidence, evidence: fails };
  return { verdict: 'Compliance', remarks: okRemark, confidence };
}

export const pending = (remarks: string): Outcome => ({ verdict: 'Pending', remarks, confidence: 'low' });

// ---- colour helpers
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
export const isNeutral = (hex: string) => hexToHsl(hex).s < 0.12;

export interface GroupInfo {
  group: string | null;
  source: 'config' | 'footer' | 'usage' | 'none';
}

/** The selected primary colour group: configured, else inferred from the footer key colour, else most-used palette colour. */
export function detectGroup(site: Site): GroupInfo {
  const prim = site.palette.primary;
  if (site.cfg.colourGroup && prim[site.cfg.colourGroup]) return { group: site.cfg.colourGroup, source: 'config' };
  const keyOf = (hex: string) => Object.keys(prim).find(g => prim[g][0].toUpperCase() === hex.toUpperCase());
  for (const p of pagesOf(site)) {
    const bg = p.data?.footer?.bgEffective as string | undefined;
    if (bg && bg !== 'image') {
      const g = keyOf(bg);
      if (g) return { group: g, source: 'footer' };
    }
  }
  const score: Record<string, number> = {};
  for (const p of pagesOf(site))
    for (const kind of ['text', 'background'])
      for (const [hex, n] of (p.data?.colours?.[kind] ?? []) as [string, number][])
        for (const g of Object.keys(prim)) if (prim[g].some(c => c.toUpperCase() === hex.toUpperCase())) score[g] = (score[g] ?? 0) + n;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best ? { group: best[0], source: 'usage' } : { group: null, source: 'none' };
}

export const sameHex = (a?: string | null, b?: string | null) => !!a && !!b && a.toUpperCase() === b.toUpperCase();

/** Relative luminance (0..1) of a #RRGGBB colour; null if it is not one. */
export function hexLum(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
