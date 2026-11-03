import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { analyseImage, similarity } from '../src/imaging.js';
const REF = path.resolve('reference');
const index = JSON.parse(fs.readFileSync(path.join(REF, 'icon-index.json'), 'utf8')) as any[];
const sample = index.filter((_, i) => i % 21 === 0).slice(0, 90);
const self: number[] = [], other: number[] = [], emb: number[] = [];
for (const s of sample) {
  for (const size of [24, 48]) {
    const png = await sharp(fs.readFileSync(path.join(REF, s.file)), { density: 300 }).resize(size, size, { fit: 'inside' }).png().toBuffer();
    const info = await analyseImage(png);
    if (!info?.hash) continue;
    self.push(similarity(info.hash, s.hash));
    let best = -1, bestId = -1;
    for (const o of index) { if (o.file === s.file) continue; const d = similarity(info.hash, o.hash); if (d > best) { best = d; bestId = o.id; } }
    other.push(best);
  }
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
console.log('n', self.length);
console.log('self-similarity  median', q(self, .5).toFixed(3), 'p10', q(self, .1).toFixed(3), 'min', Math.min(...self).toFixed(3));
console.log('best-other-sim   max', Math.max(...other).toFixed(3), 'p90', q(other, .9).toFixed(3), 'median', q(other, .5).toFixed(3));
