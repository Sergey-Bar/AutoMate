/**
 * failure-cluster-persistence.ts — Cross-run failure cluster aggregation.
 *
 * After each run ends, groups failures by fingerprint and upserts into
 * the failure_clusters table, incrementing occurrenceCount for recurring errors.
 *
 * Uses fingerprints from results.fingerprint (computed at ingestion time).
 * Falls back to computing a fingerprint from the error message if none is stored.
 *
 * Gated by feature flag 'cross-run-clusters'.
 */
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { results, failureClusters } from '../db/schema.js';
import { eq, and, isNotNull, sql } from 'drizzle-orm';

/**
 * Compute a stable 12-char hex fingerprint from an error message,
 * matching the format already used in results.fingerprint.
 */
function computeClusterFingerprint(errorMessage: string): string {
  const normalized = errorMessage
    .replace(/\d+/g, 'N')
    .replace(/['"][^'"]*['"]/g, 'S')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * After a run ends, persist cross-run failure clusters.
 * Groups failures by fingerprint within the run, then upserts into failure_clusters.
 */
export async function updateCrossRunClusters(runId: string): Promise<void> {
  const failedResults = await db
    .select({
      fingerprint: results.fingerprint,
      errorMessage: results.errorMessage,
    })
    .from(results)
    .where(
      and(
        eq(results.runId, runId),
        isNotNull(results.errorMessage),
        sql`${results.status} = 'failed'`,
      ),
    );

  if (failedResults.length === 0) return;

  // De-duplicate within this run by fingerprint
  const seen = new Map<string, string>(); // fingerprint → sampleError
  for (const row of failedResults) {
    const fp = row.fingerprint ?? computeClusterFingerprint(row.errorMessage ?? '');
    if (!seen.has(fp)) {
      seen.set(fp, row.errorMessage ?? '');
    }
  }

  const now = new Date().toISOString();

  for (const [fingerprint, sampleError] of seen) {
    const existing = await db
      .select({
        id: failureClusters.id,
        occurrenceCount: failureClusters.occurrenceCount,
      })
      .from(failureClusters)
      .where(eq(failureClusters.fingerprint, fingerprint));

    if (existing.length > 0 && existing[0]) {
      await db
        .update(failureClusters)
        .set({
          occurrenceCount: (existing[0].occurrenceCount ?? 0) + 1,
          lastSeenRunId: runId,
          updatedAt: now,
        })
        .where(eq(failureClusters.fingerprint, fingerprint));
    } else {
      await db.insert(failureClusters).values({
        id: crypto.randomUUID(),
        fingerprint,
        clusterLabel: sampleError.slice(0, 100),
        firstSeenRunId: runId,
        lastSeenRunId: runId,
        occurrenceCount: 1,
        representativeError: sampleError,
        category: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}
