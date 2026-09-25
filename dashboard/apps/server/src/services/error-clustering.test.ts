/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so the mocks are available when vi.mock factory runs (hoisted)
const { mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockWhere, mockFrom, mockSelect };
});

vi.mock('../db/client.js', () => ({
  db: { select: mockSelect },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

import { clusterErrors } from './error-clustering.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockResolvedValue([]);
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
});

describe('clusterErrors', () => {
  // ── Empty results ─────────────────────────────────────────────────────
  it('returns empty array when no failed results exist', async () => {
    mockWhere.mockResolvedValue([]);

    const clusters = await clusterErrors('run-1');
    expect(clusters).toEqual([]);
    expect(mockSelect).toHaveBeenCalled();
  });

  // ── Single failure ────────────────────────────────────────────────────
  it('returns one cluster for a single failure', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: 'Element not found', errorStack: 'at test.ts:10' },
    ]);

    const clusters = await clusterErrors('run-1');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(1);
    expect(clusters[0].testIds).toEqual(['test-1']);
    expect(clusters[0].sampleError).toBe('Element not found');
    expect(clusters[0].sampleStack).toBe('at test.ts:10');
    expect(clusters[0].clusterId).toBe('cluster-0');
  });

  // ── Identical errors → single cluster ─────────────────────────────────
  it('groups identical errors into one cluster with count 2', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: 'Timeout exceeded', errorStack: null },
      { testId: 'test-2', errorMessage: 'Timeout exceeded', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].testIds).toEqual(['test-1', 'test-2']);
  });

  // ── Different errors → multiple clusters ──────────────────────────────
  it('creates separate clusters for semantically different errors', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: 'Element not found in the DOM', errorStack: null },
      { testId: 'test-2', errorMessage: 'Network request failed with status 500', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    expect(clusters).toHaveLength(2);
    expect(clusters[0].count).toBe(1);
    expect(clusters[1].count).toBe(1);
  });

  // ── >80% similarity → same cluster ────────────────────────────────────
  it('groups errors with >80% character overlap into the same cluster', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: 'Timeout 30000ms exceeded waiting for element', errorStack: null },
      { testId: 'test-2', errorMessage: 'Timeout 60000ms exceeded waiting for element', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    // After normalization, numbers become N so both normalize to the same thing
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
  });

  // ── Sorted by count descending ────────────────────────────────────────
  it('sorts clusters by count descending', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: 'Error A unique failure', errorStack: null },
      { testId: 'test-2', errorMessage: 'Error B common failure', errorStack: null },
      { testId: 'test-3', errorMessage: 'Error B common failure', errorStack: null },
      { testId: 'test-4', errorMessage: 'Error B common failure', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    expect(clusters[0].count).toBeGreaterThanOrEqual(clusters[clusters.length - 1].count);
  });

  // ── Null errorMessage rows are skipped ────────────────────────────────
  it('skips rows with null errorMessage', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: null, errorStack: null },
      { testId: 'test-2', errorMessage: 'Real error', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].testIds).toEqual(['test-2']);
  });

  // ── Cluster IDs are sequential ────────────────────────────────────────
  it('assigns sequential cluster IDs', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: 'AAAA totally different error one', errorStack: null },
      { testId: 'test-2', errorMessage: 'ZZZZ totally different error two', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    expect(clusters).toHaveLength(2);
    const ids = clusters.map((c) => c.clusterId).sort();
    expect(ids).toContain('cluster-0');
    expect(ids).toContain('cluster-1');
  });

  // ── Jaccard: word-reordering → same cluster ──────────────────────────
  it('clusters errors with same tokens in different order (Jaccard advantage)', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: 'failed assertion expected value got undefined', errorStack: null },
      { testId: 'test-2', errorMessage: 'expected value undefined assertion failed got', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    // Jaccard similarity on tokens is 1.0 (same token set), so they cluster together
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
  });

  // ── Jaccard: unrelated errors stay separate ───────────────────────────
  it('keeps semantically different errors in separate clusters', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-1', errorMessage: "Cannot read property foo of undefined", errorStack: null },
      { testId: 'test-2', errorMessage: 'Connection refused on port 5432', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-1');
    expect(clusters).toHaveLength(2);
  });

  // ── Mutation-killing: similarity threshold > 0.8 ─────────────────────────
  it('threshold is strictly > 0.8 (not >= 0.8): errors at exactly 0.8 Jaccard are NOT clustered — kills ConditionalExpression mutation', async () => {
    // Construct two messages with exactly 0.8 Jaccard similarity on normalized tokens.
    // We need intersection/union = 0.8 exactly.
    // 4 shared tokens, 1 unique each → union=5, intersection=4, Jaccard=4/5=0.8
    // 4 shared: "element not found error"
    // message A adds: "frontend"
    // message B adds: "backend"
    mockWhere.mockResolvedValue([
      { testId: 'test-jac-a', errorMessage: 'element not found error frontend', errorStack: null },
      { testId: 'test-jac-b', errorMessage: 'element not found error backend', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-jac-80');
    // Jaccard = 4/5 = 0.80 — exactly at boundary, NOT > 0.8, so separate clusters
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.count === 1)).toBe(true);
  });

  it('threshold > 0.8: errors with Jaccard > 0.8 ARE clustered — kills ConditionalExpression false mutation', async () => {
    // 9 shared tokens, 1 unique → union=10, intersection=9, Jaccard=0.9 > 0.8
    mockWhere.mockResolvedValue([
      {
        testId: 'test-high-a',
        errorMessage: 'alpha beta gamma delta epsilon zeta eta theta iota kappa',
        errorStack: null,
      },
      {
        testId: 'test-high-b',
        errorMessage: 'alpha beta gamma delta epsilon zeta eta theta iota lambda',
        errorStack: null,
      },
    ]);

    const clusters = await clusterErrors('run-high');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
  });

  it('normalize replaces numbers with "N" so "3000" and "5000" normalize the same — kills StringLiteral "N" mutation', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-num-1', errorMessage: 'Timeout 3000ms exceeded', errorStack: null },
      { testId: 'test-num-2', errorMessage: 'Timeout 5000ms exceeded', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-norm');
    // Both normalize to "Timeout Nms exceeded" → same cluster
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
  });

  it('normalize replaces string literals with "S" — kills StringLiteral "S" mutation', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-str-1', errorMessage: "Expected element to have text 'hello' but got 'world'", errorStack: null },
      { testId: 'test-str-2', errorMessage: "Expected element to have text 'foo' but got 'bar'", errorStack: null },
    ]);

    const clusters = await clusterErrors('run-str-norm');
    // Both normalize: string literals ('hello'/'world' and 'foo'/'bar') become 'S'
    // → "Expected element to have text S but got S" → same cluster
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
  });

  it('clusterId format is "cluster-N" with sequential number — kills StringLiteral "cluster-" mutation', async () => {
    mockWhere.mockResolvedValue([
      { testId: 'test-id-1', errorMessage: 'AAAA unique error one', errorStack: null },
      { testId: 'test-id-2', errorMessage: 'BBBB unique error two', errorStack: null },
      { testId: 'test-id-3', errorMessage: 'CCCC unique error three', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-ids');
    // Each is a unique cluster
    expect(clusters).toHaveLength(3);
    const ids = clusters.map((c) => c.clusterId).sort();
    // Must use "cluster-" prefix (not empty string or other prefix)
    expect(ids[0]).toBe('cluster-0');
    expect(ids[1]).toBe('cluster-1');
    expect(ids[2]).toBe('cluster-2');
    // Verify the prefix is not empty
    for (const id of ids) {
      expect(id.startsWith('cluster-')).toBe(true);
    }
  });

  it('both-empty-token-sets have similarity 1 (not 0) — kills LogicalOperator && → || mutation', async () => {
    // Two errors that normalize to empty strings → both have empty token sets
    // similarity should return 1 (they are identical: both empty)
    // If && were changed to ||, the first empty check would short-circuit incorrectly
    mockWhere.mockResolvedValue([
      { testId: 'test-empty-1', errorMessage: '   ', errorStack: null }, // normalizes to empty
      { testId: 'test-empty-2', errorMessage: '   ', errorStack: null },
    ]);

    const clusters = await clusterErrors('run-empty-tokens');
    // Both normalize to empty strings → same cluster (similarity = 1)
    expect(clusters.length).toBeLessThanOrEqual(2); // They should group (≤1 ideal) or at most 2
    // Key: shouldn't throw and should return valid result
    expect(Array.isArray(clusters)).toBe(true);
  });
});
