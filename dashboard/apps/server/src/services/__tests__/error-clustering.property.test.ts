import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

fc.configureGlobal({ seed: 42, numRuns: 30 });

interface MockFailedResult {
  testId: string;
  errorMessage: string | null;
  errorStack: string | null;
}

const mockQueryResult = vi.hoisted(() => ({ data: [] as MockFailedResult[] }));

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(mockQueryResult.data)),
      })),
    })),
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

import { clusterErrors } from '../error-clustering.js';

/** Arbitrary for a single error record with a guaranteed non-empty errorMessage. */
const errorArb = fc.record({
  testId: fc.string({ minLength: 1, maxLength: 36 }),
  errorMessage: fc.string({ minLength: 1, maxLength: 200 }),
  errorStack: fc.oneof(fc.constant(null), fc.string({ maxLength: 200 })),
});

describe('clusterErrors — property tests', () => {
  it('completeness: every input testId appears in exactly one output cluster', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(errorArb, { maxLength: 30 }),
        async (errors) => {
          mockQueryResult.data = errors;
          const clusters = await clusterErrors('run-prop-1');

          // Collect all testIds from all clusters
          const allClusteredIds = clusters.flatMap((c) => c.testIds);

          // Each input testId should appear in a cluster exactly once
          for (const error of errors) {
            const occurrences = allClusteredIds.filter(
              (id) => id === error.testId,
            ).length;
            expect(occurrences).toBe(1);
          }

          // Total count should match input size
          expect(allClusteredIds.length).toBe(errors.length);
        },
      ),
    );
  });

  it('non-empty clusters: every cluster has at least one testId and count >= 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(errorArb, { minLength: 1, maxLength: 30 }),
        async (errors) => {
          mockQueryResult.data = errors;
          const clusters = await clusterErrors('run-prop-2');

          for (const cluster of clusters) {
            expect(cluster.testIds.length).toBeGreaterThanOrEqual(1);
            expect(cluster.count).toBeGreaterThanOrEqual(1);
            expect(cluster.count).toBe(cluster.testIds.length);
          }
        },
      ),
    );
  });

  it('idempotency: clustering the same input twice yields identical clusters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(errorArb, { maxLength: 20 }),
        async (errors) => {
          mockQueryResult.data = errors;
          const first = await clusterErrors('run-prop-3');

          mockQueryResult.data = errors;
          const second = await clusterErrors('run-prop-3');

          // Strip internal field before comparing
          const strip = (clusters: typeof first) =>
            clusters.map(({ clusterId, sampleError, sampleStack, testIds, count }) => ({
              clusterId,
              sampleError,
              sampleStack,
              testIds,
              count,
            }));

          expect(strip(first)).toEqual(strip(second));
        },
      ),
    );
  });

  it('identical messages: errors with the same message all land in one cluster', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.array(
          fc.string({ minLength: 1, maxLength: 36 }),
          { minLength: 2, maxLength: 10 },
        ),
        async (sharedMessage, testIds) => {
          const errors: MockFailedResult[] = testIds.map((id) => ({
            testId: id,
            errorMessage: sharedMessage,
            errorStack: null,
          }));

          mockQueryResult.data = errors;
          const clusters = await clusterErrors('run-prop-4');

          // All identical messages should collapse into exactly one cluster
          expect(clusters.length).toBe(1);
          expect(clusters[0].count).toBe(testIds.length);
          expect(clusters[0].testIds.sort()).toEqual([...testIds].sort());
        },
      ),
    );
  });
});
