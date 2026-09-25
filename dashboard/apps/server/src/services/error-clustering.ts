import { db } from '../db/client.js';
import { results } from '../db/schema.js';
import { eq, and, isNotNull } from 'drizzle-orm';

interface ClusterResult {
  clusterId: string;
  sampleError: string;
  sampleStack: string | null;
  testIds: string[];
  count: number;
}

/**
 * Cluster test failures by error message similarity.
 * Uses token-based Jaccard similarity for robust grouping even with word reordering.
 * Groups errors with >80% Jaccard index on normalized token sets.
 */
export async function clusterErrors(runId: string): Promise<ClusterResult[]> {
  const failedResults = await db.select({
    testId: results.testId,
    errorMessage: results.errorMessage,
    errorStack: results.errorStack,
  }).from(results)
    .where(and(
      eq(results.runId, runId),
      isNotNull(results.errorMessage),
    ));

  if (failedResults.length === 0) return [];

  // Normalize for comparison
  function normalize(s: string): string {
    return s
      .replace(/\d+/g, 'N')          // Replace numbers with N
      .replace(/['"][^'"]*['"]/g, 'S') // Replace string literals
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .trim()
      .toLowerCase();
  }

  function similarity(a: string, b: string): number {
    if (a === b) return 1;
    const aTokens = new Set(a.split(' ').filter(Boolean));
    const bTokens = new Set(b.split(' ').filter(Boolean));
    if (aTokens.size === 0 && bTokens.size === 0) return 1;
    if (aTokens.size === 0 || bTokens.size === 0) return 0;
    let intersectionSize = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) intersectionSize++;
    }
    const unionSize = aTokens.size + bTokens.size - intersectionSize;
    return intersectionSize / unionSize;
  }

  const clusters: Array<ClusterResult & { _normalizedSample?: string }> = [];

  for (const row of failedResults) {
    if (!row.errorMessage) continue;
    const norm = normalize(row.errorMessage);

    let matched = false;
    for (const cluster of clusters) {
      if (!cluster._normalizedSample) {
        cluster._normalizedSample = normalize(cluster.sampleError);
      }
      if (similarity(norm, cluster._normalizedSample) > 0.8) {
        cluster.testIds.push(row.testId);
        cluster.count++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      clusters.push({
        clusterId: `cluster-${clusters.length}`,
        sampleError: row.errorMessage,
        sampleStack: row.errorStack,
        testIds: [row.testId],
        count: 1,
      });
    }
  }

  // Sort by count descending
  return clusters.sort((a, b) => b.count - a.count);
}
