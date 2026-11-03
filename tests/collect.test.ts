import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collect, singleUrlRun } from '../src/collect.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { PageSnapshot } from '../src/collect.js';

const fixtures = path.resolve(__dirname, 'fixtures');
// valid 1x1 PNG followed by ~600 KB of padding so the file is over 500 KB
const PNG = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  Buffer.alloc(600 * 1024),
]);

let server: http.Server;
let base: string;
let snap: PageSnapshot;
let outDir: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/big.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length });
      return res.end(PNG);
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(fs.readFileSync(path.join(fixtures, 'bad.html')));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  outDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-'));
  const runDir = singleUrlRun(outDir, base + '/');
  const cfg = { ...DEFAULT_CONFIG, outDir, viewports: [1440, 375] };
  const files = await collect(cfg, runDir, { axe: true, screenshots: false, delayMs: 0 }, () => {});
  snap = JSON.parse(fs.readFileSync(path.join(runDir, files[0]), 'utf8'));
}, 90000);

afterAll(() => {
  server.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('collect on a deliberately non-compliant page', () => {
  it('reports the rendered font (not Noto Sans)', () => {
    const fam = snap.fonts!.rendered.heading.map(f => f.family.toLowerCase());
    expect(fam.some(f => f.includes('arial') || f.includes('liberation') || f.includes('helvet'))).toBe(true);
    expect(fam.some(f => f.startsWith('noto sans'))).toBe(false);
  });

  it('measures text styles', () => {
    const h1 = snap.data!.textStyles.heading[0];
    expect(h1.fontSize).toBe(30);
    expect(h1.textAlign).toBe('center');
    expect(h1.allCapsLong).toBe(true);
    expect(snap.data!.textStyles.paragraph[0].textAlign).toBe('justify');
  });

  it('records image bytes and stretch', () => {
    const res = snap.resources.find(r => r.url.endsWith('/big.png'))!;
    expect(res.bytes).toBeGreaterThan(500 * 1024);
    const img = snap.data!.images.find((i: any) => i.src.endsWith('/big.png'));
    expect(img.altLen).toBeGreaterThan(0);
    expect(img.aspectDelta).toBeGreaterThan(1); // 1x1 image drawn at 300x50
  });

  it('detects missing header/footer parts and no cookie banner', () => {
    expect(snap.data!.header.hasSearch).toBe(false);
    expect(snap.data!.header.emblem).toBe(false);
    expect(snap.data!.footer.present.sitemap).toBe(false);
    expect(snap.data!.cookie.found).toBe(false);
  });

  it('flags horizontal overflow only on the narrow viewport', () => {
    const w1440 = snap.responsive.find(r => r.width === 1440)!;
    const w375 = snap.responsive.find(r => r.width === 375)!;
    expect(w375.horizontalOverflow).toBe(true);
    expect(w1440.horizontalOverflow).toBe(true); // 1700px element also overflows 1440
  });

  it('captures insecure and editable-document links', () => {
    expect(snap.data!.links.some((l: any) => l.insecure)).toBe(true);
    expect(snap.data!.docs.map((d: any) => d.ext)).toContain('docx');
  });

  it('captures form fields without labels', () => {
    const f = snap.data!.forms[0];
    expect(f.fields.length).toBe(2);
    expect(f.fields.every((x: any) => !x.labelClickable)).toBe(true);
  });

  it('measures buttons and runs the hover probe', () => {
    expect(snap.data!.controls.length).toBe(2);
    expect(snap.data!.controls[0].words).toBe(3);
    expect(snap.hover.length).toBeGreaterThan(0);
  });

  it('runs axe (colour contrast fails on #999 on #888)', () => {
    expect(snap.axe!.violations.map(v => v.id)).toContain('color-contrast');
  });
});
