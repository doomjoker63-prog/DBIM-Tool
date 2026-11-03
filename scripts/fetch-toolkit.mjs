// Downloads the DBIM Toolkit icon bank and logos into reference/ and writes an index with content hashes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://dbimtoolkit.digifootprint.gov.in';
const REF = path.resolve('reference');
const HEAD = { 'user-agent': 'Mozilla/5.0 (dbim-auditor reference fetch)' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = async u => { const r = await fetch(u, { headers: HEAD }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };

async function listAll(kind) {
  const out = []; let page = 1, total = 1;
  do {
    const d = await getJson(`${BASE}/cms/wp-json/post-page/${kind}?limit=50&page=${page}`);
    out.push(...d.posts); total = d.total_pages; page++;
    await sleep(300);
  } while (page <= total);
  return out;
}

async function download(url, dir) {
  const name = path.basename(new URL(url).pathname);
  const file = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    const r = await fetch(url, { headers: HEAD });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    await sleep(150);
  }
  const buf = fs.readFileSync(file);
  const norm = buf.toString('utf8').replace(/\s+/g, ' ').trim();
  return { file: path.relative(REF, file).split(path.sep).join('/'), bytes: buf.length,
           sha256: crypto.createHash('sha256').update(buf).digest('hex'),
           normSha256: crypto.createHash('sha256').update(norm).digest('hex') };
}

const index = { fetchedFrom: BASE, fetchedAt: new Date().toISOString(), icons: [], logos: [] };

const icons = await listAll('iconography');
console.log('icons posts', icons.length);
for (const p of icons) {
  const a = p.acf_data || {};
  const e = { id: p.ID, title: p.post_title, category: p.categories?.[0]?.parent_category, type: a.icon_type };
  if (a.line_icon) e.line = await download(a.line_icon, path.join(REF, 'icons/line'));
  if (a.fill_icon && a.fill_icon !== a.line_icon) e.fill = await download(a.fill_icon, path.join(REF, 'icons/fill'));
  index.icons.push(e);
}
const logos = await listAll('logos');
console.log('logo posts', logos.length);
for (const p of logos) {
  const u = p.acf_data?.icon;
  if (!u) continue;
  index.logos.push({ id: p.ID, title: p.post_title, category: p.categories?.[0]?.parent_category, file: await download(u, path.join(REF, 'logos')) });
}
fs.writeFileSync(path.join(REF, 'toolkit-index.json'), JSON.stringify(index, null, 1));
console.log('done', index.icons.length, 'icons', index.logos.length, 'logos');
