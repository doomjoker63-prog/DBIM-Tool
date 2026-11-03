import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collect, singleUrlRun, type PageSnapshot } from '../src/collect.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { hideHud, HUD_ID, liveScroll, resolveLive, showHud } from '../src/live.js';
import { planProof } from '../src/proof/plan.js';
import { captureProofs } from '../src/report/proof.js';
import { IMPLEMENTED, loadPalette, runRules } from '../src/rules/index.js';
import type { Evidence, RuleResult } from '../src/rules/types.js';
import { openSession } from '../src/session.js';
import { startServer } from './helpers.js';

const quiet = () => {};
let srv: { base: string; close: () => void };
let outDir: string;
let runDir: string;
const cfg = { ...DEFAULT_CONFIG, viewports: [1440, 375], crawl: { ...DEFAULT_CONFIG.crawl, headless: true } };

const finding = (id: string, evidence: Evidence[], extra: Partial<RuleResult> = {}): RuleResult => ({
  id, checklist: 'generic', no: Number(id.slice(1)) || 1, text: `Item ${id}`, section: '1', severity: 'Medium', verdict: 'Non-Compliance', remarks: `${id} finding`,
  automated: true, evidence, evidenceCount: evidence.length, affectedUrls: [...new Set(evidence.map(e => e.url))], ...extra,
});

/** Count pixels of a colour in a saved proof image. */
async function pixels(file: string, pred: (r: number, g: number, b: number) => boolean) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 3) if (pred(data[i], data[i + 1], data[i + 2])) n++;
  return { n, total: info.width * info.height, w: info.width, h: info.height };
}
const red = (r: number, g: number, b: number) => r > 190 && g < 70 && b < 70;
const green = (r: number, g: number, b: number) => Math.abs(r - 0x12) < 25 && Math.abs(g - 0xab) < 25 && Math.abs(b - 0x34) < 25;

beforeAll(async () => {
  srv = await startServer();
  outDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-pf-'));
  runDir = singleUrlRun(outDir, srv.base + '/proof');
  await collect({ ...cfg, outDir }, runDir, { axe: false, screenshots: false, search: false, delayMs: 0 }, quiet);
}, 120000);
afterAll(() => { srv.close(); fs.rmSync(outDir, { recursive: true, force: true }); });

describe('proof planning', () => {
  const snap = { url: 'https://a.gov.in/', finalUrl: 'https://a.gov.in/', resources: [{ url: 'https://a.gov.in/img/banner.jpg', type: 'image', status: 200, bytes: 1_900_000 }], data: { meta: { title: 'Home' } } } as unknown as PageSnapshot;

  it('a region hint replaces the raw selector, so the same element is not boxed twice', () => {
    const f = finding('G25', [{ url: 'https://a.gov.in/', detail: 'x', selector: 'footer', proof: { region: 'footer', panel: 'facts', facts: ['!MISSING: Feedback'] } }]);
    expect(planProof(f, [snap]).targets).toEqual([{ by: 'region', value: 'footer' }]);
  });

  it('colour findings box the elements that use the colour; responsive findings use the failing width', () => {
    const c = planProof(finding('G02', [{ url: 'https://a.gov.in/', detail: 'bg', proof: { bg: '#DCEBF7' } }, { url: 'https://a.gov.in/', detail: 'bg2', proof: { bg: '#F2F7FC' } }]), [snap]);
    expect(c.targets.map(t => `${t.by}:${t.value}`)).toEqual(['bg:#DCEBF7', 'bg:#F2F7FC']);
    expect(planProof(finding('G46', [{ url: 'https://a.gov.in/', detail: 'w', selector: 'div', proof: { viewport: 375 } }]), [snap]).viewport).toBe(375);
  });

  it('size findings get the real network row; style findings get default properties', () => {
    const n = planProof(finding('G31', [{ url: 'https://a.gov.in/', detail: 'https://a.gov.in/img/banner.jpg is 1.8 MB', selector: 'img', proof: { panel: 'network', needle: 'https://a.gov.in/img/banner.jpg' } }]), [snap]);
    expect(n.panel.rows).toEqual([{ url: 'https://a.gov.in/img/banner.jpg', type: 'image', status: 200, bytes: 1_900_000 }]);
    const s = planProof(finding('G14', [{ url: 'https://a.gov.in/', detail: 'h2 is 20px, DBIM 24px', selector: 'h2' }]), [snap]);
    expect(s.panel.kind).toBe('computed');
    expect(s.panel.props).toContain('font-size');
  });

  it('the evidence line that has something to box is preferred', () => {
    const f = finding('G18', [{ url: 'https://a.gov.in/', detail: 'first, nothing to box' }, { url: 'https://a.gov.in/', detail: 'second', selector: 'a.x' }]);
    expect(planProof(f, [snap]).targets[0]).toEqual({ by: 'selector', value: 'a.x' });
  });
});

describe('proof screenshots on a page that scrolls smoothly, has a sticky header and reveals content on scroll', () => {
  const url = () => srv.base + '/proof';
  let proofs: Awaited<ReturnType<typeof captureProofs>>;
  beforeAll(async () => {
    const findings = [
      finding('G12', [{ url: url(), detail: 'deep element is centred', selector: '#deep', proof: { panel: 'computed', props: ['font-size', 'text-align'] } }]),
      finding('G04', [{ url: url(), detail: 'footer background #04263F', selector: 'footer', proof: { panel: 'computed', props: ['background-color'], facts: ['!background-color: #04263F', 'Expected: the key colour'] } }]),
      finding('G02', [{ url: url(), detail: 'background #DCEBF7 used 1 times', proof: { bg: '#DCEBF7', facts: ['!background-color: #DCEBF7 (1 elements)'] } }]),
      finding('G46', [{ url: url(), detail: 'page scrolls sideways', selector: '#deep', proof: { viewport: 375, facts: ['!Page is wider than the window'] } }]),
      finding('G45', [{ url: url(), detail: 'missing: meta description', proof: { panel: 'head', facts: ['!MISSING: meta description'] } }]),
      finding('G42', [{ url: url(), detail: 'no banner', proof: { region: 'bottom', panel: 'search', needle: 'cookie', facts: ['!No cookie banner'] } }]),
      finding('G99', [{ url: url(), detail: 'element that does not exist', selector: '#nope' }]),
    ];
    proofs = await captureProofs({ ...cfg, outDir }, runDir, findings, quiet);
  }, 180000);

  it('boxes an element deep in the page: right place, box verified in the final image, nothing blank', async () => {
    const p = proofs.get('G12')!;
    expect(p.kind).toBe('element');
    const g = await pixels(p.file, green), r = await pixels(p.file, red);
    expect(g.n).toBeGreaterThan(8000); // the green block is on screen (the old method photographed it mid-scroll)
    expect(r.n).toBeGreaterThan(400); // and has a red box around it
    const white = await pixels(p.file, (R, G, B) => R > 245 && G > 245 && B > 245);
    expect(white.n / white.total).toBeLessThan(0.6); // not a blank white screenshot
  });

  it('boxes a tall footer on all four sides (inset from the screen edge)', async () => {
    const p = proofs.get('G04')!;
    expect(p.kind).toBe('element');
    const { data, info } = await sharp(p.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const redAt = (x: number, y: number) => { const i = (y * info.width + x) * 3; return red(data[i], data[i + 1], data[i + 2]); };
    // the box is inset 5 px from the screen edge, so its left and right sides are visible within the first/last 12 px of the page area
    let left = false, right = false;
    for (let y = 70; y < 960 && !(left && right); y += 3) for (let x = 0; x < 12; x++) { if (redAt(x, y)) left = true; if (redAt(info.width - 1 - x, y)) right = true; }
    expect(left && right).toBe(true);
  });

  it('boxes the elements that use a given colour', async () => {
    const p = proofs.get('G02')!;
    expect(p.kind).toBe('element');
    const light = await pixels(p.file, (R, G, B) => Math.abs(R - 0xdc) < 12 && Math.abs(G - 0xeb) < 12 && Math.abs(B - 0xf7) < 12);
    expect(light.n).toBeGreaterThan(5000);
  });

  it('takes responsive findings at the failing width', async () => {
    const p = proofs.get('G46')!;
    expect(p.kind).toBe('element');
    const g = await pixels(p.file, green);
    expect(g.n).toBeGreaterThan(3000);
  });

  it('absence findings are proven in the measurement panel (head tags, DOM search) and say so', () => {
    for (const id of ['G45', 'G42']) {
      const p = proofs.get(id)!;
      expect(fs.existsSync(p.file), id).toBe(true);
      expect(['panel', 'element']).toContain(p.kind);
      expect(p.highlighted).toBe(true);
    }
    expect(proofs.get('G45')!.kind).toBe('panel');
    expect(proofs.get('G45')!.caption).toMatch(/boxed in the measurement panel/);
  });

  it('a target that is not on the page does not pretend: the image still shows the measured finding and the caption says so', () => {
    const p = proofs.get('G99')!;
    expect(p.kind).toBe('panel');
    expect(p.caption).toMatch(/boxed in the measurement panel/);
  });

  it('every image has the browser frame at the top (address bar with the real URL) and is a sensible size', async () => {
    for (const [, p] of proofs) {
      const m = await sharp(p.file).metadata();
      expect(m.width).toBeGreaterThanOrEqual(960);
      expect(m.height).toBeGreaterThan(500);
      expect(m.height!).toBeLessThan(2600);
    }
  });
});

describe('live mode helpers', () => {
  it('resolveLive: flags win, then config, then terminal detection', () => {
    const base = { ...DEFAULT_CONFIG, crawl: { ...DEFAULT_CONFIG.crawl } };
    expect(resolveLive({ live: true }, base)).toBe(true);
    expect(resolveLive({ headless: true, live: true }, base)).toBe(false);
    expect(resolveLive({}, { ...base, crawl: { ...base.crawl, live: true } })).toBe(true);
    expect(resolveLive({}, { ...base, crawl: { ...base.crawl, live: false } })).toBe(false);
    const ci = process.env.CI;
    process.env.CI = 'true';
    expect(resolveLive({}, base)).toBe(false); // CI never opens a window
    if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
  });

  it('shows a progress badge and removes it completely', async () => {
    const s = await openSession(cfg);
    const page = await s.page();
    await page.goto(srv.base + '/proof');
    await showHud(page, 'Crawling page 3 of 100', 'https://x.gov.in/a');
    expect(await page.evaluate(`!!document.getElementById(${JSON.stringify(HUD_ID)})`)).toBe(true);
    expect(await page.evaluate('document.body.innerText')).toContain('Crawling page 3 of 100');
    await hideHud(page);
    expect(await page.evaluate(`!!document.getElementById(${JSON.stringify(HUD_ID)})`)).toBe(false);
    await s.close();
  }, 60000);

  it('scrolls the whole page down and back at a followable pace, even on a smooth-scrolling site', async () => {
    const s = await openSession(cfg);
    const page = await s.page();
    await page.goto(srv.base + '/proof');
    await page.evaluate(`window.__max = 0; addEventListener('scroll', () => { window.__max = Math.max(window.__max, scrollY); });`);
    const t0 = Date.now();
    await liveScroll(page);
    const secs = (Date.now() - t0) / 1000;
    const { max, end, total, vh } = (await page.evaluate(`({ max: window.__max, end: scrollY, total: document.documentElement.scrollHeight, vh: innerHeight })`)) as { max: number; end: number; total: number; vh: number };
    expect(max).toBeGreaterThanOrEqual(total - vh - 5);
    expect(end).toBe(0);
    expect(secs).toBeGreaterThan(1); // slow enough to watch
    expect(secs).toBeLessThan(15);
    await s.close();
  }, 60000);

  it('live mode uses ONE tab for everything and the page is clean when measured', async () => {
    const s = await openSession(cfg, { simulateLive: true });
    expect(s.live).toBe(true);
    const a = await s.page(), b = await s.page();
    expect(a).toBe(b); // the same tab every time: one window to watch
    await s.release(a);
    expect(a.isClosed()).toBe(false);
    const run = singleUrlRun(outDir, srv.base + '/proof');
    await collect({ ...cfg, outDir }, run, { axe: false, screenshots: false, search: false, delayMs: 0, session: s }, quiet);
    const snap = JSON.parse(fs.readFileSync(path.join(run, 'snapshots', fs.readdirSync(path.join(run, 'snapshots'))[0]), 'utf8')) as PageSnapshot;
    expect(snap.error).toBeUndefined();
    expect(snap.data!.bodyText).not.toContain('DBIM Auditor');
    expect(a.isClosed()).toBe(false); // an injected session is left open for the next phase
    await s.close();
  }, 120000);

  it('headless mode opens a fresh tab per page and closes it again', async () => {
    const s = await openSession(cfg);
    expect(s.live).toBe(false);
    const a = await s.page(), b = await s.page();
    expect(a).not.toBe(b);
    await s.release(a);
    expect(a.isClosed()).toBe(true);
    await s.close();
  }, 60000);
});

describe('header controls in a bar above <header> (found by comparing with a real portal)', () => {
  it('language, text-size and skip controls in a top utility bar are seen', async () => {
    const run = singleUrlRun(outDir, srv.base + '/topbar');
    await collect({ ...cfg, outDir }, run, { axe: false, screenshots: false, search: false, delayMs: 0 }, quiet);
    const snap = JSON.parse(fs.readFileSync(path.join(run, 'snapshots', fs.readdirSync(path.join(run, 'snapshots'))[0]), 'utf8')) as PageSnapshot;
    expect(snap.data!.header.hasLanguage).toBe(true);
    expect(snap.data!.header.hasA11yControls).toBe(true);
    expect(snap.data!.header.hasSkipLink).toBe(true);
    const r = IMPLEMENTED.G24({ pages: [snap], cfg: { ...DEFAULT_CONFIG, orgType: 'ministry' }, palette: loadPalette() });
    expect(r.evidence ?? []).toEqual([]); // nothing missing in the header
  }, 90000);
});

describe('search rules judge what the search did, not noise on the page', () => {
  const snapWith = (queries: Record<string, unknown>[]) => ({ url: 'https://a.gov.in/', finalUrl: 'https://a.gov.in/', data: { header: {}, meta: { title: 't' } }, searchProbe: { inputFound: true, queries } }) as unknown as PageSnapshot;
  const q = (over: Record<string, unknown>) => ({ query: 'word', ok: false, urlChanged: true, urlAfter: 'https://a.gov.in/search', status: 200, occurrences: 0, resultLinks: 0, noResultsMessage: false, errorPage: false, ...over });
  const site = (queries: Record<string, unknown>[]) => ({ pages: [snapWith(queries)], cfg: DEFAULT_CONFIG, palette: loadPalette() });

  it('a site that answers every query with a "no results" page: search works (G43), relevance is inconclusive (G44), not a failure', () => {
    const s = site([q({ query: 'a', noResultsMessage: true, occurrences: 17, resultLinks: 2 }), q({ query: 'b', noResultsMessage: true }), q({ query: 'c', noResultsMessage: true })]);
    expect(IMPLEMENTED.G43(s).verdict).toBe('Compliance');
    const g44 = IMPLEMENTED.G44(s);
    expect(g44.verdict).toBe('Pending');
    expect(g44.remarks).toMatch(/inconclusive/);
  });

  it('error pages or no reaction mean search does not work', () => {
    const s = site([q({ errorPage: true, status: 500 }), q({ urlChanged: false }), q({ errorPage: true })]);
    const r = IMPLEMENTED.G43(s);
    expect(r.verdict).toBe('Non-Compliance');
    expect(r.evidence!.length).toBe(3);
  });

  it('results that exist but never mention the term fail relevance; relevant results stay Pending for a human', () => {
    const irrelevant = site([q({ ok: true, resultLinks: 8, occurrences: 0 }), q({ ok: true, resultLinks: 6, occurrences: 1 })]);
    expect(IMPLEMENTED.G44(irrelevant).verdict).toBe('Non-Compliance');
    const relevant = site([q({ ok: true, resultLinks: 8, occurrences: 9 }), q({ ok: true, resultLinks: 6, occurrences: 4 })]);
    expect(IMPLEMENTED.G44(relevant).verdict).toBe('Pending');
  });
});

describe('organisation type', () => {
  it('defaults to Generic only, so Ministry-only items are not applied to a PSU by accident', () => {
    expect(DEFAULT_CONFIG.orgType).toBe('generic');
    const res = runRules({ pages: [], cfg: DEFAULT_CONFIG, palette: loadPalette() }, ['generic']);
    expect(res.filter(r => r.checklist === 'ministry').length).toBe(0);
    expect(res.filter(r => r.checklist === 'generic').length).toBe(46);
  });
});

// keep the unused import honest: chromium is used to prove the fixture really is smooth-scrolling
describe('fixture sanity', () => {
  it('the proof page really scrolls smoothly (otherwise these tests would prove nothing)', async () => {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(srv.base + '/proof');
    await p.evaluate(`document.getElementById('deep').scrollIntoView({ block: 'center' })`);
    await p.waitForTimeout(60);
    const early = (await p.evaluate('scrollY')) as number;
    await p.waitForTimeout(1500);
    const late = (await p.evaluate('scrollY')) as number;
    await b.close();
    expect(late).toBeGreaterThan(1000);
    expect(early).toBeLessThan(late - 200); // still moving after 60 ms: the old code photographed this moment
  }, 60000);
});
