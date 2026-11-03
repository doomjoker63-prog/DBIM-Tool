import type { BrowserContext, Page } from 'playwright';

export interface FontUse {
  family: string;
  glyphs: number;
  custom: boolean;
}
export interface FontReport {
  /** Fonts the browser actually painted, by element group (CDP CSS.getPlatformFontsForNode). */
  rendered: Record<string, FontUse[]>;
  /** Font faces declared/loaded by the page (document.fonts). */
  declared: { family: string; weight: string; status: string }[];
}

const GROUPS: Record<string, string> = {
  heading: 'h1,h2,h3,h4,h5,h6',
  body: 'p,li,td,span',
  link: 'a',
  button: 'button,input[type=button],input[type=submit],.btn',
  header: 'header a,header span,header li',
  footer: 'footer a,footer p,footer li,footer span',
};

export async function collectFonts(ctx: BrowserContext, page: Page, perGroup = 25): Promise<FontReport> {
  const cdp = await ctx.newCDPSession(page);
  const rendered: Record<string, FontUse[]> = {};
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    for (const [group, selector] of Object.entries(GROUPS)) {
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
      const agg = new Map<string, FontUse>();
      for (const nodeId of nodeIds.slice(0, perGroup)) {
        try {
          const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          for (const f of fonts) {
            const cur = agg.get(f.familyName) ?? { family: f.familyName, glyphs: 0, custom: !!f.isCustomFont };
            cur.glyphs += f.glyphCount;
            agg.set(f.familyName, cur);
          }
        } catch {
          /* node may have been detached */
        }
      }
      rendered[group] = [...agg.values()].sort((a, b) => b.glyphs - a.glyphs);
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
  const declared = await page.evaluate(
    `Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]).then(() => Array.from(document.fonts).map(f => ({ family: f.family.replace(/["']/g, ''), weight: f.weight, status: f.status })))`,
  );
  return { rendered, declared: declared as FontReport['declared'] };
}
