(() => {
  const W = window.innerWidth, H = window.innerHeight;
  const cs = el => getComputedStyle(el);
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = cs(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0;
  };
  const hex2 = n => n.toString(16).padStart(2, '0').toUpperCase();
  const toHex = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    return { hex: '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2]), alpha: a };
  };
  const path = el => {
    const out = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += '#' + CSS.escape(e.id); out.unshift(s); break; }
      const c = (e.getAttribute('class') || '').trim().split(/\s+/).filter(x => /^[A-Za-z_-][\w-]*$/.test(x)).slice(0, 2);
      if (c.length) s += '.' + c.join('.');
      out.unshift(s);
    }
    return out.join(' > ');
  };
  const region = el => {
    if (el.closest('footer,[role=contentinfo]')) return 'footer';
    if (el.closest('header,[role=banner]')) return 'header';
    if (el.closest('nav,[role=navigation]')) return 'nav';
    if (el.closest('main,[role=main]')) return 'main';
    return 'body';
  };
  const effBg = el => {
    for (let e = el; e; e = e.parentElement) {
      const s = cs(e);
      const c = toHex(s.backgroundColor);
      if (c && c.alpha > 0.5) return c.hex;
      if (s.backgroundImage && s.backgroundImage !== 'none') return 'image';
    }
    return '#FFFFFF';
  };
  const ownText = el => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
  const cls = el => (el.getAttribute('class') || '').slice(0, 80);

  // ---- meta
  const metaTag = n => (document.querySelector(`meta[name="${n}"]`) || {}).content || null;
  const meta = {
    title: document.title,
    lang: document.documentElement.lang || null,
    description: metaTag('description'),
    keywords: metaTag('keywords'),
    viewport: metaTag('viewport'),
    h1Count: document.querySelectorAll('h1').length,
    headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible).slice(0, 80).map(h => ({ level: +h.tagName[1], text: h.innerText.trim().slice(0, 400) })),
    landmarks: { header: !!document.querySelector('header,[role=banner]'), nav: !!document.querySelector('nav,[role=navigation]'), main: !!document.querySelector('main,[role=main]'), footer: !!document.querySelector('footer,[role=contentinfo]') },
    personaHints: Array.from(document.querySelectorAll('[class*=persona i],[id*=persona i],[data-persona]')).length,
  };

  // ---- text styles per group
  const GROUPS = {
    heading: 'h1,h2,h3,h4,h5,h6', paragraph: 'p', listItem: 'li', link: 'a', button: 'button,[role=button],input[type=button],input[type=submit],.btn,.button',
    small: 'small,figcaption,caption', tableCell: 'th,td', label: 'label',
  };
  const textStyles = {};
  for (const [g, sel] of Object.entries(GROUPS)) {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (out.length >= 60) break;
      if (!visible(el)) continue;
      const t = el.tagName === 'INPUT' ? (el.value || '') : (ownText(el) || el.innerText || '').trim();
      if (!t) continue;
      const s = cs(el);
      const fg = toHex(s.color);
      out.push({
        tag: el.tagName.toLowerCase(), text: t.replace(/\s+/g, ' ').slice(0, 60), path: path(el), region: region(el),
        fontFamily: s.fontFamily, fontSize: parseFloat(s.fontSize), fontWeight: s.fontWeight, lineHeight: s.lineHeight,
        lineHeightRatio: s.lineHeight === 'normal' ? null : +(parseFloat(s.lineHeight) / parseFloat(s.fontSize)).toFixed(2),
        color: fg && fg.hex, background: effBg(el), textAlign: s.textAlign, textTransform: s.textTransform,
        allCapsLong: t.length > 60 && t === t.toUpperCase() && /[A-Z]/.test(t),
      });
    }
    textStyles[g] = out;
  }

  // ---- colours (usage counts)
  const tally = {};
  const add = (k, hex) => { if (!hex) return; const m = (tally[k] = tally[k] || {}); m[hex] = (m[hex] || 0) + 1; };
  let n = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (++n > 3000) break;
    if (!visible(el)) continue;
    const s = cs(el);
    if (ownText(el)) { const c = toHex(s.color); if (c) add('text', c.hex); }
    const bg = toHex(s.backgroundColor); if (bg && bg.alpha > 0.5) add('background', bg.hex);
    if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') { const b = toHex(s.borderTopColor); if (b && b.alpha > 0.5) add('border', b.hex); }
  }
  const colours = {};
  for (const k of Object.keys(tally)) colours[k] = Object.entries(tally[k]).sort((a, b) => b[1] - a[1]).slice(0, 40);

  // ---- images
  const images = [];
  for (const im of document.querySelectorAll('img')) {
    if (images.length >= 300) break;
    const r = im.getBoundingClientRect();
    images.push({
      src: im.currentSrc || im.src, naturalW: im.naturalWidth, naturalH: im.naturalHeight, renderedW: Math.round(r.width), renderedH: Math.round(r.height),
      visible: visible(im), alt: im.getAttribute('alt'), altLen: (im.getAttribute('alt') || '').length, loading: im.getAttribute('loading'),
      region: region(im), path: path(im), inLink: !!im.closest('a'), linkHref: im.closest('a') ? im.closest('a').href : null, cls: cls(im),
      nameHint: /emblem|ashok|satyamev/i.test(im.src + ' ' + (im.alt || '') + ' ' + cls(im)) ? 'emblem' : /logo/i.test(im.src + ' ' + (im.alt || '') + ' ' + cls(im)) ? 'logo' : null,
      aspectDelta: im.naturalWidth && r.width && r.height ? +Math.abs((r.width / r.height) / (im.naturalWidth / im.naturalHeight) - 1).toFixed(3) : null,
      objectFit: cs(im).objectFit,
    });
  }
  const backgrounds = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (backgrounds.length >= 100) break;
    const bi = cs(el).backgroundImage;
    if (!bi || bi === 'none' || !/url\(/.test(bi) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    for (const m of bi.matchAll(/url\(["']?([^"')]+)["']?\)/g)) backgrounds.push({ src: new URL(m[1], location.href).href, renderedW: Math.round(r.width), renderedH: Math.round(r.height), region: region(el), path: path(el) });
  }

  // ---- icons (inline svg + font icons)
  const icons = [];
  for (const sv of document.querySelectorAll('svg')) {
    if (icons.length >= 200) break;
    if (!visible(sv)) continue;
    const r = sv.getBoundingClientRect();
    if ((r.width > 100 || r.height > 100) && !/emblem|logo/i.test(path(sv))) continue;
    if (r.width > 260 || r.height > 260) continue;
    const shape = sv.querySelector('path,circle,rect,polygon,line');
    const fill = shape ? toHex(cs(shape).fill) : null;
    const stroke = shape ? toHex(cs(shape).stroke) : null;
    const mk = sv.outerHTML; const big = /emblem|logo/i.test(path(sv));
    icons.push({ kind: 'svg', markup: mk.length <= (big ? 400000 : 8000) ? mk : null, w: Math.round(r.width), h: Math.round(r.height), fill: fill && fill.hex, stroke: stroke && stroke.hex, color: (toHex(cs(sv).color) || {}).hex, region: region(sv), path: path(sv), onBg: effBg(sv) });
  }
  for (const el of document.querySelectorAll('[class*="icon" i],[class*="fa-"],[class*="material-symbols" i],[class^="bi-"]')) {
    if (icons.length >= 300) break;
    if (!visible(el) || el.tagName === 'SVG' || el.closest('svg')) continue;
    const s = cs(el), r = el.getBoundingClientRect();
    icons.push({ kind: 'font', w: Math.round(r.width), h: Math.round(r.height), fontFamily: s.fontFamily, color: (toHex(s.color) || {}).hex, region: region(el), path: path(el), onBg: effBg(el) });
  }

  // ---- controls (buttons)
  const controls = [];
  for (const el of document.querySelectorAll(GROUPS.button + ',a.btn,a[class*=button i]')) {
    if (controls.length >= 60) break;
    if (!visible(el)) continue;
    const s = cs(el), r = el.getBoundingClientRect(), t = (el.value || el.innerText || el.getAttribute('aria-label') || '').trim();
    controls.push({
      tag: el.tagName.toLowerCase(), text: t.slice(0, 50), words: t ? t.split(/\s+/).length : 0, path: path(el), region: region(el),
      w: Math.round(r.width), h: Math.round(r.height), padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '),
      fontSize: parseFloat(s.fontSize), fontFamily: s.fontFamily, radius: s.borderTopLeftRadius, background: (toHex(s.backgroundColor) || {}).hex, color: (toHex(s.color) || {}).hex, disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    });
  }

  // ---- header / footer / cookie / search
  // Language / text-size / skip controls are often in a utility bar ABOVE the <header> element; look at the whole top of the page too.
  const topBandText = Array.from(document.body.querySelectorAll('*')).filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < 260 && visible(e); }).slice(0, 700)
    .map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + ownText(e)).join(' ');
  const hdr = document.querySelector('header,[role=banner]');
  const ftr = document.querySelector('footer,[role=contentinfo]');
  const txt = el => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '');
  const header = hdr ? (() => {
    const t0 = txt(hdr), r = hdr.getBoundingClientRect(), s = cs(hdr);
    const labels = Array.from(hdr.querySelectorAll('[aria-label],[title],[alt]')).map(e => e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('alt') || '').join(' ');
    const t = t0 + ' ' + labels;
    const imgs = Array.from(hdr.querySelectorAll('img')).map(i => ({ src: i.currentSrc || i.src, alt: i.alt, w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) }));
    return {
      found: true, height: Math.round(r.height), position: s.position, background: (toHex(s.backgroundColor) || {}).hex, bgEffective: effBg(hdr), text: t0.slice(0, 600), images: imgs.slice(0, 12),
      emblem: imgs.some(i => /emblem|ashok|satyamev/i.test(i.src + ' ' + i.alt)) || !!hdr.querySelector('svg[id*=emblem i],svg[class*=emblem i],[aria-label*=emblem i],[title*=emblem i]'),
      hasSearch: !!hdr.querySelector('input[type=search],[role=search],input[name*=search i],input[placeholder*=search i],input[aria-label*=search i]'),
      hasLanguage: !!hdr.querySelector('select[name*=lang i],[class*=lang i],[id*=lang i],[aria-label*=language i]') || /language|भाषा|हिन्दी|हिंदी/i.test(t + ' ' + topBandText),
      hasSkipLink: Array.from(document.querySelectorAll('a[href^="#"]')).some(a => /skip/i.test(a.innerText + a.getAttribute('aria-label'))),
      hasA11yControls: /accessib|text size|screen reader|contrast|font size|increase text|decrease text|dark theme|\bA\+|\bA-/i.test(t + ' ' + topBandText),
      hasNav: !!hdr.querySelector('nav,[role=navigation],ul'),
    };
  })() : { found: false };
  const FOOT = { websitePolicies: /website polic|terms (of|&) (use|conditions)|privacy polic|copyright polic|hyperlink polic/i, sitemap: /site ?map/i, relatedLinks: /related links/i, help: /\bhelp\b|faq/i, feedback: /feedback/i, contactUs: /contact us/i, lastUpdated: /last (updated|reviewed|modified)/i, lineage: /(website|site) belongs to|official website of/i, archives: /archive/i };
  const footer = ftr ? (() => {
    const t = txt(ftr), s = cs(ftr);
    const social = Array.from(ftr.querySelectorAll('a[href]')).filter(a => /facebook|twitter|x\.com|instagram|youtube|linkedin|koo|whatsapp/i.test(a.href)).map(a => a.href);
    const hay = Array.from(ftr.querySelectorAll('a,button,li,p,span,h2,h3,h4')).map(e => e.innerText).join(' | ') + ' | ' + t;
    const present = {};
    for (const [k, re] of Object.entries(FOOT)) present[k] = re.test(hay);
    const fr = ftr.getBoundingClientRect();
    const coversImg = Array.from(ftr.querySelectorAll('img,svg')).some(e => { const q = e.getBoundingClientRect(); return q.width >= fr.width * 0.8 && q.height >= fr.height * 0.5; });
    const hasBgImage = coversImg || Array.from(ftr.querySelectorAll('*')).concat([ftr]).some(e => /url\(/.test(cs(e).backgroundImage));
    return { found: true, hasBgImage, background: (toHex(s.backgroundColor) || {}).hex, bgEffective: effBg(ftr), text: t.slice(0, 3000), links: Array.from(ftr.querySelectorAll('a[href]')).slice(0, 80).map(a => ({ text: a.innerText.trim().slice(0, 60), href: a.href })), present, social };
  })() : { found: false };

  let cookie = { found: false };
  for (const el of document.querySelectorAll('div,section,aside,dialog,[role=dialog]')) {
    const s = cs(el);
    if (!/fixed|sticky/.test(s.position) || !visible(el)) continue;
    const t = txt(el);
    if (!/cookie/i.test(t) || t.length > 1500) continue;
    const r = el.getBoundingClientRect();
    const btns = Array.from(el.querySelectorAll('button,a,[role=button],input[type=button]')).map(b => (b.innerText || b.value || '').trim()).filter(Boolean);
    cookie = { found: true, atBottom: r.bottom >= H - 8 && r.top > H * 0.4, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], text: t.slice(0, 300), buttons: btns, hasAccept: btns.some(b => /accept|agree|allow|ok|ठीक|स्वीकार/i.test(b)), hasReject: btns.some(b => /reject|decline|deny|refuse|अस्वीकार/i.test(b)), hasCustomise: btns.some(b => /custom|manage|settings|preferences|choose/i.test(b)), background: effBg(el), path: path(el) };
    break;
  }
  const search = { inputs: Array.from(document.querySelectorAll('input[type=search],input[name*=search i],input[placeholder*=search i],input[aria-label*=search i],[role=search] input')).filter(visible).slice(0, 5).map(i => ({ path: path(i), region: region(i), w: Math.round(i.getBoundingClientRect().width), name: i.name, placeholder: i.placeholder })) };

  // ---- forms
  const forms = [];
  for (const f of Array.from(document.querySelectorAll('form')).slice(0, 20)) {
    if (!visible(f)) continue;
    const fields = [];
    for (const el of f.querySelectorAll('input,select,textarea')) {
      const type = (el.type || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      let label = null, clickable = false;
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) { label = l.innerText.trim(); clickable = true; } }
      if (!label) { const l = el.closest('label'); if (l) { label = l.innerText.trim(); clickable = true; } }
      const aria = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') ? (document.getElementById(el.getAttribute('aria-labelledby')) || {}).innerText : null);
      fields.push({ type, name: el.name || null, id: el.id || null, label: label || aria || null, labelClickable: clickable, required: el.required || el.getAttribute('aria-required') === 'true', asterisk: /\*|\brequired\b|mandatory/i.test(label || ''), placeholderOnly: !label && !aria && !!el.placeholder, tabindex: el.getAttribute('tabindex'), path: path(el) });
    }
    const first = f.querySelector('input,select,textarea');
    let instr = false;
    if (first) for (const p of f.querySelectorAll('p,legend,.help,.instructions,small,[class*=instruction i]')) { if (p.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) { instr = true; break; } }
    forms.push({ path: path(f), action: f.getAttribute('action'), fieldCount: fields.length, fields, instructionsBeforeFields: instr, isSearch: !!f.querySelector('[type=search]') || /search/i.test(f.id + f.className + (f.getAttribute('role') || '')) });
  }

  // ---- links
  const links = [], docs = [];
  const DOC = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|rar)(\?|#|$)/i;
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= 800) break;
    let u; try { u = new URL(a.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const l = { href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 300), external: u.hostname.replace(/^www\./, '') !== location.hostname.replace(/^www\./, ''), insecure: u.protocol === 'http:', newTab: a.target === '_blank', rel: a.rel || null, region: region(a) };
    links.push(l);
    if (DOC.test(u.pathname)) docs.push({ href: a.href, text: l.text, ext: (/\.(\w+)(\?|#|$)/.exec(u.pathname) || [])[1] });
  }

  // ---- videos
  const videos = [];
  for (const v of document.querySelectorAll('video,iframe[src*="youtube"],iframe[src*="youtu.be"],iframe[src*="vimeo"]')) {
    if (videos.length >= 30) break;
    const isFrame = v.tagName === 'IFRAME';
    const tracks = isFrame ? [] : Array.from(v.querySelectorAll('track')).map(t => t.kind);
    videos.push({ tag: v.tagName.toLowerCase(), src: v.currentSrc || v.src || (v.querySelector('source') || {}).src || '', embed: isFrame, trackKinds: tracks, hasCaptions: tracks.some(k => /captions|subtitles/.test(k)), controls: !!v.controls, muted: !!v.muted || v.hasAttribute('muted'), loop: !!v.loop, autoplay: !!v.autoplay, title: v.getAttribute('title') || '', path: path(v) });
  }

  // ---- personas (audience selector words as short links/buttons/tabs)
  const PERSONA = /^(citizens?|businesses|business( owner)?s?|students?|government|media|researchers?|entrepreneurs?|investors?|farmers?|youth|women|senior citizens?|employees?|ngos?|industry|partners?|exporters?|tourists?|job ?seekers?|professionals?|startups?)$/i;
  const personas = Array.from(new Set(Array.from(document.querySelectorAll('a,button,li,[role=tab],h2,h3,span')).filter(e => visible(e) && PERSONA.test((e.innerText || '').trim())).map(e => e.innerText.trim().toLowerCase()))).slice(0, 20);

  // ---- page text
  const bodyText = document.body.innerText.slice(0, 150000);

  return { meta, textStyles, colours, images, backgrounds, icons, controls, header, footer, cookie, search, forms, links, docs, videos, personas, bodyText };
})()
