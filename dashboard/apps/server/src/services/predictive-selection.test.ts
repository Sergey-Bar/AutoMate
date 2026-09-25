import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAnalyzeImpact, mockGetImpactedTests, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockAnalyzeImpact = vi.fn();
  const mockGetImpactedTests = vi.fn();
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return { mockAnalyzeImpact, mockGetImpactedTests, mockWhere, mockFrom, mockSelect };
});

vi.mock('./impact-analysis.js', () => ({
  analyzeImpact: mockAnalyzeImpact,
  getImpactedTests: mockGetImpactedTests,
}));

vi.mock('../db/client.js', () => ({
  db: { select: mockSelect },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

describe('predictive-selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeImpact.mockResolvedValue([]);
    mockGetImpactedTests.mockResolvedValue([]);
    mockWhere.mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('computeHistoricalRisk returns 0 when all correlations have runCount of zero', async () => {
    const { computeHistoricalRisk } = await import('./predictive-selection.js');
    // Non-empty input but all entries have runCount 0 → filtered out → likelihoods.length === 0 → return 0
    expect(computeHistoricalRisk([{ failureCount: 5, runCount: 0 }, { failureCount: 3, runCount: 0 }])).toBe(0);
  });

  it('computeScore returns weighted value (0.65 * static + 0.35 * historical)', async () => {
    const { computeScore } = await import('./predictive-selection.js');

    expect(computeScore(1, 0.4)).toBeCloseTo(0.79, 10);
    expect(computeScore(0.5, 1)).toBeCloseTo(0.675, 10);
  });

  it('computeHistoricalRisk normalizes failure likelihood across correlations', async () => {
    const { computeHistoricalRisk } = await import('./predictive-selection.js');

    expect(
      computeHistoricalRisk([
        { failureCount: 2, runCount: 4 },
        { failureCount: 1, runCount: 2 },
      ]),
    ).toBeCloseTo(0.5, 10);
    expect(computeHistoricalRisk([])).toBe(0);
  });

  it('cold-start mode (< 20 runs) uses static-only with historicalRisk = 0', async () => {
    const { getPredictiveCandidates, COLD_START_THRESHOLD } = await import('./predictive-selection.js');

    mockGetImpactedTests.mockResolvedValue([
      { testFile: 'apps/server/src/services/a.test.ts', title: 'A', reason: 'Imports source-a.ts' },
      {
        testFile: 'apps/server/src/services/b.test.ts',
        title: 'B',
        reason: 'Imports source-b.ts via helper.ts',
      },
    ]);

    mockWhere.mockResolvedValue([
      {
        testStableId: 'apps/server/src/services/a.test.ts',
        sourceFilePath: 'source-a.ts',
        failureCount: 5,
        totalOccurrences: 10,
      },
      {
        testStableId: 'apps/server/src/services/b.test.ts',
        sourceFilePath: 'source-b.ts',
        failureCount: 2,
        totalOccurrences: 9,
      },
    ]);

    const result = await getPredictiveCandidates(['source-a.ts', 'source-b.ts'], 'tests');

    expect(result.mode).toBe('static_only');
    expect(result.totalHistoricalRuns).toBeLessThan(COLD_START_THRESHOLD);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].historicalRisk).toBe(0);
    expect(result.candidates[1].historicalRisk).toBe(0);
    expect(result.candidates[0].score).toBe(0.65);
    expect(result.candidates[1].score).toBe(0.325);
  });

  it('full mode includes static and historical components in score', async () => {
    const { getPredictiveCandidates, WEIGHTS } = await import('./predictive-selection.js');

    mockGetImpactedTests.mockResolvedValue([
      { testFile: 'apps/server/src/services/high.test.ts', title: 'High', reason: 'Imports source-high.ts' },
      {
        testFile: 'apps/server/src/services/low.test.ts',
        title: 'Low',
        reason: 'Imports source-low.ts via helper.ts',
      },
    ]);

    mockWhere.mockResolvedValue([
      {
        testStableId: 'apps/server/src/services/high.test.ts',
        sourceFilePath: 'source-high.ts',
        failureCount: 16,
        totalOccurrences: 20,
      },
      {
        testStableId: 'apps/server/src/services/low.test.ts',
        sourceFilePath: 'source-low.ts',
        failureCount: 2,
        totalOccurrences: 10,
      },
    ]);

    const result = await getPredictiveCandidates(['source-high.ts', 'source-low.ts'], 'tests');

    expect(result.mode).toBe('full');
    expect(result.candidates).toHaveLength(2);

    const high = result.candidates.find((c) => c.testFile.endsWith('high.test.ts'));
    const low = result.candidates.find((c) => c.testFile.endsWith('low.test.ts'));
    expect(high).toBeDefined();
    expect(low).toBeDefined();

    expect(high!.staticImpact).toBe(1);
    expect(high!.historicalRisk).toBeCloseTo(0.8, 10);
    expect(high!.score).toBeCloseTo(WEIGHTS.static * 1 + WEIGHTS.historical * 0.8, 10);

    expect(low!.staticImpact).toBe(0.5);
    expect(low!.historicalRisk).toBeCloseTo(0.2, 10);
    expect(low!.score).toBeCloseTo(WEIGHTS.static * 0.5 + WEIGHTS.historical * 0.2, 10);
  });

  it('candidates are sorted by score descending', async () => {
    const { getPredictiveCandidates } = await import('./predictive-selection.js');

    mockGetImpactedTests.mockResolvedValue([
      { testFile: 'tests/top.test.ts', title: 'Top', reason: 'Imports top.ts' },
      { testFile: 'tests/bottom.test.ts', title: 'Bottom', reason: 'Imports bottom.ts via mid.ts' },
    ]);
    mockWhere.mockResolvedValue([
      { testStableId: 'tests/top.test.ts', sourceFilePath: 'top.ts', failureCount: 18, totalOccurrences: 20 },
      {
        testStableId: 'tests/bottom.test.ts',
        sourceFilePath: 'bottom.ts',
        failureCount: 1,
        totalOccurrences: 10,
      },
    ]);

    const result = await getPredictiveCandidates(['top.ts', 'bottom.ts'], 'tests');

    expect(result.candidates[0].score).toBeGreaterThanOrEqual(result.candidates[1].score);
    expect(result.candidates[0].testFile).toBe('tests/top.test.ts');
  });

  it('score breakdown and backward-compatible fields are included in each candidate', async () => {
    const { getPredictiveCandidates } = await import('./predictive-selection.js');

    mockGetImpactedTests.mockResolvedValue([
      { testFile: 'tests/a.test.ts', title: 'A', reason: 'Imports a.ts' },
    ]);
    mockWhere.mockResolvedValue([
      { testStableId: 'tests/a.test.ts', sourceFilePath: 'a.ts', failureCount: 10, totalOccurrences: 20 },
    ]);

    const result = await getPredictiveCandidates(['a.ts'], 'tests');
    const candidate = result.candidates[0];

    expect(candidate).toMatchObject({
      testFile: 'tests/a.test.ts',
      title: 'A',
      reason: expect.any(String),
      score: expect.any(Number),
      staticImpact: expect.any(Number),
      historicalRisk: expect.any(Number),
    });
  });

  it('empty changed files returns empty candidates', async () => {
    const { getPredictiveCandidates } = await import('./predictive-selection.js');

    const result = await getPredictiveCandidates([], 'tests');

    expect(result.candidates).toEqual([]);
    expect(result.mode).toBe('static_only');
    expect(result.totalHistoricalRuns).toBe(0);
  });

  it('uses getImpactedTests with testDir and falls back to analyzeImpact when unavailable', async () => {
    const { getPredictiveCandidates } = await import('./predictive-selection.js');

    mockGetImpactedTests.mockResolvedValue([
      { testFile: 'tests/primary.test.ts', title: 'Primary', reason: 'Imports primary.ts' },
    ]);
    mockWhere.mockResolvedValue([
      { testId: 'tests/primary.test.ts', sourceFile: 'primary.ts', failureCount: 15, runCount: 25 },
    ]);

    const result = await getPredictiveCandidates(['primary.ts'], 'apps/server/tests');

    expect(mockGetImpactedTests).toHaveBeenCalledWith(['primary.ts'], 'apps/server/tests');
    expect(mockAnalyzeImpact).not.toHaveBeenCalled();
    expect(result.candidates[0]).toMatchObject({
      testFile: 'tests/primary.test.ts',
      title: 'Primary',
      reason: expect.any(String),
    });
  });

  it('mode is correctly set to full at threshold and static_only below threshold', async () => {
    const { getPredictiveCandidates, COLD_START_THRESHOLD } = await import('./predictive-selection.js');

    mockGetImpactedTests.mockResolvedValue([
      { testFile: 'tests/threshold.test.ts', title: 'Threshold', reason: 'Imports threshold.ts' },
    ]);

    mockWhere.mockResolvedValue([
      {
        testId: 'tests/threshold.test.ts',
        sourceFile: 'threshold.ts',
        failureCount: 4,
        runCount: COLD_START_THRESHOLD,
      },
    ]);

    const atThreshold = await getPredictiveCandidates(['threshold.ts'], 'tests');
    expect(atThreshold.mode).toBe('full');

    mockWhere.mockResolvedValue([
      {
        testId: 'tests/threshold.test.ts',
        sourceFile: 'threshold.ts',
        failureCount: 3,
        runCount: COLD_START_THRESHOLD - 1,
      },
    ]);

    const belowThreshold = await getPredictiveCandidates(['threshold.ts'], 'tests');
    expect(belowThreshold.mode).toBe('static_only');
  });
});
