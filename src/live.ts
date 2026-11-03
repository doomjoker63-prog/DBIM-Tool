import type { Page } from 'playwright';
import type { DbimConfig } from './config.js';

export const HUD_ID = '__dbim_hud';

/**
 * Live mode = a visible Chromium window that the person can watch. Decided by, in order: --live / --headless flags,
 * crawl.live in the config (true / false), and for "auto" (the default): visible when run from a terminal, hidden in CI.
 */
export function resolveLive(flags: { live?: boolean; headless?: boolean }, cfg: DbimConfig): boolean {
  if (flags.headless) return false;
  if (flags.live) return true;
  const c = cfg.crawl.live;
  if (c === true || c === false) return c;
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

/** Small status badge in a corner of the page so the person can see what the tool is doing. Removed before any measurement. */
export async function showHud(page: Page, title: string, detail = ''): Promise<void> {
  await page
    .evaluate(
      `((title, detail, id) => {
        let h = document.getElementById(id);
        if (!h) {
          h = document.createElement('div');
          h.id = id;
          h.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:46vw;padding:10px 14px;border-radius:10px;background:rgba(15,23,42,.93);color:#fff;font:600 14px/1.35 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none';
          (document.body || document.documentElement).appendChild(h);
        }
        h.innerHTML = '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#22c55e;margin-right:8px"></span>DBIM Auditor &middot; ' + title.replace(/</g, '&lt;') + (detail ? '<div style="font-weight:400;opacity:.8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + detail.replace(/</g, '&lt;') + '</div>' : '');
      })(${JSON.stringify(title)}, ${JSON.stringify(detail.slice(0, 120))}, ${JSON.stringify(HUD_ID)})`,
    )
    .catch(() => {});
}

export async function hideHud(page: Page): Promise<void> {
  await page.evaluate(`document.getElementById(${JSON.stringify(HUD_ID)}) && document.getElementById(${JSON.stringify(HUD_ID)}).remove()`).catch(() => {});
}

/** Scroll the whole page top to bottom and back at a pace a person can follow; also triggers lazy-loaded content. */
export async function liveScroll(page: Page): Promise<void> {
  await page
    .evaluate(`(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      const total = () => document.documentElement.scrollHeight;
      const step = Math.max(150, Math.round(total() / 190)); // about 190 steps, so a very long page still takes about 6 s
      for (let y = 0; y < total() - innerHeight + step; y += step) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 30)); }
      await new Promise(r => setTimeout(r, 250));
      for (let y = total(); y > 0; y -= step * 3) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 10)); }
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.documentElement.style.scrollBehavior = '';
    })()`)
    .catch(() => {});
}
