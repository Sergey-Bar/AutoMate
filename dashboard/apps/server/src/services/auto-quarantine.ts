import { db } from '../db/client.js';
import { tests, quarantine, runs, results } from '../db/schema.js';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { getAutoQuarantineConfig } from '../routes/settings.js';
import { isEnabled } from './feature-flags.js';
import { classifyFlakiness } from './flakiness-classifier.js';


/**
 * After each run completes, check if any tests flaked too often.
 * If a test flaked >= threshold times in the last N runs,
 * auto-quarantine it (unless already quarantined).
 */
export async function autoQuarantineCheck(): Promise<string[]> {
  // Read thresholds from config
  const config = getAutoQuarantineConfig();
  const FLAKY_THRESHOLD = config.flakyThreshold;
  const LOOKBACK_RUNS = config.lookbackRuns;

  // Get the last N run IDs (most recent)
  const recentRuns = await db
    .select({ id: runs.id })
    .from(runs)
    .orderBy(desc(runs.startedAt))
    .limit(LOOKBACK_RUNS);

  if (recentRuns.length === 0) return [];
  const runIds = recentRuns.map((r) => r.id);

  // Find tests that were flaky in those runs
  const flakyTests = await db
    .select({
      stableId: tests.stableId,
      title: tests.title,
      file: tests.file,
      flakyCount: sql<number>`COUNT(CASE WHEN ${tests.status} = 'flaky' THEN 1 END)`.as('flaky_count'),
    })
    .from(tests)
    .where(and(
      inArray(tests.runId, runIds),
      sql`${tests.stableId} IS NOT NULL`,
    ))
    .groupBy(tests.stableId)
    .having(sql`COUNT(CASE WHEN ${tests.status} = 'flaky' THEN 1 END) >= ${FLAKY_THRESHOLD}`);

  if (flakyTests.length === 0) return [];

  // Get already-quarantined stableIds
  const existing = await db.select({ testTitle: quarantine.testTitle }).from(quarantine);
  const quarantinedTitles = new Set(existing.map((e) => e.testTitle));

  const newlyQuarantined: string[] = [];

  for (const ft of flakyTests) {
    if (!ft.title || quarantinedTitles.has(ft.title)) continue;

    await db.insert(quarantine).values({
      id: randomUUID(),
      testTitle: ft.title,
      testFile: ft.file,
      reason: `Auto-quarantined: flaked ${ft.flakyCount}/${LOOKBACK_RUNS} recent runs`,
      quarantinedAt: new Date().toISOString(),
      quarantinedBy: 'system',
      // When approval workflow is ON, require editor sign-off before exclusion takes effect
      status: isEnabled('quarantine-approval') ? 'pending' : 'approved',
    });

    // Best-effort: classify flakiness based on recent error messages
    try {
      const recentErrors = await db
        .select({ errorMessage: results.errorMessage })
        .from(results)
        .innerJoin(tests, eq(results.testId, tests.id))
        .where(
          and(
            eq(tests.title, ft.title),
            eq(results.status, 'failed'),
            isNotNull(results.errorMessage),
          ),
        )
        .orderBy(desc(results.startedAt))
        .limit(10);

      const errorMessages = recentErrors
        .filter((r): r is { errorMessage: string } => r.errorMessage != null)
        .map((r) => r.errorMessage);

      const classification = classifyFlakiness({ testTitle: ft.title, errorMessages });

      await db
        .update(quarantine)
        .set({
          flakinessCategory: classification.category,
          categoryConfidence: classification.confidence,
          categoryEvidence: JSON.stringify(classification.evidence),
        })
        .where(eq(quarantine.testTitle, ft.title));
    } catch (err) {
      // Classification is best-effort; the quarantine row itself was already inserted successfully
      console.error('flakiness classification failed for', ft.title, ':', (err as Error).message);
    }

    newlyQuarantined.push(ft.title);
  }

  return newlyQuarantined;
}

/**
 * After each run completes, check quarantined tests to see if they've auto-recovered.
 * A test is considered recovered if it passed in the last CONSECUTIVE_PASSES runs
 * (where the test actually appeared).
 */
export async function autoRecoveryCheck(): Promise<string[]> {
  const config = getAutoQuarantineConfig();
  const CONSECUTIVE_PASSES = config.lookbackRuns; // default 5

  // Get all unresolved approved quarantines
  const activeQuarantines = await db
    .select({ id: quarantine.id, testTitle: quarantine.testTitle, quarantinedAt: quarantine.quarantinedAt })
    .from(quarantine)
    .where(and(eq(quarantine.status, 'approved'), isNull(quarantine.resolvedAt)));

  if (activeQuarantines.length === 0) return [];

  const recovered: string[] = [];

  for (const entry of activeQuarantines) {
    // Get the last CONSECUTIVE_PASSES results for this test (by title)
    const recentTests = await db
      .select({ status: tests.status })
      .from(tests)
      .innerJoin(runs, eq(tests.runId, runs.id))
      .where(eq(tests.title, entry.testTitle))
      .orderBy(desc(runs.startedAt))
      .limit(CONSECUTIVE_PASSES);

    // Must have seen it at least CONSECUTIVE_PASSES times, all passed
    if (
      recentTests.length >= CONSECUTIVE_PASSES &&
      recentTests.every((t) => t.status === 'passed')
    ) {
      const resolvedAt = new Date().toISOString();
      const ttfMs = new Date(resolvedAt).getTime() - new Date(entry.quarantinedAt).getTime();

      await db
        .update(quarantine)
        .set({ resolvedAt, resolutionType: 'auto_recovery', ttfMs })
        .where(eq(quarantine.id, entry.id));

      recovered.push(entry.testTitle);
    }
  }

  return recovered;
}
