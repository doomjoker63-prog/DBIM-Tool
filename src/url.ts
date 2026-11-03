const SKIP_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|csv|xml|json|jpe?g|png|gif|webp|svg|ico|mp4|mp3|avi|mov|woff2?|ttf|css|js)$/i;

/** Normalise for de-duplication: drop hash, trailing slash and default ports; keep query. */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.replace(/^www\./, '');
  return strip(new URL(a).hostname) === strip(new URL(b).hostname);
}

export type LinkKind = 'page' | 'asset';

/** Documents and media are recorded (needed for PDF/image checks) but not opened as pages. */
export function classify(url: string): LinkKind {
  return SKIP_EXT.test(new URL(url).pathname) ? 'asset' : 'page';
}

export function slugFor(url: string): string {
  const u = new URL(url);
  const s = (u.hostname + u.pathname + u.search).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || 'home').slice(0, 120);
}
