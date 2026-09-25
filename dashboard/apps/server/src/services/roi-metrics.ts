/**
 * roi-metrics.ts — Executive ROI / quality metrics computed from existing Dashboard data.
 *
 * All queries use SQL aggregation against the `trends`, `runs`, `tests`, and
 * `quarantine` tables. No in-memory iteration over large datasets.
 *
 * Metrics returned:
 *   qualityTrend          — rolling pass-rate % and change vs previous period
 *   flakyTestCost         — estimated minutes wasted on flaky reruns
 *   quarantineEffectiveness — pass-rate improvement after quarantine adoption
 *   escapedDefectRate     — proxy: failures not caught until recent runs (% of total)
 *   mttd                  — mean time to detect (avg run duration as proxy)
 *   releaseFrequency      — runs per week in the period
 */
import { poolConnection } from '../db/client.js';

export type RoiPeriod = '30d' | '60d' | '90d';

export interface RoiMetrics {
  qualityTrend: {
    currentPassRate: number; // %
    previousPassRate: number; // % (prior equal period)
    changePct: number; // positive = improving
    dataPoints: Array<{ date: string; passRate: number }>;
  };
  flakyTestCost: {
    flakyReruns: number; // total extra retries in period
    estimatedMinutesWasted: number; // flakyReruns × avg test duration / 60000
    changeVsPrevious: number; // positive = more flakiness
  };
  quarantineEffectiveness: {
    quarantinedCount: number;
    passRateBeforeQuarantine: number; // earliest 20% of period
    passRateAfterQuarantine: number; // latest 20% of period
    improvementPct: number;
  };
  escapedDefectRate: {
    totalRuns: number;
    runsWithFailures: number;
    rate: number; // runsWithFailures / totalRuns × 100
    changeVsPrevious: number;
  };
  mttd: {
    avgDetectionMinutes: number; // avg run duration as proxy (ms → min)
    changeVsPrevious: number; // positive = faster detection (lower MTTD = better, so negate)
  };
  releaseFrequency: {
    runsPerWeek: number;
    totalRuns: number;
    changeVsPrevious: number; // positive = more runs
  };
}

interface TrendRow {
  date: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  avg_duration_ms: number | null;
}

interface _RunRow {
  total: number;
  passed: number;
  failed: number;
  duration_ms: number | null;
}

/** Convert period string to number of days */
function periodDays(period: RoiPeriod): number {
  return parseInt(period.slice(0, -1), 10);
}

/** ISO date string N days ago */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function computeRoiMetrics(period: RoiPeriod): Promise<RoiMetrics> {
  const days = periodDays(period);
  const cutoff = daysAgo(days);
  const prevCutoff = daysAgo(days * 2);

  // ── trend data ─────────────────────────────────────────────────────────────
  const currentTrendsResult = await poolConnection.query(
    'SELECT * FROM trends WHERE date >= $1 ORDER BY date ASC',
    [cutoff],
  );
  const currentTrends = currentTrendsResult.rows as TrendRow[];

  const prevTrendsResult = await poolConnection.query(
    `SELECT SUM(total) AS total, SUM(passed) AS passed, SUM(flaky) AS flaky
     FROM trends
     WHERE date >= $1 AND date < $2`,
    [prevCutoff, cutoff],
  );
  const prevTrends = prevTrendsResult.rows[0] as { total: number | null; passed: number | null; flaky: number | null };

  // ── runs data ──────────────────────────────────────────────────────────────
  const currentRunsAggResult = await poolConnection.query(
    `SELECT COUNT(*) AS run_count,
            SUM(CASE WHEN failed > 0 THEN 1 ELSE 0 END) AS runs_with_failures,
            AVG(duration_ms) AS avg_duration_ms
     FROM runs
     WHERE started_at >= $1`,
    [new Date(cutoff).toISOString()],
  );
  const currentRunsAgg = currentRunsAggResult.rows[0] as { run_count: string | number; runs_with_failures: string | number; avg_duration_ms: string | number | null };

  const prevRunsAggResult = await poolConnection.query(
    `SELECT COUNT(*) AS run_count,
            SUM(CASE WHEN failed > 0 THEN 1 ELSE 0 END) AS runs_with_failures,
            AVG(duration_ms) AS avg_duration_ms
     FROM runs
     WHERE started_at >= $1 AND started_at < $2`,
    [new Date(prevCutoff).toISOString(), new Date(cutoff).toISOString()],
  );
  const prevRunsAgg = prevRunsAggResult.rows[0] as { run_count: string | number; runs_with_failures: string | number; avg_duration_ms: string | number | null };

  // ── quarantine data ────────────────────────────────────────────────────────
  const quarantinedResult = await poolConnection.query(
    "SELECT COUNT(*) AS cnt FROM quarantine WHERE status = 'approved'",
  );
  const quarantinedCount = Number((quarantinedResult.rows[0] as { cnt: string | number }).cnt);

  // Pass-rate in first 20% vs last 20% of period (quarantine proxy)
  const slice = Math.max(1, Math.floor(days * 0.2));
  const earlyEnd = daysAgo(days - slice);
  const lateStart = daysAgo(slice);

  const earlyAggResult = await poolConnection.query(
    `SELECT SUM(total) AS total, SUM(passed) AS passed FROM trends WHERE date >= $1 AND date < $2`,
    [cutoff, earlyEnd],
  );
  const earlyAgg = earlyAggResult.rows[0] as { total: number | null; passed: number | null };

  const lateAggResult = await poolConnection.query(
    `SELECT SUM(total) AS total, SUM(passed) AS passed FROM trends WHERE date >= $1`,
    [lateStart],
  );
  const lateAgg = lateAggResult.rows[0] as { total: number | null; passed: number | null };


  // ── derived metrics ────────────────────────────────────────────────────────

  // Quality trend
  const currentTotal = currentTrends.reduce((s, r) => s + r.total, 0);
  const currentPassed = currentTrends.reduce((s, r) => s + r.passed, 0);
  const currentPassRate = currentTotal > 0 ? (currentPassed / currentTotal) * 100 : 0;

  const prevTotal = prevTrends?.total ?? 0;
  const prevPassed = prevTrends?.passed ?? 0;
  const previousPassRate = prevTotal > 0 ? (prevPassed / prevTotal) * 100 : 0;

  const dataPoints = currentTrends.map((r) => ({
    date: r.date,
    passRate: r.total > 0 ? (r.passed / r.total) * 100 : 0,
  }));

  // Flaky cost
  const currentFlaky = currentTrends.reduce((s, r) => s + r.flaky, 0);
  const prevFlaky = prevTrends?.flaky ?? 0;
  const avgDurationFromTrends = currentTrends.length > 0
    ? currentTrends.reduce((s, r) => s + (r.avg_duration_ms ?? 0), 0) / currentTrends.length
    : 0;
  const avgTestDurationMs = avgDurationFromTrends > 0 ? avgDurationFromTrends : 5000; // 5s default
  const estimatedMinutesWasted = Math.round((currentFlaky * avgTestDurationMs) / 60000);
  const prevEstimatedMinutes = Math.round((prevFlaky * avgTestDurationMs) / 60000);

  // Quarantine effectiveness
  const earlyTotal = earlyAgg?.total ?? 0;
  const earlyPassed = earlyAgg?.passed ?? 0;
  const passRateBeforeQuarantine = earlyTotal > 0 ? (earlyPassed / earlyTotal) * 100 : 0;
  const lateTotal = lateAgg?.total ?? 0;
  const latePassed = lateAgg?.passed ?? 0;
  const passRateAfterQuarantine = lateTotal > 0 ? (latePassed / lateTotal) * 100 : 0;
  const improvementPct = passRateAfterQuarantine - passRateBeforeQuarantine;

  // Escaped defect rate
  const totalRuns = currentRunsAgg.run_count ?? 0;
  const runsWithFailures = currentRunsAgg.runs_with_failures ?? 0;
  const escapedRate = totalRuns > 0 ? (runsWithFailures / totalRuns) * 100 : 0;
  const prevTotalRuns = prevRunsAgg.run_count ?? 0;
  const prevRunsWithFailures = prevRunsAgg.runs_with_failures ?? 0;
  const prevEscapedRate = prevTotalRuns > 0 ? (prevRunsWithFailures / prevTotalRuns) * 100 : 0;

  // MTTD (avg run duration as proxy)
  const avgDetectionMs = currentRunsAgg.avg_duration_ms ?? 0;
  const avgDetectionMinutes = avgDetectionMs / 60000;
  const prevAvgDetectionMs = prevRunsAgg.avg_duration_ms ?? 0;
  const prevAvgDetectionMinutes = prevAvgDetectionMs / 60000;
  // Positive changeVsPrevious means detection got faster (lower MTTD = better)
  const mttdChange = prevAvgDetectionMinutes - avgDetectionMinutes;

  // Release frequency
  const weeks = days / 7;
  const runsPerWeek = weeks > 0 ? totalRuns / weeks : 0;
  const prevWeeks = days / 7;
  const prevRunsPerWeek = prevWeeks > 0 ? prevTotalRuns / prevWeeks : 0;

  return {
    qualityTrend: {
      currentPassRate: Math.round(currentPassRate * 10) / 10,
      previousPassRate: Math.round(previousPassRate * 10) / 10,
      changePct: Math.round((currentPassRate - previousPassRate) * 10) / 10,
      dataPoints,
    },
    flakyTestCost: {
      flakyReruns: currentFlaky,
      estimatedMinutesWasted,
      changeVsPrevious: estimatedMinutesWasted - prevEstimatedMinutes,
    },
    quarantineEffectiveness: {
      quarantinedCount,
      passRateBeforeQuarantine: Math.round(passRateBeforeQuarantine * 10) / 10,
      passRateAfterQuarantine: Math.round(passRateAfterQuarantine * 10) / 10,
      improvementPct: Math.round(improvementPct * 10) / 10,
    },
    escapedDefectRate: {
      totalRuns,
      runsWithFailures,
      rate: Math.round(escapedRate * 10) / 10,
      changeVsPrevious: Math.round((escapedRate - prevEscapedRate) * 10) / 10,
    },
    mttd: {
      avgDetectionMinutes: Math.round(avgDetectionMinutes * 10) / 10,
      changeVsPrevious: Math.round(mttdChange * 10) / 10,
    },
    releaseFrequency: {
      runsPerWeek: Math.round(runsPerWeek * 10) / 10,
      totalRuns,
      changeVsPrevious: Math.round((runsPerWeek - prevRunsPerWeek) * 10) / 10,
    },
  };
}
