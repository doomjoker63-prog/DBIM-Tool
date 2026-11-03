(args) => {
  // Finds the elements a proof screenshot must box. Rectangles are in DOCUMENT coordinates (scroll position added),
  // so they stay valid after the engine scrolls. Elements are kept in window.__dbimProof for the info script.
  const W = innerWidth, H = innerHeight;
  const cs = e => getComputedStyle(e);
  const vis = e => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = cs(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  };
  const abs = r => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
  const rgbOf = css => { const m = /rgba?\(([^)]+)\)/.exec(css || ''); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hexRgb = hex => { const n = parseInt(String(hex).replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };
  const sameColour = (css, hex) => { const c = rgbOf(css), t = hexRgb(hex); return !!c && c.a >= 0.5 && Math.abs(c.r - t.r) <= 1 && Math.abs(c.g - t.g) <= 1 && Math.abs(c.b - t.b) <= 1; };
  const union = (els, pad) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
    for (const e of els) { if (!vis(e)) continue; const r = abs(e.getBoundingClientRect()); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); n++; }
    return n ? { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(W, x1 + pad) - Math.max(0, x0 - pad), h: y1 - y0 + 2 * pad } : null;
  };

  window.__dbimProof = [];
  const items = [];
  const push = (el, rect, kind) => { items.push({ rect: rect || abs(el.getBoundingClientRect()), kind }); window.__dbimProof.push(el || null); };
  const docArea = W * Math.max(document.documentElement.scrollHeight, H);

  for (const t of args.targets) {
    if (items.length >= args.max) break;
    const room = args.max - items.length;
    if (t.by === 'selector') {
      let list = [];
      try { list = Array.from(document.querySelectorAll(t.value)); } catch (e) { list = []; }
      for (const el of list.filter(vis).slice(0, room)) push(el, null, 'selector');
    } else if (t.by === 'bg' || t.by === 'color') {
      const hits = [];
      let n = 0;
      for (const el of document.body.querySelectorAll('*')) {
        if (++n > 5000) break;
        if (!vis(el)) continue;
        const s = cs(el);
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (t.by === 'bg') { if (!sameColour(s.backgroundColor, t.value) || area < 600 || area > docArea * 0.4) continue; }
        else { if (!sameColour(s.color, t.value)) continue; const own = Array.from(el.childNodes).some(c => c.nodeType === 3 && c.textContent.trim()); if (!own) continue; }
        hits.push({ el, area, top: r.top + scrollY });
      }
      // earliest on the page first, so the screenshot stays near the top where reviewers look first
      hits.sort((a, b) => a.top - b.top);
      for (const h of hits.slice(0, room)) push(h.el, null, t.by);
    } else if (t.by === 'region') {
      if (t.value === 'bottom') { push(null, { x: 0, y: H - 120, w: W, h: 112 }, 'viewport-bottom'); continue; }
      const root = t.value === 'header' ? document.querySelector('header,[role=banner]') : document.querySelector('footer,[role=contentinfo]');
      if (!root) { push(null, t.value === 'header' ? { x: 0, y: 0, w: W, h: 140 } : null, 'region-missing'); continue; }
      const kids = root.querySelectorAll(t.value === 'header' ? 'a,button,img,h1,h2,input,select,svg' : 'a,h2,h3,h4,p,img,button');
      const u = union(Array.from(kids), 18);
      if (u && u.h > 20) push(root, u, 'region');
      else push(root, null, 'region');
    }
  }

  // fixed / sticky bars stuck to the top of the screen hide whatever is scrolled under them
  let topObstruct = 0, n2 = 0;
  for (const e of document.body.querySelectorAll('*')) {
    if (++n2 > 4000) break;
    const s = cs(e);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    const r = e.getBoundingClientRect();
    if (r.width >= W * 0.5 && r.height > 8 && r.height < H * 0.4 && r.top <= 6 && r.bottom > 0 && s.visibility !== 'hidden' && s.display !== 'none') topObstruct = Math.max(topObstruct, r.bottom);
  }
  return { items, topObstruct, scrollMax: Math.max(0, document.documentElement.scrollHeight - H), vw: W, vh: H, scrollY: scrollY };
}
