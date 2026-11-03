import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'inpage');
const cache = new Map<string, string>();

/** In-page scripts are plain .js files so the TypeScript toolchain cannot rewrite them. */
export function inpage(name: 'page-data' | 'responsive' | 'clickables' | 'review-data'): string {
  let s = cache.get(name);
  if (!s) {
    s = fs.readFileSync(path.join(dir, name + '.js'), 'utf8');
    cache.set(name, s);
  }
  return s;
}
