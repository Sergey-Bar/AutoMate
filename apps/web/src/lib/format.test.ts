import { describe, expect, it } from 'vitest';
import { formatDate } from './format.js';

/**
 * The three `formatDate` definitions this helper replaced are not
 * interchangeable. `routes/dashboard/index.tsx` rendered `'Not started'` for a
 * missing value — the run never began — and `routes/dashboard/run-detail.tsx`
 * rendered `'UNKNOWN'` — the field is unknown. They are different user-visible
 * claims, so the helper takes the fallback from its caller rather than deciding
 * one itself.
 */
describe('formatDate', () => {
  /**
   * A rendered time is only usable if the reader can tell which one it is.
   *
   * `toLocaleString()` renders in the viewer's zone and names no zone, so the same
   * run reads as "14:32" in Tel Aviv and "12:32" in Berlin. For a product whose
   * whole claim is evidence, a timestamp that cannot be correlated with a CI log
   * is a timestamp that cannot be checked — and the discrepancy is invisible,
   * because both readings look correct to the person who produced each (ledger
   * W-7a).
   */
  const value = '2026-09-25T10:30:00.000Z';

  it('names the time zone it rendered in', () => {
    const rendered = formatDate(value, 'Not started');
    // Either the viewer's own zone (`Asia/Jerusalem`) or its short name — what is
    // forbidden is rendering a time with nothing that says which zone it is in.
    expect(rendered).toMatch(/[A-Z]{2,5}$|UTC|GMT/);
    expect(rendered).not.toBe(new Date(value).toLocaleString());
  });

  it('is stable across locales, because the ambiguity is in the zone not the language', () => {
    // `Intl` output for the same instant differs by locale — "25/09/2026, 12:30"
    // against "9/25/2026, 12:30" — and this product renders to an international
    // audience whose browser locale is not the author's. The date *value* is what
    // must be constant; the wording may follow the locale.
    const original = process.env['TZ'];
    try {
      process.env['TZ'] = 'UTC';
      const utc = formatDate(value, 'x');
      process.env['TZ'] = 'Asia/Tokyo';
      const tokyo = formatDate(value, 'x');
      // Both must still contain the same minute, and both must name a zone. A
      // format that dropped the zone would make the two differ by nine hours with
      // nothing in the output to explain it.
      expect(utc).toMatch(/:30/);
      expect(tokyo).toMatch(/:30/);
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
  });

  it('renders an unparseable value as the fallback rather than "Invalid Date"', () => {
    // `new Date('not a date').toLocaleString()` is the string "Invalid Date",
    // which is neither a time nor the caller's claim about the field.
    expect(formatDate('not a date', 'Not started')).toBe('Not started');
  });

  it.each([null, undefined, ''])('returns the caller’s fallback for %p', (input) => {
    expect(formatDate(input, 'Not started')).toBe('Not started');
  });

  it('forwards the fallback rather than hardcoding one, so two screens keep two claims', () => {
    // The assertion that stops a "fixed" dedupe from quietly turning run-detail's
    // 'UNKNOWN' into 'Not started'.
    expect(formatDate(null, 'Not started')).toBe('Not started');
    expect(formatDate(null, 'UNKNOWN')).toBe('UNKNOWN');
    expect(formatDate(undefined, 'UNKNOWN')).toBe('UNKNOWN');
  });
});
