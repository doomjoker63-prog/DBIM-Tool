import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadConfig } from './config.js';

export interface Check {
  name: string;
  ok: boolean;
  /** error = the tool cannot do its job; warn = one feature is unavailable. */
  level: 'error' | 'warn';
  detail: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['rules.json', 'reference/palette.json', 'reference/typography.json', 'reference/icon-index.json', 'reference/logo-index.json', 'reference/emblem.json', 'reference/manual-text.json', 'templates/dbim-report-template.docx'];

export async function runDoctor(configFile?: string): Promise<Check[]> {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, level: Check['level'] = 'error') => out.push({ name, ok, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js 20 or newer', major >= 20, `found ${process.version}`);

  try {
    const b = await chromium.launch();
    const v = b.version();
    await b.close();
    add('Chromium (Playwright)', true, `version ${v}`);
  } catch (e) {
    add('Chromium (Playwright)', false, `cannot start: ${(e as Error).message.split('\n')[0]}. Fix: npx playwright install chromium`);
  }

  try {
    const sharp = (await import('sharp')).default;
    add('Image library (sharp)', true, `libvips ${sharp.versions.vips}`);
  } catch (e) {
    add('Image library (sharp)', false, `cannot load: ${(e as Error).message.split('\n')[0]}`);
  }

  const py = process.env.DBIM_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  try {
    const v = execFileSync(py, ['-c', 'import docx, sys; print(sys.version.split()[0])'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }).trim();
    add('Python + python-docx (Word reports)', true, `Python ${v}`, 'warn');
  } catch {
    add('Python + python-docx (Word reports)', false, `"${py}" with python-docx not found; XLSX reports still work. Fix: pip install python-docx (or set DBIM_PYTHON)`, 'warn');
  }

  const missing = REQUIRED.filter(f => !fs.existsSync(path.join(root, f)));
  add('Reference data and template', !missing.length, missing.length ? `missing: ${missing.join(', ')}` : `${REQUIRED.length} files present`);

  try {
    const cfg = loadConfig(configFile, { warn: false });
    fs.mkdirSync(cfg.outDir, { recursive: true });
    const probe = path.join(cfg.outDir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe);
    add('Output folder writable', true, path.resolve(cfg.outDir));
  } catch (e) {
    add('Config and output folder', false, (e as Error).message.split('\n').slice(0, 4).join(' | '));
  }

  const free = (() => { try { const s = fs.statfsSync(os.tmpdir()); return (s.bavail * s.bsize) / 1024 ** 3; } catch { return null; } })();
  if (free != null) add('Free disk space', free > 1, `${free.toFixed(1)} GB free (a 100-page audit with screenshots needs about 0.5 GB)`, 'warn');
  return out;
}
