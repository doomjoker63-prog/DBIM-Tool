import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import type { PanelInfo } from './panel.js';
import type { Box, ProofSpec } from './types.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'inpage');
const read = (n: string) => fs.readFileSync(path.join(dir, n), 'utf8');
let LOCATE = '', INFO = '';
const locateScript = (args: unknown) => `(${(LOCATE ||= read('proof-locate.js'))})(${JSON.stringify(args)})`;
const infoScript = (args: unknown) => `(${(INFO ||= read('proof-info.js'))})(${JSON.stringify(args)})`;

/** Smooth scrolling and entrance animations make a screenshot show a half-scrolled or half-drawn page. Switch them off. */
const STEADY_CSS = 'html{scroll-behavior:auto!important} *,*::before,*::after{scroll-behavior:auto!important;animation-duration:0.001s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important}';

const REVEAL = `(async () => {
  const total = () => Math.min(document.documentElement.scrollHeight, 20000);
  for (let y = 0; y < total(); y += 450) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 40)); }
  window.scrollTo({ top: 0, behavior: 'instant' });
})()`;

const frames = (page: Page) => page.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');

export interface LocateResult {
  items: { rect: Box; kind: string }[];
  topObstruct: number;
  scrollMax: number;
  vw: number;
  vh: number;
  scrollY: number;
}

/** Open the page at the proof's width and get it into a steady, fully revealed state. */
export async function preparePage(page: Page, url: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.addStyleTag({ content: STEADY_CSS }).catch(() => {});
  await page.evaluate(REVEAL).catch(() => {});
  await page.waitForTimeout(250);
}

export interface Shot {
  png: Buffer;
  /** Boxes in screenshot pixels. Empty when nothing could be boxed. */
  boxes: Box[];
  info: PanelInfo | null;
  located: number;
}

/**
 * Scroll to the target, draw the red boxes as an overlay on top of the page, and take the screenshot.
 *  center: put the target in the middle of the screen; top: put it just under any sticky header.
 */
export async function shoot(page: Page, spec: ProofSpec, strategy: 'center' | 'top'): Promise<Shot> {
  await page.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  let loc = spec.targets.length ? ((await page.evaluate(locateScript({ targets: spec.targets, max: 4 }))) as LocateResult) : null;
  let scrollY = 0;

  if (loc && loc.items.length) {
    const first = loc.items[0];
    if (first.kind !== 'viewport-bottom') {
      const avail = loc.vh - loc.topObstruct;
      const wanted = strategy === 'center' && first.rect.h < avail - 60 ? first.rect.y - loc.topObstruct - (avail - first.rect.h) / 2 : first.rect.y - loc.topObstruct - 24;
      const top = Math.max(0, Math.min(loc.scrollMax, Math.round(wanted)));
      await page.evaluate(`window.scrollTo({ top: ${top}, behavior: 'instant' })`);
      await frames(page);
      await page.waitForTimeout(350); // let reveal-on-scroll and lazy images settle
      loc = (await page.evaluate(locateScript({ targets: spec.targets, max: 4 }))) as LocateResult; // layout may have moved
    }
    scrollY = loc.scrollY;
  }

  const boxes: Box[] = [];
  if (loc) {
    for (const it of loc.items) {
      const top = Math.max(it.rect.y - scrollY, loc.topObstruct + 2), bottom = Math.min(it.rect.y - scrollY + it.rect.h, loc.vh - 2);
      if (bottom - top < 14 || it.rect.x + it.rect.w < 4 || it.rect.x > loc.vw - 4) continue;
      // inset from the screen edge so all four sides of the box are visible even for edge-to-edge elements
      const x0 = Math.max(5, Math.min(it.rect.x - 5, loc.vw - 30));
      const x1 = Math.min(loc.vw - 5, Math.max(it.rect.x + it.rect.w + 5, x0 + 24));
      const y0 = Math.max(loc.topObstruct + 3, top - 5);
      const y1 = Math.min(loc.vh - 5, Math.max(bottom + 5, y0 + 24));
      boxes.push({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
    }
  }

  const panel = spec.panel;
  const info = ((await page.evaluate(infoScript({ index: loc && loc.items.length ? 0 : null, props: panel.kind === 'computed' ? panel.props : undefined, head: panel.kind === 'head', needle: panel.kind === 'search' ? panel.needle : undefined })).catch(() => null)) as PanelInfo | null) ?? null;

  if (boxes.length) await page.evaluate(`((boxes) => {
    const c = document.createElement('div'); c.id = '__dbim_boxes'; c.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    for (const b of boxes) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;box-sizing:border-box;border:4px solid #E00000;box-shadow:0 0 0 2px #ffffff;pointer-events:none;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px'; c.appendChild(d); }
    document.documentElement.appendChild(c);
  })(${JSON.stringify(boxes)})`);
  await page.waitForTimeout(80);
  const png = await page.screenshot({ type: 'png' });
  await page.evaluate(`document.getElementById('__dbim_boxes') && document.getElementById('__dbim_boxes').remove()`).catch(() => {});
  return { png, boxes, info, located: loc?.items.length ?? 0 };
}
