import { describe, it, expect } from 'vitest';
import { detectFlakyTests } from './flaky-detection.js';
import type { TestResult } from './flaky-detection.js';

function makeResult(
  testId: string,
  testName: string,
  status: 'passed' | 'failed',
  runId: string,
  suiteName?: string,
): TestResult {
  return { testId, testName, status, runId, suiteName };
}

describe('detectFlakyTests', () => {
  it('identifies a test that alternates pass/fail as flaky', () => {
    const runs: TestResult[] = [
      makeResult('t1', 'login test', 'passed', 'r1', 'Auth'),
      makeResult('t1', 'login test', 'failed', 'r2', 'Auth'),
      makeResult('t1', 'login test', 'passed', 'r3', 'Auth'),
      makeResult('t1', 'login test', 'failed', 'r4', 'Auth'),
    ];
    const result = detectFlakyTests(runs);
    expect(result).toHaveLength(1);
    expect(result[0].testId).toBe('t1');
    expect(result[0].flakinessScore).toBeGreaterThan(0.3);
  });

  it('returns score 0 (non-flaky) for a test that always passes', () => {
    const runs: TestResult[] = [
      makeResult('t2', 'stable test', 'passed', 'r1'),
      makeResult('t2', 'stable test', 'passed', 'r2'),
      makeResult('t2', 'stable test', 'passed', 'r3'),
    ];
    const result = detectFlakyTests(runs);
    expect(result).toHaveLength(0);
  });

  it('returns non-flaky for a test that always fails', () => {
    const runs: TestResult[] = [
      makeResult('t3', 'broken test', 'failed', 'r1'),
      makeResult('t3', 'broken test', 'failed', 'r2'),
      makeResult('t3', 'broken test', 'failed', 'r3'),
    ];
    const result = detectFlakyTests(runs);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for a single run (cannot determine flakiness)', () => {
    const runs: TestResult[] = [
      makeResult('t4', 'single run test', 'passed', 'r1'),
    ];
    const result = detectFlakyTests(runs);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const result = detectFlakyTests([]);
    expect(result).toHaveLength(0);
  });

  it('correctly computes flakiness score as alternations / (runs - 1)', () => {
    // 3 alternations in 4 runs → score = 3/3 = 1.0
    const runs: TestResult[] = [
      makeResult('t5', 'very flaky', 'passed', 'r1'),
      makeResult('t5', 'very flaky', 'failed', 'r2'),
      makeResult('t5', 'very flaky', 'passed', 'r3'),
      makeResult('t5', 'very flaky', 'failed', 'r4'),
    ];
    const result = detectFlakyTests(runs);
    expect(result[0].flakinessScore).toBeCloseTo(1.0);
  });

  it('sorts results by flakiness score descending', () => {
    // t6: 1 alternation in 4 runs → score = 1/3 ≈ 0.33 (flaky)
    // t7: 3 alternations in 4 runs → score = 3/3 = 1.0 (more flaky)
    const runs: TestResult[] = [
      makeResult('t6', 'mildly flaky', 'passed', 'r1'),
      makeResult('t6', 'mildly flaky', 'failed', 'r2'),
      makeResult('t6', 'mildly flaky', 'failed', 'r3'),
      makeResult('t6', 'mildly flaky', 'failed', 'r4'),
      makeResult('t7', 'very flaky', 'passed', 'r1'),
      makeResult('t7', 'very flaky', 'failed', 'r2'),
      makeResult('t7', 'very flaky', 'passed', 'r3'),
      makeResult('t7', 'very flaky', 'failed', 'r4'),
    ];
    const result = detectFlakyTests(runs);
    expect(result[0].testId).toBe('t7');
    expect(result[1].testId).toBe('t6');
  });

  it('includes suiteName in the result', () => {
    const runs: TestResult[] = [
      makeResult('t8', 'suite test', 'passed', 'r1', 'My Suite'),
      makeResult('t8', 'suite test', 'failed', 'r2', 'My Suite'),
      makeResult('t8', 'suite test', 'passed', 'r3', 'My Suite'),
      makeResult('t8', 'suite test', 'failed', 'r4', 'My Suite'),
    ];
    const result = detectFlakyTests(runs);
    expect(result[0].suiteName).toBe('My Suite');
  });

  it('uses only the most recent 10 runs for scoring', () => {
    // First 5 runs: all pass (no alternations)
    // Last 10 runs: alternating (high score)
    const runs: TestResult[] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(makeResult('t9', 'windowed test', 'passed', `r${i}`));
    }
    // 10 alternating runs
    for (let i = 5; i < 15; i++) {
      runs.push(makeResult('t9', 'windowed test', i % 2 === 0 ? 'passed' : 'failed', `r${i}`));
    }
    const result = detectFlakyTests(runs);
    expect(result).toHaveLength(1);
    expect(result[0].recentResults).toHaveLength(10);
  });
});
