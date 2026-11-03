import type { PageSnapshot } from '../collect.js';
import type { DbimConfig } from '../config.js';

export type Verdict = 'Compliance' | 'Non-Compliance' | 'N/A' | 'Pending';
export type Confidence = 'high' | 'medium' | 'low';

/** Extra instructions for the report's proof screenshot, beyond the element selector. */
export interface ProofHint {
  /** Box the elements whose background colour is this hex. */
  bg?: string;
  /** Box the elements whose text colour is this hex. */
  color?: string;
  /** Box this part of the page: its links/headings (header, footer) or the strip at the bottom of the screen. */
  region?: 'header' | 'footer' | 'bottom';
  /** Take the screenshot at this viewport width (responsive findings). */
  viewport?: number;
  /** Open this URL instead of the evidence URL (for example a search results page). */
  url?: string;
  /** Style properties to list in the measurement panel. */
  props?: string[];
  /** Panel under the page: computed style, network row, <head> tags, DOM text search, or plain facts. */
  panel?: 'computed' | 'network' | 'head' | 'search' | 'facts';
  /** File URL (network panel) or search term (search panel). */
  needle?: string;
  /** Measured facts to print in the panel; lines starting with "!" are boxed in red. */
  facts?: string[];
}

export interface Evidence {
  url: string;
  detail: string;
  /** CSS selector of the offending element, used to draw the red box in report screenshots. */
  selector?: string;
  proof?: ProofHint;
}

export interface Outcome {
  verdict: Verdict;
  remarks: string;
  confidence?: Confidence;
  evidence?: Evidence[];
}

export interface Palette {
  primary: Record<string, string[]>;
  functional: Record<string, string>;
}

export interface Site {
  pages: PageSnapshot[];
  cfg: DbimConfig;
  palette: Palette;
}

export type RuleFn = (site: Site) => Outcome;

export interface RuleResult extends Outcome {
  id: string;
  checklist: string;
  no: number;
  text: string;
  section: string;
  severity: string;
  automated: boolean;
  evidenceCount: number;
  affectedUrls: string[];
  /** Set when a human reviewed the item (dbim review apply). */
  manual?: { reviewer: string; date: string; proof?: string };
  /** The machine result that a manual review replaced. */
  machine?: { verdict: Verdict; remarks: string };
  /** Set by `dbim retest`: how this item compares with the Level-1 baseline. */
  retest?: RetestInfo;
}

export type RetestStatus = 'CLOSED' | 'OPEN' | 'NEW' | 'UNVERIFIED';

export interface RetestInfo {
  status: RetestStatus;
  /** Text for the RETEST REMARK row. */
  remark: string;
  /** 1-based number of the observation in the baseline report (absent for NEW). */
  baselineNo?: number;
  baselineRun: string;
  /** The Level-1 finding, kept so the Level-2 report can still describe the original observation. */
  baseline?: { verdict: Verdict; remarks: string; evidence: { url: string; detail: string; selector?: string }[]; affectedUrls: string[]; evidenceCount: number };
}
