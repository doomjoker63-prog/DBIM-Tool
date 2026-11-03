(args) => {
  // Reads the real values shown in the measurement panel. args: { index, props, head, needle }
  const out = {};
  const el = args.index != null ? (window.__dbimProof || [])[args.index] : null;
  if (el && args.props && args.props.length) {
    const s = getComputedStyle(el);
    const props = {};
    for (const p of args.props) {
      let v = s.getPropertyValue(p);
      if ((p === 'fill' || p === 'stroke') && !v) v = '';
      props[p] = v;
    }
    out.props = props;
    out.tag = el.tagName.toLowerCase();
    out.text = (el.innerText || el.value || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    const r = el.getBoundingClientRect();
    out.size = Math.round(r.width) + ' x ' + Math.round(r.height);
  }
  if (args.head) {
    const lines = [];
    const rest = { link: 0, script: 0, style: 0, other: 0 };
    const cut = (v, n) => { v = (v || '').replace(/\s+/g, ' '); return v.length > n ? v.slice(0, n) + '...' : v; };
    let metas = 0;
    for (const c of Array.from(document.head.children)) {
      const t = c.tagName.toLowerCase();
      if (t === 'title') lines.push('<title>' + cut(c.textContent.trim(), 70) + '</title>');
      else if (t === 'meta') {
        if (++metas > 14) continue;
        const key = c.getAttribute('name') ? 'name="' + c.getAttribute('name') + '"' : c.getAttribute('property') ? 'property="' + c.getAttribute('property') + '"' : c.getAttribute('charset') ? 'charset="' + c.getAttribute('charset') + '"' : 'http-equiv="' + (c.getAttribute('http-equiv') || '') + '"';
        lines.push('<meta ' + key + (c.getAttribute('content') != null ? ' content="' + cut(c.getAttribute('content'), 60) + '"' : '') + '>');
      } else if (t in rest) rest[t]++;
      else rest.other++;
    }
    const parts = [];
    if (rest.link) parts.push(rest.link + ' <link>');
    if (rest.script) parts.push(rest.script + ' <script>');
    if (rest.style) parts.push(rest.style + ' <style>');
    if (parts.length) lines.push('... ' + parts.join(', ') + ' (not listed)');
    out.head = lines;
    out.lang = document.documentElement.lang || '';
  }
  if (args.needle) {
    const re = new RegExp(String(args.needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out.textMatches = (document.body.innerText.match(re) || []).length;
    let dom = 0;
    try { dom = document.querySelectorAll('[class*="' + args.needle + '" i],[id*="' + args.needle + '" i],[aria-label*="' + args.needle + '" i]').length; } catch (e) { dom = 0; }
    out.domMatches = dom;
  }
  return out;
}
