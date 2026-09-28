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
  it('produces the same string toLocaleString produced', () => {
    const value = '2026-09-25T10:30:00.000Z';
    expect(formatDate(value, 'Not started')).toBe(new Date(value).toLocaleString());
  });

  it.each([null, undefined, ''])('returns the caller’s fallback for %p', (value) => {
    expect(formatDate(value, 'Not started')).toBe('Not started');
  });

  it('forwards the fallback rather than hardcoding one, so two screens keep two claims', () => {
    // The assertion that stops a "fixed" dedupe from quietly turning run-detail's
    // 'UNKNOWN' into 'Not started'.
    expect(formatDate(null, 'Not started')).toBe('Not started');
    expect(formatDate(null, 'UNKNOWN')).toBe('UNKNOWN');
    expect(formatDate(undefined, 'UNKNOWN')).toBe('UNKNOWN');
  });
});
