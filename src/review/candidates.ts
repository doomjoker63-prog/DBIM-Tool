import type { PageSnapshot } from '../collect.js';
import { classify, normalizeUrl, sameSite } from '../url.js';

export type Role = 'about' | 'team' | 'organisation' | 'vacancies' | 'tenders' | 'documents' | 'contact';

const RULES: Record<Role, RegExp> = {
  contact: /contact( us)?|reach us|connect with us/i,
  tenders: /tenders?|\bbids?\b|procurement|\brfp\b|\beoi\b|quotations?/i,
  vacancies: /vacanc|recruit|careers?|\bjobs?\b|openings|employment/i,
  team: /our team|the team|ministers?|who.?s who|leadership|organogram|management|council of ministers/i,
  organisation: /our organi[sz]ations?|attached (offices|organi[sz]ations?)|subordinate|autonomous bod|our divisions?|organi[sz]ations?/i,
  about: /about( us)?|objectives?|mandate|vision|mission/i,
  documents: /documents?|publications?|\breports?\b|acts?( and|&) policies|circulars?|notifications?|gazette|guidelines|resources/i,
};
const ORDER: Role[] = ['contact', 'tenders', 'vacancies', 'team', 'organisation', 'about', 'documents'];

export interface Candidate {
  role: Role;
  url: string;
  label: string;
  /** crawled = a page we already have; link = a menu/footer link found on a crawled page. */
  source: 'crawled' | 'link';
}

/** Choose, per role, the best internal page from the site's own menus, footers and crawled pages. */
export function findCandidates(snaps: PageSnapshot[], site: string): Partial<Record<Role, Candidate>> {
  const home = normalizeUrl(site) ?? site;
  const crawled = new Set(snaps.map(s => normalizeUrl(s.finalUrl) ?? s.finalUrl));
  const pool = new Map<string, { label: string; region: string }[]>();
  const add = (url: string | null, label: string, region: string) => {
    if (!url || url === home || !sameSite(url, site) || classify(url) === 'asset') return;
    (pool.get(url) ?? pool.set(url, []).get(url)!).push({ label: label.slice(0, 80), region });
  };
  for (const s of snaps) {
    if (!s.data) continue;
    for (const l of s.data.links as any[]) if (!l.external) add(normalizeUrl(l.href), l.text, l.region);
    add(normalizeUrl(s.finalUrl), s.data.meta.title, 'page');
  }
  const taken = new Set<string>();
  const out: Partial<Record<Role, Candidate>> = {};
  for (const role of ORDER) {
    let best: { url: string; label: string; score: number } | null = null;
    for (const [url, labels] of pool) {
      if (taken.has(url)) continue;
      let score = 0, label = '';
      for (const l of labels) {
        let sc = 0;
        if (RULES[role].test(l.label)) sc += 3;
        if (/header|nav/.test(l.region)) sc += 1;
        if (sc > score) { score = sc; label = l.label; }
      }
      if (RULES[role].test(new URL(url).pathname.replace(/[-_/]/g, ' '))) score += 2;
      if (!score) continue;
      if (!best || score > best.score || (score === best.score && url.length < best.url.length)) best = { url, label: label || new URL(url).pathname, score };
    }
    if (best && best.score >= 2) {
      taken.add(best.url);
      out[role] = { role, url: best.url, label: best.label, source: crawled.has(best.url) ? 'crawled' : 'link' };
    }
  }
  return out;
}
