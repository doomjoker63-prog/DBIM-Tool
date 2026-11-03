import readline from 'node:readline/promises';

/** Anything that can ask a question and return the typed line (a terminal in real use, a script in tests). */
export interface Prompter {
  ask(question: string): Promise<string>;
  say(text: string): void;
  close(): void;
}

export function terminalPrompter(): Prompter {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return { ask: q => rl.question(q), say: t => console.log(t), close: () => rl.close() };
}

/** Values the person already gave as flags or in dbim.config.json; the wizard only asks for what is still undecided. */
export interface ScanAnswers {
  orgType?: 'generic' | 'ministry';
  org?: string;
  app?: string;
  reportNo?: string;
  maxPages?: number;
  formats?: ('xlsx' | 'docx')[];
}

export interface WizardDefaults {
  site: string;
  /** Organisation name from the config, if the person set one (placeholders like "[Organisation Name]" are ignored). */
  org?: string;
  app?: string;
  reportNo?: string;
  maxPages: number;
}

const NOISE = new Set(['www', 'in', 'gov', 'nic', 'co', 'org', 'com', 'net', 'ac', 'edu', 'res', 'ernet']);

/** "ntpctender.ntpc.co.in" -> "NTPC": the last meaningful label of the host, upper-cased. */
export function guessOrgFromHost(site: string): string {
  let host = '';
  try { host = new URL(site).hostname; } catch { host = site; }
  const labels = host.split('.').filter(l => l && !NOISE.has(l.toLowerCase()));
  return (labels[labels.length - 1] ?? '').toUpperCase();
}

/** "LTPL/DBIM/NTPC/01": initials for a multi-word name, otherwise the (short) name itself. */
export function suggestReportNo(org: string): string {
  const words = org.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const stop = new Set(['of', 'and', 'the', 'limited', 'ltd', 'private', 'pvt']);
  const core = words.filter(w => !stop.has(w.toLowerCase()));
  const code = (core.length > 1 ? core.map(w => w[0]).join('') : (core[0] ?? 'ORG')).toUpperCase().slice(0, 8);
  return `LTPL/DBIM/${code}/01`;
}

export function isPlaceholder(v?: string): boolean {
  return !v || /^\[.*\]$/.test(v.trim()) || /\[ORG\]|\[NN\]/.test(v);
}

/** Interactive prompts are only for a person at a terminal: never in CI, never when output is machine-readable. */
export function canPrompt(opts: { json?: boolean; yes?: boolean; prompt?: boolean }): boolean {
  if (opts.prompt === false || opts.yes || opts.json) return false;
  if (process.env.CI || process.env.DBIM_NO_PROMPT) return false;
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

async function askUntil<T>(io: Prompter, question: string, parse: (s: string) => T | undefined, hint: string): Promise<T> {
  for (let i = 0; i < 4; i++) {
    const v = parse((await io.ask(question)).trim());
    if (v !== undefined) return v;
    io.say(`  ${hint}`);
  }
  throw new Error('No valid answer given; run again, or pass the values as flags (see: dbim scan --help).');
}


export async function askOrgType(io: Prompter): Promise<'generic' | 'ministry'> {
  io.say(['What kind of website is this?',
    '  1) Generic website: PSU, authority, board, society or any other body  -> 46 Generic checklist items',
    '  2) Ministry / Department (or attached office)                          -> Generic 46 + Ministry/Department 34 items'].join('\n'));
  return askUntil<'generic' | 'ministry'>(io, 'Choose 1 or 2 [1]: ', s => {
    const t = s.toLowerCase();
    if (t === '' || t === '1' || t === 'g' || t === 'generic') return 'generic';
    if (t === '2' || t === 'm' || t === 'ministry') return 'ministry';
  }, 'Please type 1 (Generic) or 2 (Ministry / Department).');
}

/** Organisation, website name and report number: fills only the fields of `out` that are still empty. */
export async function askReportDetails(io: Prompter, out: ScanAnswers, d: Pick<WizardDefaults, 'site' | 'org' | 'app' | 'reportNo'>): Promise<void> {
  if (!out.org) {
    const def = !isPlaceholder(d.org) ? d.org! : guessOrgFromHost(d.site);
    out.org = await askUntil(io, `Organisation name${def ? ` [${def}]` : ''}: `, s => (s || def) || undefined, 'The organisation name is needed for the report cover and header.');
  }
  if (!out.app) {
    const def = !isPlaceholder(d.app) ? d.app! : out.org;
    out.app = (await io.ask(`Website / application name [${def}]: `)).trim() || def;
  }
  if (!out.reportNo) {
    const def = !isPlaceholder(d.reportNo) ? d.reportNo! : suggestReportNo(out.org);
    out.reportNo = (await io.ask(`Report number [${def}]: `)).trim() || def;
  }
}

/**
 * Ask the questions a scan needs, skipping every one that is already answered (by a flag or the config).
 * The order follows how people think about it: what kind of website, whose website, then the details.
 */
export async function runScanWizard(io: Prompter, known: ScanAnswers, d: WizardDefaults): Promise<Required<ScanAnswers>> {
  const out: ScanAnswers = { ...known };
  io.say(`\nDBIM scan of ${d.site}\nPress Enter to accept the value in [brackets].\n`);

  if (!out.orgType) out.orgType = await askOrgType(io);

  await askReportDetails(io, out, d);
  if (!out.maxPages) {
    out.maxPages = await askUntil(io, `Maximum pages to crawl [${d.maxPages}]: `, s => {
      if (!s) return d.maxPages;
      const n = Number(s);
      return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : undefined;
    }, 'Type a whole number between 1 and 5000.');
  }
  if (!out.formats) {
    io.say('Reports to write:\n  1) Excel workbook + Word report (recommended)\n  2) Excel workbook only\n  3) None (just show the results)');
    out.formats = await askUntil<('xlsx' | 'docx')[]>(io, 'Choose 1, 2 or 3 [1]: ', s => {
      if (s === '' || s === '1') return ['xlsx', 'docx'];
      if (s === '2') return ['xlsx'];
      if (s === '3') return [];
    }, 'Please type 1, 2 or 3.');
  }

  const f = out.formats!.length ? out.formats!.join(' + ') : 'no files';
  io.say(`\nSummary\n  Checklists : ${out.orgType === 'ministry' ? 'Generic (46) + Ministry/Department (34)' : 'Generic (46)'}\n  Organisation: ${out.org}\n  Website name: ${out.app}\n  Report no.  : ${out.reportNo}\n  Max pages   : ${out.maxPages}\n  Reports     : ${f}\n`);
  const go = (await io.ask('Start the scan? [Y/n]: ')).trim().toLowerCase();
  if (go === 'n' || go === 'no') throw new Error('Cancelled.');
  return out as Required<ScanAnswers>;
}
