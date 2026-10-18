import type { Locale } from './messages.ts';

/** A complete calendar timestamp with an explicit zone; never Date.parse's loose forms. */
export function strictTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, min, sec, , , oh, om] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
    && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59
    && (!oh || Number(oh) <= 23 && Number(om) <= 59) && Number.isFinite(Date.parse(value));
}
export function formattedTimestamp(value: string, locale: Locale, timeZone = 'UTC'): string | null {
  if (!strictTimestamp(value)) return null;
  try {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
    return `${date} (${timeZone})`;
  } catch { return null; }
}
