const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parse the date styles seen on Indian government sites. Numeric dates are read day-first (DD-MM-YYYY). */
export function parseDate(raw: string): Date | null {
  const s = raw.trim().replace(/(\d)(st|nd|rd|th)\b/i, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return mk(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
  if (m) return mk(+m[3], +m[2] - 1, +m[1]);
  m = /^(\d{1,2}) ([a-z]{3})[a-z]*\.? (\d{4})$/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] != null) return mk(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^([a-z]{3})[a-z]*\.? (\d{1,2}) (\d{4})$/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase()] != null) return mk(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

function mk(y: number, mo: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo && dt.getUTCDate() === d ? dt : null;
}

export const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

/** First date in free text, or null. */
export function firstDate(text: string): Date | null {
  const re = /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/g;
  for (const m of text.matchAll(re)) { const d = parseDate(m[1]); if (d) return d; }
  return null;
}
