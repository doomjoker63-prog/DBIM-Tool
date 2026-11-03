import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../src/audit.js';
import { collect, singleUrlRun } from '../src/collect.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { buildReports } from '../src/report/report.js';

const fixtures = path.resolve(__dirname, 'fixtures');
let server: http.Server;
let outDir: string;
let files: string[];

const cfg = () => ({
  ...DEFAULT_CONFIG,
  orgType: 'ministry' as const,
  outDir,
  viewports: [1440, 375],
  report: { ...DEFAULT_CONFIG.report, organisation: 'Test Ministry', application: 'Bad Site', reportNo: 'LTPL/DBIM/TEST/01', level: 1 as const },
});

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(fs.readFileSync(path.join(fixtures, 'bad.html')));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  outDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '/tmp'), 'dbim-rep-'));
  const runDir = singleUrlRun(outDir, url);
  await collect(cfg(), runDir, { axe: true, screenshots: false, delayMs: 0 }, () => {});
  audit(cfg(), runDir);
  files = await buildReports(cfg(), runDir, { formats: ['xlsx', 'docx'], proofs: true }, () => {});
}, 180000);

afterAll(() => {
  server.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('report generation', () => {
  it('writes an xlsx with summary, both checklists and findings', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files.find(f => f.endsWith('.xlsx'))!);
    expect(wb.worksheets.map(w => w.name)).toEqual(['Summary', 'Generic Checklist', 'Ministry Checklist', 'Findings']);
    expect(wb.getWorksheet('Generic Checklist')!.rowCount).toBe(47);
    expect(wb.getWorksheet('Ministry Checklist')!.rowCount).toBe(35);
    const findings = wb.getWorksheet('Findings')!;
    expect(findings.rowCount).toBeGreaterThan(8);
    expect(String(findings.getRow(2).getCell(5).value)).toBe('OPEN');
    const header = (findings.getRow(1).getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb;
    expect(header).toBe('FFFFFF00');
  });

  it('fills the Word template: no leftover finding placeholders, one table per finding, screenshots embedded', () => {
    const docx = files.find(f => f.endsWith('.docx'))!;
    const script = `
import docx, json, sys
d = docx.Document(sys.argv[1])
text = "\\n".join(p.text for p in d.paragraphs) + "\\n".join(c.text for t in d.tables for r in t.rows for c in r.cells)
fin = [t for t in d.tables if t.rows[0].cells[0].text.strip() == "STATUS"]
print(json.dumps({"obs": "[Observation" in text, "verdict_ph": "[Compliance / Non-Compliance" in text, "findings": len(fin),
  "images": len(d.inline_shapes), "nc_cells": sum(1 for r in d.tables[6].rows for c in r.cells[4:] if c.text == "Non-Compliance"),
  "has_org": "Test Ministry" in text, "ref": fin[0].rows[1].cells[1].text}))`;
    const out = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script, docx], { encoding: 'utf8' }));
    expect(out.obs).toBe(false);
    expect(out.verdict_ph).toBe(false);
    expect(out.findings).toBeGreaterThan(8);
    expect(out.images).toBeGreaterThanOrEqual(out.findings);
    expect(out.nc_cells).toBeGreaterThan(8);
    expect(out.has_org).toBe(true);
    expect(out.ref).toMatch(/^DBIM v3 – Section /);
  });

  it('applies the VAPT report style: fonts, header band, verdict colours, real header text, border off the cover', () => {
    const docx = files.find(f => f.endsWith('.docx'))!;
    const script = `
import docx, json, sys
from docx.oxml.ns import qn
d = docx.Document(sys.argv[1])
fin = [t for t in d.tables if t.rows[0].cells[0].text.strip() == "STATUS"]
lab = fin[0].rows[1].cells[0]
fills = [c._tc.tcPr.find(qn("w:shd")).get(qn("w:fill")) for c in [lab]]
fonts = {r.font.name for t in d.tables for row in t.rows for c in row.cells for p in c.paragraphs for r in p.runs if r.text.strip()}
h = d.sections[0].header
htext = " ".join(p.text for p in h.paragraphs)
sp = d.sections[0]._sectPr
print(json.dumps({"fonts": sorted(fonts), "fill": fills[0], "hdr": htext, "pict": "<w:pict" in h._element.xml,
  "border": sp.find(qn("w:pgBorders")).get(qn("w:display")), "title": sp.find(qn("w:titlePg")) is not None,
  "h1": d.styles["Heading 1"].font.name}))`;
    const out = JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script, docx], { encoding: 'utf8' }));
    expect(out.fonts).toEqual(['Calibri']);
    expect(out.fill).toBe('BBD4EC');
    expect(out.hdr).not.toMatch(/\[ORG\]|\[1\/2\]/);
    expect(out.hdr).toContain('DBIM Level-1 Test Report');
    expect(out.pict).toBe(false);
    expect(out.border).toBe('notFirstPage');
    expect(out.title).toBe(true);
    expect(out.h1).toBe('Times New Roman');
  });
});
