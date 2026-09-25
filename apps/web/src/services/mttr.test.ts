import { describe, it, expect } from 'vitest';
import { calculateMTTR, formatMttr } from './mttr.js';
import type { RunRecord } from './mttr.js';

describe('calculateMTTR', () => {
  it('returns zero for empty runs', () => {
    const result = calculateMTTR([]);
    expect(result.avgRecoveryMs).toBe(0);
    expect(result.recoveryCount).toBe(0);
  });

  it('returns zero when all runs pass (no failures)', () => {
    const runs: RunRecord[] = [
      { timestamp: 1000, status: 'passed' },
      { timestamp: 2000, status: 'passed' },
    ];
    const result = calculateMTTR(runs);
    expect(result.avgRecoveryMs).toBe(0);
    expect(result.recoveryCount).toBe(0);
  });

  it('returns zero when all runs fail (no recovery)', () => {
    const runs: RunRecord[] = [
      { timestamp: 1000, status: 'failed' },
      { timestamp: 2000, status: 'failed' },
    ];
    const result = calculateMTTR(runs);
    expect(result.avgRecoveryMs).toBe(0);
    expect(result.recoveryCount).toBe(0);
  });

  it('calculates single recovery correctly', () => {
    const runs: RunRecord[] = [
      { timestamp: 1000, status: 'passed' },
      { timestamp: 2000, status: 'failed' },
      { timestamp: 5000, status: 'passed' },
    ];
    const result = calculateMTTR(runs);
    expect(result.recoveryCount).toBe(1);
    expect(result.avgRecoveryMs).toBe(3000);
  });

  it('averages multiple recovery events', () => {
    const runs: RunRecord[] = [
      { timestamp: 0, status: 'failed' },
      { timestamp: 2000, status: 'passed' },   // recovery 1: 2000ms
      { timestamp: 3000, status: 'failed' },
      { timestamp: 7000, status: 'passed' },   // recovery 2: 4000ms
    ];
    const result = calculateMTTR(runs);
    expect(result.recoveryCount).toBe(2);
    expect(result.avgRecoveryMs).toBe(3000); // (2000 + 4000) / 2
  });

  it('uses first failure timestamp in a streak', () => {
    // fail at t=1000, fail again at t=2000, pass at t=4000
    // recovery should be measured from t=1000 (first failure)
    const runs: RunRecord[] = [
      { timestamp: 1000, status: 'failed' },
      { timestamp: 2000, status: 'failed' },
      { timestamp: 4000, status: 'passed' },
    ];
    const result = calculateMTTR(runs);
    expect(result.recoveryCount).toBe(1);
    expect(result.avgRecoveryMs).toBe(3000); // 4000 - 1000
  });

  it('accepts ISO string timestamps', () => {
    const runs: RunRecord[] = [
      { timestamp: '2024-01-01T00:00:00.000Z', status: 'failed' },
      { timestamp: '2024-01-01T01:00:00.000Z', status: 'passed' },
    ];
    const result = calculateMTTR(runs);
    expect(result.recoveryCount).toBe(1);
    expect(result.avgRecoveryMs).toBe(3600000); // 1 hour in ms
  });

  it('handles pass before any failure gracefully', () => {
    const runs: RunRecord[] = [
      { timestamp: 1000, status: 'passed' },
      { timestamp: 2000, status: 'failed' },
      { timestamp: 3000, status: 'passed' },
      { timestamp: 4000, status: 'passed' },
    ];
    const result = calculateMTTR(runs);
    expect(result.recoveryCount).toBe(1);
    expect(result.avgRecoveryMs).toBe(1000);
  });
});

describe('formatMttr', () => {
  it('returns N/A for 0', () => {
    expect(formatMttr(0)).toBe('N/A');
  });

  it('formats milliseconds', () => {
    expect(formatMttr(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatMttr(30000)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatMttr(120000)).toBe('2m');
  });

  it('formats hours', () => {
    expect(formatMttr(7200000)).toBe('2h');
  });
});
