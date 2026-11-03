(() => {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const path = el => {
    const out = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { out.unshift(s + '#' + CSS.escape(e.id)); break; }
      const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(x => /^[A-Za-z_-][\w-]*$/.test(x)).slice(0, 2);
      if (c.length) s += '.' + c.join('.');
      out.unshift(s);
    }
    return out.join(' > ');
  };
  const root = document.querySelector('main,[role=main]') || document.body;
  const bodyText = document.body.innerText;

  // ---- headings
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter(vis).slice(0, 60).map(h => ({ level: +h.tagName[1], text: clean(h.innerText).slice(0, 160), path: path(h) }));

  // ---- lists (3+ items), with the nearest preceding heading
  const lists = [];
  for (const l of root.querySelectorAll('ul,ol')) {
    if (lists.length >= 10) break;
    if (!vis(l) || l.closest('nav,header,footer')) continue;
    const items = Array.from(l.children).filter(c => c.tagName === 'LI').map(li => clean(li.innerText)).filter(Boolean);
    if (items.length < 3) continue;
    let h = null;
    for (let e = l; e && !h; e = e.previousElementSibling || e.parentElement) { if (/^H[1-4]$/.test(e.tagName)) h = clean(e.innerText); if (e === root) break; }
    lists.push({ heading: h, tag: l.tagName.toLowerCase(), items: items.slice(0, 40).map(t => t.slice(0, 180)), total: items.length, path: path(l) });
  }

  // ---- tables
  const tables = [];
  for (const t of document.querySelectorAll('table')) {
    if (tables.length >= 6) break;
    if (!vis(t)) continue;
    const rows = Array.from(t.rows).map(r => Array.from(r.cells).map(c => clean(c.innerText).slice(0, 120)));
    if (rows.length < 2) continue;
    tables.push({ caption: clean((t.caption || {}).innerText), header: rows[0], rows: rows.slice(1, 26), total: rows.length - 1, path: path(t) });
  }

  // ---- dates (text + 60 chars of context)
  const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DATE = new RegExp('\\b(\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH + '\\.?,?\\s+\\d{4}|' + MONTH + '\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})\\b', 'gi');
  const dates = [];
  for (const m of bodyText.matchAll(DATE)) { if (dates.length >= 80) break; dates.push({ text: m[1], context: clean(bodyText.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20)) }); }

  // ---- names with honorifics
  const TITLE = /\b(Dr\.?|Shri|Smt\.?|Sh\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?|Kumari|Km\.?)\s+[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3}/g;
  const titled = Array.from(bodyText.matchAll(TITLE)).slice(0, 120).map(m => m[0].trim());

  // ---- maps / contact
  const maps = Array.from(document.querySelectorAll('iframe[src*="google.com/maps"],iframe[src*="maps.google"],iframe[src*="openstreetmap"],iframe[src*="mapmyindia"],a[href*="google.com/maps"],a[href*="goo.gl/maps"],a[href*="maps.app.goo.gl"]')).slice(0, 5).map(e => ({ tag: e.tagName.toLowerCase(), src: e.src || e.href, path: path(e) }));
  const emails = Array.from(new Set(bodyText.match(/[\w.+-]+(?:\s?\[at\]\s?|@)[\w.-]+\.[a-z]{2,}/gi) || [])).slice(0, 12);
  const phones = Array.from(new Set(bodyText.match(/(?:\+91[\s-]?)?(?:\d{2,5}[\s-]?){2,3}\d{3,4}/g) || [])).filter(x => x.replace(/\D/g, '').length >= 8).slice(0, 12);

  // ---- last updated
  const lu = /last (?:updated|reviewed|modified)(?: on)?\s*:?\s*([^\n|]{4,40})/i.exec(bodyText);

  // ---- navigation tree (two levels)
  const navRoot = document.querySelector('header nav,nav[aria-label*=main i],nav') || document.querySelector('header');
  const nav = [];
  if (navRoot) {
    const top = navRoot.querySelectorAll(':scope ul > li, :scope > a');
    for (const li of Array.from(top).slice(0, 60)) {
      if (li.parentElement && li.parentElement.closest('li') && li.parentElement.closest('li') !== li) continue; // handled as child
      const a = li.tagName === 'A' ? li : li.querySelector(':scope > a, :scope > button, :scope > span');
      if (!a) continue;
      const kids = Array.from(li.querySelectorAll(':scope > ul > li > a, :scope > div a')).slice(0, 15).map(k => ({ text: clean(k.innerText).slice(0, 80), href: k.href || null }));
      const t = clean(a.innerText).slice(0, 80);
      if (t) nav.push({ text: t, href: a.href || null, children: kids });
      if (nav.length >= 30) break;
    }
  }

  // ---- homepage components (DBIM A.4), by class names and headings
  const cls = sel => !!document.querySelector(sel);
  const headText = headings.map(h => h.text.toLowerCase()).join(' | ');
  const has = re => re.test(headText);
  const carouselEl = document.querySelector('[class*=swiper],[class*=slick],[class*=carousel],[class*=owl-],[class*=splide]');
  const components = {
    headerSticky: (() => { const h = document.querySelector('header,[role=banner]'); if (!h) return false; const s = getComputedStyle(h).position; return s === 'sticky' || s === 'fixed'; })(),
    topBannerCarousel: !!carouselEl,
    announcementsTicker: cls('marquee,[class*=ticker i],[class*=marquee i],[class*=announce i]') || has(/announcement|latest update/),
    pmQuote: /prime minister|narendra modi/i.test(bodyText) && (cls('blockquote,[class*=quote i]') || /[“"][^”"]{25,300}[”"]/.test(bodyText)),
    ministerSection: has(/minister of state|our team|hon.ble minister|the minister/) || document.querySelectorAll('img[alt*=minister i],img[src*=minister i]').length > 0,
    keyOfferings: has(/offering|scheme|vacanc|tender/),
    whatsNew: has(/what.?s new|latest news|news (&|and) updates/),
    recentDocuments: has(/recent documents|latest documents|documents/),
    userPersonas: has(/persona|i am a|i.m a|browse as|who are you/) || cls('[class*=persona i]'),
    importantLinks: has(/important links|quick links|useful links/),
    citizenEngagement: has(/citizen engagement|social media|follow us|connect with us/) || cls('iframe[src*=twitter],iframe[src*=instagram],iframe[src*=facebook],[class*=twitter-timeline i]'),
    centralPostsCcps: has(/central posts|ccps/) || cls('[class*=ccps i],[id*=ccps i]') || /ccps/i.test(document.documentElement.innerHTML.slice(0, 200000)),
    infographics: has(/infographic|statistics|at a glance|key figures/),
    footerCarousel: (() => { const f = document.querySelector('footer,[role=contentinfo]'); if (!f) return false; const fr = f.getBoundingClientRect(); return Array.from(document.querySelectorAll('[class*=swiper],[class*=slick],[class*=carousel],[class*=owl-],[class*=splide]')).some(c => { const r = c.getBoundingClientRect(); return r.bottom <= fr.top + 5 && r.bottom > fr.top - 700 && c.querySelectorAll('img').length >= 4; }); })(),
    footerPresent: !!document.querySelector('footer,[role=contentinfo]'),
  };

  // ---- PM quote element (for a screenshot)
  let pmPath = null;
  for (const el of document.querySelectorAll('blockquote,[class*=quote i],section,div')) {
    const t = el.innerText || '';
    if (t.length > 40 && t.length < 900 && /prime minister|narendra modi/i.test(t) && /[“"]/.test(t) && vis(el)) { pmPath = path(el); }
  }

  // ---- cookie banner element
  const cookieEl = Array.from(document.querySelectorAll('div,section,aside,[role=dialog]')).find(e => /fixed|sticky/.test(getComputedStyle(e).position) && vis(e) && /cookie/i.test(e.innerText || '') && (e.innerText || '').length < 1500);
  const langOptions = Array.from(document.querySelectorAll('select[name*=lang i] option,[class*=lang i] a,[class*=lang i] button,[aria-label*=language i] a,[aria-label*=language i] button')).slice(0, 25).map(e => clean(e.innerText || e.textContent)).filter(Boolean);

  // ---- images in main (contact sheet / watermark review)
  const contentImgs = Array.from(document.querySelectorAll('img')).filter(i => vis(i) && i.getBoundingClientRect().width >= 120 && !i.closest('header,footer,nav')).slice(0, 14).map(i => ({ src: i.currentSrc || i.src, alt: i.alt || '', path: path(i), w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) }));
  const logos = Array.from(document.querySelectorAll('header img,footer img,img[class*=logo i],img[src*=logo i],img[alt*=logo i]')).filter(vis).slice(0, 14).map(i => ({ src: i.currentSrc || i.src, alt: i.alt || '', path: path(i), region: i.closest('footer') ? 'footer' : i.closest('header') ? 'header' : 'body', w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) }));

  // ---- forms present
  const forms = Array.from(document.querySelectorAll('form')).filter(vis).map(f => ({ path: path(f), fields: f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea').length, search: !!f.querySelector('[type=search]') || /search/i.test(f.id + f.className + (f.getAttribute('role') || '')) }));

  const mainText = clean(root.innerText).slice(0, 8000);

  return { title: document.title, url: location.href, mainText, headings, lists, tables, dates, titled, maps, emails, phones, lastUpdated: lu ? clean(lu[1]) : null, nav, components, pmPath, cookiePath: cookieEl ? path(cookieEl) : null, langOptions, contentImgs, logos, forms, textLength: bodyText.length };
})()
