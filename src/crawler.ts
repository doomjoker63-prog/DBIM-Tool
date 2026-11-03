import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { DbimConfig } from './config.js';
import { sleep, writeJsonAtomic } from './fsutil.js';
import { fetchAllowed } from './net-guard.js';
import { hideHud, liveScroll, showHud } from './live.js';
import { ALLOW_ALL, loadRobots, type Robots } from './robots.js';
import { openSession, type Session } from './session.js';
import { classify, normalizeUrl, sameSite, slugFor } from './url.js';

export interface ResourceRecord {
  url: string;
  type: string;
  status: number;
  /** Transfer size from Content-Length when sent, else body length. */
  bytes: number | null;
  contentType: string | null;
}

export interface PageRecord {
  url: string;
  finalUrl: string;
  depth: number;
  status: number | null;
  title: string;
  linkCount: number;
  resources: ResourceRecord[];
  error?: string;
  /** The page looks like a WAF / captcha / "access denied" screen, not the site's own content. */
  blocked?: boolean;
  /** Load attempts used (1 = first try worked). */
  attempts?: number;
  file: string;
}

export interface CrawlResult {
  runId: string;
  runDir: string;
  pages: PageRecord[];
  assets: string[];
  external: string[];
  skipped: { url: string; reason: string }[];
  /** True when the queue was emptied. False = stopped early (limit, time, Ctrl+C or block) and can be resumed. */
  finished: boolean;
  /** Why the crawl stopped early, if it did. */
  stopReason?: 'max-pages' | 'time-limit' | 'interrupted' | 'blocked';
}

interface CrawlState {
  start: string;
  seen: string[];
  queue: { url: string; depth: number }[];
  assets: string[];
  external: string[];
  skipped: { url: string; reason: string }[];
  delayMs: number;
  finished: boolean;
  stopReason?: CrawlResult['stopReason'];
}

export interface CrawlOptions {
  /** Use this browser session (one Chromium shared by crawl, collect and proofs). Opened and closed here if absent. */
  session?: Session;
  /** Continue an earlier run folder (reads crawl-state.json). */
  resumeDir?: string;
  /** Ignore robots.txt (only for sites you own or are explicitly authorised to test). */
  ignoreRobots?: boolean;
  maxMinutes?: number | null;
}

export const STATE_FILE = (runDir: string) => path.join(runDir, 'crawl-state.json');

const RETRY_STATUS = new Set([429, 502, 503, 504]);
const BLOCK_TEXT = /access denied|request blocked|attention required|just a moment|captcha|are you (a )?(human|robot)|unusual traffic|checking your browser|incapsula|reference #\d|you have been blocked/i;

/** Block pages are short; a long page that merely mentions "captcha" is not one. */
export function looksBlocked(title: string, text: string, status: number | null): boolean {
  const short = text.length < 3000;
  if ((status === 403 || status === 406) && short) return true;
  return short && BLOCK_TEXT.test(`${title} ${text.slice(0, 1500)}`);
}

async function sitemapSeeds(origin: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const r = await fetch(new URL('/sitemap.xml', origin), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return out;
    const xml = await r.text();
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) out.push(m[1]);
  } catch {
    /* sitemap is optional */
  }
  return out.filter(u => !u.endsWith('.xml'));
}

async function collectLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => (a as HTMLAnchorElement).href));
}

export async function settle(page: Page, live = false) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  if (live) return liveScroll(page); // visible mode: a pace a person can follow
  // Trigger lazy-loaded images before measuring.
  await page
    .evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

export async function crawl(cfg: DbimConfig, log: (m: string) => void = console.log, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const resuming = !!opts.resumeDir;
  let runDir: string, runId: string;
  let state: CrawlState;
  const pages: PageRecord[] = [];

  if (resuming) {
    runDir = path.resolve(opts.resumeDir!);
    runId = path.basename(runDir);
    if (!fs.existsSync(STATE_FILE(runDir))) throw new Error(`Nothing to resume in ${runDir} (no crawl-state.json).`);
    state = JSON.parse(fs.readFileSync(STATE_FILE(runDir), 'utf8')) as CrawlState;
    const prev = JSON.parse(fs.readFileSync(path.join(runDir, 'crawl.json'), 'utf8')) as { pages: PageRecord[] };
    for (const p of prev.pages) pages.push({ ...p, resources: [] });
    state.finished = false;
    state.stopReason = undefined;
    log(`Resuming ${runId}: ${pages.length} page(s) done, ${state.queue.length} queued.`);
  } else {
    const start = cfg.scope[0];
    runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    runDir = path.resolve(cfg.outDir, runId);
    state = { start, seen: [], queue: [], assets: [], external: [], skipped: [], delayMs: cfg.crawl.delayMs, finished: false };
  }
  fs.mkdirSync(path.join(runDir, 'pages'), { recursive: true });
  const start = state.start;
  const origin = new URL(start).origin;
  const ua = cfg.crawl.userAgent ?? 'dbim-auditor';

  const exclude = cfg.crawl.exclude.map(e => new RegExp(e, 'i'));
  const seen = new Set(state.seen);
  const assets = new Set(state.assets);
  const external = new Set(state.external);
  const queue = state.queue;
  const enqueue = (raw: string, depth: number, base?: string) => {
    const u = normalizeUrl(raw, base);
    if (!u || seen.has(u)) return;
    seen.add(u);
    queue.push({ url: u, depth });
  };

  let robots: Robots = ALLOW_ALL;
  if (cfg.crawl.respectRobots && !opts.ignoreRobots) {
    robots = await loadRobots(origin, ua);
    if (robots.crawlDelayMs && robots.crawlDelayMs > state.delayMs) { state.delayMs = Math.min(robots.crawlDelayMs, 30000); log(`robots.txt asks for a ${robots.crawlDelayMs / 1000}s crawl delay; using it.`); }
  }

  if (!resuming) {
    enqueue(start, 0);
    if (cfg.crawl.useSitemap) for (const u of await sitemapSeeds(origin)) if (sameSite(u, start)) enqueue(u, 1);
  }

  const save = (finished = false, stopReason?: CrawlResult['stopReason']) => {
    state.seen = [...seen];
    state.assets = [...assets];
    state.external = [...external];
    state.finished = finished;
    state.stopReason = stopReason;
    writeJsonAtomic(STATE_FILE(runDir), state);
    // crawl.json is rewritten after every page, so `dbim collect` also works on a crawl that was cut short
    writeJsonAtomic(path.join(runDir, 'crawl.json'), { runId, runDir, finished, stopReason, pages: pages.map(p => ({ ...p, resources: undefined })), assets: state.assets, external: state.external, skipped: state.skipped }, 1);
  };

  const ownSession = !opts.session;
  const session = opts.session ?? (await openSession(cfg));
  const live = session.live;

  let interrupted = false;
  const onSigint = () => { interrupted = true; log('Stopping after the current page; progress is saved. Resume with: dbim crawl --resume'); };
  process.once('SIGINT', onSigint);
  const deadline = (opts.maxMinutes ?? cfg.crawl.maxMinutes) ? Date.now() + (opts.maxMinutes ?? cfg.crawl.maxMinutes)! * 60_000 : null;

  let stopReason: CrawlResult['stopReason'];
  let consecutiveBlocked = 0;

  /** Load one URL, retrying network errors and rate-limit responses with back-off. */
  const visit = async (url: string, depth: number): Promise<PageRecord> => {
    const rec: PageRecord = { url, finalUrl: url, depth, status: null, title: '', linkCount: 0, resources: [], file: '' };
    for (let attempt = 0; attempt <= cfg.crawl.retries; attempt++) {
      rec.attempts = attempt + 1;
      rec.error = undefined;
      const page = await session.page();
      const resources: ResourceRecord[] = [];
      const onResponse = (res: import('playwright').Response) => {
        const h = res.headers();
        resources.push({ url: res.url(), type: res.request().resourceType(), status: res.status(), bytes: h['content-length'] ? Number(h['content-length']) : null, contentType: h['content-type'] ?? null });
      };
      page.on('response', onResponse);
      const done = async () => { page.off('response', onResponse); await hideHud(page); await session.release(page); };
      let retryAfterMs = 0;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        rec.status = resp?.status() ?? null;
        const ra = Number(resp?.headers()['retry-after']);
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 60_000);
        if (rec.status != null && RETRY_STATUS.has(rec.status) && attempt < cfg.crawl.retries) {
          state.delayMs = Math.min(state.delayMs * 2, 15_000); // slow down for the rest of the crawl
          log(`  HTTP ${rec.status} on ${url}; backing off and retrying (${attempt + 1}/${cfg.crawl.retries})`);
          await done();
          await sleep(Math.max(retryAfterMs, Math.min(1000 * 2 ** attempt, 20_000)));
          continue;
        }
        if (live) await showHud(page, `Crawling page ${pages.length + 1} of up to ${cfg.crawl.maxPages}`, url);
        await settle(page, live);
        if (live) await hideHud(page);
        rec.finalUrl = page.url();
        rec.title = await page.title();
        const text = (await page.evaluate("document.body ? document.body.innerText.slice(0, 3000) : ''").catch(() => '')) as string;
        rec.blocked = looksBlocked(rec.title, text, rec.status);
        const links = rec.blocked ? [] : await collectLinks(page);
        rec.linkCount = links.length;
        for (const l of links) {
          const n = normalizeUrl(l, rec.finalUrl);
          if (!n) continue;
          if (!sameSite(n, start)) { external.add(n); continue; }
          if (classify(n) === 'asset') { assets.add(n); continue; }
          if (depth < cfg.crawl.maxDepth) enqueue(n, depth + 1);
        }
        rec.resources = resources;
        await done();
        break;
      } catch (e) {
        rec.error = (e as Error).message.split('\n')[0];
        rec.resources = resources;
        await done().catch(() => {});
        if (attempt < cfg.crawl.retries) { await sleep(Math.min(1000 * 2 ** attempt, 20_000)); continue; }
      }
    }
    return rec;
  };

  try {
    while (queue.length) {
      if (pages.length >= cfg.crawl.maxPages) { stopReason = 'max-pages'; break; }
      if (interrupted) { stopReason = 'interrupted'; break; }
      if (deadline && Date.now() > deadline) { stopReason = 'time-limit'; break; }
      const { url, depth } = queue.shift()!;
      if (exclude.some(e => e.test(url))) { state.skipped.push({ url, reason: 'excluded by crawl.exclude' }); continue; }
      if (!robots.allowed(url)) { state.skipped.push({ url, reason: 'disallowed by robots.txt' }); continue; }

      const rec = await visit(url, depth);

      // Fill missing sizes with a HEAD request so size rules do not depend on Content-Length being sent.
      for (const r of rec.resources) {
        if (r.bytes == null && ['image', 'media', 'font'].includes(r.type) && fetchAllowed(r.url, new URL(start).hostname)) {
          try {
            const h = await fetch(r.url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
            const l = h.headers.get('content-length');
            if (l) r.bytes = Number(l);
          } catch { /* leave null */ }
        }
      }

      rec.file = `pages/${String(pages.length + 1).padStart(3, '0')}_${slugFor(url)}.json`;
      writeJsonAtomic(path.join(runDir, rec.file), rec, 1);
      pages.push(rec);
      log(`[${pages.length}/${cfg.crawl.maxPages}] d${depth} ${rec.blocked ? 'BLOCKED' : rec.status ?? 'ERR'} ${url}${rec.error ? '  ! ' + rec.error : ''}${(rec.attempts ?? 1) > 1 ? `  (attempt ${rec.attempts})` : ''}`);

      consecutiveBlocked = rec.blocked ? consecutiveBlocked + 1 : 0;
      if (rec.blocked) state.delayMs = Math.min(state.delayMs * 2, 15_000);
      save(false);
      if (consecutiveBlocked >= 3) {
        stopReason = 'blocked';
        log('Three pages in a row look like a block / captcha screen. Stopping so the site is not hammered. Try --headed, a logged-in session (dbim login), a slower --delay, or ask the site owner to allow-list this scan.');
        break;
      }
      await sleep(state.delayMs);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    if (ownSession) await session.close();
  }

  const finished = !stopReason && queue.length === 0;
  save(finished, stopReason);
  return { runId, runDir, pages, assets: [...assets], external: [...external], skipped: state.skipped, finished, stopReason };
}
