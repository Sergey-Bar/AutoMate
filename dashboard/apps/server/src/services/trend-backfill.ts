import { db } from '../db/client.js';
import { runs, trends } from '../db/schema.js';
import { and, gte, lte } from 'drizzle-orm';

/**
 * Update trends for a specific date (usually "today" after a run completes).
 * Aggregates all runs on that date, computing: total, passed, failed, flaky, avgDurationMs, p95DurationMs.
 * Uses INSERT ... ON CONFLICT UPDATE (upsert) so it's idempotent.
 */
export async function updateTrendsForDate(date: string, project?: string, branch?: string): Promise<void> {
  // date format: 'YYYY-MM-DD'
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  // Query aggregated stats from runs that finished on this date
  const dayRuns = await db.select().from(runs)
    .where(and(
      gte(runs.finishedAt, dayStart),
      lte(runs.finishedAt, dayEnd),
    ));

  if (dayRuns.length === 0) return;

  // Aggregate
  let total = 0, passed = 0, failed = 0, flaky = 0;
  const durations: number[] = [];

  for (const run of dayRuns) {
    total += run.total;
    passed += run.passed;
    failed += run.failed;
    flaky += run.flaky;
    if (run.durationMs) durations.push(run.durationMs);
  }

  const avgDurationMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;

  const p95DurationMs = durations.length > 0
    ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length * 0.95)]
    : null;

  const proj = project ?? 'default';
  const br = branch ?? dayRuns[0]?.branch ?? 'main';

  // Upsert into trends
  await db.insert(trends).values({
    date,
    project: proj,
    branch: br,
    total,
    passed,
    failed,
    flaky,
    avgDurationMs,
    p95DurationMs,
  }).onConflictDoUpdate({
    target: [trends.date, trends.project, trends.branch],
    set: { total, passed, failed, flaky, avgDurationMs, p95DurationMs },
  });
}

/**
 * Backfill trends for the last N days.
 * Called on server startup to populate historical data.
 */
export async function backfillTrends(days: number = 90): Promise<void> {
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0] ?? d.toISOString().slice(0, 10);
    try {
      await updateTrendsForDate(dateStr);
    } catch {
      // Skip dates that fail — don't break startup
    }
  }
}
