import fs from 'node:fs';
import path from 'node:path';
import type { ReviewPack } from './types.js';

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DBIM manual review</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --ink:#1b1f24; --mute:#5b6570; --line:#d8dde3; --acc:#0f5757; --ok:#1a7f37; --warn:#b35900; --bad:#c62828; --pend:#8a6d00; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14181c; --card:#1d2227; --ink:#e8ecef; --mute:#9aa5af; --line:#333b43; --acc:#6fd0d0; --ok:#56c271; --warn:#f0a050; --bad:#ff7b72; --pend:#e3b341; } }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 "Noto Sans", system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  header.top { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:10px 16px; background:var(--card); border-bottom:1px solid var(--line); }
  header.top h1 { font-size:17px; margin:0; flex:1 1 260px; }
  header.top input[type=text] { padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); }
  button, .btn { padding:6px 12px; border:1px solid var(--acc); background:var(--acc); color:#fff; border-radius:6px; cursor:pointer; font:inherit; }
  button.alt { background:transparent; color:var(--acc); }
  @media (prefers-color-scheme: dark) { button { color:#0b1a1a; } button.alt { color:var(--acc); } }
  .wrap { display:grid; grid-template-columns:320px 1fr; gap:16px; padding:16px; max-width:1500px; margin:0 auto; }
  @media (max-width:900px) { .wrap { grid-template-columns:1fr; } }
  nav.list { background:var(--card); border:1px solid var(--line); border-radius:8px; max-height:calc(100vh - 100px); overflow:auto; position:sticky; top:70px; }
  nav.list .f { padding:8px; border-bottom:1px solid var(--line); }
  nav.list select { width:100%; padding:6px; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:6px; }
  nav.list a { display:flex; gap:8px; padding:7px 10px; color:var(--ink); text-decoration:none; border-bottom:1px solid var(--line); font-size:13px; }
  nav.list a:hover, nav.list a.cur { background:var(--bg); }
  .dot { flex:0 0 10px; height:10px; margin-top:6px; border-radius:50%; background:var(--line); }
  .dot.Compliance { background:var(--ok); } .dot.Non-Compliance { background:var(--bad); } .dot.N-A { background:var(--mute); } .dot.Pending { background:var(--pend); }
  section.card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:18px; }
  section.card h2 { margin:0 0 4px; font-size:18px; }
  .meta { color:var(--mute); font-size:13px; margin-bottom:12px; }
  h3 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--mute); margin:18px 0 6px; }
  .hint { padding:6px 10px; border-left:4px solid var(--line); margin:4px 0; background:var(--bg); border-radius:0 6px 6px 0; }
  .hint.ok { border-color:var(--ok); } .hint.warn { border-color:var(--warn); } .hint.info { border-color:var(--acc); }
  .sugg { padding:10px 12px; border:1px dashed var(--acc); border-radius:8px; margin:10px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px,1fr)); gap:12px; }
  figure { margin:0; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--bg); }
  figure img { display:block; width:100%; max-height:340px; object-fit:contain; object-position:top; background:#fff; cursor:zoom-in; }
  figcaption { padding:6px 8px; font-size:12px; color:var(--mute); }
  figcaption label { display:block; margin-top:4px; color:var(--ink); }
  table { border-collapse:collapse; width:100%; font-size:13px; margin:4px 0; }
  th, td { border:1px solid var(--line); padding:4px 6px; text-align:left; vertical-align:top; }
  th { background:var(--bg); }
  ul.plain { margin:4px 0; padding-left:20px; font-size:13px; }
  .verdicts { display:flex; gap:14px; flex-wrap:wrap; margin:8px 0; }
  textarea { width:100%; min-height:90px; padding:8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); font:inherit; }
  .machine { font-size:13px; background:var(--bg); padding:8px 10px; border-radius:6px; }
  #zoom { position:fixed; inset:0; background:rgba(0,0,0,.85); display:none; align-items:center; justify-content:center; z-index:20; overflow:auto; }
  #zoom img { max-width:96vw; max-height:96vh; background:#fff; }
  .badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; border:1px solid var(--line); }
</style>
</head>
<body>
<header class="top">
  <h1>DBIM manual review <span class="badge" id="prog"></span><br><small id="site" style="font-weight:400;color:var(--mute)"></small></h1>
  <label>Reviewer <input type="text" id="who" placeholder="Your name" size="22"></label>
  <label class="btn alt" style="margin:0">Load saved reviews.json <input type="file" id="load" accept=".json" hidden></label>
  <button id="export">Export reviews.json</button>
</header>
<div class="wrap">
  <nav class="list" aria-label="Items">
    <div class="f"><select id="filter" aria-label="Filter"><option value="all">All items</option><option value="open">Not answered yet</option><option value="done">Answered</option><option value="warn">Has warnings</option></select></div>
    <div id="items"></div>
  </nav>
  <main id="main"></main>
</div>
<div id="zoom" role="dialog" aria-label="Image"><img alt=""></div>
<script>
const PACK = __PACK__;
const KEY = 'dbim-review:' + PACK.run;
const VERDICTS = ['Compliance', 'Non-Compliance', 'N/A', 'Pending'];
let state = { reviewer: '', answers: {} };
try { state = Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
let cur = PACK.items[0] ? PACK.items[0].id : null;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
const answered = id => state.answers[id] && state.answers[id].verdict && state.answers[id].verdict !== 'Pending';

function renderList() {
  const f = $('#filter').value;
  const rows = PACK.items.filter(it => f === 'all' || (f === 'open' && !answered(it.id)) || (f === 'done' && answered(it.id)) || (f === 'warn' && it.hints.some(h => h.level === 'warn')));
  $('#items').innerHTML = rows.map(it => {
    const v = (state.answers[it.id] || {}).verdict || '';
    return '<a href="#' + esc(it.id) + '" data-id="' + esc(it.id) + '" class="' + (it.id === cur ? 'cur' : '') + '"><span class="dot ' + esc(v.replace('/', '-')) + '"></span><span><b>' + esc(it.id) + '</b> ' + esc(it.text.slice(0, 70)) + (it.text.length > 70 ? '…' : '') + '</span></a>';
  }).join('');
  $('#prog').textContent = PACK.items.filter(i => answered(i.id)).length + ' of ' + PACK.items.length + ' answered';
}

function renderItem() {
  const it = PACK.items.find(i => i.id === cur);
  if (!it) { $('#main').innerHTML = '<section class="card">No items to review.</section>'; return; }
  const a = state.answers[it.id] || {};
  const m = it.machine;
  let h = '<section class="card"><h2>' + esc(it.id) + ' &middot; ' + esc(it.text) + '</h2><div class="meta">DBIM v3 section ' + esc(it.section) + ' &middot; ' + esc(it.checklist) + ' checklist #' + it.no + ' &middot; severity ' + esc(it.severity) + '</div>';
  h += '<h3>What the automated scan found</h3><div class="machine">' + (m.automated ? '<b>' + esc(m.verdict) + '</b> (' + esc(m.confidence || '') + ' confidence): ' + esc(m.remarks) : 'This item is not covered by the automated scan.') +
    (m.evidence.length ? '<ul class="plain">' + m.evidence.slice(0, 8).map(e => '<li>' + esc(e.detail) + '</li>').join('') + '</ul>' : '') + '</div>';
  h += '<h3>How to test</h3><p>' + esc(it.howToTest) + '</p>';
  if (it.hints.length) h += '<h3>Facts extracted for you</h3>' + it.hints.map(x => '<div class="hint ' + x.level + '">' + esc(x.text) + '</div>').join('');
  if (it.suggested) h += '<div class="sugg"><span>Suggested: <b>' + esc(it.suggested.verdict) + '</b> &mdash; ' + esc(it.suggested.reason) + '</span><button class="alt" data-sugg="1">Use this suggestion</button></div>';
  if (it.links.length) h += '<h3>Pages to open</h3><ul class="plain">' + it.links.map(l => '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a> <small>' + esc(l.url) + '</small></li>').join('') + '</ul>';
  if (it.images.length) h += '<h3>Screenshots</h3><div class="grid">' + it.images.map(im => '<figure><img src="' + esc(im.file) + '" alt="' + esc(im.caption) + '" loading="lazy"><figcaption>' + esc(im.caption) + '<label><input type="radio" name="proof" value="' + esc(im.file) + '"' + (a.proof === im.file ? ' checked' : '') + '> use as proof of concept</label></figcaption></figure>').join('') + '</div>';
  for (const t of it.tables) h += '<h3>' + esc(t.title) + '</h3><table><tr>' + t.header.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr>' + t.rows.map(r => '<tr>' + r.map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') + '</table>';
  for (const l of it.lists) h += '<h3>' + esc(l.title) + '</h3><ul class="plain">' + l.items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  h += '<h3>Your verdict</h3><div class="verdicts">' + VERDICTS.map(v => '<label><input type="radio" name="verdict" value="' + v + '"' + (a.verdict === v ? ' checked' : '') + '> ' + v + '</label>').join('') + '</div>';
  h += '<label for="rem"><b>Remarks</b> (measured values, what you saw; this text goes into the report)</label><textarea id="rem">' + esc(a.remarks || '') + '</textarea>';
  const idx = PACK.items.findIndex(i => i.id === cur);
  h += '<p><button class="alt" data-nav="-1"' + (idx <= 0 ? ' disabled' : '') + '>&larr; Previous</button> <button data-nav="1"' + (idx >= PACK.items.length - 1 ? ' disabled' : '') + '>Next &rarr;</button></p></section>';
  $('#main').innerHTML = h;
}

function setAnswer(patch) { const id = cur; state.answers[id] = Object.assign({}, state.answers[id], patch); save(); renderList(); }

document.addEventListener('click', e => {
  const t = e.target;
  const link = t.closest && t.closest('nav.list a[data-id]');
  if (link) { e.preventDefault(); cur = link.dataset.id; renderList(); renderItem(); window.scrollTo(0, 0); return; }
  if (t.dataset && t.dataset.nav) { const i = PACK.items.findIndex(x => x.id === cur) + Number(t.dataset.nav); if (PACK.items[i]) { cur = PACK.items[i].id; renderList(); renderItem(); window.scrollTo(0, 0); } return; }
  if (t.dataset && t.dataset.sugg) { const it = PACK.items.find(x => x.id === cur); setAnswer({ verdict: it.suggested.verdict, remarks: (state.answers[cur] || {}).remarks || it.suggested.reason }); renderItem(); return; }
  if (t.tagName === 'IMG' && t.closest('figure')) { $('#zoom img').src = t.src; $('#zoom').style.display = 'flex'; return; }
  if (t.closest && t.closest('#zoom')) $('#zoom').style.display = 'none';
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'verdict') setAnswer({ verdict: t.value });
  else if (t.name === 'proof') setAnswer({ proof: t.value });
  else if (t.id === 'filter') renderList();
});
document.addEventListener('input', e => { if (e.target.id === 'rem') setAnswer({ remarks: e.target.value }); if (e.target.id === 'who') { state.reviewer = e.target.value; save(); } });

$('#export').addEventListener('click', () => {
  const reviews = {};
  for (const it of PACK.items) {
    const a = state.answers[it.id];
    if (a && a.verdict) reviews[it.id] = { verdict: a.verdict, remarks: a.remarks || '', proof: a.proof || null, url: (it.links[1] || it.links[0] || {}).url || null };
  }
  const out = { run: PACK.run, reviewer: state.reviewer || 'unknown', date: new Date().toISOString().slice(0, 10), reviews };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = 'reviews.json';
  a.click();
});
$('#load').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); state.reviewer = d.reviewer || state.reviewer; for (const [id, r] of Object.entries(d.reviews || {})) state.answers[id] = r; save(); $('#who').value = state.reviewer; renderList(); renderItem(); } catch (err) { alert('Could not read that file: ' + err.message); }
});
$('#site').textContent = PACK.site + ' · run ' + PACK.run;
$('#who').value = state.reviewer || '';
renderList(); renderItem();
</script>
</body>
</html>
`;

export function writeReviewHtml(dir: string, pack: ReviewPack): string {
  // '<' and the two JS line-separator characters must not appear raw inside the inline <script>
  const bs = String.fromCharCode(92);
  const json = JSON.stringify(pack).split('<').join(bs + 'u003c').split(String.fromCharCode(0x2028)).join(bs + 'u2028').split(String.fromCharCode(0x2029)).join(bs + 'u2029');
  const file = path.join(dir, 'review.html');
  fs.writeFileSync(file, PAGE.replace('__PACK__', () => json));
  return file;
}
