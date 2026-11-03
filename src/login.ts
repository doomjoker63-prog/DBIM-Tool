import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { chromium, type BrowserContext, type Page } from 'playwright';

export interface LoginOptions {
  out: string;
  /** Run without a visible window (only useful for automated tests). */
  headless?: boolean;
  /**
   * Called once the page is open. The default waits for Enter in the terminal while the person logs in by hand.
   * Tests pass a function that fills the login form instead.
   */
  confirm?: (ctx: BrowserContext, page: Page) => Promise<void>;
}

const askEnter = (q: string) => new Promise<void>(res => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, () => { rl.close(); res(); }); });

/** Open the site in a real browser window, let the person log in, then save the session (cookies + storage) for `--auth`. */
export async function login(url: string, opt: LoginOptions, log: (m: string) => void = console.log): Promise<string> {
  const browser = await chromium.launch({ headless: opt.headless ?? false });
  try {
    const ctx = await browser.newContext({ viewport: null });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (opt.confirm) await opt.confirm(ctx, page);
    else {
      log(`A browser window is open at ${url}.`);
      log('Log in as the role you were given for the audit (read-only access is enough), then come back here.');
      await askEnter('Press Enter when you are logged in and can see the protected pages... ');
    }
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await ctx.storageState({ path: out });
    try { fs.chmodSync(out, 0o600); } catch { /* not supported on Windows */ }
    log(`Saved the session to ${out}`);
    log('This file lets anyone act as that user: keep it out of version control and delete it after the audit.');
    return out;
  } finally {
    await browser.close();
  }
}
