import { describe, expect, it } from 'vitest';
import { guessOrgFromHost, runScanWizard, suggestReportNo, type Prompter } from '../src/wizard.js';

function script(answers: string[]) {
  const asked: string[] = [];
  const said: string[] = [];
  const io: Prompter = { ask: async q => { asked.push(q); return answers.shift() ?? ''; }, say: t => said.push(t), close: () => {} };
  return { io, asked, said };
}
const D = { site: 'https://ntpctender.ntpc.co.in/', org: '[Organisation Name]', app: '[Website / Application Name]', reportNo: 'LTPL/DBIM/[ORG]/[NN]', maxPages: 100 };

describe('scan wizard', () => {
  it('guesses names from the host and the report number from the name', () => {
    expect(guessOrgFromHost('https://ntpctender.ntpc.co.in/')).toBe('NTPC');
    expect(guessOrgFromHost('https://www.mha.gov.in')).toBe('MHA');
    expect(suggestReportNo('Ministry of Finance')).toBe('LTPL/DBIM/MF/01');
    expect(suggestReportNo('NTPC Limited')).toBe('LTPL/DBIM/NTPC/01');
  });

  it('Enter accepts every default: generic, guessed organisation, both reports', async () => {
    const { io } = script(['', '', '', '', '', '', '']);
    const a = await runScanWizard(io, {}, D);
    expect(a).toMatchObject({ orgType: 'generic', org: 'NTPC', app: 'NTPC', maxPages: 100, formats: ['xlsx', 'docx'] });
    expect(a.reportNo).toMatch(/^LTPL\/DBIM\/NTPC\/01$/);
  });

  it('ministry choice and typed answers are used', async () => {
    const { io } = script(['2', 'Ministry of Power', 'Power Portal', 'LTPL/DBIM/MOP/02', '250', '2', 'y']);
    const a = await runScanWizard(io, {}, D);
    expect(a).toEqual({ orgType: 'ministry', org: 'Ministry of Power', app: 'Power Portal', reportNo: 'LTPL/DBIM/MOP/02', maxPages: 250, formats: ['xlsx'] });
  });

  it('skips questions already answered by flags', async () => {
    const { io, asked } = script(['']);
    await runScanWizard(io, { orgType: 'ministry', org: 'X', app: 'Y', reportNo: 'R', maxPages: 5, formats: [] }, D);
    expect(asked).toEqual(['Start the scan? [Y/n]: ']);
  });

  it('re-asks on an invalid answer and cancels on n', async () => {
    const { io, said } = script(['9', '1', '', '', '', 'abc', '10', '1', 'n']);
    await expect(runScanWizard(io, {}, D)).rejects.toThrow('Cancelled');
    expect(said.some(t => t.includes('Please type 1'))).toBe(true);
  });
});
