/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mocks are available when vi.mock factory runs (hoisted)
const { mockLimit, mockOrderBy, mockWhere, mockInnerJoin, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockLimit, mockOrderBy, mockWhere, mockInnerJoin, mockFrom, mockSelect };
});

vi.mock('../db/client.js', () => ({
  db: { select: mockSelect },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

import { computeStabilityGrade, computeStabilityGradesBatch } from './stability-grades.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
  mockSelect.mockReturnValue({ from: mockFrom });
});

describe('computeStabilityGrade', () => {
  // ── No data ───────────────────────────────────────────────────────────
  it('returns dash grade with 0 passRate when no data exists', async () => {
    mockLimit.mockResolvedValue([]);

    const result = await computeStabilityGrade('stable-1');
    expect(result).toEqual({ grade: '—', passRate: 0, totalRuns: 0 });
  });

  // ── 100% pass → A+ ───────────────────────────────────────────────────
  it('returns A+ grade for 100% pass rate', async () => {
    const rows = Array.from({ length: 10 }, () => ({ status: 'passed' }));
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('A+');
    expect(result.passRate).toBe(100);
    expect(result.totalRuns).toBe(10);
  });

  // ── 95% pass → A ──────────────────────────────────────────────────────
  it('returns A grade for 95% pass rate', async () => {
    const rows = [
      ...Array.from({ length: 19 }, () => ({ status: 'passed' })),
      { status: 'failed' },
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('A');
    expect(result.passRate).toBe(95);
    expect(result.totalRuns).toBe(20);
  });

  // ── 85% pass → B ──────────────────────────────────────────────────────
  it('returns B grade for 85% pass rate', async () => {
    const rows = [
      ...Array.from({ length: 17 }, () => ({ status: 'passed' })),
      ...Array.from({ length: 3 }, () => ({ status: 'failed' })),
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('B');
    expect(result.passRate).toBe(85);
    expect(result.totalRuns).toBe(20);
  });

  // ── 70% pass → C ──────────────────────────────────────────────────────
  it('returns C grade for 70% pass rate', async () => {
    const rows = [
      ...Array.from({ length: 7 }, () => ({ status: 'passed' })),
      ...Array.from({ length: 3 }, () => ({ status: 'failed' })),
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('C');
    expect(result.passRate).toBe(70);
    expect(result.totalRuns).toBe(10);
  });

  // ── 50% pass → D ──────────────────────────────────────────────────────
  it('returns D grade for 50% pass rate', async () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ({ status: 'passed' })),
      ...Array.from({ length: 5 }, () => ({ status: 'failed' })),
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('D');
    expect(result.passRate).toBe(50);
    expect(result.totalRuns).toBe(10);
  });

  // ── <50% pass → F ─────────────────────────────────────────────────────
  it('returns F grade for less than 50% pass rate', async () => {
    const rows = [
      ...Array.from({ length: 2 }, () => ({ status: 'passed' })),
      ...Array.from({ length: 8 }, () => ({ status: 'failed' })),
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('F');
    expect(result.passRate).toBe(20);
    expect(result.totalRuns).toBe(10);
  });

  // ── 0% pass → F ──────────────────────────────────────────────────────
  it('returns F grade for 0% pass rate', async () => {
    const rows = Array.from({ length: 5 }, () => ({ status: 'failed' }));
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('F');
    expect(result.passRate).toBe(0);
    expect(result.totalRuns).toBe(5);
  });

  // ── Custom lookback ───────────────────────────────────────────────────
  it('passes lookbackRuns to the limit call', async () => {
    mockLimit.mockResolvedValue([]);

    await computeStabilityGrade('stable-1', 50);
    expect(mockLimit).toHaveBeenCalledWith(50);
  });

  // ── Default lookback is 20 ────────────────────────────────────────────
  it('uses default lookbackRuns of 20', async () => {
    mockLimit.mockResolvedValue([]);

    await computeStabilityGrade('stable-1');
    expect(mockLimit).toHaveBeenCalledWith(20);
  });

  // ── passRate rounding ─────────────────────────────────────────────────
  it('rounds passRate to one decimal place', async () => {
    const rows = [
      ...Array.from({ length: 2 }, () => ({ status: 'passed' })),
      { status: 'failed' },
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await computeStabilityGrade('stable-1');
    // 2/3 = 66.666... → should round to 66.7
    expect(result.passRate).toBe(66.7);
  });

  // ── Single run passed ─────────────────────────────────────────────────
  it('handles single passing run correctly', async () => {
    mockLimit.mockResolvedValue([{ status: 'passed' }]);

    const result = await computeStabilityGrade('stable-1');
    expect(result.grade).toBe('A+');
    expect(result.passRate).toBe(100);
    expect(result.totalRuns).toBe(1);
  });
});

describe('computeStabilityGradesBatch', () => {
  it('returns empty object for empty stableIds array', async () => {
    const result = await computeStabilityGradesBatch([]);
    expect(result).toEqual({});
    // Should not even query the DB
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('computes grades for multiple stableIds in a single query', async () => {
    // The batch function chain ends at orderBy (no limit), so override mockOrderBy to resolve directly
    mockOrderBy.mockResolvedValueOnce([
      { stableId: 'a', status: 'passed', runStartedAt: '2025-03-03' },
      { stableId: 'a', status: 'passed', runStartedAt: '2025-03-02' },
      { stableId: 'a', status: 'failed', runStartedAt: '2025-03-01' },
      { stableId: 'b', status: 'failed', runStartedAt: '2025-03-03' },
      { stableId: 'b', status: 'failed', runStartedAt: '2025-03-02' },
    ]);

    const result = await computeStabilityGradesBatch(['a', 'b']);
    expect(result.a.grade).toBe('D'); // 2/3 = 66.7% → below 70 threshold
    expect(result.a.passRate).toBe(66.7);
    expect(result.a.totalRuns).toBe(3);
    expect(result.b.grade).toBe('F'); // 0/2 = 0%
    expect(result.b.passRate).toBe(0);
    expect(result.b.totalRuns).toBe(2);
  });

  it('returns dash grade for stableIds with no data', async () => {
    mockOrderBy.mockResolvedValueOnce([
      { stableId: 'a', status: 'passed', runStartedAt: '2025-03-03' },
    ]);

    const result = await computeStabilityGradesBatch(['a', 'missing']);
    expect(result.a.grade).toBe('A+');
    expect(result.missing).toEqual({ grade: '—', passRate: 0, totalRuns: 0 });
  });

  it('respects lookbackRuns limit per stableId', async () => {
    // Simulate 25 rows for one stableId — only first 20 (default lookback) should be used
    const rows = Array.from({ length: 25 }, (_, i) => ({
      stableId: 'x',
      status: i < 20 ? 'passed' : 'failed',
      runStartedAt: `2025-03-${String(25 - i).padStart(2, '0')}`,
    }));
    mockOrderBy.mockResolvedValueOnce(rows);

    const result = await computeStabilityGradesBatch(['x']);
    // Only the first 20 rows should be counted (all 'passed')
    expect(result.x.totalRuns).toBe(20);
    expect(result.x.passRate).toBe(100);
    expect(result.x.grade).toBe('A+');
  });
});
