import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { collect, singleUrlRun } from '../src/collect.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildReports } from '../src/report/report.js';
import { applyReviews } from '../src/review/apply.js';
import { writeReviewHtml } from '../src/review/html.js';
import { prepareReview } from '../src/review/prepare.js';
import type { ReviewPack } from '../src/review/types.js';
import { startServer } from './helpers.js';

let srv: { base: string; close: () => void };
let outDir: string;
let runDir: string;
let pack: ReviewPack;
let htmlFile: string;
const cfg = () => ({ ...DEFAULT_CONFIG, outDir, orgType: 'ministry' as const, viewports: [1440], report: { ...DEFAULT_CONFIG.report, organisation: 'Test Ministry', application: 'Test Site' } });
const item = (id: string) => pack.items.find(i => i.id === id)!;

beforeAll(async () => {
  srv = await startServer();
  outDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-rv-'));
  runDir = singleUrlRun(outDir, srv.base + '/ms/');
  await collect(cfg(), runDir, { axe: false, screenshots: false, search: false, delayMs: 0 }, () => {});
  audit(cfg(), runDir);
  const r = await prepareReview(cfg(), runDir, { all: false, visit: true }, () => {});
  pack = r.pack;
  htmlFile = writeReviewHtml(r.dir, pack);
}, 240000);

afterAll(() => {
  srv.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('review pack contents', () => {
  it('includes the manual and Pending items, each with the how-to-test text', () => {
    expect(pack.items.length).toBeGreaterThan(20);
    for (const id of ['G10', 'G26', 'M01', 'M05', 'M16', 'M17', 'M25', 'M32']) expect(item(id), id).toBeTruthy();
    expect(item('M16').howToTest.length).toBeGreaterThan(20);
  });

  it('finds the role pages from the menu and captures them', () => {
    const m16 = item('M16');
    expect(m16.links.some(l => l.url.endsWith('/ms/vacancies'))).toBe(true);
    expect(m16.images.length).toBeGreaterThan(0);
    for (const im of m16.images) expect(fs.existsSync(path.join(runDir, 'review', im.file)), im.file).toBe(true);
  });

  it('M16: flags expired vacancies and suggests Non-Compliance', () => {
    expect(item('M16').hints.some(h => h.level === 'warn' && /before today/.test(h.text))).toBe(true);
    expect(item('M16').suggested?.verdict).toBe('Non-Compliance');
  });

  it('M17: flags the over-long tender ID and past dates', () => {
    expect(item('M17').hints.some(h => h.level === 'warn' && /longer than 50/.test(h.text))).toBe(true);
    expect(item('M17').suggested?.verdict).toBe('Non-Compliance');
  });

  it('M25: spots Dr vs Dr. inconsistency', () => {
    expect(item('M25').hints.some(h => h.level === 'warn' && /Dr/.test(h.text))).toBe(true);
    expect(item('M25').suggested?.verdict).toBe('Non-Compliance');
  });

  it('M21/M22: reports missing officer roles and the map', () => {
    const t = item('M21').hints.map(h => `${h.level}:${h.text}`).join('\n');
    expect(t).toMatch(/ok:"CIO" is mentioned/);
    expect(t).toMatch(/warn:"Web Information Manager" is not mentioned/);
    expect(t).toMatch(/Map found/);
  });

  it('M32: keyboard probe reaches all form fields in order', () => {
    expect(item('M32').lists[0].items.length).toBe(3);
    expect(item('M32').hints.some(h => h.level === 'ok' && /reached with the Tab key/.test(h.text))).toBe(true);
  });

  it('M01 / M05: navigation tree and homepage component table', () => {
    expect(item('M01').lists[0].items.join(' ')).toContain('Vacancies');
    expect(item('M05').tables[0].rows.length).toBe(15);
  });

  it('M23: reads the stale "Last Updated On" date', () => {
    expect(item('M23').hints.some(h => h.level === 'warn' && /more than a year old/.test(h.text))).toBe(true);
  });
});

describe('review page + apply loop', () => {
  it('lets a tester answer items in the real HTML page and export reviews.json, which merges into the audit and report', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto('file:///' + htmlFile.replace(/\\/g, '/'));
    await page.fill('#who', 'Test Reviewer');
    // M16: use the suggestion, then attach the first screenshot as proof
    await page.click('nav.list a[data-id="M16"]');
    await page.click('button[data-sugg]');
    await page.locator('input[name=proof]').first().check();
    // M25: answer by hand
    await page.click('nav.list a[data-id="M25"]');
    await page.check('input[name=verdict][value="Non-Compliance"]');
    await page.fill('#rem', 'Dr and Dr. are both used on the Our Team page.');
    // M32: compliance
    await page.click('nav.list a[data-id="M32"]');
    await page.check('input[name=verdict][value="Compliance"]');
    await page.fill('#rem', 'All three fields reachable by Tab.');
    expect(await page.textContent('#prog')).toContain('3 of');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
    const out = path.join(outDir, 'reviews.json');
    await dl.saveAs(out);
    await browser.close();

    const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(saved.reviewer).toBe('Test Reviewer');
    expect(Object.keys(saved.reviews).sort()).toEqual(['M16', 'M25', 'M32']);

    const r = applyReviews(runDir, out);
    expect(r.applied.sort()).toEqual(['M16', 'M25', 'M32']);
    const res = (id: string) => r.audit.results.find(x => x.id === id)!;
    expect(res('M16').verdict).toBe('Non-Compliance');
    expect(res('M16').manual?.proof).toBeTruthy();
    expect(res('M16').remarks).toContain('Manual review (Test Reviewer');
    expect(res('M32').verdict).toBe('Compliance');
    expect(res('M16').machine?.verdict).toBe('Pending');

    // re-running the audit keeps the manual verdicts
    const again = audit(cfg(), runDir);
    expect(again.results.find(x => x.id === 'M25')!.verdict).toBe('Non-Compliance');

    // and the workbook reflects them
    const files = await buildReports(cfg(), runDir, { formats: ['xlsx'], proofs: false }, () => {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files[0]);
    const sheet = wb.getWorksheet('Ministry Checklist')!;
    const row = sheet.getRows(2, sheet.rowCount)!.find(x => String(x.getCell(2).value).includes('Appropriate titles'))!;
    expect(String(row.getCell(9).value)).toContain('Manual review (Test Reviewer');
    expect(String(row.getCell(6).value)).toBe('Non-Compliance');
  }, 120000);

  it('refuses a Non-Compliance without remarks', () => {
    const f = path.join(outDir, 'bad-reviews.json');
    fs.writeFileSync(f, JSON.stringify({ run: 'x', reviewer: 'T', date: '2026-11-02', reviews: { M17: { verdict: 'Non-Compliance', remarks: '' } } }));
    const r = applyReviews(runDir, f);
    expect(r.applied).toEqual([]);
    expect(r.skipped[0]).toContain('needs remarks');
  });
});

describe('review page robustness', () => {
  it('survives item text containing </script> and quotes', async () => {
    const evil: ReviewPack = { run: 'evil', site: 'http://x/', generatedAt: '', items: [{
      id: 'G99', checklist: 'generic', no: 99, text: 'Bad </script><b>bold</b> "quote" \'apos\'', section: '1', severity: 'Low', howToTest: 'x </script> y',
      machine: { verdict: 'Pending', remarks: '', automated: false, evidence: [] }, hints: [{ level: 'warn', text: '</script><img src=x onerror=alert(1)>' }], links: [], images: [], tables: [], lists: [],
    }] };
    const dir = fs.mkdtempSync(path.join(outDir, 'evil-'));
    const file = writeReviewHtml(dir, evil);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
    await page.goto('file:///' + file.split(String.fromCharCode(92)).join('/'));
    await page.waitForSelector('section.card h2');
    expect(await page.textContent('section.card h2')).toContain('</script>');
    expect(await page.locator('section.card b', { hasText: /^bold$/ }).count()).toBe(0); // injected markup must stay text
    expect(await page.locator('section.card img[src="x"]').count()).toBe(0);
    expect(errors).toEqual([]);
    await browser.close();
  }, 60000);
});
