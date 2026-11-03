import net from 'node:net';

/** True for loopback, private (RFC 1918), link-local, unique-local and cloud-metadata addresses, and for "localhost". */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v = net.isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === '::1' || h === '::' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('::ffff:');
  return false;
}

/**
 * The tool downloads images and probes file sizes using addresses taken from the audited page. A hostile page could point
 * those at internal services, so such requests are only made to private hosts when the audited site itself is that host.
 */
export function fetchAllowed(url: string, scopeHost: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (!isPrivateHost(u.hostname)) return true;
  return u.hostname.replace(/^www\./, '') === scopeHost.replace(/^www\./, '');
}
