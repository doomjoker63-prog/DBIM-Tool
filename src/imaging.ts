import sharp from 'sharp';

export interface ImageInfo {
  /** 16x16 blurred ink-density grid as 512 hex chars (one byte per cell); null when there is no visible ink. Compare with similarity(). */
  hash: string | null;
  /** Width / height of the visible shape. */
  aspect: number;
  /** Intrinsic raster size after decoding. */
  w: number;
  h: number;
  hasAlpha: boolean;
  /** All four corners fully transparent (cut-out image). */
  cornerTransparent: boolean;
  /** Share of the shape's bounding box that is ink: low = line art, high = filled. */
  inkRatio: number;
  /** Mean colour of the ink pixels. */
  rgb: [number, number, number];
  /** Relative luminance 0..1 of that colour. */
  lum: number;
}

const GRID = 16;
const WORK = 256;
const bytesOf = (h: string) => Uint8Array.from(h.match(/../g)!.map(x => parseInt(x, 16)));

/** Pearson correlation (-1..1) of two shape fingerprints; high values mean the same shape at a different size, colour or stroke weight. */
export function similarity(a: string, b: string): number {
  const x = bytesOf(a), y = bytesOf(b);
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let dot = 0, nx = 0, ny = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; dot += dx * dy; nx += dx * dx; ny += dy * dy; }
  return nx && ny ? dot / Math.sqrt(nx * ny) : 0;
}

const srgbLum = ([r, g, b]: number[]) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Decode any image (SVG, PNG, WEBP, JPEG ...) and fingerprint its visible shape. Returns null if it cannot be decoded. */
export async function analyseImage(buf: Buffer, isSvg = false): Promise<ImageInfo | null> {
  try {
    let density = 72;
    if (isSvg) {
      const m = await sharp(buf, { failOn: 'none' }).metadata();
      const big = Math.max(m.width ?? 24, m.height ?? 24, 1);
      density = Math.min(4000, Math.max(72, Math.round((72 * WORK) / big)));
    }
    const { data, info } = await sharp(buf, { density, failOn: 'none', limitInputPixels: 80_000_000 })
      .resize(WORK, WORK, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = info;
    const px = (x: number, y: number) => (y * W + x) * 4;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { hasAlpha = true; break; }
    const corners = [px(0, 0), px(W - 1, 0), px(0, H - 1), px(W - 1, H - 1)];
    const cornerTransparent = hasAlpha && corners.every(c => data[c + 3] < 10);
    const bg = [data[corners[0]], data[corners[0] + 1], data[corners[0] + 2]];
    const ink = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = px(x, y);
        const on = hasAlpha ? data[p + 3] > 40 : Math.abs(data[p] - bg[0]) + Math.abs(data[p + 1] - bg[1]) + Math.abs(data[p + 2] - bg[2]) > 90;
        if (on) { ink[y * W + x] = 1; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    if (maxX < 0) return { hash: null, aspect: 1, w: W, h: H, hasAlpha, cornerTransparent, inkRatio: 0, rgb: [0, 0, 0], lum: 0 };
    const bw = maxX - minX + 1, bh = maxY - minY + 1, s = Math.max(bw, bh);
    const ox = minX - (s - bw) / 2, oy = minY - (s - bh) / 2;
    const cov = new Float32Array(GRID * GRID);
    let inkCount = 0, r = 0, g = 0, b = 0;
    for (let gy = 0; gy < GRID; gy++)
      for (let gx = 0; gx < GRID; gx++) {
        const x0 = Math.floor(ox + (gx * s) / GRID), x1 = Math.max(x0 + 1, Math.floor(ox + ((gx + 1) * s) / GRID));
        const y0 = Math.floor(oy + (gy * s) / GRID), y1 = Math.max(y0 + 1, Math.floor(oy + ((gy + 1) * s) / GRID));
        let on = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (x >= 0 && y >= 0 && x < W && y < H && ink[y * W + x]) on++; }
        cov[gy * GRID + gx] = n ? on / n : 0;
      }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (ink[y * W + x]) { const p = px(x, y); r += data[p]; g += data[p + 1]; b += data[p + 2]; inkCount++; }
    // 3x3 box blur so thin vs thick strokes of the same shape land close together
    let hex = '';
    for (let gy = 0; gy < GRID; gy++)
      for (let gx = 0; gx < GRID; gx++) {
        let sum = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = gx + dx, y = gy + dy; if (x >= 0 && y >= 0 && x < GRID && y < GRID) { sum += cov[y * GRID + x]; c++; } }
        hex += Math.round((sum / c) * 255).toString(16).padStart(2, '0');
      }
    const rgb: [number, number, number] = [Math.round(r / inkCount), Math.round(g / inkCount), Math.round(b / inkCount)];
    return { hash: hex, aspect: +(bw / bh).toFixed(3), w: W, h: H, hasAlpha, cornerTransparent, inkRatio: +(inkCount / (bw * bh)).toFixed(3), rgb, lum: +srgbLum(rgb).toFixed(3) };
  } catch {
    return null;
  }
}
