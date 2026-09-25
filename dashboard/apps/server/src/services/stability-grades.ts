/**
 * stability-grades.ts — Compute stability letter grades for tests
 *
 * Grades are computed on-the-fly from existing test/run data.
 * No new database tables required.
 */

import { db } from '../db/client.js';
import { tests, runs } from '../db/schema.js';
import { eq, desc, inArray } from 'drizzle-orm';

export interface StabilityGrade {
  grade: string;
  passRate: number;
  totalRuns: number;
}

function gradeFromPassRate(rate: number): string {
  if (rate >= 100) return 'A+';
  if (rate >= 95) return 'A';
  if (rate >= 85) return 'B';
  if (rate >= 70) return 'C';
  if (rate >= 50) return 'D';
  return 'F';
}

export async function computeStabilityGrade(
  stableId: string,
  lookbackRuns = 20,
): Promise<StabilityGrade> {
  const rows = await db
    .select({
      status: tests.status,
    })
    .from(tests)
    .innerJoin(runs, eq(tests.runId, runs.id))
    .where(eq(tests.stableId, stableId))
    .orderBy(desc(runs.startedAt))
    .limit(lookbackRuns);

  const totalRuns = rows.length;
  if (totalRuns === 0) {
    return { grade: '—', passRate: 0, totalRuns: 0 };
  }

  const passed = rows.filter((r) => r.status === 'passed').length;
  const passRate = (passed / totalRuns) * 100;

  return {
    grade: gradeFromPassRate(passRate),
    passRate: Math.round(passRate * 10) / 10,
    totalRuns,
  };
}

/**
 * Batch-compute stability grades for multiple stableIds in a single query.
 * Eliminates the N+1 problem of calling computeStabilityGrade per ID.
 */
export async function computeStabilityGradesBatch(
  stableIds: string[],
  lookbackRuns = 20,
): Promise<Record<string, StabilityGrade>> {
  if (stableIds.length === 0) return {};

  // Single query: fetch all matching tests sorted by run date
  const rows = await db
    .select({
      stableId: tests.stableId,
      status: tests.status,
      runStartedAt: runs.startedAt,
    })
    .from(tests)
    .innerJoin(runs, eq(tests.runId, runs.id))
    .where(inArray(tests.stableId, stableIds))
    .orderBy(desc(runs.startedAt));

  // Group by stableId, keep only the most recent `lookbackRuns` per ID
  const grouped: Record<string, string[]> = {};
  for (const row of rows) {
    const sid = row.stableId!;
    if (!grouped[sid]) grouped[sid] = [];
    if (grouped[sid].length < lookbackRuns) {
      grouped[sid].push(row.status);
    }
  }

  // Compute grades from grouped statuses
  const result: Record<string, StabilityGrade> = {};
  for (const sid of stableIds) {
    const statuses = grouped[sid];
    if (!statuses || statuses.length === 0) {
      result[sid] = { grade: '—', passRate: 0, totalRuns: 0 };
      continue;
    }
    const totalRuns = statuses.length;
    const passed = statuses.filter((s) => s === 'passed').length;
    const passRate = (passed / totalRuns) * 100;
    result[sid] = {
      grade: gradeFromPassRate(passRate),
      passRate: Math.round(passRate * 10) / 10,
      totalRuns,
    };
  }

  return result;
}
