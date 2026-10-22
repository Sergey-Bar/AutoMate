import { describe, expect, it } from 'vitest';
import { nextOccurrence } from './schedule.js';

/**
 * Found by mutation testing: the validation bounds and the "strictly after" rule in
 * `nextOccurrence` had one example each, so every `<` / `<=` / `>` / `>=` on them
 * survived. A scheduler that is off by one at midnight or at minute 59 is the kind of
 * defect that runs a job a day late, once a day, for a year.
 */
const FROM = new Date('2026-09-25T00:00:00.000Z');

describe('nextOccurrence validation bounds', () => {
  it.each([0, 59])('accepts minute %i', (minute) => {
    expect(nextOccurrence({ minute, hour: 5 }, FROM)).toBeInstanceOf(Date);
  });

  it.each([-1, 60, 1.5, Number.NaN])('rejects minute %s with the minute message', (minute) => {
    expect(() => nextOccurrence({ minute, hour: 5 }, FROM)).toThrow('Invalid minute');
  });

  it.each([0, 23])('accepts hour %i', (hour) => {
    expect(nextOccurrence({ minute: 5, hour }, FROM)).toBeInstanceOf(Date);
  });

  it.each([-1, 24, 1.5, Number.NaN])('rejects hour %s with the hour message', (hour) => {
    expect(() => nextOccurrence({ minute: 5, hour }, FROM)).toThrow('Invalid hour');
  });

  it('rejects a wildcard hour combined with a fixed minute', () => {
    expect(() => nextOccurrence({ minute: 5, hour: '*' }, FROM)).toThrow('Invalid hour');
  });
});

describe('nextOccurrence arithmetic', () => {
  it('moves a fixed time to the next day when the clock is exactly on it', () => {
    // `next <= from` survived as `next < from`: standing on the occurrence returned the
    // occurrence itself, so a job that had just fired was scheduled to fire again now.
    const on = new Date('2026-09-25T02:30:00.000Z');
    expect(nextOccurrence({ minute: 30, hour: 2 }, on)?.toISOString()).toBe(
      '2026-09-26T02:30:00.000Z',
    );
    expect(
      nextOccurrence({ minute: 30, hour: 2 }, new Date('2026-09-25T02:29:59.999Z'))?.toISOString(),
    ).toBe('2026-09-25T02:30:00.000Z');
  });

  it.each(['*', 'step'] as const)(
    'a %s minute is the interval ahead, with seconds and milliseconds cleared',
    (minute) => {
      const from = new Date('2026-09-25T00:00:30.500Z');
      expect(nextOccurrence({ minute, hour: '*' }, from)?.toISOString()).toBe(
        '2026-09-25T00:01:00.000Z',
      );
      expect(nextOccurrence({ minute, hour: '*' }, from, 10)?.toISOString()).toBe(
        '2026-09-25T00:10:00.000Z',
      );
    },
  );

  it('clears seconds and milliseconds from a fixed time too', () => {
    const from = new Date('2026-09-25T00:00:30.500Z');
    expect(nextOccurrence({ minute: 5, hour: 3 }, from)?.toISOString()).toBe(
      '2026-09-25T03:05:00.000Z',
    );
  });
});
