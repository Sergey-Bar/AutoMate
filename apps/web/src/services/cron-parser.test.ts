/// <reference types="vitest/globals" />
import { parseCron, isValidCron } from './cron-parser.js';

describe('parseCron', () => {
  it('returns null for invalid expression (wrong field count)', () => {
    expect(parseCron('* * * *')).toBeNull();
    expect(parseCron('* * * * * *')).toBeNull();
    expect(parseCron('')).toBeNull();
  });

  it('returns null for invalid characters', () => {
    expect(parseCron('abc * * * *')).toBeNull();
  });

  it('converts every minute', () => {
    expect(parseCron('* * * * *')).toBe('Every minute');
  });

  it('converts step minutes', () => {
    expect(parseCron('*/5 * * * *')).toBe('Every 5 minutes');
    expect(parseCron('*/15 * * * *')).toBe('Every 15 minutes');
  });

  it('converts step hours', () => {
    expect(parseCron('0 */2 * * *')).toBe('Every 2 hours');
  });

  it('converts daily at specific time', () => {
    expect(parseCron('0 9 * * *')).toBe('Daily at 9:00 AM');
    expect(parseCron('30 14 * * *')).toBe('Daily at 2:30 PM');
    expect(parseCron('0 0 * * *')).toBe('Daily at 12:00 AM');
    expect(parseCron('0 12 * * *')).toBe('Daily at 12:00 PM');
  });

  it('converts weekday schedule', () => {
    expect(parseCron('0 9 * * 1-5')).toBe('Every weekday at 9:00 AM');
  });

  it('converts weekend schedule', () => {
    expect(parseCron('0 10 * * 0,6')).toBe('Every weekend at 10:00 AM');
  });

  it('converts specific day of week', () => {
    expect(parseCron('0 9 * * 1')).toBe('Every Monday at 9:00 AM');
    expect(parseCron('0 17 * * 5')).toBe('Every Friday at 5:00 PM');
  });

  it('converts multiple days of week', () => {
    expect(parseCron('0 9 * * 1,3,5')).toBe('Every Monday, Wednesday and Friday at 9:00 AM');
  });

  it('converts day-of-month schedule', () => {
    expect(parseCron('0 9 1 * *')).toBe('On the 1st at 9:00 AM');
    expect(parseCron('0 9 15 * *')).toBe('On the 15th at 9:00 AM');
    expect(parseCron('0 9 2 * *')).toBe('On the 2nd at 9:00 AM');
    expect(parseCron('0 9 3 * *')).toBe('On the 3rd at 9:00 AM');
  });

  it('converts month-restricted schedule', () => {
    expect(parseCron('0 9 * 1 *')).toBe('Daily in January at 9:00 AM');
    expect(parseCron('0 9 * 12 *')).toBe('Daily in December at 9:00 AM');
  });

  it('converts multiple months', () => {
    expect(parseCron('0 9 * 1,6 *')).toBe('Daily in January and June at 9:00 AM');
  });

  it('converts "on specific days" when both dom and dow are non-wildcard', () => {
    expect(parseCron('0 9 15 * 1')).toBe('On specific days at 9:00 AM');
  });

  it('handles non-numeric dom with wildcard dow (step dom)', () => {
    expect(parseCron('0 9 */2 * *')).toBe('On day */2 at 9:00 AM');
  });

  it('returns "every minute" suffix when minute and hour are both wildcards but month is set', () => {
    expect(parseCron('* * * 1 *')).toBe('Daily in January, every minute');
  });

  it('returns "every minute" when hour is wildcard but minute is specific', () => {
    expect(parseCron('0 * * * *')).toBe('Daily at every minute');
  });

  it('uses ordinalSuffix "th" for 11, 12, 13', () => {
    expect(parseCron('0 9 11 * *')).toBe('On the 11th at 9:00 AM');
    expect(parseCron('0 9 12 * *')).toBe('On the 12th at 9:00 AM');
    expect(parseCron('0 9 13 * *')).toBe('On the 13th at 9:00 AM');
  });

  it('uses ordinalSuffix "th" for numbers whose last digit is 4-9 or 0', () => {
    expect(parseCron('0 9 4 * *')).toBe('On the 4th at 9:00 AM');
    expect(parseCron('0 9 20 * *')).toBe('On the 20th at 9:00 AM');
  });

  it('converts a day-of-week range using parseRange (Monday through Wednesday)', () => {
    expect(parseCron('0 9 * * 1-3')).toBe('Every Monday through Wednesday at 9:00 AM');
  });

  it('converts a month range using parseRange (January through March)', () => {
    expect(parseCron('0 9 * 1-3 *')).toBe('Daily in January through March at 9:00 AM');
  });
});

describe('isValidCron', () => {
  it('returns true for valid expressions', () => {
    expect(isValidCron('* * * * *')).toBe(true);
    expect(isValidCron('0 9 * * 1-5')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
  });

  it('returns false for invalid expressions', () => {
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('* * * *')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});
