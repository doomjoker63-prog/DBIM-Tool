import type { Page } from 'playwright';
import { inpage } from './inpage.js';

export interface HoverResult {
  id: number;
  tag: string;
  text: string;
  region: string;
  path: string;
  /** Style properties that changed between normal and hover / focus. Empty = no visible change. */
  hoverChanged: string[];
  focusChanged: string[];
  cursor: string;
  error?: string;
}

const READ = `el => { const s = getComputedStyle(el); return { color: s.color, backgroundColor: s.backgroundColor, textDecorationLine: s.textDecorationLine, boxShadow: s.boxShadow, borderColor: s.borderTopColor, outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, transform: s.transform, opacity: s.opacity, cursor: s.cursor, kids: Array.from(el.querySelectorAll('*')).slice(0, 12).map(c => { const t = getComputedStyle(c); return t.color + t.backgroundColor + t.opacity + t.transform + t.boxShadow; }).join('|'), img: (el.querySelector('img') || {}).currentSrc || '' }; }`;

// Built with new Function so the TypeScript toolchain cannot inject helpers into browser code.
const fn = (src: string) => new Function('return ' + src)() as (el: Element) => unknown;
const readStyle = fn(READ);
const blur = fn('el => el.blur()');

const diff = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).filter(k => k !== 'cursor' && a[k] !== b[k]);

export async function collectHover(page: Page): Promise<HoverResult[]> {
  const picks = (await page.evaluate(inpage('clickables'))) as Omit<HoverResult, 'hoverChanged' | 'focusChanged' | 'cursor'>[];
  const out: HoverResult[] = [];
  for (const p of picks) {
    const el = page.locator(`[data-dbim-hover="${p.id}"]`).first();
    const r: HoverResult = { ...p, hoverChanged: [], focusChanged: [], cursor: '' };
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 2000 });
      await page.mouse.move(0, 0);
      const base = (await el.evaluate(readStyle)) as Record<string, string>;
      await el.hover({ timeout: 2000 });
      await page.waitForTimeout(300);
      const hov = (await el.evaluate(readStyle)) as Record<string, string>;
      r.hoverChanged = diff(base, hov);
      r.cursor = hov.cursor;
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
      await el.focus({ timeout: 1500 });
      await page.waitForTimeout(150);
      const foc = (await el.evaluate(readStyle)) as Record<string, string>;
      r.focusChanged = diff(base, foc);
      await el.evaluate(blur);
    } catch (e) {
      r.error = (e as Error).message.split('\n')[0];
    }
    out.push(r);
  }
  return out;
}
