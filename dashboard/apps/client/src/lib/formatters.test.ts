/// <reference types="vitest" />
import { describe, it, expect, vi } from 'vitest';
import {
  formatDuration,
  formatElapsed,
  timeAgo,
  statusColor,
  statusBgColor,
  statusLabel,
  statusTextClass,
  statusBgClass,
  statusBorderClass,
  statusSolidBgClass,
  passRate,
  shortPath,
  fileName,
  shortSha,
  stripAnsi,
  tryParseJSON,
  greeting,
  formatDate,
} from './formatters';

describe('formatDuration', () => {
  it('returns — for null/undefined', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(30000)).toBe('30.0s');
  });

  it('formats minutes', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(300000)).toBe('5m 00s');
  });
});

describe('formatElapsed', () => {
  it('formats to MM:SS', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 120_000).toISOString();
    const result = formatElapsed(twoMinAgo);
    // Should be approximately "02:00" (±1s tolerance)
    expect(result).toMatch(/^0[12]:/);
  });
});

describe('timeAgo', () => {
  it('returns — for null', () => {
    expect(timeAgo(null)).toBe('—');
    expect(timeAgo(undefined)).toBe('—');
  });

  it('returns "just now" for recent times', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns "Xs ago" for seconds', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(thirtySecAgo)).toMatch(/^\d+s ago$/);
  });

  it('returns "Xm ago" for minutes', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
    expect(timeAgo(fiveMinAgo)).toMatch(/^\d+m ago$/);
  });

  it('returns "Xh ago" for hours', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
    expect(timeAgo(twoHoursAgo)).toMatch(/^\d+h ago$/);
  });

  it('returns "Xd ago" for days', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const twoDaysAgo = new Date(Date.now() - 172_800_000).toISOString();
    expect(timeAgo(twoDaysAgo)).toMatch(/^\d+d ago$/);
  });
});

describe('statusColor', () => {
  it('returns correct CSS var for each status', () => {
    expect(statusColor('passed')).toBe('var(--color-pass)');
    expect(statusColor('failed')).toBe('var(--color-fail)');
    expect(statusColor('flaky')).toBe('var(--color-flaky)');
    expect(statusColor('running')).toBe('var(--color-running)');
    expect(statusColor('skipped')).toBe('var(--color-skip)');
  });

  it('returns fallback for unknown status', () => {
    expect(statusColor('unknown')).toBe('var(--color-text-tertiary)');
  });
});

describe('statusBgColor', () => {
  it('returns background CSS var for each status', () => {
    expect(statusBgColor('passed')).toBe('var(--color-pass-bg)');
    expect(statusBgColor('failed')).toBe('var(--color-fail-bg)');
  });

  it('returns transparent for unknown', () => {
    expect(statusBgColor('unknown')).toBe('transparent');
  });
});

describe('statusTextClass', () => {
  it('returns correct Tailwind class for each status', () => {
    expect(statusTextClass('passed')).toBe('text-pass');
    expect(statusTextClass('failed')).toBe('text-fail');
    expect(statusTextClass('timedOut')).toBe('text-fail');
    expect(statusTextClass('flaky')).toBe('text-flaky');
    expect(statusTextClass('running')).toBe('text-running');
    expect(statusTextClass('skipped')).toBe('text-skip');
    expect(statusTextClass('queued')).toBe('text-queued');
  });

  it('returns fallback for unknown status', () => {
    expect(statusTextClass('unknown')).toBe('text-text-tertiary');
  });
});

describe('statusBgClass', () => {
  it('returns correct Tailwind bg class for each status', () => {
    expect(statusBgClass('passed')).toBe('bg-pass-bg');
    expect(statusBgClass('failed')).toBe('bg-fail-bg');
    expect(statusBgClass('flaky')).toBe('bg-flaky-bg');
  });

  it('returns transparent for unknown', () => {
    expect(statusBgClass('unknown')).toBe('bg-transparent');
  });
});

describe('statusBorderClass', () => {
  it('returns border class with opacity', () => {
    expect(statusBorderClass('passed')).toBe('border-pass/25');
    expect(statusBorderClass('failed')).toBe('border-fail/25');
  });

  it('returns transparent for unknown', () => {
    expect(statusBorderClass('unknown')).toBe('border-transparent');
  });
});

describe('statusSolidBgClass', () => {
  it('returns solid bg class for each status', () => {
    expect(statusSolidBgClass('passed')).toBe('bg-pass');
    expect(statusSolidBgClass('failed')).toBe('bg-fail');
    expect(statusSolidBgClass('running')).toBe('bg-running');
  });

  it('returns fallback for unknown', () => {
    expect(statusSolidBgClass('unknown')).toBe('bg-text-tertiary');
  });
});

describe('statusLabel', () => {
  it('returns human-readable labels', () => {
    expect(statusLabel('passed')).toBe('Passed');
    expect(statusLabel('failed')).toBe('Failed');
    expect(statusLabel('timedOut')).toBe('Timed out');
    expect(statusLabel('interrupted')).toBe('Aborted');
  });

  it('returns raw status for unknown', () => {
    expect(statusLabel('custom')).toBe('custom');
  });
});

describe('passRate', () => {
  it('returns — for zero total', () => {
    expect(passRate(0, 0)).toBe('—');
  });

  it('calculates percentage', () => {
    expect(passRate(90, 100)).toBe('90.0%');
    expect(passRate(47, 50)).toBe('94.0%');
  });
});

describe('shortPath', () => {
  it('returns last 2 segments', () => {
    expect(shortPath('src/tests/login.spec.ts')).toBe('tests/login.spec.ts');
  });

  it('handles backslashes', () => {
    expect(shortPath('src\\tests\\login.spec.ts')).toBe('tests/login.spec.ts');
  });
});

describe('fileName', () => {
  it('extracts filename', () => {
    expect(fileName('src/tests/login.spec.ts')).toBe('login.spec.ts');
  });

  it('returns original string when no slash found', () => {
    expect(fileName('login.spec.ts')).toBe('login.spec.ts');
  });
});

describe('shortSha', () => {
  it('returns — for null', () => {
    expect(shortSha(null)).toBe('—');
    expect(shortSha(undefined)).toBe('—');
  });

  it('returns first 7 chars', () => {
    expect(shortSha('abc1234567890')).toBe('abc1234');
  });

  it('supports custom length', () => {
    expect(shortSha('abc1234567890', 4)).toBe('abc1');
  });
});

describe('stripAnsi', () => {
  it('strips ANSI escape codes', () => {
    expect(stripAnsi('\x1b[32mPassed\x1b[0m')).toBe('Passed');
  });

  it('returns clean string unchanged', () => {
    expect(stripAnsi('Hello world')).toBe('Hello world');
  });
});

describe('tryParseJSON', () => {
  it('parses valid JSON', () => {
    expect(tryParseJSON('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns fallback for invalid JSON', () => {
    expect(tryParseJSON('not json', [])).toEqual([]);
  });

  it('returns fallback for null', () => {
    expect(tryParseJSON(null, 'default')).toBe('default');
  });
});

describe('greeting', () => {
  it('returns a greeting string', () => {
    const result = greeting();
    expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(result);
  });

  it('returns Good morning before noon', () => {
    vi.useFakeTimers();
    // eslint-disable-next-line test-flakiness/no-random-data
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    vi.setSystemTime(d);
    expect(greeting()).toBe('Good morning');
    vi.useRealTimers();
  });

  it('returns Good afternoon between noon and 6pm', () => {
    vi.useFakeTimers();
    // Use a Date where local getHours() === 14 regardless of timezone
    // eslint-disable-next-line test-flakiness/no-random-data
    const d = new Date();
    d.setHours(14, 0, 0, 0);
    vi.setSystemTime(d);
    expect(greeting()).toBe('Good afternoon');
    vi.useRealTimers();
  });

  it('returns Good evening at or after 6pm', () => {
    vi.useFakeTimers();
    // eslint-disable-next-line test-flakiness/no-random-data
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    vi.setSystemTime(d);
    expect(greeting()).toBe('Good evening');
    vi.useRealTimers();
  });
});

describe('formatDate', () => {
  it('returns — for null/undefined', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('formats an ISO date string as localized date', () => {
    const result = formatDate('2026-03-27T10:30:00.000Z');
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/27/);
  });

  it('includes time in formatted output', () => {
    const result = formatDate('2026-01-15T14:30:00.000Z');
    // Should include AM/PM
    expect(result).toMatch(/AM|PM/);
  });
});


describe('formatDuration', () => {
  it('returns — for null/undefined', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(30000)).toBe('30.0s');
  });

  it('formats minutes', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(300000)).toBe('5m 00s');
  });
});

describe('formatElapsed', () => {
  it('formats to MM:SS', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 120_000).toISOString();
    const result = formatElapsed(twoMinAgo);
    // Should be approximately "02:00" (±1s tolerance)
    expect(result).toMatch(/^0[12]:/);
  });
});

describe('timeAgo', () => {
  it('returns — for null', () => {
    expect(timeAgo(null)).toBe('—');
    expect(timeAgo(undefined)).toBe('—');
  });

  it('returns "just now" for recent times', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns "Xs ago" for seconds', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(thirtySecAgo)).toMatch(/^\d+s ago$/);
  });

  it('returns "Xm ago" for minutes', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
    expect(timeAgo(fiveMinAgo)).toMatch(/^\d+m ago$/);
  });
});

describe('statusColor', () => {
  it('returns correct CSS var for each status', () => {
    expect(statusColor('passed')).toBe('var(--color-pass)');
    expect(statusColor('failed')).toBe('var(--color-fail)');
    expect(statusColor('flaky')).toBe('var(--color-flaky)');
    expect(statusColor('running')).toBe('var(--color-running)');
    expect(statusColor('skipped')).toBe('var(--color-skip)');
  });

  it('returns fallback for unknown status', () => {
    expect(statusColor('unknown')).toBe('var(--color-text-tertiary)');
  });
});

describe('statusBgColor', () => {
  it('returns background CSS var for each status', () => {
    expect(statusBgColor('passed')).toBe('var(--color-pass-bg)');
    expect(statusBgColor('failed')).toBe('var(--color-fail-bg)');
  });

  it('returns transparent for unknown', () => {
    expect(statusBgColor('unknown')).toBe('transparent');
  });
});

describe('statusTextClass', () => {
  it('returns correct Tailwind class for each status', () => {
    expect(statusTextClass('passed')).toBe('text-pass');
    expect(statusTextClass('failed')).toBe('text-fail');
    expect(statusTextClass('timedOut')).toBe('text-fail');
    expect(statusTextClass('flaky')).toBe('text-flaky');
    expect(statusTextClass('running')).toBe('text-running');
    expect(statusTextClass('skipped')).toBe('text-skip');
    expect(statusTextClass('queued')).toBe('text-queued');
  });

  it('returns fallback for unknown status', () => {
    expect(statusTextClass('unknown')).toBe('text-text-tertiary');
  });
});

describe('statusBgClass', () => {
  it('returns correct Tailwind bg class for each status', () => {
    expect(statusBgClass('passed')).toBe('bg-pass-bg');
    expect(statusBgClass('failed')).toBe('bg-fail-bg');
    expect(statusBgClass('flaky')).toBe('bg-flaky-bg');
  });

  it('returns transparent for unknown', () => {
    expect(statusBgClass('unknown')).toBe('bg-transparent');
  });
});

describe('statusBorderClass', () => {
  it('returns border class with opacity', () => {
    expect(statusBorderClass('passed')).toBe('border-pass/25');
    expect(statusBorderClass('failed')).toBe('border-fail/25');
  });

  it('returns transparent for unknown', () => {
    expect(statusBorderClass('unknown')).toBe('border-transparent');
  });
});

describe('statusSolidBgClass', () => {
  it('returns solid bg class for each status', () => {
    expect(statusSolidBgClass('passed')).toBe('bg-pass');
    expect(statusSolidBgClass('failed')).toBe('bg-fail');
    expect(statusSolidBgClass('running')).toBe('bg-running');
  });

  it('returns fallback for unknown', () => {
    expect(statusSolidBgClass('unknown')).toBe('bg-text-tertiary');
  });
});

describe('statusLabel', () => {
  it('returns human-readable labels', () => {
    expect(statusLabel('passed')).toBe('Passed');
    expect(statusLabel('failed')).toBe('Failed');
    expect(statusLabel('timedOut')).toBe('Timed out');
    expect(statusLabel('interrupted')).toBe('Aborted');
  });

  it('returns raw status for unknown', () => {
    expect(statusLabel('custom')).toBe('custom');
  });
});

describe('passRate', () => {
  it('returns — for zero total', () => {
    expect(passRate(0, 0)).toBe('—');
  });

  it('calculates percentage', () => {
    expect(passRate(90, 100)).toBe('90.0%');
    expect(passRate(47, 50)).toBe('94.0%');
  });
});

describe('shortPath', () => {
  it('returns last 2 segments', () => {
    expect(shortPath('src/tests/login.spec.ts')).toBe('tests/login.spec.ts');
  });

  it('handles backslashes', () => {
    expect(shortPath('src\\tests\\login.spec.ts')).toBe('tests/login.spec.ts');
  });
});

describe('fileName', () => {
  it('extracts filename', () => {
    expect(fileName('src/tests/login.spec.ts')).toBe('login.spec.ts');
  });
});

describe('shortSha', () => {
  it('returns — for null', () => {
    expect(shortSha(null)).toBe('—');
    expect(shortSha(undefined)).toBe('—');
  });

  it('returns first 7 chars', () => {
    expect(shortSha('abc1234567890')).toBe('abc1234');
  });

  it('supports custom length', () => {
    expect(shortSha('abc1234567890', 4)).toBe('abc1');
  });
});

describe('stripAnsi', () => {
  it('strips ANSI escape codes', () => {
    expect(stripAnsi('\x1b[32mPassed\x1b[0m')).toBe('Passed');
  });

  it('returns clean string unchanged', () => {
    expect(stripAnsi('Hello world')).toBe('Hello world');
  });
});

describe('tryParseJSON', () => {
  it('parses valid JSON', () => {
    expect(tryParseJSON('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('returns fallback for invalid JSON', () => {
    expect(tryParseJSON('not json', [])).toEqual([]);
  });

  it('returns fallback for null', () => {
    expect(tryParseJSON(null, 'default')).toBe('default');
  });
});

describe('greeting', () => {
  it('returns a greeting string', () => {
    const result = greeting();
    expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(result);
  });
});
