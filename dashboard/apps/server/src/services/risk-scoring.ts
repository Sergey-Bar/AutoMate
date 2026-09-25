/**
 * risk-scoring.ts — Per-test risk scores using test_failure_correlations.
 *
 * Weighted formula (all dimensions normalized 0-1):
 *   failure_rate       40 %  SUM(failureCount) / SUM(totalOccurrences)
 *   recency            20 %  Decays to 0 over 30 days since last DB update
 *   correlation_strength 20 % Number of correlated source files (capped at 5)
 *   cluster_severity   20 %  Reserved — always 0 until cluster-to-test join lands
 *
 * Confidence = min(totalRuns / 50, 1) — grows with observed data volume.
 *
 * Graceful degradation: totalRuns < 10  →  score=0, confidence=0, reason='insufficient_data'
 */
import { db } from '../db/client.js';
import { testFailureCorrelations } from '../db/schema.js';
import { inArray, sql } from 'drizzle-orm';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RiskScoreComponents {
  failureRate: number;
  recency: number;
  correlationStrength: number;
  clusterSeverity: number;
}

export interface RiskScore {
  stableId: string;
  score: number;
  confidence: number;
  reason: 'computed' | 'insufficient_data';
  components: RiskScoreComponents;
}

export interface RiskSummary {
  totalTests: number;
  highRisk: number;      // score >= 0.7
  mediumRisk: number;    // score 0.4 – 0.69
  lowRisk: number;       // score 0 – 0.39 (computed)
  topRiskyTests: RiskScore[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const INSUFFICIENT_DATA_THRESHOLD = 10;
const RECENCY_DECAY_DAYS = 30;
const CORRELATION_FILE_CAP = 5;
const CONFIDENCE_SATURATION = 50;

const WEIGHT_FAILURE_RATE = 0.4;
const WEIGHT_RECENCY = 0.2;
const WEIGHT_CORRELATION = 0.2;
const WEIGHT_CLUSTER = 0.2;

function computeRecency(lastUpdatedIso: string): number {
  const msPerDay = 86_400_000;
  const daysSince = (Date.now() - new Date(lastUpdatedIso).getTime()) / msPerDay;
  return Math.max(0, 1 - daysSince / RECENCY_DECAY_DAYS);
}

function computeScore(
  failureRate: number,
  recency: number,
  correlationStrength: number,
  clusterSeverity: number,
): number {
  const raw =
    failureRate * WEIGHT_FAILURE_RATE +
    recency * WEIGHT_RECENCY +
    correlationStrength * WEIGHT_CORRELATION +
    clusterSeverity * WEIGHT_CLUSTER;
  // Clamp to [0, 1] and round to 4 decimal places
  return Math.round(Math.min(1, Math.max(0, raw)) * 10000) / 10000;
}

type AggRow = {
  testStableId: string;
  totalFailures: number;
  totalRuns: number;
  fileCount: number;
  lastUpdated: string;
};

// ─── Core service functions ───────────────────────────────────────────────────

/**
 * Batch-compute risk scores for a list of test stable IDs.
 * Uses a single aggregation query.
 */
export async function computeRiskScoresBatch(stableIds: string[]): Promise<RiskScore[]> {
  if (stableIds.length === 0) return [];

  const rows = await db
    .select({
      testStableId: testFailureCorrelations.testStableId,
      totalFailures: sql<number>`SUM(${testFailureCorrelations.failureCount})`.as('total_failures'),
      totalRuns: sql<number>`SUM(${testFailureCorrelations.totalOccurrences})`.as('total_runs'),
      fileCount: sql<number>`COUNT(*)`.as('file_count'),
      lastUpdated: sql<string>`MAX(${testFailureCorrelations.updatedAt})`.as('last_updated'),
    })
    .from(testFailureCorrelations)
    .where(inArray(testFailureCorrelations.testStableId, stableIds))
    .groupBy(testFailureCorrelations.testStableId);

  // Index by stableId for O(1) lookup
  const aggMap = new Map<string, AggRow>();
  for (const row of rows) {
    aggMap.set(row.testStableId, row as AggRow);
  }

  return stableIds.map((stableId): RiskScore => {
    const agg = aggMap.get(stableId);

    if (!agg || agg.totalRuns < INSUFFICIENT_DATA_THRESHOLD) {
      return {
        stableId,
        score: 0,
        confidence: 0,
        reason: 'insufficient_data',
        components: { failureRate: 0, recency: 0, correlationStrength: 0, clusterSeverity: 0 },
      };
    }

    const failureRate = agg.totalRuns > 0 ? agg.totalFailures / agg.totalRuns : 0;
    const recency = computeRecency(agg.lastUpdated);
    const correlationStrength = Math.min(1, agg.fileCount / CORRELATION_FILE_CAP);
    const clusterSeverity = 0; // reserved — requires cluster-to-test join

    return {
      stableId,
      score: computeScore(failureRate, recency, correlationStrength, clusterSeverity),
      confidence: Math.min(1, agg.totalRuns / CONFIDENCE_SATURATION),
      reason: 'computed',
      components: {
        failureRate: Math.round(failureRate * 10000) / 10000,
        recency: Math.round(recency * 10000) / 10000,
        correlationStrength: Math.round(correlationStrength * 10000) / 10000,
        clusterSeverity,
      },
    };
  });
}

/**
 * Compute a suite-level risk summary: counts by tier + top N risky tests.
 */
export async function computeRiskSummary(topN = 10): Promise<RiskSummary> {
  const rows = await db
    .select({
      testStableId: testFailureCorrelations.testStableId,
      totalFailures: sql<number>`SUM(${testFailureCorrelations.failureCount})`.as('total_failures'),
      totalRuns: sql<number>`SUM(${testFailureCorrelations.totalOccurrences})`.as('total_runs'),
      fileCount: sql<number>`COUNT(*)`.as('file_count'),
      lastUpdated: sql<string>`MAX(${testFailureCorrelations.updatedAt})`.as('last_updated'),
    })
    .from(testFailureCorrelations)
    .groupBy(testFailureCorrelations.testStableId);

  const allScores: RiskScore[] = rows
    .map((row): RiskScore => {
      if (row.totalRuns < INSUFFICIENT_DATA_THRESHOLD) {
        return {
          stableId: row.testStableId,
          score: 0,
          confidence: 0,
          reason: 'insufficient_data',
          components: { failureRate: 0, recency: 0, correlationStrength: 0, clusterSeverity: 0 },
        };
      }
      const failureRate = row.totalRuns > 0 ? row.totalFailures / row.totalRuns : 0;
      const recency = computeRecency(row.lastUpdated);
      const correlationStrength = Math.min(1, row.fileCount / CORRELATION_FILE_CAP);
      return {
        stableId: row.testStableId,
        score: computeScore(failureRate, recency, correlationStrength, 0),
        confidence: Math.min(1, row.totalRuns / CONFIDENCE_SATURATION),
        reason: 'computed',
        components: {
          failureRate: Math.round(failureRate * 10000) / 10000,
          recency: Math.round(recency * 10000) / 10000,
          correlationStrength: Math.round(correlationStrength * 10000) / 10000,
          clusterSeverity: 0,
        },
      };
    })
    .filter((s) => s.reason === 'computed');

  const high = allScores.filter((s) => s.score >= 0.7).length;
  const medium = allScores.filter((s) => s.score >= 0.4 && s.score < 0.7).length;
  const low = allScores.filter((s) => s.score > 0 && s.score < 0.4).length;

  const topRiskyTests = [...allScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return {
    totalTests: allScores.length,
    highRisk: high,
    mediumRisk: medium,
    lowRisk: low,
    topRiskyTests,
  };
}
