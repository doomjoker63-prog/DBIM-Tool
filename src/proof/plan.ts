import type { PageSnapshot } from '../collect.js';
import { TITLES } from '../report/titles.js';
import type { Evidence, RuleResult } from '../rules/types.js';
import type { NetRow, PanelSpec, ProofSpec, TargetSpec } from './types.js';

/** Style properties worth showing for findings about one element. */
const PROPS: Record<string, string[]> = {
  G03: ['fill', 'color'],
  G08: ['width', 'height'],
  G09: ['width', 'height', 'object-fit'],
  G12: ['text-align', 'font-size', 'width'],
  G13: ['text-transform', 'font-size', 'font-family'],
  G14: ['font-size', 'font-weight', 'line-height', 'font-family'],
  G17: ['color', 'background-color', 'outline-style', 'box-shadow'],
  G18: ['color', 'background-color', 'text-decoration-line', 'cursor'],
  G20: ['width', 'height', 'object-fit'],
  G27: ['width', 'height', 'object-fit'],
  X02: ['line-height', 'font-size'],
  X03: ['font-size', 'padding'],
};
const COMPUTED = new Set(Object.keys(PROPS));

const URL_IN_TEXT = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|svg|webp|avif|bmp|ico|css|js|woff2?|ttf|mp4))/i;

/** Pick the evidence line that best shows the problem: one with something to box, else the first. */
function primaryOf(r: RuleResult): Evidence | undefined {
  const ev = r.evidence ?? [];
  return ev.find(e => e.selector || e.proof?.bg || e.proof?.color || e.proof?.region) ?? ev.find(e => e.proof) ?? ev[0];
}

export function planProof(r: RuleResult, snaps: PageSnapshot[]): ProofSpec {
  const ev = r.evidence ?? [];
  const e = primaryOf(r);
  const h = e?.proof;
  const url = h?.url ?? e?.url ?? r.affectedUrls[0] ?? snaps[0]?.finalUrl ?? '';
  const viewport = h?.viewport ?? 1440;

  const targets: TargetSpec[] = [];
  const add = (t: TargetSpec) => { if (!targets.some(x => x.by === t.by && x.value === t.value)) targets.push(t); };
  if (e?.selector && !h?.region) add({ by: 'selector', value: e.selector });
  if (h?.bg) add({ by: 'bg', value: h.bg });
  if (h?.color) add({ by: 'color', value: h.color });
  if (h?.region) add({ by: 'region', value: h.region });
  // the same kind of problem elsewhere on the same page: box a few of them too
  for (const o of ev) {
    if (targets.length >= 4) break;
    if (o === e || (o.url ?? '') !== (e?.url ?? '')) continue;
    if (o.selector && !h?.region) add({ by: 'selector', value: o.selector });
    else if (o.proof?.bg && h?.bg) add({ by: 'bg', value: o.proof.bg });
  }

  const snap = snaps.find(s => s.finalUrl === url || s.url === url) ?? snaps.find(s => s.url === e?.url);
  const kind = h?.panel ?? (COMPUTED.has(r.id) ? 'computed' : 'facts');
  const detail = e?.detail ?? r.remarks;
  const panel: PanelSpec = { kind, props: h?.props ?? PROPS[r.id], facts: h?.facts ?? [`!${detail}`] };

  if (kind === 'network') {
    panel.needle = h?.needle ?? URL_IN_TEXT.exec(detail)?.[1] ?? '';
    const res: NetRow[] = (snap?.resources ?? []).map(x => ({ url: x.url, type: x.type, status: x.status, bytes: x.bytes }));
    const name = (u: string) => u.split('#')[0].split('?')[0];
    const hit = res.filter(x => panel.needle && (x.url === panel.needle || name(x.url) === name(panel.needle)));
    panel.rows = hit.length ? hit.slice(0, 3) : [];
  }
  if (kind === 'search') panel.needle = h?.needle ?? 'cookie';

  return { id: r.id, url, viewport, targets, panel, headline: TITLES[r.id] ?? r.text };
}
