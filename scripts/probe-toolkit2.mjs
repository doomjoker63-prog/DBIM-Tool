import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
let tag = 'load';
const log = [];
p.on('response', async r => {
  const u = r.url(), ct = r.headers()['content-type'] || '';
  if (/_next\/static|fonts\./.test(u) || r.request().resourceType() === 'font') return;
  log.push({ tag, status: r.status(), type: r.request().resourceType(), ct, u });
  if (ct.includes('json') && /wp-json|_next\/data/.test(u)) {
    try { fs.writeFileSync(`${out}/${tag}_${log.length}.json`, await r.text()); } catch {}
  }
});
await p.goto('https://dbimtoolkit.digifootprint.gov.in/visual-library', { waitUntil: 'networkidle' });
for (const t of ['ICONOGRAPHY', 'LOGOS', 'IMAGE BANK']) {
  tag = t.replace(/\s/g, '');
  await p.getByText(new RegExp('^'+t+'$','i')).first().click().catch(e => console.log('click fail', t));
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${out}/${tag}.png` });
  console.log(t, 'imgs:', await p.locator('img').count(), 'svg:', await p.locator('svg').count());
}
fs.writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 1));
for (const l of log.filter(l => l.tag !== 'load')) console.log(l.tag, l.status, l.type, l.u.slice(0, 160));
await b.close();
