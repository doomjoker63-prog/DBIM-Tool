import sharp from 'sharp';
import type { Box } from './types.js';

/**
 * Look at the finished image, not at what we meant to draw: walk along the border of each expected box and count how many
 * sample points really are red. Returns the best share (0..1) over the boxes; 0 when there are no boxes.
 */
export async function redBoxShare(jpeg: Buffer, boxes: Box[], offX: number, offY: number): Promise<number> {
  if (!boxes.length) return 0;
  const { data, info } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const isRed = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = (yy * W + xx) * C;
        if (data[i] > 175 && data[i + 1] < 95 && data[i + 2] < 95) return true;
      }
    return false;
  };
  let best = 0;
  for (const b of boxes) {
    const x0 = b.x + offX + 2, y0 = b.y + offY + 2, x1 = b.x + offX + b.w - 3, y1 = b.y + offY + b.h - 3; // 2 px inside the 4 px border
    let hit = 0, n = 0;
    const probe = (x: number, y: number) => { n++; if (isRed(Math.round(x), Math.round(y))) hit++; };
    for (let x = x0; x <= x1; x += 16) { probe(x, y0); probe(x, y1); }
    for (let y = y0; y <= y1; y += 16) { probe(x0, y); probe(x1, y); }
    best = Math.max(best, n ? hit / n : 0);
  }
  return best;
}
