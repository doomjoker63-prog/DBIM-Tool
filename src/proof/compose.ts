import type { Page } from 'playwright';
import { PANEL_CSS, esc, panelHtml, type PanelInfo } from './panel.js';
import type { PanelSpec } from './types.js';

export const CHROME_H = 64;

export interface Composed {
  jpeg: Buffer;
  /** Where the page screenshot starts inside the final image. */
  offsetX: number;
  offsetY: number;
}

const LOCK = '<svg width="20" height="20" viewBox="0 0 24 24" style="margin-right:10px;flex:none"><path fill="#188038" d="M12 1a5 5 0 0 0-5 5v3H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1h-2V6a5 5 0 0 0-5-5zm-3 5a3 3 0 0 1 6 0v3H9V6z"/></svg>';

/**
 * Put the screenshot inside a browser-style frame (address bar with the real URL) and add the measurement panel below it,
 * like the manual auditor's browser + DevTools screenshots. Rendered by Chromium itself, so text and fonts are reliable.
 */
export async function composeProof(composer: Page, a: { url: string; pagePng: Buffer; vw: number; panel: PanelSpec; info: PanelInfo | null; headline: string }): Promise<Composed> {
  const W = Math.max(a.vw, 960);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#e8eaed} body{width:${W}px}
    .chrome{height:${CHROME_H}px;background:#dee1e6;display:flex;align-items:center;padding:0 18px;box-sizing:border-box;gap:16px;font-family:"Segoe UI",system-ui,Arial,sans-serif}
    .dots span{display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:8px;background:#9aa0a6}
    .pill{flex:1;height:38px;border-radius:19px;background:#fff;display:flex;align-items:center;padding:0 18px;font-size:21px;color:#202124;overflow:hidden;white-space:nowrap}
    .shot{display:block;width:${a.vw}px;background:#fff} ${PANEL_CSS}
  </style></head><body>
    <div class="chrome"><div class="dots"><span></span><span></span><span></span></div><div class="pill">${LOCK}${esc(a.url.length > 120 ? a.url.slice(0, 117) + '...' : a.url)}</div></div>
    <img class="shot" src="data:image/png;base64,${a.pagePng.toString('base64')}">
    <div style="background:#fff;width:${W}px">${panelHtml(a.panel, a.info, a.headline)}</div>
  </body></html>`;
  await composer.setViewportSize({ width: W, height: 900 });
  await composer.setContent(html, { waitUntil: 'load' });
  const jpeg = await composer.screenshot({ type: 'jpeg', quality: 88, fullPage: true });
  return { jpeg, offsetX: 0, offsetY: CHROME_H };
}
