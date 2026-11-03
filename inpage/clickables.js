(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const pathOf = el => { const out = []; for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) { let s = e.tagName.toLowerCase(); if (e.id) { out.unshift(s + '#' + CSS.escape(e.id)); break; } const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(x => /^[A-Za-z_-][\w-]*$/.test(x)).slice(0, 2); if (c.length) s += '.' + c.join('.'); out.unshift(s); } return out.join(' > '); };
  const region = el => el.closest('footer,[role=contentinfo]') ? 'footer' : el.closest('header,[role=banner]') ? 'header' : el.closest('nav,[role=navigation]') ? 'nav' : 'main';
  const pick = [];
  const take = (sel, max) => {
    let n = 0;
    for (const el of document.querySelectorAll(sel)) {
      if (n >= max) break;
      if (!vis(el) || el.hasAttribute('data-dbim-hover')) continue;
      el.setAttribute('data-dbim-hover', String(pick.length));
      pick.push({ id: pick.length, tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 40), region: region(el), path: pathOf(el) });
      n++;
    }
  };
  take('nav a, header a', 4);
  take('button,[role=button],input[type=submit],.btn,.button', 4);
  take('main a, article a, body a', 4);
  take('footer a', 2);
  return pick;
})()
