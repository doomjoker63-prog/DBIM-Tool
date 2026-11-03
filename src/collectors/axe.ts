import AxeBuilder from '@axe-core/playwright';
import type { Page } from 'playwright';

export interface AxeIssue {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodeCount: number;
  nodes: { target: string; html: string; summary: string; data?: unknown }[];
}
export interface AxeReport {
  version: string;
  violations: AxeIssue[];
  incomplete: { id: string; nodeCount: number }[];
  passes: number;
  error?: string;
}

export async function collectAxe(page: Page): Promise<AxeReport> {
  try {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
    return {
      version: r.testEngine.version,
      passes: r.passes.length,
      incomplete: r.incomplete.map(i => ({ id: i.id, nodeCount: i.nodes.length })),
      violations: r.violations.map(v => ({
        id: v.id,
        impact: v.impact ?? null,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodeCount: v.nodes.length,
        nodes: v.nodes.slice(0, 8).map(n => ({
          target: n.target.join(' '),
          html: n.html.slice(0, 200),
          summary: (n.failureSummary ?? '').slice(0, 300),
          // contrast ratio, expected ratio and colours for color-contrast
          data: n.any[0]?.data,
        })),
      })),
    };
  } catch (e) {
    return { version: '', violations: [], incomplete: [], passes: 0, error: (e as Error).message.split('\n')[0] };
  }
}
