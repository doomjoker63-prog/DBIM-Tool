import { loadReference, loadRules } from '../rules.js';
import { mediaRules } from './media.js';
import { semiRules } from './semi.js';
import { structureRules } from './structure.js';
import type { Palette, RuleFn, RuleResult, Site } from './types.js';
import { visualRules } from './visual.js';

export const IMPLEMENTED: Record<string, RuleFn> = { ...visualRules, ...mediaRules, ...structureRules, ...semiRules };

export const loadPalette = (): Palette => loadReference<Palette>('palette.json');

const MAX_EVIDENCE = 25;

/** Run every catalogue rule that has an implementation; the rest are reported as Pending with the manual how-to-test text. */
export function runRules(site: Site, checklists: string[]): RuleResult[] {
  const out: RuleResult[] = [];
  for (const r of loadRules().filter(r => checklists.includes(r.checklist))) {
    const fn = IMPLEMENTED[r.id];
    let o;
    if (!fn) {
      o = { verdict: 'Pending' as const, remarks: `Not automated yet. Manual test: ${r.howToTest}`, confidence: 'low' as const };
    } else {
      try {
        o = fn(site);
      } catch (e) {
        o = { verdict: 'Pending' as const, remarks: `Rule error: ${(e as Error).message}`, confidence: 'low' as const };
      }
    }
    const evidence = o.evidence ?? [];
    out.push({
      ...o, id: r.id, checklist: r.checklist, no: r.no, text: r.text, section: r.section, severity: r.severity, automated: !!fn,
      evidence: evidence.slice(0, MAX_EVIDENCE), evidenceCount: evidence.length, affectedUrls: [...new Set(evidence.map(e => e.url))].slice(0, 20),
    });
  }
  // Extra checks defined in the manual but absent from the Level-1 template.
  for (const id of Object.keys(IMPLEMENTED).filter(k => k.startsWith('X'))) {
    const o = IMPLEMENTED[id](site);
    const evidence = o.evidence ?? [];
    out.push({ ...o, id, checklist: 'extra', no: Number(id.slice(1)), text: EXTRA_TEXT[id] ?? id, section: EXTRA_SECTION[id] ?? '', severity: 'Low', automated: true, evidence: evidence.slice(0, MAX_EVIDENCE), evidenceCount: evidence.length, affectedUrls: [...new Set(evidence.map(e => e.url))].slice(0, 20) });
  }
  return out;
}

const EXTRA_TEXT: Record<string, string> = {
  X01: 'Image alt text is meaningful, up to 140 characters and does not start with "image of" / "picture of".',
  X02: 'Line height is 1.2 to 1.5 times the type size.',
  X03: 'Call-to-action button text is at most 3 words.',
};
const EXTRA_SECTION: Record<string, string> = { X01: '6.1.2', X02: '4.5', X03: '4.5' };
