import type { PanelSpec } from './types.js';

export interface PanelInfo {
  props?: Record<string, string>;
  tag?: string;
  text?: string;
  size?: string;
  head?: string[];
  lang?: string;
  textMatches?: number;
  domMatches?: number;
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtSize = (b: number | null) => (b == null ? 'unknown' : b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' kB' : b + ' B');
const baseName = (u: string) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || u).slice(0, 70); } catch { return u.slice(0, 70); } };

export const PANEL_CSS = `
  .dt { border-top: 3px solid #1a73e8; background: #fff; color: #202124; font-family: "Segoe UI", system-ui, Arial, sans-serif; }
  .tabs { background: #f1f3f4; height: 46px; display: flex; align-items: stretch; padding: 0 14px; font-size: 20px; gap: 26px; border-bottom: 1px solid #dadce0; color: #5f6368; }
  .tabs span { display: flex; align-items: center; }
  .tabs .on { color: #1a73e8; border-bottom: 3px solid #1a73e8; font-weight: 600; }
  .pbody { padding: 14px 22px 10px; font-size: 22px; line-height: 1.55; }
  .mono { font-family: Consolas, "Cascadia Mono", "Courier New", monospace; }
  .dim { color: #5f6368; }
  .k { color: #c80000; } .v { color: #1a1aa6; }
  .hl { outline: 4px solid #E00000; outline-offset: 2px; background: #fff3f3; }
  .row { margin: 3px 0; padding: 0 8px; display: block; }
  .fact { margin: 8px 0 0; padding: 4px 10px; font-size: 21px; }
  .fact.bad { font-weight: 600; margin: 12px 4px 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 21px; margin: 4px 0 8px; }
  th { background: #f1f3f4; text-align: left; font-weight: 600; padding: 5px 10px; border: 1px solid #dadce0; }
  td { padding: 6px 10px; border: 1px solid #dadce0; }
  .code { padding: 10px 14px; font-size: 20px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
  .miss { color: #b00000; font-weight: 600; }
  .note { font-size: 16px; color: #80868b; padding: 6px 22px 10px; border-top: 1px solid #eceff1; }
`;

/** HTML of the measurement panel for a proof image. Every value comes from the live page at capture time. */
export function panelHtml(p: PanelSpec, info: PanelInfo | null, headline: string): string {
  const tabs = (names: string[], on: number) => `<div class="tabs">${names.map((n, i) => `<span class="${i === on ? 'on' : ''}">${esc(n)}</span>`).join('')}</div>`;
  const facts = (lines: string[] | undefined) => (lines ?? []).filter(Boolean).map(l => (l.startsWith('!') ? `<div class="fact bad hl">${esc(l.slice(1))}</div>` : `<div class="fact">${esc(l)}</div>`)).join('');
  let head = '', body = '';

  if (p.kind === 'computed') {
    head = tabs(['Elements', 'Console', 'Network', 'Styles', 'Computed'], 4);
    const rows = Object.entries(info?.props ?? {}).map(([k, v], i) => `<span class="row mono ${i === 0 ? 'hl' : ''}"><span class="k">${esc(k)}</span>: <span class="v">${esc(v || '(none)')}</span>;</span>`).join('');
    body = `<div class="mono dim" style="font-size:20px;margin-bottom:6px">&lt;${esc(info?.tag ?? 'element')}&gt; ${info?.text ? '"' + esc(info.text) + '"' : ''} <span>${esc(info?.size ?? '')}</span></div>${rows || '<div class="dim">The boxed element could not be measured.</div>'}${facts(p.facts)}`;
  } else if (p.kind === 'network') {
    head = tabs(['Elements', 'Console', 'Network', 'Sources'], 2);
    const trs = (p.rows ?? []).map(r => {
      const bad = r.status >= 400;
      return `<tr><td class="mono">${esc(baseName(r.url))}</td><td class="${bad ? 'hl' : ''}">${r.status}</td><td>${esc(r.type)}</td><td class="${bad ? '' : 'hl'}">${esc(fmtSize(r.bytes))}</td></tr>`;
    }).join('');
    body = trs
      ? `<table><tr><th>Name</th><th>Status</th><th>Type</th><th>Size</th></tr>${trs}</table><div class="dim mono" style="font-size:17px;word-break:break-all">${esc(p.rows![0].url)}</div>${facts(p.facts)}`
      : `<div class="dim">This file was not in the recorded network requests.</div>${facts(p.facts)}`;
  } else if (p.kind === 'head') {
    head = tabs(['Elements', 'Console', 'Network', 'Sources'], 0);
    const lines = (info?.head ?? []).map(l => esc(l)).join('\n');
    const missing = (p.facts ?? []).filter(f => /^!MISSING/i.test(f)).map(f => `<div class="miss">&lt;${esc(f.replace(/^!MISSING:?\s*/i, ''))}&gt;   &larr; not present in this page</div>`).join('');
    body = `<div class="code mono">&lt;head&gt;\n${lines}\n<div class="hl" style="margin:8px 0;padding:6px 12px">${missing || '<span class="miss">nothing missing</span>'}</div>&lt;/head&gt;</div>`;
  } else if (p.kind === 'search') {
    head = tabs(['Elements', 'Console', 'Network', 'Sources'], 0);
    body = `<div class="code mono hl">Find in page "${esc(p.needle)}":  ${info?.textMatches ?? 0} match(es) in the visible text, ${info?.domMatches ?? 0} element(s) with a class, id or label containing it</div>${facts(p.facts)}`;
  } else {
    head = `<div class="tabs"><span class="on">DBIM Auditor · measured facts</span></div>`;
    body = facts(p.facts) || '<div class="dim">No further measurements.</div>';
  }
  return `<div class="dt">${head}<div class="pbody">${body}</div><div class="note">Measured by DBIM Auditor on the live page at capture time · ${esc(headline)}</div></div>`;
}
