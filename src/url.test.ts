import { describe, expect, it } from 'vitest';
import { classify, normalizeUrl, sameSite } from './url.js';

describe('url helpers', () => {
  it('normalises hash and trailing slash', () => {
    expect(normalizeUrl('/about/#team', 'https://x.gov.in/')).toBe('https://x.gov.in/about');
  });
  it('rejects non-http schemes', () => {
    expect(normalizeUrl('mailto:a@b.in')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
  });
  it('treats www and bare host as same site', () => {
    expect(sameSite('https://www.x.gov.in/a', 'https://x.gov.in/')).toBe(true);
    expect(sameSite('https://y.gov.in/', 'https://x.gov.in/')).toBe(false);
  });
  it('classifies documents as assets', () => {
    expect(classify('https://x.gov.in/a/report.PDF')).toBe('asset');
    expect(classify('https://x.gov.in/a/report')).toBe('page');
  });
});
