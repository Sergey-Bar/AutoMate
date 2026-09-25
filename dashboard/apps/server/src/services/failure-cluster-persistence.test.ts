/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── DB mock ─────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  // SELECT chain
  const mockSelectWhere = vi.fn().mockResolvedValue([]);
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  // INSERT chain
  const mockInsertValues = vi.fn().mockResolvedValue({});
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  // UPDATE chain
  const mockUpdateWhere = vi.fn().mockResolvedValue({});
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  return {
    mockSelectWhere,
    mockSelectFrom,
    mockSelect,
    mockInsertValues,
    mockInsert,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
  };
});

vi.mock('../db/client.js', () => ({
  db: {
    select: mocks.mockSelect,
    insert: mocks.mockInsert,
    update: mocks.mockUpdate,
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

import { updateCrossRunClusters } from './failure-cluster-persistence.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockSelectWhere.mockResolvedValue([]);
  mocks.mockSelectFrom.mockReturnValue({ where: mocks.mockSelectWhere });
  mocks.mockSelect.mockReturnValue({ from: mocks.mockSelectFrom });
  mocks.mockInsertValues.mockResolvedValue({});
  mocks.mockInsert.mockReturnValue({ values: mocks.mockInsertValues });
  mocks.mockUpdateWhere.mockResolvedValue({});
  mocks.mockUpdateSet.mockReturnValue({ where: mocks.mockUpdateWhere });
  mocks.mockUpdate.mockReturnValue({ set: mocks.mockUpdateSet });
});

describe('updateCrossRunClusters', () => {
  it('does nothing when run has no failed results', async () => {
    // First select (getting failed results) returns empty
    mocks.mockSelectWhere.mockResolvedValueOnce([]);

    await updateCrossRunClusters('run-1');

    expect(mocks.mockInsert).not.toHaveBeenCalled();
    expect(mocks.mockUpdate).not.toHaveBeenCalled();
  });

  it('creates a new cluster for a new fingerprint', async () => {
    // Failed results for the run
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: 'abc123', errorMessage: 'TypeError: undefined' },
      ])
      // existing cluster lookup → not found
      .mockResolvedValueOnce([]);

    await updateCrossRunClusters('run-1');

    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
    expect(mocks.mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: 'abc123',
        clusterLabel: 'TypeError: undefined',
        firstSeenRunId: 'run-1',
        lastSeenRunId: 'run-1',
        occurrenceCount: 1,
        status: 'active',
      }),
    );
    expect(mocks.mockUpdate).not.toHaveBeenCalled();
  });

  it('increments occurrenceCount for an existing cluster', async () => {
    // Failed results for the run
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: 'abc123', errorMessage: 'TypeError: undefined' },
      ])
      // existing cluster → found
      .mockResolvedValueOnce([
        { id: 'cluster-id-1', occurrenceCount: 2 },
      ]);

    await updateCrossRunClusters('run-2');

    expect(mocks.mockUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrenceCount: 3, // 2 + 1
        lastSeenRunId: 'run-2',
      }),
    );
    expect(mocks.mockInsert).not.toHaveBeenCalled();
  });

  it('de-duplicates identical fingerprints within the same run', async () => {
    // Two failed results with the same fingerprint in one run
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: 'fp-dupe', errorMessage: 'Same error' },
        { fingerprint: 'fp-dupe', errorMessage: 'Same error' },
      ])
      // cluster lookup for fp-dupe → not found
      .mockResolvedValueOnce([]);

    await updateCrossRunClusters('run-1');

    // Should only create ONE cluster, not two
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });

  it('handles multiple distinct fingerprints in one run', async () => {
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: 'fp-a', errorMessage: 'Error A' },
        { fingerprint: 'fp-b', errorMessage: 'Error B' },
      ])
      .mockResolvedValueOnce([]) // fp-a: not found
      .mockResolvedValueOnce([]); // fp-b: not found

    await updateCrossRunClusters('run-1');

    expect(mocks.mockInsert).toHaveBeenCalledTimes(2);
  });

  it('computes fingerprint from error message when result has no fingerprint', async () => {
    // Result with null fingerprint — service should compute one
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: null, errorMessage: 'ReferenceError: x is not defined' },
      ])
      .mockResolvedValueOnce([]); // cluster not found

    await updateCrossRunClusters('run-1');

    // Should still create a cluster (fingerprint computed from errorMessage)
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mocks.mockInsertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof inserted?.fingerprint).toBe('string');
    expect((inserted?.fingerprint as string).length).toBe(12); // 12-char hex
  });

  it('truncates long cluster labels to 100 chars', async () => {
    const longError = 'A'.repeat(200);
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: 'fp-long', errorMessage: longError },
      ])
      .mockResolvedValueOnce([]);

    await updateCrossRunClusters('run-1');

    const inserted = mocks.mockInsertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted?.clusterLabel as string).length).toBe(100);
  });

  it('handles null errorMessage when fingerprint is also null', async () => {
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: null, errorMessage: null },
      ])
      .mockResolvedValueOnce([]);

    await updateCrossRunClusters('run-1');

    // Should still create a cluster — computed from empty string
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mocks.mockInsertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof inserted?.fingerprint).toBe('string');
  });

  it('treats null occurrenceCount as 0 when incrementing', async () => {
    mocks.mockSelectWhere
      .mockResolvedValueOnce([
        { fingerprint: 'fp-null-count', errorMessage: 'Some error' },
      ])
      .mockResolvedValueOnce([
        { id: 'cluster-xyz', occurrenceCount: null },
      ]);

    await updateCrossRunClusters('run-1');

    expect(mocks.mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceCount: 1 }), // null ?? 0 = 0, +1 = 1
    );
  });
});
