import { describe, it, expect } from 'vitest';
import { groupRecentStatuses } from '../tests-history.js';
import type { TestHistoryRow } from '../tests-history.js';

describe('groupRecentStatuses', () => {
  it('returns empty object for empty array', () => {
    const result = groupRecentStatuses([]);
    expect(result).toEqual({});
  });

  it('groups single stableId with one result', () => {
    const rows: TestHistoryRow[] = [{ stableId: 'test-1', status: 'passed' }];

    const result = groupRecentStatuses(rows);

    expect(result).toEqual({
      'test-1': [{ status: 'passed' }],
    });
  });

  it('groups single stableId with multiple results under limit', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: 'passed' },
      { stableId: 'test-1', status: 'failed' },
      { stableId: 'test-1', status: 'passed' },
    ];

    const result = groupRecentStatuses(rows);

    expect(result).toEqual({
      'test-1': [{ status: 'passed' }, { status: 'failed' }, { status: 'passed' }],
    });
  });

  it('truncates to default limit of 7 per stableId', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: '1' },
      { stableId: 'test-1', status: '2' },
      { stableId: 'test-1', status: '3' },
      { stableId: 'test-1', status: '4' },
      { stableId: 'test-1', status: '5' },
      { stableId: 'test-1', status: '6' },
      { stableId: 'test-1', status: '7' },
      { stableId: 'test-1', status: '8' }, // Should be excluded
      { stableId: 'test-1', status: '9' }, // Should be excluded
    ];

    const result = groupRecentStatuses(rows);

    expect(result['test-1']).toHaveLength(7);
    expect(result['test-1']).toEqual([
      { status: '1' },
      { status: '2' },
      { status: '3' },
      { status: '4' },
      { status: '5' },
      { status: '6' },
      { status: '7' },
    ]);
  });

  it('respects custom limit parameter', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: '1' },
      { stableId: 'test-1', status: '2' },
      { stableId: 'test-1', status: '3' },
      { stableId: 'test-1', status: '4' },
      { stableId: 'test-1', status: '5' },
    ];

    const result = groupRecentStatuses(rows, 3);

    expect(result['test-1']).toHaveLength(3);
    expect(result['test-1']).toEqual([{ status: '1' }, { status: '2' }, { status: '3' }]);
  });

  it('groups multiple stableIds independently', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: 'passed' },
      { stableId: 'test-2', status: 'failed' },
      { stableId: 'test-1', status: 'failed' },
      { stableId: 'test-3', status: 'skipped' },
      { stableId: 'test-2', status: 'passed' },
    ];

    const result = groupRecentStatuses(rows);

    expect(result).toEqual({
      'test-1': [{ status: 'passed' }, { status: 'failed' }],
      'test-2': [{ status: 'failed' }, { status: 'passed' }],
      'test-3': [{ status: 'skipped' }],
    });
  });

  it('applies limit independently per stableId', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: '1-1' },
      { stableId: 'test-1', status: '1-2' },
      { stableId: 'test-1', status: '1-3' }, // test-1 hits limit
      { stableId: 'test-2', status: '2-1' },
      { stableId: 'test-2', status: '2-2' },
      { stableId: 'test-1', status: '1-4' }, // Should be excluded (test-1 over limit)
      { stableId: 'test-2', status: '2-3' }, // test-2 hits limit
      { stableId: 'test-2', status: '2-4' }, // Should be excluded (test-2 over limit)
    ];

    const result = groupRecentStatuses(rows, 3);

    expect(result['test-1']).toHaveLength(3);
    expect(result['test-1']).toEqual([{ status: '1-1' }, { status: '1-2' }, { status: '1-3' }]);

    expect(result['test-2']).toHaveLength(3);
    expect(result['test-2']).toEqual([{ status: '2-1' }, { status: '2-2' }, { status: '2-3' }]);
  });

  it('handles limit of 0 (returns empty arrays)', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: 'passed' },
      { stableId: 'test-2', status: 'failed' },
    ];

    const result = groupRecentStatuses(rows, 0);

    expect(result).toEqual({
      'test-1': [],
      'test-2': [],
    });
  });

  it('handles limit of 1', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: 'first' },
      { stableId: 'test-1', status: 'second' },
      { stableId: 'test-1', status: 'third' },
    ];

    const result = groupRecentStatuses(rows, 1);

    expect(result).toEqual({
      'test-1': [{ status: 'first' }],
    });
  });

  it('preserves status values exactly as provided', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test-1', status: 'passed' },
      { stableId: 'test-1', status: 'failed' },
      { stableId: 'test-1', status: 'skipped' },
      { stableId: 'test-1', status: 'timedOut' },
      { stableId: 'test-1', status: 'interrupted' },
    ];

    const result = groupRecentStatuses(rows);

    expect(result['test-1']).toEqual([
      { status: 'passed' },
      { status: 'failed' },
      { status: 'skipped' },
      { status: 'timedOut' },
      { status: 'interrupted' },
    ]);
  });

  it('handles stableIds with special characters', () => {
    const rows: TestHistoryRow[] = [
      { stableId: 'test/with/slashes', status: 'passed' },
      { stableId: 'test-with-dashes', status: 'failed' },
      { stableId: 'test.with.dots', status: 'skipped' },
      { stableId: 'test with spaces', status: 'passed' },
    ];

    const result = groupRecentStatuses(rows);

    expect(result).toHaveProperty('test/with/slashes');
    expect(result).toHaveProperty('test-with-dashes');
    expect(result).toHaveProperty('test.with.dots');
    expect(result).toHaveProperty('test with spaces');
  });

  it('handles large dataset efficiently', () => {
    const rows: TestHistoryRow[] = [];

    // Generate 1000 tests with 20 results each (20,000 rows total)
    for (let i = 0; i < 1000; i++) {
      for (let j = 0; j < 20; j++) {
        rows.push({ stableId: `test-${i}`, status: j % 2 === 0 ? 'passed' : 'failed' });
      }
    }

    const result = groupRecentStatuses(rows, 7);

    // Verify all tests present
    expect(Object.keys(result)).toHaveLength(1000);

    // Verify each test limited to 7
    for (let i = 0; i < 1000; i++) {
      expect(result[`test-${i}`]).toHaveLength(7);
    }
  });
});
