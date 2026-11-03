export interface Robots {
  allowed(url: string): boolean;
  /** Crawl-delay in ms for our agent, if the site asks for one. */
  crawlDelayMs: number | null;
}

interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
  delay: number | null;
}

/** Parse a robots.txt body. Longest matching rule wins; Allow beats Disallow on a tie. Supports * and $ in paths. */
export function parseRobots(body: string, agent = 'dbim-auditor'): Robots {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') { if (val) cur.rules.push({ allow: key === 'allow', path: val }); else if (key === 'disallow') cur.rules.push({ allow: true, path: '/' }); }
    else if (key === 'crawl-delay') { const n = Number(val); if (Number.isFinite(n) && n >= 0) cur.delay = n * 1000; }
  }
  const a = agent.toLowerCase();
  const specific = groups.filter(g => g.agents.some(x => x !== '*' && a.includes(x)));
  const chosen = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const rules = chosen.flatMap(g => g.rules);
  const delay = chosen.find(g => g.delay != null)?.delay ?? null;
  const toRe = (p: string) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  const compiled = rules.map(r => ({ ...r, re: toRe(r.path), len: r.path.length }));
  return {
    crawlDelayMs: delay,
    allowed(url: string) {
      let path: string;
      try { const u = new URL(url); path = u.pathname + u.search; } catch { return true; }
      let best: { allow: boolean; len: number } | null = null;
      for (const r of compiled) if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = { allow: r.allow, len: r.len };
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: Robots = { allowed: () => true, crawlDelayMs: null };

export async function loadRobots(origin: string, agent: string): Promise<Robots> {
  try {
    const r = await fetch(new URL('/robots.txt', origin), { signal: AbortSignal.timeout(10000), headers: { 'user-agent': agent } });
    if (!r.ok) return ALLOW_ALL;
    const text = await r.text();
    if (/<html/i.test(text.slice(0, 300))) return ALLOW_ALL; // soft-404 page
    return parseRobots(text, agent);
  } catch {
    return ALLOW_ALL;
  }
}
