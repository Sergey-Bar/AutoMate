export interface TestResult {
  testId: string;
  testName: string;
  suiteName?: string;
  status: 'passed' | 'failed';
  runId: string;
}

export interface FlakyTest {
  testId: string;
  testName: string;
  suiteName: string;
  flakinessScore: number;
  recentResults: Array<'passed' | 'failed'>;
}

const FLAKY_THRESHOLD = 0.3;
const RECENT_RUNS_WINDOW = 10;

/**
 * Count alternations in a sequence of statuses.
 * An alternation is a transition from pass→fail or fail→pass.
 */
function countAlternations(statuses: Array<'passed' | 'failed'>): number {
  let count = 0;
  for (let i = 1; i < statuses.length; i++) {
    if (statuses[i] !== statuses[i - 1]) {
      count++;
    }
  }
  return count;
}

/**
 * Detect flaky tests from run history.
 *
 * A test is considered flaky if its flakiness score exceeds FLAKY_THRESHOLD (0.3).
 * Score = alternations / (total runs - 1), clamped to [0, 1].
 *
 * @param runs - Array of test results across multiple runs
 * @returns Array of flaky tests sorted by flakiness score descending
 */
export function detectFlakyTests(runs: TestResult[]): FlakyTest[] {
  // Group results by testId
  const byTest = new Map<string, TestResult[]>();
  for (const result of runs) {
    const existing = byTest.get(result.testId);
    if (existing) {
      existing.push(result);
    } else {
      byTest.set(result.testId, [result]);
    }
  }

  const flaky: FlakyTest[] = [];

  for (const [testId, results] of byTest) {
    if (results.length < 2) {
      // Need at least 2 runs to detect flakiness
      continue;
    }

    // Take the most recent N runs
    const recent = results.slice(-RECENT_RUNS_WINDOW);
    const statuses = recent.map((r) => r.status);
    const alternations = countAlternations(statuses);
    const score = alternations / (statuses.length - 1);

    if (score > FLAKY_THRESHOLD) {
      const last = results[results.length - 1];
      flaky.push({
        testId,
        testName: last.testName,
        suiteName: last.suiteName ?? '',
        flakinessScore: score,
        recentResults: statuses,
      });
    }
  }

  return flaky.sort((a, b) => b.flakinessScore - a.flakinessScore);
}
