import fs from 'node:fs';
import path from 'node:path';
import type { DbimConfig } from './config.js';
import { settle } from './crawler.js';
import { hideHud, showHud } from './live.js';
import { openSession, type Session } from './session.js';
import { writeJsonAtomic } from './fsutil.js';
import { slugFor } from './url.js';
import { analyseAssets, type AssetInfo } from './collectors/assets.js';
import { collectAxe, type AxeReport } from './collectors/axe.js';
import { collectFonts, type FontReport } from './collectors/fonts.js';
import { collectHover, type HoverResult } from './collectors/hover.js';
import { inpage } from './collectors/inpage.js';
import { recordNetwork, type Resource } from './collectors/network.js';
import { pickQueries, probeSearch, type SearchProbe } from './collectors/search.js';
import { resourceFor } from './rules/util.js';

export interface ResponsiveResult {
  width: number;
  screenshot: string | null;
  [k: string]: unknown;
}

/** Everything measured on one page. Rules (Phase 3+) read only this, never the live site. */
export interface PageSnapshot {
  url: string;
  finalUrl: string;
  status: number | null;
  capturedAt: string;
  error?: string;
  data: Record<string, any> | null; // output of inpage/page-data.js
  fonts: FontReport | null;
  hover: HoverResult[];
  axe: AxeReport | null;
  /** Fingerprints of icons, logos, emblem and PM images (Phase 5). */
  assets: AssetInfo[];
  /** Live search test (first page only). */
  searchProbe: SearchProbe | null;
  resources: Resource[];
  responsive: ResponsiveResult[];
  timings: { loadMs: number; collectMs: number };
}

export interface CollectOptions {
  /** Use this browser session (one Chromium shared with the crawl). Opened and closed here if absent. */
  session?: Session;
  axe: boolean;
  screenshots: boolean;
  /** Type real queries into the site's search box on the first page. */
  search?: boolean;
  only?: number[];
  delayMs: number;
  /** Skip pages that already have a snapshot (continue an interrupted collect). */
  resume?: boolean;
  /** With resume: collect again the pages whose snapshot recorded an error. */
  retryErrors?: boolean;
}

export function latestRun(outDir: string): string | null {
  if (!fs.existsSync(outDir)) return null;
  const runs = fs.readdirSync(outDir).filter(d => fs.existsSync(path.join(outDir, d, 'crawl.json'))).sort();
  return runs.length ? path.resolve(outDir, runs[runs.length - 1]) : null;
}

/** Create a one-page run directory so a single URL can be collected without crawling. */
export function singleUrlRun(outDir: string, url: string): string {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.resolve(outDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'crawl.json'), JSON.stringify({ runId, runDir, pages: [{ url, depth: 0 }], assets: [], external: [], skipped: [] }));
  return runDir;
}

export async function collect(cfg: DbimConfig, runDir: string, opt: CollectOptions, log: (m: string) => void = console.log) {
  const crawlFile = JSON.parse(fs.readFileSync(path.join(runDir, 'crawl.json'), 'utf8')) as { pages: { url: string; status?: number | null }[] };
  const snapDir = path.join(runDir, 'snapshots');
  const shotDir = path.join(runDir, 'shots');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.mkdirSync(shotDir, { recursive: true });

  const ownSession = !opt.session;
  const session = opt.session ?? (await openSession(cfg, { bypassCSP: true, viewport: { width: cfg.viewports[0] ?? 1440, height: 900 } }));
  const ctx = session.ctx;
  const live = session.live;

  const written: string[] = [];
  const assetCache = new Map<string, any>();
  try {
    for (const [i, p] of crawlFile.pages.entries()) {
      if (opt.only && !opt.only.includes(i + 1)) continue;
      const id = String(i + 1).padStart(3, '0');
      const base = `${id}_${slugFor(p.url)}`;
      const existing = path.join(runDir, `snapshots/${base}.json`);
      if (opt.resume && fs.existsSync(existing)) {
        let failed = false;
        try { failed = !!(JSON.parse(fs.readFileSync(existing, 'utf8')) as PageSnapshot).error; } catch { failed = true; } // unreadable = half-written
        if (!failed || !opt.retryErrors) { written.push(`snapshots/${base}.json`); log(`[${i + 1}/${crawlFile.pages.length}] already collected: ${p.url}`); continue; }
      }
      const snap: PageSnapshot = {
        url: p.url, finalUrl: p.url, status: null, capturedAt: new Date().toISOString(), data: null, fonts: null, hover: [], axe: null, assets: [], searchProbe: null, resources: [], responsive: [], timings: { loadMs: 0, collectMs: 0 },
      };
      const page = await session.page();
      const net = recordNetwork(page, new URL(p.url).hostname);
      try {
        const t0 = Date.now();
        await page.setViewportSize({ width: cfg.viewports[0] ?? 1440, height: 900 });
        const resp = await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        snap.status = resp?.status() ?? null;
        if (live) await showHud(page, `Measuring page ${i + 1} of ${crawlFile.pages.length}`, p.url);
        await settle(page, live);
        if (live) await hideHud(page); // nothing of ours may be on the page while it is measured
        snap.finalUrl = page.url();
        snap.timings.loadMs = Date.now() - t0;

        const t1 = Date.now();
        snap.data = (await page.evaluate(inpage('page-data'))) as Record<string, any>;
        snap.fonts = await collectFonts(ctx, page).catch(() => null);
        snap.hover = await collectHover(page);
        if (opt.axe) snap.axe = await collectAxe(page);
        const seen = net.peek();
        snap.assets = await analyseAssets(ctx, snap.data, src => resourceFor({ resources: seen } as any, src)?.bytes ?? null, assetCache, new URL(p.url).hostname);

        for (const w of cfg.viewports) {
          await page.setViewportSize({ width: w, height: w <= 480 ? 800 : 900 });
          await page.waitForTimeout(400);
          const r = (await page.evaluate(inpage('responsive'))) as Record<string, unknown>;
          let shot: string | null = null;
          if (opt.screenshots) {
            const file = `${base}_w${w}.jpg`;
            try {
              await page.screenshot({ path: path.join(shotDir, file), type: 'jpeg', quality: 55, fullPage: true, timeout: 15000 });
              shot = `shots/${file}`;
            } catch {
              try {
                await page.screenshot({ path: path.join(shotDir, file), type: 'jpeg', quality: 55, timeout: 8000 });
                shot = `shots/${file}`;
              } catch {
                /* no screenshot */
              }
            }
          }
          snap.responsive.push({ width: w, screenshot: shot, ...r });
        }
        snap.resources = await net.stop(); // freeze before the search probe navigates elsewhere
        if (opt.search !== false && i === 0 && snap.data) {
          await page.setViewportSize({ width: cfg.viewports[0] ?? 1440, height: 900 });
          snap.searchProbe = await probeSearch(page, p.url, pickQueries(snap.data));
        }
        snap.timings.collectMs = Date.now() - t1;
      } catch (e) {
        snap.error = (e as Error).message.split('\n')[0];
      } finally {
        snap.resources = await net.stop();
        await hideHud(page);
        await session.release(page);
      }
      const file = `snapshots/${base}.json`;
      writeJsonAtomic(path.join(runDir, file), snap);
      written.push(file);
      const d = snap.data;
      log(`[${i + 1}/${crawlFile.pages.length}] ${snap.status ?? 'ERR'} ${p.url}  imgs=${d?.images.length ?? 0} axe=${snap.axe ? snap.axe.violations.length : '-'} ${snap.error ? '! ' + snap.error : ''}`);
      await new Promise(r => setTimeout(r, opt.delayMs));
    }
  } finally {
    if (ownSession) await session.close();
  }
  return written;
}
