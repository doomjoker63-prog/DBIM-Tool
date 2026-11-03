(() => {
  const W = window.innerWidth;
  const doc = document.documentElement;
  const path = el => {
    const out = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += '#' + CSS.escape(e.id); out.unshift(s); break; }
      const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(x => /^[A-Za-z_-][\w-]*$/.test(x)).slice(0, 2);
      if (c.length) s += '.' + c.join('.');
      out.unshift(s);
    }
    return out.join(' > ');
  };
  const offenders = [];
  let minFont = null;
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    if (r.right > W + 1 && offenders.length < 10 && !el.closest('[style*="overflow"],.carousel,.swiper,.slick-list')) offenders.push({ path: path(el), right: Math.round(r.right), width: Math.round(r.width) });
    if (el.childNodes.length && Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) {
      const f = parseFloat(s.fontSize);
      if (minFont === null || f < minFont) minFont = f;
    }
  }
  const hdr = document.querySelector('header,[role=banner]');
  return {
    innerWidth: W, scrollWidth: doc.scrollWidth, horizontalOverflow: doc.scrollWidth > W + 1, offenders, minFontPx: minFont,
    viewportMeta: !!document.querySelector('meta[name=viewport]'),
    headerVisible: !!hdr && hdr.getBoundingClientRect().height > 0,
    menuToggle: !!document.querySelector('[aria-label*=menu i],[class*=hamburger i],[class*=navbar-toggler i],[class*=menu-toggle i],button[aria-expanded]'),
  };
})()
