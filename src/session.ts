import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { DbimConfig } from './config.js';

/**
 * One Chromium for a whole job. In live mode (visible window) every phase works in a single tab, so the person watches
 * one window crawl, scroll and measure; headless runs use a fresh tab per page.
 */
export interface Session {
  browser: Browser;
  ctx: BrowserContext;
  live: boolean;
  /** A page to work in: the one shared tab in live mode, a new tab otherwise. */
  page(): Promise<Page>;
  /** Give the page back: closes it unless it is the shared live tab. */
  release(p: Page): Promise<void>;
  close(): Promise<void>;
}

export interface SessionOptions {
  /** Run the live-mode logic (one shared tab, progress badge, slow scrolling) even in a hidden browser; used by tests. */
  simulateLive?: boolean;
  viewport?: { width: number; height: number };
  /** Allow axe-core and the in-page scripts on pages with a strict Content-Security-Policy. */
  bypassCSP?: boolean;
}

export async function openSession(cfg: DbimConfig, opt: SessionOptions = {}): Promise<Session> {
  const visible = !cfg.crawl.headless;
  const live = opt.simulateLive ?? visible;
  const browser = await chromium.launch({ headless: !visible, args: visible ? ['--window-size=1500,1030', '--window-position=24,8'] : [] });
  const ctx = await browser.newContext({
    viewport: opt.viewport ?? { width: 1440, height: 900 },
    ...(opt.bypassCSP ? { bypassCSP: true } : {}),
    ...(cfg.crawl.userAgent ? { userAgent: cfg.crawl.userAgent } : {}),
    ...(cfg.crawl.storageState ? { storageState: cfg.crawl.storageState } : {}),
  });
  let shared: Page | null = null;
  return {
    browser, ctx, live,
    async page() {
      if (!live) return ctx.newPage();
      if (!shared || shared.isClosed()) shared = await ctx.newPage();
      return shared;
    },
    async release(p: Page) {
      if (live) return;
      await p.close().catch(() => {});
    },
    async close() {
      await ctx.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
