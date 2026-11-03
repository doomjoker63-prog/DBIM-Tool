import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collect } from '../src/collect.js';
import { DEFAULT_CONFIG, loadConfig, validateConfig, type DbimConfig } from '../src/config.js';
import { crawl, looksBlocked, STATE_FILE } from '../src/crawler.js';
import { login } from '../src/login.js';
import { fetchAllowed, isPrivateHost } from '../src/net-guard.js';
import { writeJunit } from '../src/report/junit.js';
import { parseRobots } from '../src/robots.js';
import { scan } from '../src/scan.js';
import { startServer } from './helpers.js';

let outDir: string;
const tmp = () => fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-h-'));
const quiet = () => {};
const cfgFor = (url: string, patch: Partial<DbimConfig['crawl']> = {}, extra: Partial<DbimConfig> = {}): DbimConfig => ({
  ...DEFAULT_CONFIG, scope: [url], outDir, viewports: [1440, 375], orgType: 'ministry',
  crawl: { ...DEFAULT_CONFIG.crawl, delayMs: 30, useSitemap: false, retries: 2, ...patch }, ...extra,
});
const html = (title: string, body = '', text = 'Some ordinary page content that is long enough to not look like a block page. '.repeat(4)) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${text}</p>${body}</main></body></html>`;

/** Tiny programmable server; `hits` counts requests per path. */
async function serve(handler: (url: URL, req: http.IncomingMessage, res: http.ServerResponse, hits: Map<string, number>) => boolean | void) {
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
    if (!handler(url, req, res, hits)) { res.writeHead(404, { 'content-type': 'text/html' }); res.end(html('Not found')); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, close: () => server.close() };
}
const page = (res: http.ServerResponse, body: string, status = 200, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'text/html', ...headers }); res.end(body); return true; };

beforeAll(() => { outDir = tmp(); });
afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

describe('config validation', () => {
  it('accepts the defaults with a real scope', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, scope: ['https://www.mof.gov.in/'] }).errors).toEqual([]);
  });
  it('lists every problem in plain words', () => {
    const bad = { ...DEFAULT_CONFIG, scope: ['not a url'], orgType: 'ministery' as never, colourGroup: 'Pink', viewports: [10], crawl: { ...DEFAULT_CONFIG.crawl, maxPages: 0, delayMs: -5, exclude: ['('], storageState: 'nope.json' } };
    const { errors } = validateConfig(bad as DbimConfig);
    const t = errors.join('\n');
    for (const needle of ['scope contains an invalid URL', 'orgType must be', 'colourGroup must be one of', 'crawl.maxPages', 'crawl.delayMs', 'crawl.exclude', 'storageState file not found', 'viewports']) expect(t, needle).toContain(needle);
  });
  it('warns about a very short delay and unknown settings', () => {
    const { warnings } = validateConfig({ ...DEFAULT_CONFIG, scope: ['https://a.gov.in/'], crawl: { ...DEFAULT_CONFIG.crawl, delayMs: 100 } }, { scope: [], colorGroup: 'x' });
    expect(warnings.join(' ')).toMatch(/below 300 ms/);
    expect(warnings.join(' ')).toMatch(/Unknown setting "colorGroup"/);
  });
  it('loadConfig: invalid JSON and bad values give one readable error', () => {
    const f = path.join(outDir, 'bad.json');
    fs.writeFileSync(f, '{ nope');
    expect(() => loadConfig(f)).toThrow(/not valid JSON/);
    fs.writeFileSync(f, JSON.stringify({ scope: ['https://a.gov.in/'], crawl: { maxPages: 'many' } }));
    expect(() => loadConfig(f)).toThrow(/crawl\.maxPages must be a whole number/);
  });
  it('loadConfig merges partial files with defaults and lets a URL argument replace the scope', () => {
    const f = path.join(outDir, 'ok.json');
    fs.writeFileSync(f, JSON.stringify({ crawl: { delayMs: 900 } }));
    const c = loadConfig(f, { scope: 'https://x.gov.in/', warn: false });
    expect(c.scope).toEqual(['https://x.gov.in/']);
    expect(c.crawl.delayMs).toBe(900);
    expect(c.crawl.retries).toBe(2);
  });
});

describe('robots.txt', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\nCrawl-delay: 2\n\nUser-agent: dbim-auditor\nDisallow: /secret\n', 'dbim-auditor');
  const star = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*.pdf$\nCrawl-delay: 2\n');
  it('uses the group for our own agent when there is one', () => {
    expect(r.allowed('https://a.in/secret/x')).toBe(false);
    expect(r.allowed('https://a.in/private/x')).toBe(true); // the * group does not apply to us
  });
  it('longest rule wins, wildcards and $ work, crawl-delay is read', () => {
    expect(star.allowed('https://a.in/private/x')).toBe(false);
    expect(star.allowed('https://a.in/private/open/y')).toBe(true);
    expect(star.allowed('https://a.in/files/a.pdf')).toBe(false);
    expect(star.allowed('https://a.in/files/a.pdf?x=1')).toBe(true);
    expect(star.allowed('https://a.in/about')).toBe(true);
    expect(star.crawlDelayMs).toBe(2000);
  });
  it('an empty Disallow allows everything', () => {
    expect(parseRobots('User-agent: *\nDisallow:\n').allowed('https://a.in/anything')).toBe(true);
  });
});

describe('fetch guard (hostile pages must not make the tool call internal addresses)', () => {
  it('recognises private and special hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.1.1', '169.254.169.254', '[::1]', 'fd00::1', 'db.internal']) expect(isPrivateHost(h), h).toBe(true);
    for (const h of ['www.india.gov.in', '8.8.8.8', '172.32.0.1', 'example.com']) expect(isPrivateHost(h), h).toBe(false);
  });
  it('allows private hosts only when the audited site is that host', () => {
    expect(fetchAllowed('https://cdn.example.gov.in/a.png', 'www.example.gov.in')).toBe(true);
    expect(fetchAllowed('http://169.254.169.254/latest/meta-data', 'www.example.gov.in')).toBe(false);
    expect(fetchAllowed('http://localhost:8080/x', 'www.example.gov.in')).toBe(false);
    expect(fetchAllowed('http://127.0.0.1:3000/x', '127.0.0.1')).toBe(true);
    expect(fetchAllowed('file:///etc/passwd', 'x')).toBe(false);
    expect(fetchAllowed('javascript:alert(1)', 'x')).toBe(false);
  });
});

describe('block-page detection', () => {
  it('flags short access-denied / captcha pages, not long pages that mention captcha', () => {
    expect(looksBlocked('Access Denied', 'You do not have permission. Reference #18.3', 403)).toBe(true);
    expect(looksBlocked('Just a moment...', 'Checking your browser before accessing', 200)).toBe(true);
    expect(looksBlocked('Home', 'x'.repeat(5000) + ' captcha', 200)).toBe(false);
    expect(looksBlocked('Contact', 'Our office hours are 9 to 5.', 200)).toBe(false);
    expect(looksBlocked('Forbidden', 'short', 403)).toBe(true);
  });
});

describe('polite crawling', () => {
  it('skips robots.txt-disallowed paths, retries a 429 with back-off and records the attempts', async () => {
    let flaky = 0;
    const s = await serve((u, _q, res) => {
      if (u.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nDisallow: /private\n'); return true; }
      if (u.pathname === '/') return page(res, html('Home', '<a href="/a">a</a><a href="/private/x">p</a><a href="/flaky">f</a>'));
      if (u.pathname === '/a') return page(res, html('A', '<a href="/b">b</a>'));
      if (u.pathname === '/b') return page(res, html('B'));
      if (u.pathname === '/private/x') return page(res, html('Private'));
      if (u.pathname === '/flaky') return flaky++ === 0 ? page(res, html('Slow down', '', 'Too many requests'), 429, { 'retry-after': '1' }) : page(res, html('Flaky OK'));
    });
    const r = await crawl(cfgFor(s.base + '/', { maxDepth: 3 }), quiet);
    const urls = r.pages.map(p => new URL(p.url).pathname).sort();
    expect(urls).toEqual(['/', '/a', '/b', '/flaky']);
    expect(s.hits.get('/private/x')).toBeUndefined();
    expect(r.skipped).toEqual([{ url: s.base + '/private/x', reason: 'disallowed by robots.txt' }]);
    const fl = r.pages.find(p => p.url.endsWith('/flaky'))!;
    expect(fl.status).toBe(200);
    expect(fl.attempts).toBe(2);
    expect(r.finished).toBe(true);
    s.close();
  }, 60000);

  it('--ignore-robots really ignores robots.txt', async () => {
    const s = await serve((u, _q, res) => {
      if (u.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nDisallow: /\n'); return true; }
      if (u.pathname === '/') return page(res, html('Home'));
    });
    const blocked = await crawl(cfgFor(s.base + '/'), quiet);
    expect(blocked.pages.length).toBe(0);
    const open = await crawl(cfgFor(s.base + '/'), quiet, { ignoreRobots: true });
    expect(open.pages.length).toBe(1);
    s.close();
  }, 60000);

  it('stops after three block pages in a row instead of hammering the site', async () => {
    const s = await serve((u, _q, res) => {
      if (u.pathname === '/') return page(res, html('Home', [1, 2, 3, 4, 5, 6].map(i => `<a href="/x${i}">x</a>`).join('')));
      if (u.pathname.startsWith('/x')) return page(res, '<html><head><title>Access Denied</title></head><body>Request blocked. Reference #99</body></html>', 403);
    });
    const r = await crawl(cfgFor(s.base + '/', { retries: 0 }), quiet);
    expect(r.stopReason).toBe('blocked');
    expect(r.finished).toBe(false);
    expect(r.pages.filter(p => p.blocked).length).toBe(3);
    expect(r.pages.length).toBe(4);
    s.close();
  }, 60000);
});

describe('interrupt and resume', () => {
  it('a crawl cut short by the page limit continues without re-fetching what it already has', async () => {
    const s = await serve((u, _q, res) => {
      const m = /^\/p(\d)$/.exec(u.pathname);
      if (u.pathname === '/') return page(res, html('Home', '<a href="/p1">1</a>'));
      if (m) return page(res, html('Page ' + m[1], `<a href="/p${Number(m[1]) + 1}">next</a>`));
    });
    const cfg = cfgFor(s.base + '/', { maxPages: 2, maxDepth: 6 });
    const first = await crawl(cfg, quiet);
    expect(first.pages.length).toBe(2);
    expect(first.finished).toBe(false);
    expect(first.stopReason).toBe('max-pages');
    const state = JSON.parse(fs.readFileSync(STATE_FILE(first.runDir), 'utf8'));
    expect(state.finished).toBe(false);
    expect(state.queue.length).toBeGreaterThan(0);
    // crawl.json already usable by `collect`
    expect(JSON.parse(fs.readFileSync(path.join(first.runDir, 'crawl.json'), 'utf8')).pages.length).toBe(2);

    const hitsBefore = new Map(s.hits);
    const second = await crawl({ ...cfg, crawl: { ...cfg.crawl, maxPages: 20 } }, quiet, { resumeDir: first.runDir });
    expect(second.finished).toBe(true);
    expect(second.pages.map(p => new URL(p.url).pathname)).toEqual(['/', '/p1', '/p2', '/p3', '/p4', '/p5', '/p6']);
    expect(s.hits.get('/')).toBe(hitsBefore.get('/'));
    expect(s.hits.get('/p1')).toBe(hitsBefore.get('/p1'));
    expect(JSON.parse(fs.readFileSync(STATE_FILE(first.runDir), 'utf8')).finished).toBe(true);
    s.close();
  }, 90000);

  it('refuses to resume a folder that has no saved state', async () => {
    const empty = fs.mkdtempSync(path.join(outDir, 'empty-'));
    await expect(crawl(cfgFor('http://127.0.0.1:1/'), quiet, { resumeDir: empty })).rejects.toThrow(/Nothing to resume/);
  });

  it('collect --resume skips pages that already have a snapshot', async () => {
    const s = await serve((u, _q, res) => {
      if (u.pathname === '/') return page(res, html('Home', '<a href="/one">1</a><a href="/two">2</a>'));
      if (u.pathname === '/one' || u.pathname === '/two') return page(res, html(u.pathname));
    });
    const cfg = cfgFor(s.base + '/', { maxDepth: 2 });
    const cr = await crawl(cfg, quiet);
    const opt = { axe: false, screenshots: false, search: false, delayMs: 0 };
    await collect(cfg, cr.runDir, { ...opt, only: [1] }, quiet);
    const afterFirst = new Map(s.hits);
    const files = await collect(cfg, cr.runDir, { ...opt, resume: true }, quiet);
    expect(files.length).toBe(3);
    expect(s.hits.get('/')).toBe(afterFirst.get('/')); // page 1 was not visited again
    expect(s.hits.get('/one')).toBe((afterFirst.get('/one') ?? 0) + 1);
    // a failed snapshot is only redone with retryErrors
    const bad = path.join(cr.runDir, 'snapshots', fs.readdirSync(path.join(cr.runDir, 'snapshots')).find(f => f.startsWith('002'))!);
    const snap = JSON.parse(fs.readFileSync(bad, 'utf8'));
    fs.writeFileSync(bad, JSON.stringify({ ...snap, error: 'boom', data: null }));
    const before = s.hits.get('/one') ?? 0;
    await collect(cfg, cr.runDir, { ...opt, resume: true }, quiet);
    expect(s.hits.get('/one')).toBe(before);
    await collect(cfg, cr.runDir, { ...opt, resume: true, retryErrors: true }, quiet);
    expect(s.hits.get('/one')).toBe(before + 1);
    expect(JSON.parse(fs.readFileSync(bad, 'utf8')).error).toBeUndefined();
    s.close();
  }, 120000);
});

describe('login and authenticated crawling', () => {
  it('saves a session through a real form login and the crawler then sees the protected page', async () => {
    const s = await serve((u, req, res) => {
      const authed = /(?:^|;\s*)session=ok/.test(req.headers.cookie ?? '');
      if (u.pathname === '/') return page(res, html('Public home', '<a href="/members">members</a>'));
      if (u.pathname === '/login') return page(res, html('Login', '<form method="post" action="/do-login"><input name="u" id="u"><button id="go">Log in</button></form>'));
      if (u.pathname === '/do-login') { res.writeHead(302, { 'set-cookie': 'session=ok; Path=/', location: '/' }); res.end(); return true; }
      if (u.pathname === '/members') return authed ? page(res, html('Members only', '', 'Secret members content that only logged in people can read. '.repeat(4))) : (res.writeHead(302, { location: '/login' }), res.end(), true);
    });
    const stateFile = path.join(outDir, 'auth', 'state.json');
    const noAuth = await crawl(cfgFor(s.base + '/', { maxDepth: 2 }), quiet);
    expect(noAuth.pages.find(p => p.url.endsWith('/members'))?.title).toBe('Login'); // redirected to the login page

    await login(s.base + '/login', {
      out: stateFile, headless: true,
      confirm: async (_ctx, p) => { await p.fill('#u', 'tester'); await Promise.all([p.waitForURL(s.base + '/'), p.click('#go')]); },
    }, quiet);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(saved.cookies.some((c: { name: string; value: string }) => c.name === 'session' && c.value === 'ok')).toBe(true);

    const authed = await crawl(cfgFor(s.base + '/', { maxDepth: 2, storageState: stateFile }), quiet);
    expect(authed.pages.find(p => p.url.endsWith('/members'))?.title).toBe('Members only');
    s.close();
  }, 90000);
});

describe('JUnit output', () => {
  it('maps verdicts to pass / failure / skipped and escapes hostile text', () => {
    const r = (id: string, verdict: string, remarks: string, extra = {}) => ({ id, checklist: 'generic', no: 1, text: `Item ${id}`, section: '1', severity: 'High', verdict, remarks, automated: true, evidence: [], evidenceCount: 0, affectedUrls: [], ...extra });
    const a = { run: 'r', generatedAt: '', site: 'https://a.gov.in/?x=1&y=2', pagesAudited: 1, orgType: 'ministry', summary: {}, results: [r('G01', 'Compliance', 'ok'), r('G02', 'Non-Compliance', 'bad <script>&"\'' + String.fromCharCode(1), { evidence: [{ url: 'u', detail: 'd & e' }] }), r('G03', 'Pending', 'p', { automated: false }), r('G04', 'N/A', 'n')] } as never;
    const f = path.join(outDir, 'out', 'j.xml');
    writeJunit(a, f);
    const x = fs.readFileSync(f, 'utf8');
    expect(x).toContain('<testsuites name="https://a.gov.in/?x=1&amp;y=2" tests="4" failures="1" skipped="2">');
    expect((x.match(/<failure /g) ?? []).length).toBe(1);
    expect((x.match(/<skipped /g) ?? []).length).toBe(2);
    expect(x).not.toContain('<script>');
    expect(x).toContain('&lt;script&gt;');
    expect(x).not.toContain(String.fromCharCode(1));
  });
});

describe('scan: one command, pass/fail for CI', () => {
  let srv: { base: string; close: () => void };
  beforeAll(async () => { srv = await startServer(); }, 60000);
  afterAll(() => srv.close());
  const opts = (failOn: 'any' | 'high' | 'new' | 'never', extra: Record<string, unknown> = {}) => ({
    collect: { axe: false, screenshots: false, search: false }, formats: ['xlsx' as const], proofs: false, failOn, ...extra,
  });
  const cfg = (url: string) => cfgFor(url, { maxDepth: 0 });

  it('a compliant page passes the gate; a bad page fails it and writes JUnit + workbook', async () => {
    const good = await scan(cfg(srv.base + '/good'), opts('any'), quiet);
    expect(good.exitCode).toBe(0);
    expect(good.findings).toEqual([]);
    expect(good.gate.failed).toBe(false);

    const junit = path.join(outDir, 'bad.xml');
    const bad = await scan(cfg(srv.base + '/bad'), opts('any', { junit }), quiet);
    expect(bad.exitCode).toBe(1);
    expect(bad.findings.length).toBeGreaterThan(8);
    expect(bad.gate.reason).toMatch(/Non-Compliance item/);
    expect(bad.files.some(f => f.endsWith('.xlsx'))).toBe(true);
    const x = fs.readFileSync(junit, 'utf8');
    expect((x.match(/<failure /g) ?? []).length).toBe(bad.findings.length);
  }, 180000);

  it('--fail-on never always passes; --fail-on high fails only on High items', async () => {
    const never = await scan(cfg(srv.base + '/bad'), opts('never', { formats: [] }), quiet);
    expect(never.exitCode).toBe(0);
    const high = await scan(cfg(srv.base + '/bad'), opts('high', { formats: [] }), quiet);
    expect(high.findings.some(f => f.severity === 'High')).toBe(true);
    expect(high.exitCode).toBe(1);
  }, 180000);

  it('--fail-on new compares with a baseline and fails only on new problems', async () => {
    await expect(scan(cfg(srv.base + '/good'), opts('new'), quiet)).rejects.toThrow(/needs --baseline/);
    const base = await scan(cfg(srv.base + '/bad'), opts('never', { formats: [] }), quiet);
    await new Promise(r => setTimeout(r, 1100));
    const fixed = await scan(cfg(srv.base + '/good'), opts('new', { formats: [], baseline: path.basename(base.runDir) }), quiet);
    expect(fixed.retest?.CLOSED).toBeGreaterThan(5);
    expect(fixed.retest?.NEW).toBe(0);
    expect(fixed.exitCode).toBe(0);
    await new Promise(r => setTimeout(r, 1100));
    const regressed = await scan(cfg(srv.base + '/bad'), opts('new', { formats: [], baseline: path.basename(fixed.runDir) }), quiet);
    expect(regressed.retest?.NEW).toBeGreaterThan(5);
    expect(regressed.exitCode).toBe(1);
  }, 240000);

  it('refuses to audit a site that cannot be loaded', async () => {
    await expect(scan(cfgFor('http://127.0.0.1:1/', { retries: 0 }), opts('any'), quiet)).rejects.toThrow(/No page could be loaded/);
  }, 60000);
});
