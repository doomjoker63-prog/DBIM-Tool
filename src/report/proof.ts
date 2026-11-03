import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadSnapshots } from '../audit.js';
import type { DbimConfig } from '../config.js';
import { hideHud, showHud } from '../live.js';
import { composeProof } from '../proof/compose.js';
import { preparePage, shoot, type Shot } from '../proof/engine.js';
import { planProof } from '../proof/plan.js';
import type { Proof, ProofSpec } from '../proof/types.js';
import { redBoxShare } from '../proof/verify.js';
import type { RuleResult } from '../rules/types.js';
import { openSession, type Session } from '../session.js';

export type { Proof } from '../proof/types.js';

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const MIN_SHARE = 0.7; // how much of the drawn border must be found as red in the finished image

/** Is the finding itself boxed inside the measurement panel (so the proof is meaningful even when no element could be boxed)? */
function panelIsBoxed(spec: ProofSpec, info: Shot['info']): boolean {
  const p = spec.panel;
  if (p.kind === 'head' || p.kind === 'search') return true;
  if (p.kind === 'network') return !!p.rows?.length;
  if (p.kind === 'computed') return !!info?.props && Object.keys(info.props).length > 0;
  return (p.facts ?? []).some(f => f.startsWith('!'));
}

/**
 * One proof image per finding: a browser-style frame with the real URL, the page scrolled to the right place with a red
 * box on the offending element(s), and a measurement panel with the real values underneath. The red box is checked in the
 * finished image; if it cannot be found the proof says so instead of pretending.
 */
export async function captureProofs(cfg: DbimConfig, runDir: string, findings: RuleResult[], log: (m: string) => void = console.log, shared?: Session): Promise<Map<string, Proof>> {
  const out = new Map<string, Proof>();
  if (!findings.length) return out;
  const dir = path.join(runDir, 'proof');
  fs.mkdirSync(dir, { recursive: true });
  const snaps = loadSnapshots(runDir);

  const items = findings.map(f => ({ f, spec: planProof(f, snaps) })).filter(x => x.spec.url);
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const key = `${it.spec.url}|${it.spec.viewport}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }

  const session = shared ?? (await openSession(cfg, { bypassCSP: true }));
  const composerBrowser = await chromium.launch({ headless: true }); // frames are drawn invisibly, so a live window only shows the real pages
  const composer = await (await composerBrowser.newContext()).newPage();
  let figure = 0, done = 0;
  try {
    for (const [, group] of groups) {
      const { url, viewport } = group[0].spec;
      const page = await session.page();
      try {
        if (session.live) await showHud(page, `Capturing proof ${done + 1} of ${items.length}`, url);
        await preparePage(page, url, viewport);
        if (session.live) await hideHud(page);
        const snap = snaps.find(s => s.finalUrl === url || s.url === url);
        const pageTitle = (snap?.data?.meta?.title as string | undefined)?.trim() || new URL(url).pathname;

        for (const { f, spec } of group) {
          done++;
          try {
            let best: { jpeg: Buffer; share: number; shot: Shot } | null = null;
            for (const strategy of ['center', 'top'] as const) {
              const shot = await shoot(page, spec, strategy);
              const c = await composeProof(composer, { url, pagePng: shot.png, vw: viewport, panel: spec.panel, info: shot.info, headline: spec.headline });
              const share = await redBoxShare(c.jpeg, shot.boxes, c.offsetX, c.offsetY);
              if (!best || share > best.share) best = { jpeg: c.jpeg, share, shot };
              if (!shot.boxes.length || share >= MIN_SHARE) break; // nothing to box, or the box is verified
            }
            const { jpeg, share, shot } = best!;
            const file = path.join(dir, `${f.id}.jpg`);
            fs.writeFileSync(file, jpeg);
            const verified = shot.boxes.length > 0 && share >= MIN_SHARE;
            const kind: Proof['kind'] = verified ? 'element' : panelIsBoxed(spec, shot.info) ? 'panel' : 'view';
            figure++;
            const detail = f.evidence?.[0]?.detail ?? f.remarks;
            const suffix = kind === 'element' ? '' : kind === 'panel' ? ' (the finding is boxed in the measurement panel below the page)' : ' (the element could not be located on the live page; see the measured values)';
            out.set(f.id, { file, kind, highlighted: kind !== 'view', caption: `Figure ${figure}: ${short(pageTitle, 50)} – ${short(detail, 150)}${suffix}` });
            log(`proof ${f.id}: ${kind}${kind === 'element' ? ` (${shot.boxes.length} box${shot.boxes.length > 1 ? 'es' : ''}, ${(share * 100).toFixed(0)}% of the border verified)` : spec.targets.length ? ` (${shot.located ? 'box not verified' : 'target not found'})` : ''}`);
          } catch (err) {
            log(`proof ${f.id}: failed (${(err as Error).message.split('\n')[0]})`);
          }
        }
      } catch (err) {
        log(`proof group ${url}: failed (${(err as Error).message.split('\n')[0]})`);
      } finally {
        await hideHud(page).catch(() => {});
        await session.release(page);
      }
    }
  } finally {
    await composerBrowser.close().catch(() => {});
    if (!shared) await session.close();
  }
  return out;
}
