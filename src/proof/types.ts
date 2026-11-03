export type TargetSpec = { by: 'selector' | 'bg' | 'color' | 'region'; value: string };

export interface NetRow {
  url: string;
  type: string;
  status: number;
  bytes: number | null;
}

export interface PanelSpec {
  kind: 'computed' | 'network' | 'head' | 'search' | 'facts';
  /** Style properties to read from the boxed element (computed panel). */
  props?: string[];
  /** File URL (network panel) or search term (search panel). */
  needle?: string;
  /** Measured facts; a line starting with "!" is the finding and gets the red box. */
  facts?: string[];
  rows?: NetRow[];
}

/** Everything the engine needs to produce one proof image. */
export interface ProofSpec {
  id: string;
  url: string;
  /** Browser width for the screenshot (responsive findings use the failing width). */
  viewport: number;
  targets: TargetSpec[];
  panel: PanelSpec;
  /** Title shown at the top of the panel. */
  headline: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Proof {
  file: string;
  caption: string;
  /** A red box was drawn and then found again in the final image by pixel check (or the finding is boxed in the panel). */
  highlighted: boolean;
  /** element = box on the page, panel = the finding is boxed in the measurement panel only, view = no box could be drawn. */
  kind: 'element' | 'panel' | 'view';
}
