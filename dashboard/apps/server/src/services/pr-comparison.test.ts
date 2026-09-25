/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockQuery,
  mockPrepare,
  mockAll,
  mockLimit,
  mockOrderBy,
  mockWhere,
  mockInnerJoin,
  mockFrom,
  mockSelect,
} = vi.hoisted(() => {
  const _mockQuery = vi.fn();
  const _mockAll = vi.fn();
  const _mockPrepare = vi.fn(() => ({ all: _mockAll }));
  const _mockLimit = vi.fn().mockResolvedValue([]);
  const _mockOrderBy = vi.fn(() => ({ limit: _mockLimit }));
  const _mockWhere = vi.fn(() => ({ orderBy: _mockOrderBy }));
  const _mockInnerJoin = vi.fn(() => ({ where: _mockWhere }));
  const _mockFrom = vi.fn(() => ({ where: _mockWhere, innerJoin: _mockInnerJoin }));
  const _mockSelect = vi.fn(() => ({ from: _mockFrom }));

  return {
    mockQuery: _mockQuery,
    mockPrepare: _mockPrepare,
    mockAll: _mockAll,
    mockLimit: _mockLimit,
    mockOrderBy: _mockOrderBy,
    mockWhere: _mockWhere,
    mockInnerJoin: _mockInnerJoin,
    mockFrom: _mockFrom,
    mockSelect: _mockSelect,
  };
});


vi.mock('../db/client.js', () => ({
  db: {
    select: mockSelect,
  },
  poolConnection: {
    query: mockQuery,
  },
}));

import { compareRunToBase, resolveBaseRun } from './pr-comparison.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrepare.mockReturnValue({ all: mockAll });

  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockFrom.mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin });
  mockSelect.mockReturnValue({ from: mockFrom });
});

describe('compareRunToBase', () => {
  it('should identify new failures', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ stable_id: 's-1', title: 'test one', file: 'a.spec.ts', status: 'failed' }],
      })
      .mockResolvedValueOnce({
        rows: [{ stable_id: 's-1', title: 'test one', file: 'a.spec.ts', status: 'passed' }],
      });

    mockWhere.mockResolvedValue([
      { stableId: 's-1', title: 'test one', file: 'a.spec.ts', errorMessage: 'boom' },
    ]);

    const result = await compareRunToBase('pr-run', 'base-run');

    expect(result.newFailures).toEqual([
      { stableId: 's-1', title: 'test one', file: 'a.spec.ts', error: 'boom' },
    ]);
    expect(result.fixedTests).toEqual([]);
    expect(result.newTests).toEqual([]);
  });

  it('should identify fixed tests', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ stable_id: 's-2', title: 'test two', file: 'b.spec.ts', status: 'passed' }],
      })
      .mockResolvedValueOnce({
        rows: [{ stable_id: 's-2', title: 'test two', file: 'b.spec.ts', status: 'failed' }],
      });

    const result = await compareRunToBase('pr-run', 'base-run');

    expect(result.newFailures).toEqual([]);
    expect(result.fixedTests).toEqual([
      { stableId: 's-2', title: 'test two', file: 'b.spec.ts' },
    ]);
    expect(result.newTests).toEqual([]);
  });

  it('should ignore tests that already fail on base', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ stable_id: 's-3', title: 'test three', file: 'c.spec.ts', status: 'failed' }],
      })
      .mockResolvedValueOnce({
        rows: [{ stable_id: 's-3', title: 'test three', file: 'c.spec.ts', status: 'failed' }],
      });

    const result = await compareRunToBase('pr-run', 'base-run');

    expect(result.newFailures).toEqual([]);
    expect(result.fixedTests).toEqual([]);
  });

  it('should identify new tests', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ stable_id: 's-3', title: 'test three', file: 'c.spec.ts', status: 'passed' }],
      })
      .mockResolvedValueOnce({ rows: [] });


    const result = await compareRunToBase('pr-run', 'base-run');

    expect(result.newTests).toEqual([
      { stableId: 's-3', title: 'test three', file: 'c.spec.ts', status: 'passed' },
    ]);
    expect(result.newFailures).toEqual([]);
    expect(result.fixedTests).toEqual([]);
  });

  it('should return correct summary counts', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { stable_id: 's-1', title: 'new failure', file: 'a.spec.ts', status: 'failed' },
          { stable_id: 's-2', title: 'fixed', file: 'b.spec.ts', status: 'passed' },
          { stable_id: 's-3', title: 'new test', file: 'c.spec.ts', status: 'skipped' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { stable_id: 's-1', title: 'new failure', file: 'a.spec.ts', status: 'passed' },
          { stable_id: 's-2', title: 'fixed', file: 'b.spec.ts', status: 'failed' },
        ],
      });

    mockWhere.mockResolvedValue([
      { stableId: 's-1', title: 'new failure', file: 'a.spec.ts', errorMessage: 'regressed' },
    ]);

    const result = await compareRunToBase('pr-run', 'base-run');

    expect(result.summary).toEqual({
      totalPrTests: 3,
      totalBaseTests: 2,
      newFailureCount: 1,
      fixedCount: 1,
      newTestCount: 1,
    });
  });
});

describe('resolveBaseRun', () => {
  it('resolveBaseRun should return null when no matching run exists', async () => {
    mockLimit.mockResolvedValue([]);

    const runId = await resolveBaseRun('main');

    expect(runId).toBeNull();
  });
});
