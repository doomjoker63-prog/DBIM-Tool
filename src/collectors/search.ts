import type { Page } from 'playwright';

export interface SearchQuery {
  query: string;
  ok: boolean;
  urlChanged: boolean;
  urlAfter: string;
  status: number | null;
  /** How often the query word appears in the visible text after searching. */
  occurrences: number;
  /** Links in the main content area (candidate results). */
  resultLinks: number;
  noResultsMessage: boolean;
  errorPage: boolean;
  error?: string;
}

export interface SearchProbe {
  inputFound: boolean;
  queries: SearchQuery[];
}

const INPUT = 'input[type=search],[role=search] input[type=text],[role=search] input:not([type]),input[name*=search i],input[placeholder*=search i],input[aria-label*=search i],input[name=q],input[name=s]';
const SKIP = /^(home|login|log in|logout|sign|skip|menu|search|contact|about|help|english|hindi|main|content|navigation|more|read|view|click|here|previous|next)$/i;

/** Pick a few real words from the site's own navigation and headings as test queries. */
export function pickQueries(data: Record<string, any>, max = 3): string[] {
  const pool: string[] = [];
  for (const l of (data.links ?? []) as any[]) if (['header', 'nav'].includes(l.region) && !l.external) pool.push(l.text);
  for (const h of (data.meta?.headings ?? []) as any[]) pool.push(h.text);
  pool.push(data.meta?.title ?? '');
  const words = new Set<string>();
  for (const t of pool)
    for (const w of String(t).split(/[^A-Za-z]+/)) if (w.length >= 5 && w.length <= 14 && !SKIP.test(w)) words.add(w.toLowerCase());
  return [...words].slice(0, max);
}

/** Type real queries into the site's search box and record what happens. Navigates away from the current page. */
export async function probeSearch(page: Page, startUrl: string, queries: string[]): Promise<SearchProbe> {
  const probe: SearchProbe = { inputFound: false, queries: [] };
  for (const q of queries) {
    const r: SearchQuery = { query: q, ok: false, urlChanged: false, urlAfter: '', status: null, occurrences: 0, resultLinks: 0, noResultsMessage: false, errorPage: false };
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      const box = page.locator(INPUT).filter({ visible: true }).first();
      if (!(await box.count())) {
        // the box may sit behind a search icon/button
        await page.locator('button[aria-label*=search i],a[aria-label*=search i],[class*=search i] button,button:has-text("search")').filter({ visible: true }).first().click({ timeout: 2000 }).catch(() => {});
      }
      const input = page.locator(INPUT).filter({ visible: true }).first();
      if (!(await input.count())) { r.error = 'no visible search input'; probe.queries.push(r); break; }
      probe.inputFound = true;
      const before = page.url();
      const bodyBefore = (await page.locator('body').innerText()).length;
      await input.fill(q, { timeout: 4000 });
      const nav = page.waitForResponse(res => res.request().isNavigationRequest() && res.url() !== before, { timeout: 7000 }).catch(() => null);
      await input.press('Enter');
      const res = await nav;
      r.status = res?.status() ?? null;
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      r.urlAfter = page.url();
      r.urlChanged = r.urlAfter !== before;
      const text = await page.locator('body').innerText();
      r.occurrences = (text.match(new RegExp(q.replace(/[^a-z]/gi, ''), 'gi')) ?? []).length;
      r.resultLinks = await page.evaluate(`(() => { const m = document.querySelector('main,[role=main]') || document.body; return Array.from(m.querySelectorAll('a[href]')).filter(a => !a.closest('header,footer,nav') && (a.innerText || '').trim().length > 8).length; })()`) as number;
      const title = (await page.title()) + ' ' + ((await page.locator('h1').first().innerText().catch(() => '')) || '');
      r.noResultsMessage = /no (results?|records?|matches|items|tenders?|data|documents?)\b|nothing found|data not found|not found\b|\b0 (live )?(results?|tenders?|records?|items)\b/i.test(text.slice(0, 20000));
      r.errorPage = (r.status ?? 200) >= 400 || /\b(404|not found|server error|something went wrong)\b/i.test(title);
      r.ok = !r.errorPage && !r.noResultsMessage && (r.urlChanged || text.length !== bodyBefore) && (r.occurrences >= 1 || r.resultLinks >= 1);
    } catch (e) {
      r.error = (e as Error).message.split('\n')[0];
    }
    probe.queries.push(r);
  }
  return probe;
}
