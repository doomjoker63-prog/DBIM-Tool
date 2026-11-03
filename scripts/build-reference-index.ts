// Fingerprints every Toolkit icon and the State Emblem so site icons can be matched by shape.
// usage: npx tsx scripts/build-reference-index.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { analyseImage } from '../src/imaging.js';

const REF = path.resolve('reference');
const idx = JSON.parse(fs.readFileSync(path.join(REF, 'toolkit-index.json'), 'utf8')) as { icons: any[]; logos: any[] };

const out: { id: number; title: string; style: 'line' | 'fill'; file: string; hash: string; aspect: number; inkRatio: number }[] = [];
let skipped = 0;
for (const ic of idx.icons) {
  for (const style of ['line', 'fill'] as const) {
    const f = ic[style]?.file as string | undefined;
    if (!f) continue;
    const info = await analyseImage(fs.readFileSync(path.join(REF, f)), true);
    if (!info?.hash) { skipped++; continue; }
    out.push({ id: ic.id, title: ic.title, style, file: f, hash: info.hash, aspect: info.aspect, inkRatio: info.inkRatio });
  }
}
fs.writeFileSync(path.join(REF, 'icon-index.json'), JSON.stringify(out));
console.log('icons indexed', out.length, 'skipped', skipped);

// Toolkit logos (for the "closest official logo" hint in the review pack)
const logos: { id: number; title: string; category: string; hash: string; aspect: number }[] = [];
for (const l of idx.logos) {
  const info = await analyseImage(fs.readFileSync(path.join(REF, l.file.file)), true);
  if (info?.hash) logos.push({ id: l.id, title: l.title, category: l.category, hash: info.hash, aspect: info.aspect });
}
fs.writeFileSync(path.join(REF, 'logo-index.json'), JSON.stringify(logos));
console.log('logos indexed', logos.length);

// The State Emblem as published by MeitY in the Toolkit header (inline SVG), used as the authorised reference.
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('https://dbimtoolkit.digifootprint.gov.in/', { waitUntil: 'networkidle' });
const svg = await p.evaluate(`(() => { const e = document.querySelector('svg#emblemLogo'); return e ? e.outerHTML : null; })()`) as string | null;
await b.close();
if (!svg) throw new Error('emblem svg not found on the Toolkit page');
fs.writeFileSync(path.join(REF, 'emblem.svg'), svg);
const info = await analyseImage(Buffer.from(svg), true);
fs.writeFileSync(path.join(REF, 'emblem.json'), JSON.stringify({ source: 'https://dbimtoolkit.digifootprint.gov.in/ (header svg#emblemLogo)', hash: info?.hash, aspect: info?.aspect }, null, 1));
console.log('emblem', info?.hash?.slice(0, 16), info?.aspect);
