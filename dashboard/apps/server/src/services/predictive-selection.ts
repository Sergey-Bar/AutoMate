import { and, gte, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { testFailureCorrelations } from '../db/schema.js';
import * as impactAnalysis from './impact-analysis.js';
import type { ImpactedTest } from './impact-analysis.js';

export interface PredictiveCandidate {
  testFile: string;
  title: string;
  score: number;
  staticImpact: number;
  historicalRisk: number;
  reason: string;
}

export interface PredictiveResult {
  candidates: PredictiveCandidate[];
  mode: 'full' | 'static_only';
  totalHistoricalRuns: number;
  coldStartThreshold: number;
}

export const WEIGHTS = { static: 0.65, historical: 0.35 } as const;
export const COLD_START_THRESHOLD = 20;

type CorrelationEntry = { failureCount: number; runCount: number };
type CorrelationRow = {
  testId?: string;
  testStableId?: string;
  sourceFile?: string;
  sourceFilePath?: string;
  failureCount: number;
  runCount?: number;
  totalOccurrences?: number;
};

export function computeHistoricalRisk(correlations: CorrelationEntry[]): number {
  if (correlations.length === 0) {
    return 0;
  }

  const likelihoods = correlations
    .filter((entry) => entry.runCount > 0)
    .map((entry) => entry.failureCount / entry.runCount);

  if (likelihoods.length === 0) {
    return 0;
  }

  const average = likelihoods.reduce((sum, value) => sum + value, 0) / likelihoods.length;
  return Math.max(0, Math.min(1, average));
}

export function computeScore(staticImpact: number, historicalRisk: number): number {
  return WEIGHTS.static * staticImpact + WEIGHTS.historical * historicalRisk;
}

function toIsoDateDaysAgo(windowDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() - windowDays);
  return date.toISOString();
}

function getStaticImpactFromReason(reason: string): number {
  return /\bvia\b/i.test(reason) ? 0.5 : 1.0;
}

async function getStaticCandidates(changedFiles: string[], testDir: string) {
  const maybeGetImpactedTests = (
    impactAnalysis as typeof impactAnalysis & {
      getImpactedTests?: (files: string[], dir: string) => Promise<ImpactedTest[]>;
    }
  ).getImpactedTests;

  if (typeof maybeGetImpactedTests === 'function') {
    return maybeGetImpactedTests(changedFiles, testDir);
  }

  return impactAnalysis.analyzeImpact(changedFiles);
}

function normalizeCorrelationRow(row: CorrelationRow) {
  const runCount = row.runCount ?? row.totalOccurrences ?? 0;
  return {
    testId: row.testId ?? row.testStableId ?? '',
    sourceFile: row.sourceFile ?? row.sourceFilePath ?? '',
    failureCount: row.failureCount,
    runCount,
  };
}

export async function getPredictiveCandidates(
  changedFiles: string[],
  testDir: string,
  options?: { windowDays?: number },
): Promise<PredictiveResult> {
  const impactedTests = await getStaticCandidates(changedFiles, testDir);

  if (impactedTests.length === 0) {
    return {
      candidates: [],
      mode: 'static_only',
      totalHistoricalRuns: 0,
      coldStartThreshold: COLD_START_THRESHOLD,
    };
  }

  const windowDays = options?.windowDays ?? 90;
  const sinceIso = toIsoDateDaysAgo(windowDays);

  const uniqueChangedFiles = Array.from(new Set(changedFiles));
  const rows: CorrelationRow[] = uniqueChangedFiles.length === 0
    ? []
    : await db
        .select({
          testStableId: testFailureCorrelations.testStableId,
          sourceFilePath: testFailureCorrelations.sourceFilePath,
          failureCount: testFailureCorrelations.failureCount,
          totalOccurrences: testFailureCorrelations.totalOccurrences,
        })
        .from(testFailureCorrelations)
        .where(
          and(
            inArray(testFailureCorrelations.sourceFilePath, uniqueChangedFiles),
            gte(testFailureCorrelations.updatedAt, sinceIso),
          ),
        );

  const normalizedRows = rows.map(normalizeCorrelationRow);

  const totalHistoricalRuns = normalizedRows.length === 0
    ? 0
    : Math.max(...normalizedRows.map((row) => row.runCount));
  const mode: PredictiveResult['mode'] =
    totalHistoricalRuns < COLD_START_THRESHOLD ? 'static_only' : 'full';

  const correlationsByTest = new Map<string, CorrelationEntry[]>();
  for (const row of normalizedRows) {
    if (!row.testId || !row.sourceFile) {
      continue;
    }

    const existing = correlationsByTest.get(row.testId) ?? [];
    existing.push({
      failureCount: row.failureCount,
      runCount: row.runCount,
    });
    correlationsByTest.set(row.testId, existing);
  }

  const candidates: PredictiveCandidate[] = impactedTests.map((impacted) => {
    const staticImpact = getStaticImpactFromReason(impacted.reason);
    const historicalRisk = mode === 'static_only'
      ? 0
      : computeHistoricalRisk(correlationsByTest.get(impacted.testFile) ?? []);
    const score = computeScore(staticImpact, historicalRisk);

    return {
      testFile: impacted.testFile,
      title: impacted.title,
      staticImpact,
      historicalRisk,
      score,
      reason:
        `${impacted.reason}; static=${staticImpact.toFixed(2)}, ` +
        `historical=${historicalRisk.toFixed(2)}, score=${score.toFixed(3)}`,
    };
  });

  candidates.sort((a, b) => b.score - a.score);

  return {
    candidates,
    mode,
    totalHistoricalRuns,
    coldStartThreshold: COLD_START_THRESHOLD,
  };
}
