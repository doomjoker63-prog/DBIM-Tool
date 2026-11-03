import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RuleDef {
  id: string;
  checklist: 'generic' | 'ministry';
  no: number;
  text: string;
  category: string;
  severity: 'High' | 'Medium' | 'Low';
  section: string;
  howToTest: string;
  tool: string;
  finding: string;
  impact: string;
  recommendation: string;
  automation: 'A' | 'B' | 'C' | null;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadRules(): RuleDef[] {
  return JSON.parse(fs.readFileSync(path.join(root, 'rules.json'), 'utf8'));
}

export function loadReference<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, 'reference', name), 'utf8')) as T;
}
