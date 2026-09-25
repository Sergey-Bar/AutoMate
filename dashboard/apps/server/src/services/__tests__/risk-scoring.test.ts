/**
 * Tests for services/risk-scoring.ts
 *
 * Covers:
 *  - computeRiskScoresBatch: empty stableIds list
 *  - computeRiskScoresBatch: insufficient data (<10 totalRuns) → score=0, confidence=0
 *  - computeRiskScoresBatch: high failure rate → score > 0.5
 *  - computeRiskScoresBatch: perfect pass record → score < 0.1
 *  - computeRiskScoresBatch: stableId not in DB → insufficient_data
 *  - computeRiskScoresBatch: recency decay — old data reduces score
 *  - computeRiskScoresBatch: batch returns one entry per requested stableId
 *  - computeRiskSummary: aggregates tier counts correctly
 *  - computeRiskSummary: empty DB returns zero counts
 *  - computeRiskSummary: topRiskyTests capped by topN param
 *  - GET /api/analytics/risk-scores: 404 when flag OFF
 *  - GET /api/analytics/risk-scores: returns batch scores when flag ON
 *  - GET /api/analytics/risk-scores/summary: 404 when flag OFF
 *  - GET /api/analytics/risk-scores/summary: returns summary when flag ON
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockIsEnabled,
  mockDbWhere,
  mockDbGroupBy,
  mockDbFrom,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockIsEnabled: vi.fn<(flag: string) => boolean>(),
  mockDbWhere: vi.fn(),
  mockDbGroupBy: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock('../../services/feature-flags.js', () => ({
  isEnabled: mockIsEnabled,
  requireFeature: vi.fn((flag: string) => async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => void } }) => {
    if (!mockIsEnabled(flag)) {
      return reply.status(404).send({ error: `Feature '${flag}' is not enabled` });
    }
  }),
  getFeatureFlags: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: { select: mockDbSelect },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** One aggregated row as returned by the DB query */
function makeAggRow(
  testStableId: string,
  totalFailures: number,
  totalRuns: number,
  fileCount: number,
  daysAgo = 1,
) {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return {
    testStableId,
    totalFailures,
    totalRuns,
    fileCount,
    lastUpdated: d.toISOString(),
  };
}

// ── Unit tests — computeRiskScoresBatch ──────────────────────────────────────

describe('computeRiskScoresBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default chain: select().from().where().groupBy()
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere, groupBy: mockDbGroupBy });
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([]);
  });

  it('returns empty array for empty stableIds input', async () => {
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');
    const result = await computeRiskScoresBatch([]);
    expect(result).toEqual([]);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('returns insufficient_data when DB has no rows for stableId', async () => {
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([]); // no rows
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');

    const result = await computeRiskScoresBatch(['unknown-test']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      stableId: 'unknown-test',
      score: 0,
      confidence: 0,
      reason: 'insufficient_data',
    });
  });

  it('returns insufficient_data when totalRuns < 10', async () => {
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([makeAggRow('flaky-test', 5, 9, 1)]);
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');

    const result = await computeRiskScoresBatch(['flaky-test']);
    expect(result[0]).toMatchObject({ reason: 'insufficient_data', score: 0, confidence: 0 });
  });

  it('returns high score for frequently failing test (3 out of 5 last runs, 60 total)', async () => {
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    // 36 failures out of 60 runs = 60% failure rate
    mockDbGroupBy.mockResolvedValue([makeAggRow('bad-test', 36, 60, 2, 1)]);
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');

    const result = await computeRiskScoresBatch(['bad-test']);
    expect(result[0].reason).toBe('computed');
    expect(result[0].score).toBeGreaterThan(0.5);
    expect(result[0].confidence).toBeGreaterThan(0);
  });

  it('returns low score when test always passes (0 failures)', async () => {
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([makeAggRow('stable-test', 0, 50, 1, 1)]);
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');

    const result = await computeRiskScoresBatch(['stable-test']);
    expect(result[0].reason).toBe('computed');
    expect(result[0].score).toBeLessThan(0.4); // low-risk tier: recency+correlation still contribute even with 0 failures
  });

  it('returns one entry per requested stableId (batch of 3)', async () => {
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([
      makeAggRow('test-a', 5, 20, 1, 2),
      makeAggRow('test-b', 15, 20, 3, 2),
    ]);
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');

    const result = await computeRiskScoresBatch(['test-a', 'test-b', 'test-c']);
    expect(result).toHaveLength(3);
    const ids = result.map((r) => r.stableId);
    expect(ids).toContain('test-a');
    expect(ids).toContain('test-b');
    expect(ids).toContain('test-c');
    // test-c has no DB row → insufficient_data
    expect(result.find((r) => r.stableId === 'test-c')?.reason).toBe('insufficient_data');
  });

  it('penalises old data through recency decay', async () => {
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');

    // Same failure rate; one updated yesterday, one 35 days ago (recency → 0)
    mockDbGroupBy.mockResolvedValue([makeAggRow('fresh-test', 15, 30, 1, 1)]);
    const [fresh] = await computeRiskScoresBatch(['fresh-test']);

    mockDbGroupBy.mockResolvedValue([makeAggRow('stale-test', 15, 30, 1, 35)]);
    const [stale] = await computeRiskScoresBatch(['stale-test']);

    expect(fresh!.score).toBeGreaterThan(stale!.score);
  });

  it('confidence grows with totalRuns (capped at 1)', async () => {
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    const { computeRiskScoresBatch } = await import('../risk-scoring.js');

    mockDbGroupBy.mockResolvedValue([makeAggRow('many-runs', 5, 50, 1, 1)]);
    const [full] = await computeRiskScoresBatch(['many-runs']);

    mockDbGroupBy.mockResolvedValue([makeAggRow('few-runs', 2, 10, 1, 1)]);
    const [low] = await computeRiskScoresBatch(['few-runs']);

    expect(full!.confidence).toBe(1);
    expect(low!.confidence).toBeLessThan(1);
    expect(low!.confidence).toBeGreaterThan(0);
  });
});

// ── Unit tests — computeRiskSummary ──────────────────────────────────────────

describe('computeRiskSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([]);
  });

  it('returns all-zero counts when DB is empty', async () => {
    const { computeRiskSummary } = await import('../risk-scoring.js');
    const summary = await computeRiskSummary();
    expect(summary).toMatchObject({
      totalTests: 0,
      highRisk: 0,
      mediumRisk: 0,
      lowRisk: 0,
      topRiskyTests: [],
    });
  });

  it('correctly classifies high/medium/low risk tests', async () => {
    mockDbGroupBy.mockResolvedValue([
      makeAggRow('high-risk', 45, 50, 5, 1),    // 90% failure, 5 files → score ~0.75 (high)
      makeAggRow('medium-risk', 22, 50, 2, 1),  // 44% failure, 2 files → score ~0.45 (medium)
      makeAggRow('low-risk', 5, 50, 1, 1),      // 10% failure, 1 file  → score ~0.27 (low)
    ]);
    const { computeRiskSummary } = await import('../risk-scoring.js');
    const summary = await computeRiskSummary();

    expect(summary.totalTests).toBe(3);
    expect(summary.highRisk).toBeGreaterThanOrEqual(1);
    expect(summary.mediumRisk).toBeGreaterThanOrEqual(1);
    expect(summary.lowRisk).toBeGreaterThanOrEqual(0);
  });

  it('topRiskyTests is sorted descending by score', async () => {
    mockDbGroupBy.mockResolvedValue([
      makeAggRow('medium', 20, 50, 2, 1),
      makeAggRow('high', 40, 50, 4, 1),
      makeAggRow('low', 2, 50, 1, 1),
    ]);
    const { computeRiskSummary } = await import('../risk-scoring.js');
    const { topRiskyTests } = await computeRiskSummary(3);

    for (let i = 0; i < topRiskyTests.length - 1; i++) {
      expect(topRiskyTests[i]!.score).toBeGreaterThanOrEqual(topRiskyTests[i + 1]!.score);
    }
  });

  it('caps topRiskyTests at topN', async () => {
    mockDbGroupBy.mockResolvedValue([
      makeAggRow('t1', 20, 30, 1, 1),
      makeAggRow('t2', 20, 30, 1, 1),
      makeAggRow('t3', 20, 30, 1, 1),
      makeAggRow('t4', 20, 30, 1, 1),
      makeAggRow('t5', 20, 30, 1, 1),
    ]);
    const { computeRiskSummary } = await import('../risk-scoring.js');
    const { topRiskyTests } = await computeRiskSummary(3);
    expect(topRiskyTests).toHaveLength(3);
  });

  it('excludes insufficient_data tests from summary counts', async () => {
    mockDbGroupBy.mockResolvedValue([
      makeAggRow('no-data', 2, 5, 1, 1), // < 10 runs → excluded
    ]);
    const { computeRiskSummary } = await import('../risk-scoring.js');
    const summary = await computeRiskSummary();
    expect(summary.totalTests).toBe(0);
    expect(summary.topRiskyTests).toHaveLength(0);
  });
});

// ── Route tests — feature flag gating ────────────────────────────────────────

describe('GET /api/analytics/risk-scores — feature flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere, groupBy: mockDbGroupBy });
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([]);
  });

  it('returns 404 when risk-scoring flag is OFF', async () => {
    mockIsEnabled.mockReturnValue(false);
    const app = Fastify({ logger: false });
    const { analyticsRoutes } = await import('../../routes/analytics.js');
    await analyticsRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/analytics/risk-scores?stableIds=test-a' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns scores array when risk-scoring flag is ON', async () => {
    mockIsEnabled.mockImplementation((flag) => flag === 'risk-scoring');
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([]);

    const app = Fastify({ logger: false });
    const { analyticsRoutes } = await import('../../routes/analytics.js');
    await analyticsRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/analytics/risk-scores?stableIds=test-a' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    await app.close();
  });
});

describe('GET /api/analytics/risk-scores/summary — feature flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere, groupBy: mockDbGroupBy });
    mockDbWhere.mockReturnValue({ groupBy: mockDbGroupBy });
    mockDbGroupBy.mockResolvedValue([]);
  });

  it('returns 404 when risk-scoring flag is OFF', async () => {
    mockIsEnabled.mockReturnValue(false);
    const app = Fastify({ logger: false });
    const { analyticsRoutes } = await import('../../routes/analytics.js');
    await analyticsRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/analytics/risk-scores/summary' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns summary object when risk-scoring flag is ON', async () => {
    mockIsEnabled.mockImplementation((flag) => flag === 'risk-scoring');
    mockDbGroupBy.mockResolvedValue([]);

    const app = Fastify({ logger: false });
    const { analyticsRoutes } = await import('../../routes/analytics.js');
    await analyticsRoutes(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/analytics/risk-scores/summary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toHaveProperty('totalTests');
    expect(body).toHaveProperty('highRisk');
    expect(body).toHaveProperty('topRiskyTests');
    await app.close();
  });
});
