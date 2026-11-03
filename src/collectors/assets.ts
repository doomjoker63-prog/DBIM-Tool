import type { BrowserContext } from 'playwright';
import { fetchAllowed } from '../net-guard.js';
import { analyseImage, type ImageInfo } from '../imaging.js';
import { fileType, imageRole } from '../rules/util.js';

export interface AssetInfo {
  /** Stable key: image URL, or "inline:<css path>" for inline SVG. */
  key: string;
  kind: 'img' | 'svg';
  /** emblem | logo | icon | pm */
  role: string;
  region: string;
  path: string;
  type: string;
  bytes: number | null;
  info: ImageInfo | null;
  /** For inline SVG: computed fill / stroke / colour of the first shape. */
  fill?: string | null;
  stroke?: string | null;
  color?: string | null;
  onBg?: string | null;
}

const MAX_BYTES = 600 * 1024;
const PM = /prime.?minister|narendra|modi|pm[-_ ]?(quote|image|portrait|photo)/i;

type Cache = Map<string, ImageInfo | null>;

const withNs = (svg: string) => (/xmlns=/.test(svg.slice(0, 400)) ? svg : svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"'));

/** Download and fingerprint the small brand assets of a page (icons, logos, emblem, PM image) and its inline SVG icons/emblem. */
export async function analyseAssets(ctx: BrowserContext, data: Record<string, any>, sizeOf: (src: string) => number | null, cache: Cache = new Map(), scopeHost = ''): Promise<AssetInfo[]> {
  const out: AssetInfo[] = [];

  for (const i of (data.images ?? []) as any[]) {
    if (out.length >= 80) break;
    if (!i.visible || !i.src || i.renderedW <= 0) continue;
    const role = PM.test(`${i.src} ${i.alt ?? ''} ${i.cls ?? ''}`) && i.renderedW >= 80 ? 'pm' : imageRole(i);
    if (!['emblem', 'logo', 'icon', 'pm'].includes(role)) continue;
    const bytes = sizeOf(i.src);
    if (bytes != null && bytes > MAX_BYTES) continue;
    let info: ImageInfo | null | undefined = cache.get(i.src);
    if (info === undefined) {
      info = null;
      try {
        let buf: Buffer | null = null;
        if (i.src.startsWith('data:')) {
          const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(i.src);
          if (m) buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
        } else if (fetchAllowed(i.src, scopeHost)) {
          const r = await ctx.request.get(i.src, { timeout: 10000 });
          if (r.ok()) buf = await r.body();
        }
        const type = fileType(i.src);
        if (buf && buf.length <= MAX_BYTES * 2) info = await analyseImage(buf, type === 'svg' || /^\s*<(\?xml|svg)/.test(buf.subarray(0, 80).toString()));
      } catch {
        info = null;
      }
      cache.set(i.src, info);
    }
    out.push({ key: i.src, kind: 'img', role, region: i.region, path: i.path, type: fileType(i.src), bytes, info });
  }

  for (const ic of (data.icons ?? []) as any[]) {
    if (ic.kind !== 'svg' || !ic.markup || out.length >= 160) continue;
    const key = `inline:${ic.path}`;
    const markup = withNs(ic.markup as string);
    let info = cache.get(markup.slice(0, 200) + markup.length);
    if (info === undefined) {
      info = await analyseImage(Buffer.from(markup), true);
      cache.set(markup.slice(0, 200) + markup.length, info);
    }
    out.push({ key, kind: 'svg', role: /emblem/i.test(ic.path) ? 'emblem' : /logo/i.test(ic.path) ? 'logo' : 'icon', region: ic.region, path: ic.path, type: 'svg', bytes: null, info, fill: ic.fill, stroke: ic.stroke, color: ic.color, onBg: ic.onBg });
  }
  return out;
}
