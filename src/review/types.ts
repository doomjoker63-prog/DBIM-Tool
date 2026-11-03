import type { Verdict } from '../rules/types.js';

export type HintLevel = 'ok' | 'warn' | 'info';
export interface Hint {
  level: HintLevel;
  text: string;
}

export interface ReviewItem {
  id: string;
  checklist: string;
  no: number;
  text: string;
  section: string;
  severity: string;
  howToTest: string;
  /** What the automated scan already established (empty remarks for items it never covers). */
  machine: { verdict: Verdict; remarks: string; confidence?: string; automated: boolean; evidence: { url: string; detail: string }[] };
  /** Facts the tool extracted for the tester, each marked ok / warn / info. */
  hints: Hint[];
  links: { label: string; url: string }[];
  /** Paths relative to the review folder. */
  images: { file: string; caption: string }[];
  tables: { title: string; header: string[]; rows: string[][] }[];
  lists: { title: string; items: string[] }[];
  /** A starting verdict when the extracted facts are clear-cut; the tester still decides. */
  suggested?: { verdict: Verdict; reason: string };
}

export interface ReviewPack {
  run: string;
  site: string;
  generatedAt: string;
  items: ReviewItem[];
}

/** What the tester sends back (exported from review.html). */
export interface ReviewFile {
  run: string;
  reviewer: string;
  date: string;
  reviews: Record<string, { verdict: Verdict; remarks: string; proof?: string | null; url?: string | null; reviewer?: string; date?: string }>;
}
