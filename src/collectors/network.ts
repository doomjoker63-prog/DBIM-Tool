import type { Page } from 'playwright';
import { fetchAllowed } from '../net-guard.js';

export interface Resource {
  url: string;
  type: string;
  status: number;
  contentType: string | null;
  /** Bytes of the response body as sent (compressed size if the server compresses). */
  bytes: number | null;
  /** Where the size came from. */
  sizeSource: 'transfer' | 'content-length' | 'head' | null;
}

/** Start recording every response; call stop() after the page has settled. */
export function recordNetwork(page: Page, scopeHost?: string) {
  const list: Resource[] = [];
  const pending: Promise<void>[] = [];
  const onResponse = (res: import('playwright').Response) => {
    const h = res.headers();
    const r: Resource = { url: res.url(), type: res.request().resourceType(), status: res.status(), contentType: h['content-type'] ?? null, bytes: null, sizeSource: null };
    list.push(r);
    pending.push(
      (async () => {
        try {
          const s = await res.request().sizes();
          if (s.responseBodySize > 0) {
            r.bytes = s.responseBodySize;
            r.sizeSource = 'transfer';
          }
        } catch {
          /* request may be gone */
        }
        if (r.bytes == null && h['content-length']) {
          r.bytes = Number(h['content-length']);
          r.sizeSource = 'content-length';
        }
      })(),
    );
  };
  page.on('response', onResponse);
  let stopped: Resource[] | null = null;
  return {
    /** Snapshot of the responses so far (sizes may still be filling in). */
    peek: (): Resource[] => list,
    async stop(): Promise<Resource[]> {
      if (stopped) return stopped;
      page.off('response', onResponse);
      await Promise.allSettled(pending);
      // For images/media/fonts without a size, ask the server directly.
      for (const r of list) {
        if (r.bytes == null && ['image', 'media', 'font'].includes(r.type) && /^https?:/.test(r.url) && fetchAllowed(r.url, scopeHost ?? new URL(page.url() === 'about:blank' ? r.url : page.url()).hostname)) {
          try {
            const h = await fetch(r.url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
            const l = h.headers.get('content-length');
            if (l) {
              r.bytes = Number(l);
              r.sizeSource = 'head';
            }
          } catch {
            /* leave null */
          }
        }
      }
      stopped = list;
      return list;
    },
  };
}
