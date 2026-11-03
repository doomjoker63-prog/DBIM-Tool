import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collect, singleUrlRun, type PageSnapshot } from '../src/collect.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { loadPalette, runRules } from '../src/rules/index.js';
import type { RuleResult } from '../src/rules/types.js';
import { startServer } from './helpers.js';


let srv: { base: string; close: () => void };
let outDir: string;
let good: Map<string, RuleResult>;
let bad: Map<string, RuleResult>;

async function snapshotOf(url: string): Promise<PageSnapshot> {
  const runDir = singleUrlRun(outDir, url);
  const cfg = { ...DEFAULT_CONFIG, outDir, viewports: [1440, 375] };
  const files = await collect(cfg, runDir, { axe: true, screenshots: false, search: true, delayMs: 0 }, () => {});
  return JSON.parse(fs.readFileSync(path.join(runDir, files[0]), 'utf8'));
}
const run = (snap: PageSnapshot) => new Map(runRules({ pages: [snap], cfg: { ...DEFAULT_CONFIG, orgType: 'ministry' }, palette: loadPalette() }, ['generic', 'ministry', 'extra']).map(r => [r.id, r]));

beforeAll(async () => {
  srv = await startServer();
  outDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-r-'));
  good = run(await snapshotOf(srv.base + '/good'));
  bad = run(await snapshotOf(srv.base + '/bad'));
}, 240000);

afterAll(() => {
  srv.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

const v = (m: Map<string, RuleResult>, id: string) => m.get(id)!.verdict;

describe('compliant page produces no false failures', () => {
  const mustPass = ['G01', 'G02', 'G03', 'G04', 'G08', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G24', 'G25', 'G42', 'G45', 'G46', 'M26', 'M27', 'M28', 'M31', 'M33', 'M34', 'X02', 'X03',
    'G06', 'G19', 'G21', 'G22', 'G23', 'G43', 'M06', 'M15', 'M19', 'M29'];
  for (const id of mustPass) it(`${id} is Compliance`, () => expect(v(good, id), `${id}: ${good.get(id)!.remarks}`).toBe('Compliance'));
  it('has no Non-Compliance at all', () => {
    const fails = [...good.values()].filter(r => r.verdict === 'Non-Compliance').map(r => `${r.id}: ${r.remarks}`);
    expect(fails).toEqual([]);
  });
});

describe('non-compliant page is caught', () => {
  const mustFail = ['G11', 'G12', 'G13', 'G14', 'G15', 'G18', 'G24', 'G25', 'G32', 'G42', 'G45', 'G46', 'M26', 'M28', 'M34', 'X01',
    'G19', 'G37', 'G38', 'G39', 'G43', 'M06', 'M20', 'M29'];
  for (const id of mustFail) it(`${id} is Non-Compliance`, () => expect(v(bad, id), `${id}: ${bad.get(id)!.remarks}`).toBe('Non-Compliance'));
  it('gives evidence with URLs', () => {
    const r = bad.get('M26')!;
    expect(r.evidence![0].detail).toContain('report.docx');
    expect(r.affectedUrls.length).toBeGreaterThan(0);
  });
});

describe('catalogue handling', () => {
  it('reports unautomated items as Pending with the manual test', () => {
    const r = good.get('G10')!;
    expect(r.automated).toBe(false);
    expect(r.verdict).toBe('Pending');
    expect(r.remarks).toContain('Not automated yet');
  });
  it('covers all 80 template items plus the extras', () => {
    expect([...good.values()].filter(r => r.checklist !== 'extra').length).toBe(80);
    expect([...good.values()].filter(r => r.checklist === 'extra').length).toBe(3);
    expect([...good.values()].filter(r => r.automated && r.checklist !== 'extra').length).toBeGreaterThanOrEqual(55);
  });
});
